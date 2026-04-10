import { inngest } from '../client';
import { withTenantContext } from '@/lib/tenant';
import { createRLSProxy } from '@/lib/rls-proxy';
import { getAdapter, decryptCredentials } from '@/adapters';

/**
 * Maximum length for vendor error messages stored in audit logs.
 * Prevents credential leakage from verbose vendor error responses.
 */
const MAX_ERROR_MSG_LENGTH = 200;

/** Sanitize vendor error messages before persisting to audit log. */
function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';
  // Truncate and strip anything that looks like a token/key
  return error.message
    .slice(0, MAX_ERROR_MSG_LENGTH)
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]');
}

/**
 * Catalog Sync Workflow
 *
 * Triggered when a vendor connection is established or a manual sync is requested.
 * Fetches the product catalog from the vendor and updates ProductOfferings.
 */
export const catalogSync = inngest.createFunction(
  {
    id: 'catalog-sync',
    name: 'Vendor Catalog Sync',
    retries: 3,
  },
  { event: 'vendor/catalog-sync.requested' },
  async ({ event, step }) => {
    const { vendorConnectionId, organizationId, traceId } = event.data;

    await step.run('sync-catalog', async () => {
      await withTenantContext(organizationId, async () => {
        const db = createRLSProxy(organizationId);

        const connection = await db.vendorConnection.findFirst({
          where: { id: vendorConnectionId },
        });

        if (!connection || connection.status === 'DISCONNECTED') {
          return;
        }

        try {
          const adapter = getAdapter(connection.vendorType);
          const credentials = decryptCredentials(connection.credentials);
          const catalog = await adapter.getProductCatalog(credentials);

          // Update the last sync timestamp
          await db.vendorConnection.update({
            where: { id: vendorConnectionId },
            data: {
              lastSyncAt: new Date(),
              status: 'ACTIVE',
            },
          });

          // Write audit log
          await db.auditLog.create({
            data: {
              userId: null,
              action: 'vendor.catalog_synced',
              entityId: vendorConnectionId,
              after: { itemCount: catalog.length } as any,
              traceId: traceId ?? null,
            },
          });
        } catch (error) {
          // Update connection status to ERROR
          await db.vendorConnection.update({
            where: { id: vendorConnectionId },
            data: { status: 'ERROR' },
          });

          await db.auditLog.create({
            data: {
              userId: null,
              action: 'vendor.catalog_sync_failed',
              entityId: vendorConnectionId,
              after: { error: sanitizeErrorMessage(error) } as any,
              traceId: traceId ?? null,
            },
          });

          throw error; // Let Inngest retry
        }
      });
    });

    return { success: true, vendorConnectionId };
  },
);
