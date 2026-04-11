import { inngest } from '../client';
import { withTenantContext } from '@/lib/tenant';
import { createRLSProxy } from '@/lib/rls-proxy';
import { getAdapter, decryptCredentials } from '@/adapters';

/**
 * Commitment-Expiry Cancellation Workflow
 *
 * When a subscription with an active commitment is cancelled, we set it to SUSPENDED
 * and dispatch this workflow. It:
 * 1. Waits until the commitment end date
 * 2. Cancels the subscription on the vendor
 * 3. Updates subscription status to CANCELLED
 * 4. Writes an audit log entry
 */
export const commitmentExpiry = inngest.createFunction(
  {
    id: 'commitment-expiry',
    name: 'Commitment-Expiry Cancellation',
    retries: 3,
  },
  { event: 'subscription/commitment-expired' },
  async ({ event, step }) => {
    const { subscriptionId, organizationId, commitmentEndDate, userId, traceId } = event.data;

    // Step 1: Sleep until the commitment window expires
    await step.sleepUntil('wait-for-commitment', new Date(commitmentEndDate));

    // Step 2: Execute the cancellation within tenant context
    await step.run('execute-cancellation', async () => {
      await withTenantContext(organizationId, async () => {
        const db = createRLSProxy(organizationId);

        const subscription = await db.subscription.findFirst({
          where: { id: subscriptionId },
          include: { vendorConnection: true },
        });

        // Idempotent: early return if subscription not found or no longer SUSPENDED
        if (!subscription || subscription.status !== 'SUSPENDED') {
          return;
        }

        const beforeStatus = subscription.status;

        // Vendor-first: cancel on the vendor before updating local state
        const adapter = getAdapter(subscription.vendorConnection.vendorType);
        const credentials = decryptCredentials(subscription.vendorConnection.credentials);
        await adapter.cancelSubscription(credentials, subscription.externalId);

        // Update subscription status to CANCELLED
        await db.subscription.update({
          where: { id: subscription.id },
          data: { status: 'CANCELLED' },
        });

        // Write audit log (organizationId auto-injected by RLS proxy)
        await (db as any).auditLog.create({
          data: {
            userId: userId ?? null,
            action: 'subscription.commitment_expired',
            entityId: subscriptionId,
            before: { status: beforeStatus },
            after: { status: 'CANCELLED' },
            traceId: traceId ?? null,
          },
        });
      });
    });

    return { success: true, subscriptionId };
  },
);
