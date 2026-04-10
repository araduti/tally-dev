import { inngest } from '../client';
import { withTenantContext } from '@/lib/tenant';
import { createRLSProxy } from '@/lib/rls-proxy';

/**
 * Commitment-Gated Scale-Down Workflow
 *
 * 1. Wait until commitmentEndDate
 * 2. Promote pendingQuantity → quantity on the License
 * 3. Write audit log entry
 */
export const commitmentScaleDown = inngest.createFunction(
  {
    id: 'commitment-scale-down',
    name: 'Commitment-Gated Scale-Down',
    retries: 3,
  },
  { event: 'license/scale-down.staged' },
  async ({ event, step }) => {
    const { licenseId, organizationId, commitmentEndDate, userId, traceId } = event.data;

    // Step 1: Sleep until the commitment window expires
    await step.sleepUntil('wait-for-commitment', new Date(commitmentEndDate));

    // Step 2: Execute the scale-down within tenant context
    await step.run('execute-scale-down', async () => {
      await withTenantContext(organizationId, async () => {
        const db = createRLSProxy(organizationId);

        // License doesn't have organizationId — query via subscription join
        const { prisma } = await import('@/lib/db');
        const subscriptions = await db.subscription.findMany({ select: { id: true } });
        const subscriptionIds = subscriptions.map((s: any) => s.id);

        const license = await prisma.license.findFirst({
          where: { id: licenseId, subscriptionId: { in: subscriptionIds } },
        });

        if (!license || license.pendingQuantity === null) {
          // Scale-down was cancelled or license not in this org — nothing to do
          return;
        }

        const beforeQuantity = license.quantity;
        const newQuantity = license.pendingQuantity;

        // Promote pendingQuantity → quantity
        await prisma.license.update({
          where: { id: license.id },
          data: {
            quantity: newQuantity,
            pendingQuantity: null,
            inngestRunId: null,
          },
        });

        // Write audit log via RLS proxy
        await db.auditLog.create({
          data: {
            userId: userId ?? null,
            action: 'license.scale_down.executed',
            entityId: licenseId,
            before: { quantity: beforeQuantity } as any,
            after: { quantity: newQuantity } as any,
            traceId: traceId ?? null,
          },
        });
      });
    });

    return { success: true, licenseId };
  },
);
