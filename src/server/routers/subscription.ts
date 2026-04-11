import { z } from 'zod';
import { router, orgMemberProcedure, orgAdminMutationProcedure } from '../trpc/init';
import { SubscriptionStatus } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { createBusinessError, dpaNotAcceptedError, provisioningDisabledError, offeringUnavailableError, offeringPriceMissingError, quantityOutOfRangeError, vendorUpstreamError } from '@/lib/errors';
import Decimal from 'decimal.js';
import { getAdapter, decryptCredentials } from '@/adapters';
import { VendorError } from '@/adapters/types';

export const subscriptionRouter = router({
  list: orgMemberProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        status: z.nativeEnum(SubscriptionStatus).optional(),
        bundleId: z.string().cuid().optional(),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.where?.status) where.status = input.where.status;
      if (input.where?.bundleId) where.bundleId = input.where.bundleId;

      const items = await ctx.db.subscription.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          bundle: true,
          licenses: true,
        },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  get: orgMemberProcedure
    .input(z.object({
      subscriptionId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const subscription = await ctx.db.subscription.findFirst({
        where: { id: input.subscriptionId },
        include: {
          bundle: true,
          licenses: { include: { productOffering: true } },
          vendorConnection: {
            select: { id: true, vendorType: true, status: true },
          },
        },
      });

      if (!subscription) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Subscription not found',
          errorCode: 'SUBSCRIPTION:LIFECYCLE:NOT_FOUND',
        });
      }

      return subscription;
    }),

  create: orgAdminMutationProcedure
    .input(z.object({
      productOfferingId: z.string().cuid(),
      quantity: z.number().int().positive(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');

      // Check DPA
      const dpa = await ctx.db.dpaAcceptance.findFirst({
        where: {},
        orderBy: { acceptedAt: 'desc' },
      });
      if (!dpa) {
        throw dpaNotAcceptedError(ctx.organizationId!, '2024-01');
      }

      // Check provisioning gate via RLS proxy
      const org = await ctx.db.organization.findUnique({
        where: { id: ctx.organizationId! },
        select: { provisioningEnabled: true },
      });
      if (!org?.provisioningEnabled) {
        throw provisioningDisabledError(ctx.organizationId!);
      }

      // Fetch the product offering
      const offering = await prisma.productOffering.findUnique({
        where: { id: input.productOfferingId },
        include: { bundle: true },
      });
      if (!offering) {
        throw offeringUnavailableError();
      }
      if (!offering.effectiveUnitCost) {
        throw offeringPriceMissingError(null, null);
      }

      // Check quantity bounds
      if (offering.minQuantity && input.quantity < offering.minQuantity) {
        throw quantityOutOfRangeError(offering.minQuantity, offering.maxQuantity, input.quantity);
      }
      if (offering.maxQuantity && input.quantity > offering.maxQuantity) {
        throw quantityOutOfRangeError(offering.minQuantity, offering.maxQuantity, input.quantity);
      }

      const unitCost = new Decimal(offering.effectiveUnitCost.toString());
      const grossAmount = unitCost.mul(input.quantity);
      const marginPercent = offering.partnerMarginPercent
        ? new Decimal(offering.partnerMarginPercent.toString())
        : new Decimal(0);
      const marginEarned = grossAmount.mul(marginPercent).div(100);

      // Find vendor connection
      const vendorConnection = await ctx.db.vendorConnection.findFirst({
        where: { vendorType: offering.sourceType },
      });
      if (!vendorConnection) {
        throw createBusinessError({
          code: 'PRECONDITION_FAILED',
          message: 'No active vendor connection for this distributor',
          errorCode: 'VENDOR:AUTH:DISCONNECTED',
          recovery: {
            action: 'REAUTH_VENDOR',
            label: 'Connect Vendor',
            params: { vendorType: offering.sourceType },
          },
        });
      }

      // Provision subscription on the vendor BEFORE creating local records.
      // If the vendor rejects, we fail fast without creating orphan records.
      const adapter = getAdapter(vendorConnection.vendorType);
      const credentials = decryptCredentials(vendorConnection.credentials);

      let vendorSubscription;
      try {
        vendorSubscription = await adapter.createSubscription(
          credentials,
          offering.externalSku,
          input.quantity,
        );
      } catch (error: unknown) {
        if (error instanceof VendorError) {
          throw vendorUpstreamError(vendorConnection.vendorType);
        }
        throw error;
      }

      // Create subscription, license, and purchase transaction
      const subscription = await ctx.db.subscription.create({
        data: {
          vendorConnectionId: vendorConnection.id,
          bundleId: offering.bundleId,
          externalId: vendorSubscription.externalId,
          status: 'ACTIVE',
          ...(vendorSubscription.commitmentEndDate
            ? { commitmentEndDate: vendorSubscription.commitmentEndDate }
            : {}),
        },
      });

      const license = await ctx.db.license.create({
        data: {
          subscriptionId: subscription.id,
          productOfferingId: offering.id,
          quantity: input.quantity,
        },
      });

      const purchaseTransaction = await ctx.db.purchaseTransaction.create({
        data: {
          productOfferingId: offering.id,
          quantity: input.quantity,
          grossAmount: grossAmount.toDecimalPlaces(2),
          ourMarginEarned: marginEarned.toDecimalPlaces(2),
          idempotencyKey: input.idempotencyKey,
          status: 'COMPLETED',
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'subscription.created',
        entityId: subscription.id,
        after: { subscriptionId: subscription.id, quantity: input.quantity },
        traceId: ctx.traceId,
      });

      return { subscription, license, purchaseTransaction };
    }),

  cancel: orgAdminMutationProcedure
    .input(z.object({
      subscriptionId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const subscription = await ctx.db.subscription.findFirst({
        where: { id: input.subscriptionId },
        include: { vendorConnection: true },
      });

      if (!subscription) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Subscription not found',
          errorCode: 'SUBSCRIPTION:LIFECYCLE:NOT_FOUND',
        });
      }

      const now = new Date();
      const isCommitted = subscription.commitmentEndDate && subscription.commitmentEndDate > now;

      if (isCommitted) {
        // Schedule cancellation
        const updated = await ctx.db.subscription.update({
          where: { id: subscription.id },
          data: { status: 'SUSPENDED' },
        });

        await writeAuditLog({
          db: ctx.db,
          organizationId: ctx.organizationId!,
          userId: ctx.userId,
          action: 'subscription.cancellation_scheduled',
          entityId: subscription.id,
          before: { status: subscription.status },
          after: { status: updated.status, scheduledDate: subscription.commitmentEndDate },
          traceId: ctx.traceId,
        });

        return { subscription: updated, scheduledDate: subscription.commitmentEndDate };
      }

      // Immediate cancellation — cancel on vendor first, then update locally.
      const adapter = getAdapter(subscription.vendorConnection.vendorType);
      const credentials = decryptCredentials(subscription.vendorConnection.credentials);
      try {
        await adapter.cancelSubscription(credentials, subscription.externalId);
      } catch (error: unknown) {
        if (error instanceof VendorError) {
          throw vendorUpstreamError(subscription.vendorConnection.vendorType);
        }
        throw error;
      }

      const updated = await ctx.db.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED' },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'subscription.cancelled',
        entityId: subscription.id,
        before: { status: subscription.status },
        after: { status: updated.status },
        traceId: ctx.traceId,
      });

      return { subscription: updated, scheduledDate: null };
    }),
});
