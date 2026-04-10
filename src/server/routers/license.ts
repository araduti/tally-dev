import { z } from 'zod';
import { router, orgMemberProcedure, mspTechMutationProcedure } from '../trpc/init';
import { writeAuditLog } from '@/lib/audit';
import { createBusinessError, pendingScaleDownExistsError, quantityOutOfRangeError } from '@/lib/errors';
import Decimal from 'decimal.js';

export const licenseRouter = router({
  list: orgMemberProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        subscriptionId: z.string().cuid().optional(),
        hasPendingScaleDown: z.boolean().optional(),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');
      // Licenses are scoped via subscription, so we need a join
      const subscriptions = await ctx.db.subscription.findMany({
        select: { id: true },
      });
      const subscriptionIds = subscriptions.map((s: any) => s.id);

      const where: Record<string, unknown> = { subscriptionId: { in: subscriptionIds } };
      if (input.where?.subscriptionId) where.subscriptionId = input.where.subscriptionId;
      if (input.where?.hasPendingScaleDown === true) where.pendingQuantity = { not: null };
      if (input.where?.hasPendingScaleDown === false) where.pendingQuantity = null;

      const items = await prisma.license.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: { include: { bundle: true } },
          productOffering: true,
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
      licenseId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');
      // Verify org scope through subscription
      const subscriptions = await ctx.db.subscription.findMany({
        select: { id: true },
      });
      const subscriptionIds = subscriptions.map((s: any) => s.id);

      const license = await prisma.license.findFirst({
        where: { id: input.licenseId, subscriptionId: { in: subscriptionIds } },
        include: {
          subscription: { include: { bundle: true } },
          productOffering: true,
        },
      });

      if (!license) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'License not found',
          errorCode: 'LICENSE:QUANTITY:NOT_FOUND',
        });
      }

      return license;
    }),

  scaleUp: mspTechMutationProcedure
    .input(z.object({
      licenseId: z.string().cuid(),
      newQuantity: z.number().int().positive(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');
      // Verify org scope
      const subscriptions = await ctx.db.subscription.findMany({ select: { id: true } });
      const subscriptionIds = subscriptions.map((s: any) => s.id);

      const license = await prisma.license.findFirst({
        where: { id: input.licenseId, subscriptionId: { in: subscriptionIds } },
        include: { productOffering: true, subscription: true },
      });

      if (!license) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'License not found',
          errorCode: 'LICENSE:QUANTITY:NOT_FOUND',
        });
      }

      if (input.newQuantity <= license.quantity) {
        throw createBusinessError({
          code: 'BAD_REQUEST',
          message: 'New quantity must be greater than current quantity for scale-up',
          errorCode: 'LICENSE:QUANTITY:OUT_OF_RANGE',
          recovery: {
            action: 'NONE',
            label: 'Adjust quantity',
            params: { min: license.quantity + 1, max: license.productOffering?.maxQuantity, requested: input.newQuantity },
          },
        });
      }

      if (license.productOffering?.maxQuantity && input.newQuantity > license.productOffering.maxQuantity) {
        throw quantityOutOfRangeError(
          license.productOffering.minQuantity,
          license.productOffering.maxQuantity,
          input.newQuantity,
        );
      }

      const before = { quantity: license.quantity };

      const updated = await prisma.license.update({
        where: { id: license.id },
        data: { quantity: input.newQuantity },
      });

      // Create purchase transaction for the delta
      const delta = input.newQuantity - license.quantity;
      const unitCost = license.productOffering?.effectiveUnitCost
        ? new Decimal(license.productOffering.effectiveUnitCost.toString())
        : new Decimal(0);
      const grossAmount = unitCost.mul(delta);
      const marginPercent = license.productOffering?.partnerMarginPercent
        ? new Decimal(license.productOffering.partnerMarginPercent.toString())
        : new Decimal(0);
      const marginEarned = grossAmount.mul(marginPercent).div(100);

      if (!license.productOfferingId) {
        throw createBusinessError({
          code: 'PRECONDITION_FAILED',
          message: 'License has no associated product offering',
          errorCode: 'CATALOG:OFFERING:UNAVAILABLE',
        });
      }

      const purchaseTransaction = await ctx.db.purchaseTransaction.create({
        data: {
          productOfferingId: license.productOfferingId,
          quantity: delta,
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
        action: 'license.scale_up.executed',
        entityId: license.id,
        before,
        after: { quantity: updated.quantity },
        traceId: ctx.traceId,
      });

      return { license: updated, purchaseTransaction };
    }),

  scaleDown: mspTechMutationProcedure
    .input(z.object({
      licenseId: z.string().cuid(),
      newQuantity: z.number().int().min(0),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');
      const subscriptions = await ctx.db.subscription.findMany({ select: { id: true } });
      const subscriptionIds = subscriptions.map((s: any) => s.id);

      const license = await prisma.license.findFirst({
        where: { id: input.licenseId, subscriptionId: { in: subscriptionIds } },
        include: { productOffering: true, subscription: true },
      });

      if (!license) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'License not found',
          errorCode: 'LICENSE:QUANTITY:NOT_FOUND',
        });
      }

      if (input.newQuantity >= license.quantity) {
        throw createBusinessError({
          code: 'BAD_REQUEST',
          message: 'New quantity must be less than current quantity for scale-down',
          errorCode: 'LICENSE:QUANTITY:OUT_OF_RANGE',
          recovery: {
            action: 'NONE',
            label: 'Adjust quantity',
            params: { min: 0, max: license.quantity - 1, requested: input.newQuantity },
          },
        });
      }

      if (license.productOffering?.minQuantity && input.newQuantity < license.productOffering.minQuantity) {
        throw quantityOutOfRangeError(
          license.productOffering.minQuantity,
          license.productOffering.maxQuantity,
          input.newQuantity,
        );
      }

      if (license.pendingQuantity !== null) {
        throw pendingScaleDownExistsError(license.id, license.pendingQuantity, license.inngestRunId);
      }

      const now = new Date();
      const isCommitted = license.subscription.commitmentEndDate &&
        license.subscription.commitmentEndDate > now;

      if (isCommitted) {
        // Stage the scale-down
        const inngestRunId = `pending-${crypto.randomUUID()}`;
        const updated = await prisma.license.update({
          where: { id: license.id },
          data: {
            pendingQuantity: input.newQuantity,
            inngestRunId,
          },
        });

        await writeAuditLog({
          db: ctx.db,
          organizationId: ctx.organizationId!,
          userId: ctx.userId,
          action: 'license.scale_down.staged',
          entityId: license.id,
          before: { quantity: license.quantity },
          after: { pendingQuantity: input.newQuantity, inngestRunId },
          traceId: ctx.traceId,
        });

        return {
          license: updated,
          isStaged: true,
          commitmentEndDate: license.subscription.commitmentEndDate,
          inngestRunId,
        };
      }

      // Immediate scale-down
      const updated = await prisma.license.update({
        where: { id: license.id },
        data: { quantity: input.newQuantity },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'license.scale_down.executed',
        entityId: license.id,
        before: { quantity: license.quantity },
        after: { quantity: updated.quantity },
        traceId: ctx.traceId,
      });

      return {
        license: updated,
        isStaged: false,
        commitmentEndDate: null,
        inngestRunId: null,
      };
    }),

  cancelPendingScaleDown: mspTechMutationProcedure
    .input(z.object({
      licenseId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');
      const subscriptions = await ctx.db.subscription.findMany({ select: { id: true } });
      const subscriptionIds = subscriptions.map((s: any) => s.id);

      const license = await prisma.license.findFirst({
        where: { id: input.licenseId, subscriptionId: { in: subscriptionIds } },
      });

      if (!license) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'License not found',
          errorCode: 'LICENSE:QUANTITY:NOT_FOUND',
        });
      }

      if (license.pendingQuantity === null) {
        throw createBusinessError({
          code: 'BAD_REQUEST',
          message: 'No pending scale-down to cancel',
          errorCode: 'LICENSE:SCALE_DOWN:NO_PENDING',
        });
      }

      const before = {
        pendingQuantity: license.pendingQuantity,
        inngestRunId: license.inngestRunId,
      };

      const updated = await prisma.license.update({
        where: { id: license.id },
        data: {
          pendingQuantity: null,
          inngestRunId: null,
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'license.scale_down.cancelled',
        entityId: license.id,
        before,
        after: { pendingQuantity: null, inngestRunId: null },
        traceId: ctx.traceId,
      });

      return { license: updated };
    }),
});
