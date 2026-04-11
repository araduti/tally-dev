import { z } from 'zod';
import { router, orgMemberProcedure, orgAdminProcedure, orgAdminMutationProcedure } from '../trpc/init';
import { TransactionStatus } from '@prisma/client';
import { createBusinessError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import Decimal from 'decimal.js';

export const billingRouter = router({
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
