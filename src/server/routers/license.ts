import { z } from 'zod';
import { router, orgMemberProcedure, mspTechMutationProcedure, orgAdminMutationProcedure } from '../trpc/init';
import { writeAuditLog } from '@/lib/audit';
import { createBusinessError, offeringUnavailableError, pendingScaleDownExistsError, quantityOutOfRangeError, vendorUpstreamError } from '@/lib/errors';
import { getAdapter, decryptCredentials } from '@/adapters';
import { VendorError } from '@/adapters/types';
import { inngest } from '@/inngest/client';
import Decimal from 'decimal.js';

/**
 * Returns subscription IDs belonging to the current org.
 * Used to scope License queries (License lacks organizationId).
 */
async function getOrgSubscriptionIds(db: any): Promise<string[]> {
  const subscriptions = await db.subscription.findMany({ select: { id: true } });
  return subscriptions.map((s: any) => s.id);
}

/**
 * Finds a license scoped to the current org via the subscription join.
 * Returns null if the license doesn't exist or doesn't belong to this org.
 *
 * NOTE: License model lacks organizationId, so it's not in DIRECT_ORG_MODELS
 * and can't be scoped by the RLS proxy directly. We scope indirectly by
 * fetching org-scoped subscription IDs via the RLS proxy, then querying
 * raw prisma with those IDs as a filter.
 */
