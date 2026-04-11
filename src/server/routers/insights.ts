import { z } from 'zod';
import { router, orgMemberProcedure } from '../trpc/init';
import Decimal from 'decimal.js';

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

export const insightsRouter = router({
  getRecommendations: orgMemberProcedure
    .input(z.object({}))
    .output(z.object({
      recommendations: z.array(recommendationSchema),
      generatedAt: z.date(),
    }))
    .query(async ({ ctx }) => {
      const { prisma } = await import('@/lib/db');

      // Fetch active subscriptions with licenses and offerings (org-scoped via RLS proxy)
      const subscriptions = await ctx.db.subscription.findMany({
        where: { status: 'ACTIVE' },
        include: {
          bundle: true,
          licenses: { include: { productOffering: true } },
        },
      });

      const recommendations: z.infer<typeof recommendationSchema>[] = [];
      let recIndex = 0;

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
              id: `rec-${recIndex++}`,
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
          const allOfferings = await prisma.productOffering.findMany({
            where: { bundleId: sub.bundleId },
          });

          const cheaperOffering = allOfferings.find((o: any) => {
            if (!o.effectiveUnitCost || o.id === lic.productOfferingId) return false;
            const altCost = new Decimal(o.effectiveUnitCost.toString());
            // Check quantity eligibility
            const minOk = o.minQuantity === null || lic.quantity >= o.minQuantity;
            const maxOk = o.maxQuantity === null || lic.quantity <= o.maxQuantity;
            return minOk && maxOk && altCost.lt(currentCost);
          });

          if (cheaperOffering) {
            const altCost = new Decimal((cheaperOffering as any).effectiveUnitCost.toString());
            const monthlySavings = currentCost.sub(altCost).mul(lic.quantity).toFixed(2);

            recommendations.push({
              id: `rec-${recIndex++}`,
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
            id: `rec-${recIndex++}`,
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

      return {
        recommendations,
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
      // Fetch active subscriptions with licenses (org-scoped via RLS proxy)
      const subscriptions = await ctx.db.subscription.findMany({
        where: { status: 'ACTIVE' },
        include: {
          bundle: true,
          licenses: { include: { productOffering: true } },
        },
      });

      const alerts: z.infer<typeof wasteAlertSchema>[] = [];
      let alertIndex = 0;
      const now = new Date();

      for (const sub of subscriptions as any[]) {
        // --- STALE_SUBSCRIPTION: active subscription with no licenses ---
        if (!sub.licenses || sub.licenses.length === 0) {
          alerts.push({
            id: `waste-${alertIndex++}`,
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
              id: `waste-${alertIndex++}`,
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
              id: `waste-${alertIndex++}`,
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
              id: `waste-${alertIndex++}`,
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

      return {
        alerts,
        analyzedAt: new Date(),
      };
    }),
});
