import { z } from 'zod';
import { router, orgMemberProcedure, orgAdminProcedure, orgAdminMutationProcedure } from '../trpc/init';
import { TransactionStatus } from '@prisma/client';
import { createBusinessError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { getStripeClient, createCheckoutSession as stripeCreateCheckout } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import Decimal from 'decimal.js';

export const billingRouter = router({
  // ── Payment Status ─────────────────────────────────────────────────

  getPaymentStatus: orgMemberProcedure
    .query(async ({ ctx }) => {
      const org = await ctx.db.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { billingType: true },
      });

      const stripeEnabled = getStripeClient() !== null && org.billingType === 'DIRECT_STRIPE';

      return {
        stripeEnabled,
        billingType: org.billingType,
      };
    }),

  // ── Checkout Session ───────────────────────────────────────────────

  createCheckoutSession: orgAdminMutationProcedure
    .input(z.object({
      productOfferingId: z.string().cuid(),
      quantity: z.number().int().min(1),
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId, userId, traceId } = ctx;

      // 1. Verify Stripe is available and org uses DIRECT_STRIPE billing
      const stripe = getStripeClient();
      if (!stripe) {
        throw createBusinessError({
          code: 'PRECONDITION_FAILED',
          message: 'Stripe is not configured on this server',
          errorCode: 'BILLING:CHECKOUT:STRIPE_NOT_CONFIGURED',
        });
      }

      const org = await db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { billingType: true },
      });

      if (org.billingType !== 'DIRECT_STRIPE') {
        throw createBusinessError({
          code: 'PRECONDITION_FAILED',
          message: 'Organization does not use Stripe billing',
          errorCode: 'BILLING:CHECKOUT:WRONG_BILLING_TYPE',
          recovery: {
            action: 'NONE',
            label: 'Contact administrator',
            params: { billingType: org.billingType },
          },
        });
      }

      // 2. Look up the ProductOffering to get pricing
      const offering = await db.productOffering.findUnique({
        where: { id: input.productOfferingId },
        include: { bundle: { include: { product: true } } },
      });

      if (!offering) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Product offering not found',
          errorCode: 'BILLING:CHECKOUT:OFFERING_NOT_FOUND',
        });
      }

      if (offering.effectiveUnitCost === null) {
        throw createBusinessError({
          code: 'PRECONDITION_FAILED',
          message: 'Product offering does not have pricing data — a catalog sync is required',
          errorCode: 'BILLING:CHECKOUT:PRICE_MISSING',
          recovery: {
            action: 'FORCE_SYNC',
            label: 'Sync Catalog',
          },
        });
      }

      // 3. Calculate amounts using Decimal.js — NEVER plain JS arithmetic
      const unitCost = new Decimal(offering.effectiveUnitCost.toString());
      const quantity = new Decimal(input.quantity);
      const grossAmount = unitCost.mul(quantity);

      // Margin calculation
      const marginPercent = offering.partnerMarginPercent
        ? new Decimal(offering.partnerMarginPercent.toString())
        : new Decimal(0);
      const ourMarginEarned = grossAmount.mul(marginPercent).div(100);

      // Convert to Stripe's smallest currency unit (cents for USD).
      // Decimal.mul(100) → round to integer to avoid floating-point drift.
      const unitAmountCents = unitCost.mul(100).round().toNumber();

      // 4. Create PurchaseTransaction in PENDING status
      const transaction = await db.purchaseTransaction.create({
        data: {
          organizationId,
          productOfferingId: input.productOfferingId,
          quantity: input.quantity,
          grossAmount: new Decimal(grossAmount.toFixed(2)),
          ourMarginEarned: new Decimal(ourMarginEarned.toFixed(2)),
          status: 'PENDING',
          idempotencyKey: input.idempotencyKey,
        },
      });

      // 5. Create the Stripe Checkout Session
      const displayName = offering.bundle?.product?.name
        ? `${offering.bundle.product.name} — ${offering.bundle.name}`
        : offering.bundle?.name ?? offering.externalSku;

      let checkoutSession;
      try {
        checkoutSession = await stripeCreateCheckout({
          organizationId,
          transactionId: transaction.id,
          lineItems: [{
            name: displayName,
            unitAmountCents,
            quantity: input.quantity,
            currency: offering.currency.toLowerCase(),
          }],
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
        });
      } catch (err) {
        // If Stripe call fails, mark the transaction as FAILED
        await db.purchaseTransaction.update({
          where: { id: transaction.id },
          data: { status: 'FAILED' },
        });

        logger.error('Stripe Checkout Session creation failed', {
          transactionId: transaction.id,
          organizationId,
          error: err instanceof Error ? err.message : String(err),
        });

        throw createBusinessError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create payment session — please try again',
          errorCode: 'BILLING:CHECKOUT:STRIPE_ERROR',
        });
      }

      // 6. Write audit log
      await writeAuditLog({
        db,
        organizationId,
        userId,
        action: 'billing.checkout_session_created',
        entityId: transaction.id,
        after: {
          transactionId: transaction.id,
          productOfferingId: input.productOfferingId,
          quantity: input.quantity,
          grossAmount: grossAmount.toFixed(2),
          ourMarginEarned: ourMarginEarned.toFixed(2),
          currency: offering.currency,
          stripeSessionId: checkoutSession.id,
        },
        traceId,
      });

      return {
        checkoutUrl: checkoutSession.url!,
        transactionId: transaction.id,
      };
    }),

  // ── Existing Procedures ────────────────────────────────────────────

  listTransactions: orgMemberProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        status: z.nativeEnum(TransactionStatus).optional(),
      }).optional(),
      orderBy: z.object({
        field: z.enum(['createdAt', 'grossAmount']),
        direction: z.enum(['asc', 'desc']).default('desc'),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.where?.status) where.status = input.where.status;

      const orderBy = input.orderBy
        ? { [input.orderBy.field]: input.orderBy.direction }
        : { createdAt: 'desc' as const };

      const items = await ctx.db.purchaseTransaction.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where,
        orderBy,
        include: {
          productOffering: {
            include: { bundle: true },
          },
        },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  getSnapshot: orgAdminProcedure
    .input(z.object({
      subscriptionId: z.string().cuid().optional(),
      periodStart: z.date().optional(),
      periodEnd: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.subscriptionId) where.subscriptionId = input.subscriptionId;
      if (input.periodStart) where.periodStart = { gte: input.periodStart };
      if (input.periodEnd) where.periodEnd = { lte: input.periodEnd };

      const snapshot = await ctx.db.billingSnapshot.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
      });

      if (!snapshot) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'No billing snapshot found for the specified period',
          errorCode: 'BILLING:SNAPSHOT:NOT_FOUND',
        });
      }

      return snapshot;
    }),

  projectInvoice: orgAdminProcedure
    .input(z.object({
      periodStart: z.date().optional(),
      periodEnd: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const periodStart = input.periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = input.periodEnd ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Get all active subscriptions for the org
      const subscriptions = await ctx.db.subscription.findMany({
        where: { status: 'ACTIVE' },
        include: {
          bundle: true,
          licenses: { include: { productOffering: true } },
          vendorConnection: { select: { vendorType: true } },
        },
      });

      let totalProjected = new Decimal(0);
      const lineItems = subscriptions.flatMap((sub: any) =>
        sub.licenses.map((lic: any) => {
          const unitCost = lic.productOffering?.effectiveUnitCost
            ? new Decimal(lic.productOffering.effectiveUnitCost.toString())
            : new Decimal(0);
          const lineTotal = unitCost.mul(lic.quantity);
          totalProjected = totalProjected.add(lineTotal);

          return {
            subscriptionId: sub.id,
            bundleName: sub.bundle.name,
            vendorType: sub.vendorConnection.vendorType,
            quantity: lic.quantity,
            unitCost: unitCost.toFixed(2),
            lineTotal: lineTotal.toFixed(2),
            pendingQuantity: lic.pendingQuantity,
            commitmentEndDate: sub.commitmentEndDate,
          };
        }),
      );

      return {
        periodStart,
        periodEnd,
        totalProjectedAmount: totalProjected.toFixed(2),
        lineItems,
      };
    }),

  createSnapshot: orgAdminMutationProcedure
    .input(z.object({
      periodStart: z.date().optional(),
      periodEnd: z.date().optional(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const periodStart = input.periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = input.periodEnd ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Idempotent: return existing snapshot for the same period if one exists
      const existing = await ctx.db.billingSnapshot.findFirst({
        where: { periodStart, periodEnd },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        return existing;
      }

      // Calculate projected invoice — same logic as projectInvoice
      const subscriptions = await ctx.db.subscription.findMany({
        where: { status: 'ACTIVE' },
        include: {
          bundle: true,
          licenses: { include: { productOffering: true } },
          vendorConnection: { select: { vendorType: true } },
        },
      });

      let totalProjected = new Decimal(0);
      const lineItems = subscriptions.flatMap((sub: any) =>
        sub.licenses.map((lic: any) => {
          const unitCost = lic.productOffering?.effectiveUnitCost
            ? new Decimal(lic.productOffering.effectiveUnitCost.toString())
            : new Decimal(0);
          const lineTotal = unitCost.mul(lic.quantity);
          totalProjected = totalProjected.add(lineTotal);

          return {
            subscriptionId: sub.id,
            bundleName: sub.bundle.name,
            vendorType: sub.vendorConnection.vendorType,
            quantity: lic.quantity,
            unitCost: unitCost.toFixed(2),
            lineTotal: lineTotal.toFixed(2),
            pendingQuantity: lic.pendingQuantity,
            commitmentEndDate: sub.commitmentEndDate,
          };
        }),
      );

      const snapshot = await ctx.db.billingSnapshot.create({
        data: {
          projectedAmount: new Decimal(totalProjected.toFixed(2)),
          periodStart,
          periodEnd,
          metadata: { lineItems },
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'billing.snapshot_created',
        entityId: snapshot.id,
        after: {
          projectedAmount: totalProjected.toFixed(2),
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          lineItemCount: lineItems.length,
        },
        traceId: ctx.traceId,
      });

      return snapshot;
    }),
});
