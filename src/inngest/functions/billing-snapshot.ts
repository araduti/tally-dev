import Decimal from 'decimal.js';
import { inngest } from '../client';
import { withTenantContext } from '@/lib/tenant';
import { createRLSProxy } from '@/lib/rls-proxy';

/**
 * Billing Snapshot Generation Workflow
 *
 * Generates billing snapshots for an organization at period boundaries.
 * Creates individual per-subscription snapshots and one aggregate snapshot.
 *
 * Triggered by:
 *   - Scheduled cron jobs at period boundaries
 *   - Manual snapshot generation requests
 */
export const billingSnapshotGeneration = inngest.createFunction(
  {
    id: 'billing-snapshot-generation',
    name: 'Billing Snapshot Generation',
    retries: 3,
  },
  { event: 'billing/snapshot-generation.requested' },
  async ({ event, step }) => {
    const { organizationId, traceId } = event.data;

    await step.run('generate-snapshots', async () => {
      await withTenantContext(organizationId, async () => {
        const db = createRLSProxy(organizationId);

        // Calculate current period boundaries
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        // Fetch all active subscriptions with related data
        const subscriptions = await db.subscription.findMany({
          where: { status: 'ACTIVE' },
          include: {
            bundle: true,
            licenses: { include: { productOffering: true } },
            vendorConnection: { select: { vendorType: true } },
          },
        });

        let totalProjected = new Decimal(0);
        const allLineItems: Array<{
          subscriptionId: string;
          bundleName: string;
          vendorType: string;
          quantity: number;
          unitCost: string;
          lineTotal: string;
          pendingQuantity: number | null;
          commitmentEndDate: Date | null;
        }> = [];
        const snapshotIds: string[] = [];

        // Create individual per-subscription snapshots
        for (const sub of subscriptions) {
          let subscriptionTotal = new Decimal(0);
          const subLineItems = (sub as any).licenses.map((lic: any) => {
            const unitCost = lic.productOffering?.effectiveUnitCost
              ? new Decimal(lic.productOffering.effectiveUnitCost.toString())
              : new Decimal(0);
            const lineTotal = unitCost.mul(lic.quantity);
            subscriptionTotal = subscriptionTotal.add(lineTotal);

            return {
              subscriptionId: sub.id,
              bundleName: (sub as any).bundle.name,
              vendorType: (sub as any).vendorConnection.vendorType,
              quantity: lic.quantity,
              unitCost: unitCost.toFixed(2),
              lineTotal: lineTotal.toFixed(2),
              pendingQuantity: lic.pendingQuantity,
              commitmentEndDate: sub.commitmentEndDate,
            };
          });

          const subSnapshot = await (db as any).billingSnapshot.create({
            data: {
              subscriptionId: sub.id,
              projectedAmount: new Decimal(subscriptionTotal.toFixed(2)),
              periodStart,
              periodEnd,
              metadata: { lineItems: subLineItems },
            },
          });

          snapshotIds.push(subSnapshot.id);
          totalProjected = totalProjected.add(subscriptionTotal);
          allLineItems.push(...subLineItems);
        }

        // Create aggregate snapshot (no subscriptionId)
        const aggregateSnapshot = await (db as any).billingSnapshot.create({
          data: {
            projectedAmount: new Decimal(totalProjected.toFixed(2)),
            periodStart,
            periodEnd,
            metadata: { lineItems: allLineItems },
          },
        });

        snapshotIds.push(aggregateSnapshot.id);

        // Write audit log (organizationId auto-injected by RLS proxy)
        await (db as any).auditLog.create({
          data: {
            userId: null,
            action: 'billing.snapshot_generated',
            entityId: aggregateSnapshot.id,
            after: {
              projectedAmount: totalProjected.toFixed(2),
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
              subscriptionCount: subscriptions.length,
              snapshotIds,
            },
            traceId: traceId ?? null,
          },
        });
      });
    });

    return { success: true, organizationId };
  },
);