async function findOrgScopedLicense(
  db: any,
  licenseId: string,
  include?: Record<string, unknown>,
): Promise<any> {
  const { prisma } = await import('@/lib/db');
  const subscriptionIds = await getOrgSubscriptionIds(db);
  if (subscriptionIds.length === 0) return null;

  return prisma.license.findFirst({
    where: { id: licenseId, subscriptionId: { in: subscriptionIds } },
    ...(include ? { include } : {}),
  });
}

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
      const subscriptionIds = await getOrgSubscriptionIds(ctx.db);

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
      const license = await findOrgScopedLicense(ctx.db, input.licenseId, {
        subscription: { include: { bundle: true } },
        productOffering: true,
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

      const license = await findOrgScopedLicense(ctx.db, input.licenseId, {
        productOffering: true,
        subscription: { include: { vendorConnection: true } },
      });

      if (!license) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'License not found',
          errorCode: 'LICENSE:QUANTITY:NOT_FOUND',
        });
      }

      // Validate productOfferingId BEFORE any writes
      if (!license.productOfferingId) {
        throw offeringUnavailableError();
      }

      if (input.newQuantity <= license.quantity) {
        throw quantityOutOfRangeError(license.quantity + 1, license.productOffering?.maxQuantity ?? null, input.newQuantity);
      }

      if (license.productOffering?.maxQuantity && input.newQuantity > license.productOffering.maxQuantity) {
        throw quantityOutOfRangeError(
          license.productOffering.minQuantity,
          license.productOffering.maxQuantity,
          input.newQuantity,
        );
      }

      // Call vendor API to update quantity BEFORE local record update.
      // If the vendor rejects, we throw and local state stays consistent.
      try {
        const adapter = getAdapter(license.subscription.vendorConnection.vendorType);
        const credentials = decryptCredentials(license.subscription.vendorConnection.credentials);
        await adapter.setQuantity(credentials, license.subscription.externalId, input.newQuantity);
      } catch (error) {
        if (error instanceof VendorError) {
          throw vendorUpstreamError(license.subscription.vendorConnection.vendorType);
        }
        throw error;
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

      const license = await findOrgScopedLicense(ctx.db, input.licenseId, {
        productOffering: true,
        subscription: { include: { vendorConnection: true } },
      });

      if (!license) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'License not found',
          errorCode: 'LICENSE:QUANTITY:NOT_FOUND',
        });
      }

      if (input.newQuantity >= license.quantity) {
        throw quantityOutOfRangeError(0, license.quantity - 1, input.newQuantity);
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

        // Dispatch the durable workflow to execute the scale-down at commitment end
        await inngest.send({
          name: 'license/scale-down.staged',
          data: {
            licenseId: license.id,
            organizationId: ctx.organizationId!,
            commitmentEndDate: license.subscription.commitmentEndDate!.toISOString(),
            userId: ctx.userId,
            traceId: ctx.traceId,
          },
        });

        return {
          license: updated,
          isStaged: true,
          commitmentEndDate: license.subscription.commitmentEndDate,
          inngestRunId,
        };
      }

      // Immediate scale-down — call vendor API before local update
      try {
        const adapter = getAdapter(license.subscription.vendorConnection.vendorType);
        const credentials = decryptCredentials(license.subscription.vendorConnection.credentials);
        await adapter.setQuantity(credentials, license.subscription.externalId, input.newQuantity);
      } catch (error) {
        if (error instanceof VendorError) {
          throw vendorUpstreamError(license.subscription.vendorConnection.vendorType);
        }
        throw error;
      }

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

      const license = await findOrgScopedLicense(ctx.db, input.licenseId);

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

  importLicenses: orgAdminMutationProcedure
    .input(z.object({
      records: z.array(z.object({
        productOfferingId: z.string().cuid(),
        quantity: z.number().int().positive(),
      })).min(1).max(500),
      idempotencyKey: z.string().uuid(),
    }))
    .output(z.object({
      imported: z.number().int(),
      skipped: z.number().int(),
      results: z.array(z.object({
        index: z.number().int(),
        status: z.enum(['SUCCESS', 'SKIPPED', 'ERROR']),
        licenseId: z.string().nullable(),
        error: z.string().nullable(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');

      let imported = 0;
      let skipped = 0;
      const results: Array<{
        index: number;
        status: 'SUCCESS' | 'SKIPPED' | 'ERROR';
        licenseId: string | null;
        error: string | null;
      }> = [];

      for (let i = 0; i < input.records.length; i++) {
        const record = input.records[i];
        try {
          // Validate offering exists
          const offering = await prisma.productOffering.findUnique({
            where: { id: record.productOfferingId },
            include: { bundle: true },
          });

          if (!offering) {
            results.push({ index: i, status: 'SKIPPED', licenseId: null, error: 'Product offering not found' });
            skipped++;
            continue;
          }

          // Check quantity bounds
          if (offering.minQuantity && record.quantity < offering.minQuantity) {
            results.push({ index: i, status: 'SKIPPED', licenseId: null, error: `Quantity ${record.quantity} below minimum ${offering.minQuantity}` });
            skipped++;
            continue;
          }
          if (offering.maxQuantity && record.quantity > offering.maxQuantity) {
            results.push({ index: i, status: 'SKIPPED', licenseId: null, error: `Quantity ${record.quantity} above maximum ${offering.maxQuantity}` });
            skipped++;
            continue;
          }

          // Find an existing active subscription for this bundle, or create one
          let subscription = await ctx.db.subscription.findFirst({
            where: { bundleId: offering.bundleId, status: 'ACTIVE' },
          });

          if (!subscription) {
            // Find a vendor connection for this source type
            const vendorConnection = await ctx.db.vendorConnection.findFirst({
              where: { vendorType: offering.sourceType },
            });

            if (!vendorConnection) {
              results.push({ index: i, status: 'SKIPPED', licenseId: null, error: `No vendor connection for ${offering.sourceType}` });
              skipped++;
              continue;
            }

            // Provision subscription on vendor before creating local records
            let vendorSubscription;
            try {
              const adapter = getAdapter(vendorConnection.vendorType);
              const credentials = decryptCredentials(vendorConnection.credentials);
              vendorSubscription = await adapter.createSubscription(
                credentials,
                offering.externalSku,
                record.quantity,
              );
            } catch (error) {
              const msg = error instanceof VendorError
                ? `Vendor API error: ${error.message}`
                : 'Failed to provision subscription on vendor';
              results.push({ index: i, status: 'SKIPPED', licenseId: null, error: msg });
              skipped++;
              continue;
            }

            subscription = await ctx.db.subscription.create({
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
          }

          // Create the license
          const license = await ctx.db.license.create({
            data: {
              subscriptionId: subscription.id,
              productOfferingId: offering.id,
              quantity: record.quantity,
            },
          });

          results.push({ index: i, status: 'SUCCESS', licenseId: license.id, error: null });
          imported++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unexpected error during import';
          results.push({ index: i, status: 'ERROR', licenseId: null, error: msg });
          skipped++;
        }
      }

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'license.bulk_import',
        entityId: ctx.organizationId!,
        after: { imported, skipped, total: input.records.length },
        traceId: ctx.traceId,
      });

      return { imported, skipped, results };
    }),
});
