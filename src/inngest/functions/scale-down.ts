import { inngest } from '../client';
import { withTenantContext } from '@/lib/tenant';
import { prisma } from '@/lib/db';

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
    const { licenseId, organizationId, commitmentEndDate, userId } = event.data;

    // Step 1: Sleep until the commitment window expires
    await step.sleepUntil('wait-for-commitment', new Date(commitmentEndDate));

    // Step 2: Execute the scale-down within tenant context
    await step.run('execute-scale-down', async () => {
      await withTenantContext(organizationId, async () => {
        const license = await prisma.license.findUnique({
          where: { id: licenseId },
        });

        if (!license || license.pendingQuantity === null) {
          // Scale-down was cancelled — nothing to do
          return;
        }

        const beforeQuantity = license.quantity;
        const newQuantity = license.pendingQuantity;

        // Promote pendingQuantity → quantity
        await prisma.license.update({
          where: { id: licenseId },
          data: {
            quantity: newQuantity,
            pendingQuantity: null,
            inngestRunId: null,
          },
        });

        // Write audit log
        await prisma.auditLog.create({
          data: {
            organizationId,
            userId: userId ?? null,
            action: 'license.scale_down.executed',
            entityId: licenseId,
            before: { quantity: beforeQuantity } as any,
            after: { quantity: newQuantity } as any,
          },
        });
      });
    });

    return { success: true, licenseId };
  },
);
