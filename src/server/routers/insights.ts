import { z } from 'zod';
import { router, orgMemberProcedure, orgAdminMutationProcedure } from '../trpc/init';
import { writeAuditLog } from '@/lib/audit';
import { createBusinessError } from '@/lib/errors';
import Decimal from 'decimal.js';

// ---------- Shared types ----------

interface RecommendationItem {
  type: 'RIGHT_SIZE' | 'COST_OPTIMIZATION' | 'COMMITMENT_SUGGESTION';
  title: string;
  description: string;
  potentialSavings: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  entityId: string;
  entityType: 'LICENSE' | 'SUBSCRIPTION';
}

interface WasteAlertItem {
  type: 'UNUSED_LICENSE' | 'OVER_PROVISIONED' | 'STALE_SUBSCRIPTION' | 'STALE_PENDING_SCALEDOWN';
  title: string;
  description: string;
  estimatedWaste: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  entityId: string;
  entityType: 'LICENSE' | 'SUBSCRIPTION';
  suggestedAction: string;
}

// ---------- Output sub-schemas ----------

const recommendationSchema = z.object({
  id: z.string(),
  type: z.enum(['RIGHT_SIZE', 'COST_OPTIMIZATION', 'COMMITMENT_SUGGESTION']),
  title: z.string(),
  description: z.string(),
  potentialSavings: z.string().nullable(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  entityId: z.string(),
  entityType: z.enum(['LICENSE', 'SUBSCRIPTION']),
});

const wasteAlertSchema = z.object({
  id: z.string(),
  type: z.enum(['UNUSED_LICENSE', 'OVER_PROVISIONED', 'STALE_SUBSCRIPTION', 'STALE_PENDING_SCALEDOWN']),
  title: z.string(),
  description: z.string(),
  estimatedWaste: z.string().nullable(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  entityId: z.string(),
  entityType: z.enum(['LICENSE', 'SUBSCRIPTION']),
  suggestedAction: z.string(),
});

// ---------- Analysis helpers ----------

/**
 * Generate recommendations from active subscriptions.
 * Extracted from getRecommendations so persistInsights can reuse it.
 *
 * @param db - RLS-scoped Prisma proxy (ctx.db)
 * @param prismaClient - Unscoped Prisma client for cross-org catalog queries
 */
async function analyzeRecommendations(
  db: import('@/server/trpc/context').RLSPrismaProxy,
  prismaClient: import('@prisma/client').PrismaClient,
): Promise<RecommendationItem[]> {
  const subscriptions = await db.subscription.findMany({
    where: { status: 'ACTIVE' },
    include: {
      bundle: true,
      licenses: { include: { productOffering: true } },
    },
  });

  const recommendations: RecommendationItem[] = [];

  for (const sub of subscriptions as any[]) {
    // --- RIGHT_SIZE: licenses with pending scale-downs ---
    for (const lic of sub.licenses) {
      if (lic.pendingQuantity !== null && lic.pendingQuantity < lic.quantity) {
        const delta = lic.quantity - lic.pendingQuantity;
        const unitCost = lic.productOffering?.effectiveUnitCost
          ? new Decimal(lic.productOffering.effectiveUnitCost.toString())
          : null;
        const savings = unitCost ? unitCost.mul(delta).toFixed(2) : null;

        recommendations.push({
          type: 'RIGHT_SIZE',
          title: `Right-size ${sub.bundle?.name ?? 'license'}`,
          description: `License has a pending scale-down from ${lic.quantity} to ${lic.pendingQuantity} seats. Complete the reduction to save ${savings ? `$${savings}/mo` : 'costs'}.`,
          potentialSavings: savings,
          severity: 'HIGH',
          entityId: lic.id,
          entityType: 'LICENSE',
        });
      }
    }

    // --- COST_OPTIMIZATION: check for cheaper offerings across distributors ---
    for (const lic of sub.licenses) {
      if (!lic.productOffering?.effectiveUnitCost) continue;

      const currentCost = new Decimal(lic.productOffering.effectiveUnitCost.toString());

      // Look for cheaper offerings for the same bundle
      const allOfferings = await prismaClient.productOffering.findMany({
        where: { bundleId: sub.bundleId },
      });

      const cheaperOffering = allOfferings.find((o: any) => {
        if (!o.effectiveUnitCost || o.id === lic.productOfferingId) return false;
        const altCost = new Decimal(o.effectiveUnitCost.toString());
        const minOk = o.minQuantity === null || lic.quantity >= o.minQuantity;
        const maxOk = o.maxQuantity === null || lic.quantity <= o.maxQuantity;
        return minOk && maxOk && altCost.lt(currentCost);
      });

      if (cheaperOffering) {
        const altCost = new Decimal((cheaperOffering as any).effectiveUnitCost.toString());
        const monthlySavings = currentCost.sub(altCost).mul(lic.quantity).toFixed(2);

        recommendations.push({
          type: 'COST_OPTIMIZATION',
          title: `Cheaper option for ${sub.bundle?.name ?? 'license'}`,
          description: `A ${(cheaperOffering as any).sourceType} offering is available at $${altCost.toFixed(2)}/seat vs current $${currentCost.toFixed(2)}/seat. Switch to save $${monthlySavings}/mo.`,
          potentialSavings: monthlySavings,
          severity: 'MEDIUM',
          entityId: lic.id,
          entityType: 'LICENSE',
        });
      }
    }

    // --- COMMITMENT_SUGGESTION: subscriptions without commitment dates ---
    if (!sub.commitmentEndDate) {
      recommendations.push({
        type: 'COMMITMENT_SUGGESTION',
        title: `Consider commitment for ${sub.bundle?.name ?? 'subscription'}`,
        description: 'This subscription has no commitment term. Committing to an annual term typically reduces per-seat costs by 10-20%.',
        potentialSavings: null,
        severity: 'LOW',
        entityId: sub.id,
        entityType: 'SUBSCRIPTION',
      });
    }
  }

  return recommendations;
}

/**
 * Generate waste alerts from active subscriptions.
 * Extracted from getWasteAlerts so persistInsights can reuse it.
 *
 * @param db - RLS-scoped Prisma proxy (ctx.db)
 */
async function analyzeWasteAlerts(
  db: import('@/server/trpc/context').RLSPrismaProxy,
): Promise<WasteAlertItem[]> {
  const subscriptions = await db.subscription.findMany({
    where: { status: 'ACTIVE' },
    include: {
      bundle: true,
      licenses: { include: { productOffering: true } },
    },
  });

  const alerts: WasteAlertItem[] = [];
  const now = new Date();

  for (const sub of subscriptions as any[]) {
    // --- STALE_SUBSCRIPTION: active subscription with no licenses ---
    if (!sub.licenses || sub.licenses.length === 0) {
      alerts.push({
        type: 'STALE_SUBSCRIPTION',
        title: `Stale subscription: ${sub.bundle?.name ?? 'Unknown'}`,
        description: 'This active subscription has no licenses associated. It may be generating unnecessary costs.',
        estimatedWaste: null,
        severity: 'MEDIUM',
        entityId: sub.id,
        entityType: 'SUBSCRIPTION',
        suggestedAction: 'Review and cancel this subscription if no longer needed.',
      });
      continue;
    }

    for (const lic of sub.licenses) {
      // --- OVER_PROVISIONED: quantity exceeds max ---
      if (lic.productOffering?.maxQuantity && lic.quantity > lic.productOffering.maxQuantity) {
        const excessQty = lic.quantity - lic.productOffering.maxQuantity;
        const unitCost = lic.productOffering?.effectiveUnitCost
          ? new Decimal(lic.productOffering.effectiveUnitCost.toString())
          : null;
        const wasteAmount = unitCost ? unitCost.mul(excessQty).toFixed(2) : null;

        alerts.push({
          type: 'OVER_PROVISIONED',
          title: `Over-provisioned: ${sub.bundle?.name ?? 'license'}`,
          description: `License has ${lic.quantity} seats but the offering maximum is ${lic.productOffering.maxQuantity}. ${excessQty} excess seats may not be usable.`,
          estimatedWaste: wasteAmount,
          severity: 'HIGH',
          entityId: lic.id,
          entityType: 'LICENSE',
          suggestedAction: `Scale down to ${lic.productOffering.maxQuantity} seats.`,
        });
      }

      // --- STALE_PENDING_SCALEDOWN: commitment ended but pending scale-down not applied ---
      if (
        lic.pendingQuantity !== null &&
        sub.commitmentEndDate &&
        new Date(sub.commitmentEndDate) < now
      ) {
        const delta = lic.quantity - lic.pendingQuantity;
        const unitCost = lic.productOffering?.effectiveUnitCost
          ? new Decimal(lic.productOffering.effectiveUnitCost.toString())
          : null;
        const wasteAmount = unitCost ? unitCost.mul(delta).toFixed(2) : null;

        alerts.push({
          type: 'STALE_PENDING_SCALEDOWN',
          title: `Stale pending scale-down: ${sub.bundle?.name ?? 'license'}`,
          description: `Commitment period ended but the pending scale-down from ${lic.quantity} to ${lic.pendingQuantity} seats was never applied.`,
          estimatedWaste: wasteAmount,
          severity: 'HIGH',
          entityId: lic.id,
          entityType: 'LICENSE',
          suggestedAction: 'Apply the pending scale-down or cancel it if no longer needed.',
        });
      }

      // --- UNUSED_LICENSE: licenses with zero quantity still tracked ---
      if (lic.quantity === 0) {
        alerts.push({
          type: 'UNUSED_LICENSE',
          title: `Unused license: ${sub.bundle?.name ?? 'license'}`,
          description: 'This license has 0 seats. It may be an artifact from a previous scale-down.',
          estimatedWaste: '0.00',
          severity: 'LOW',
          entityId: lic.id,
          entityType: 'LICENSE',
          suggestedAction: 'Remove this license if it is no longer needed.',
        });
      }
    }
  }

  return alerts;
}

// ---------- Router ----------

export const insightsRouter = router({
  getRecommendations: orgMemberProcedure
    .input(z.object({}))
    .output(z.object({
      recommendations: z.array(recommendationSchema),
      generatedAt: z.date(),
    }))
    .query(async ({ ctx }) => {
      const { prisma } = await import('@/lib/db');
      const items = await analyzeRecommendations(ctx.db, prisma);

      return {
        recommendations: items.map((item, index) => ({
          id: `rec-${index}`,
          ...item,
        })),
        generatedAt: new Date(),
      };
    }),

  getWasteAlerts: orgMemberProcedure
    .input(z.object({}))
    .output(z.object({
      alerts: z.array(wasteAlertSchema),
      analyzedAt: z.date(),
    }))
    .query(async ({ ctx }) => {
      const items = await analyzeWasteAlerts(ctx.db);

      return {
        alerts: items.map((item, index) => ({
          id: `waste-${index}`,
          ...item,
        })),
        analyzedAt: new Date(),
      };
    }),

  // ---------- Feature 1: Insights Persistence ----------

  persistInsights: orgAdminMutationProcedure
    .input(z.object({
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx }) => {
      const { prisma } = await import('@/lib/db');

      // Run both analyses in parallel
      const [recommendations, wasteAlerts] = await Promise.all([
        analyzeRecommendations(ctx.db, prisma),
        analyzeWasteAlerts(ctx.db),
      ]);

      const generatedAt = new Date();
      const snapshots: Array<{
        type: string;
        insightType: string;
        title: string;
        description: string;
        severity: string;
        entityId: string;
        entityType: string;
        potentialSavings?: Decimal;
        estimatedWaste?: Decimal;
        suggestedAction?: string;
        generatedAt: Date;
      }> = [];

      // Map recommendations to snapshot records
      for (const rec of recommendations) {
        snapshots.push({
          type: 'RECOMMENDATION',
          insightType: rec.type,
          title: rec.title,
          description: rec.description,
          severity: rec.severity,
          entityId: rec.entityId,
          entityType: rec.entityType,
          potentialSavings: rec.potentialSavings
            ? new Decimal(rec.potentialSavings)
            : undefined,
          generatedAt,
        });
      }

      // Map waste alerts to snapshot records
      for (const alert of wasteAlerts) {
        snapshots.push({
          type: 'WASTE_ALERT',
          insightType: alert.type,
          title: alert.title,
          description: alert.description,
          severity: alert.severity,
          entityId: alert.entityId,
          entityType: alert.entityType,
          estimatedWaste: alert.estimatedWaste
            ? new Decimal(alert.estimatedWaste)
            : undefined,
          suggestedAction: alert.suggestedAction,
          generatedAt,
        });
      }

      // Persist all snapshots via RLS-scoped db
      const created = await Promise.all(
        snapshots.map((snapshot) =>
          ctx.db.insightSnapshot.create({
            data: {
              type: snapshot.type,
              insightType: snapshot.insightType,
              title: snapshot.title,
              description: snapshot.description,
              severity: snapshot.severity,
              entityId: snapshot.entityId,
              entityType: snapshot.entityType,
              potentialSavings: snapshot.potentialSavings ?? null,
              estimatedWaste: snapshot.estimatedWaste ?? null,
              suggestedAction: snapshot.suggestedAction ?? null,
              generatedAt: snapshot.generatedAt,
            },
          }),
        ),
      );

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'insights.persisted',
        entityId: null,
        after: {
          recommendationCount: recommendations.length,
          wasteAlertCount: wasteAlerts.length,
          totalSnapshots: created.length,
          generatedAt: generatedAt.toISOString(),
        },
        traceId: ctx.traceId,
      });

      return {
        snapshotCount: created.length,
        recommendationCount: recommendations.length,
        wasteAlertCount: wasteAlerts.length,
        generatedAt,
      };
    }),

  listInsightHistory: orgMemberProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        type: z.enum(['RECOMMENDATION', 'WASTE_ALERT']).optional(),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        dismissed: z.boolean().optional(),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};

      if (input.where?.type) where.type = input.where.type;
      if (input.where?.severity) where.severity = input.where.severity;

      // Date-range filtering on generatedAt
      if (input.where?.from || input.where?.to) {
        const dateFilter: Record<string, Date> = {};
        if (input.where?.from) dateFilter.gte = input.where.from;
        if (input.where?.to) dateFilter.lte = input.where.to;
        where.generatedAt = dateFilter;
      }

      // Dismissed filter
      if (input.where?.dismissed === true) {
        where.dismissedAt = { not: null };
      } else if (input.where?.dismissed === false) {
        where.dismissedAt = null;
      }

      const items = await ctx.db.insightSnapshot.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where,
        orderBy: { generatedAt: 'desc' },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items: items.map((snapshot: any) => ({
          id: snapshot.id,
          type: snapshot.type,
          insightType: snapshot.insightType,
          title: snapshot.title,
          description: snapshot.description,
          severity: snapshot.severity,
          entityId: snapshot.entityId,
          entityType: snapshot.entityType,
          potentialSavings: snapshot.potentialSavings
            ? new Decimal(snapshot.potentialSavings.toString()).toFixed(2)
            : null,
          estimatedWaste: snapshot.estimatedWaste
            ? new Decimal(snapshot.estimatedWaste.toString()).toFixed(2)
            : null,
          suggestedAction: snapshot.suggestedAction,
          dismissedAt: snapshot.dismissedAt,
          dismissedByUserId: snapshot.dismissedByUserId,
          generatedAt: snapshot.generatedAt,
        })),
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  dismissInsight: orgAdminMutationProcedure
    .input(z.object({
      snapshotId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const snapshot = await ctx.db.insightSnapshot.findFirst({
        where: { id: input.snapshotId },
      });

      if (!snapshot) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Insight snapshot not found',
          errorCode: 'INSIGHTS:SNAPSHOT:NOT_FOUND',
        });
      }

      if (snapshot.dismissedAt) {
        throw createBusinessError({
          code: 'CONFLICT',
          message: 'Insight snapshot is already dismissed',
          errorCode: 'INSIGHTS:SNAPSHOT:ALREADY_DISMISSED',
        });
      }

      const now = new Date();
      const updated = await ctx.db.insightSnapshot.update({
        where: { id: snapshot.id },
        data: {
          dismissedAt: now,
          dismissedByUserId: ctx.userId,
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'insights.dismissed',
        entityId: snapshot.id,
        before: { dismissedAt: null, dismissedByUserId: null },
        after: { dismissedAt: now.toISOString(), dismissedByUserId: ctx.userId },
        traceId: ctx.traceId,
      });

      return {
        snapshot: {
          id: updated.id,
          dismissedAt: updated.dismissedAt,
          dismissedByUserId: updated.dismissedByUserId,
        },
      };
    }),
});
