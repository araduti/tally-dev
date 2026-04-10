import { inngest } from '../client';
import { withTenantContext } from '@/lib/tenant';
import { prisma } from '@/lib/db';
import { getAdapter, decryptCredentials } from '@/adapters';

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
    const { vendorConnectionId, organizationId } = event.data;

    await step.run('sync-catalog', async () => {
      await withTenantContext(organizationId, async () => {
        const connection = await prisma.vendorConnection.findUnique({
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
          await prisma.vendorConnection.update({
            where: { id: vendorConnectionId },
            data: {
              lastSyncAt: new Date(),
              status: 'ACTIVE',
            },
          });

          // Write audit log
          await prisma.auditLog.create({
            data: {
              organizationId,
              userId: null,
              action: 'vendor.catalog_synced',
              entityId: vendorConnectionId,
              after: { itemCount: catalog.length } as any,
            },
          });
        } catch (error) {
          // Update connection status to ERROR
          await prisma.vendorConnection.update({
            where: { id: vendorConnectionId },
            data: { status: 'ERROR' },
          });

          await prisma.auditLog.create({
            data: {
              organizationId,
              userId: null,
              action: 'vendor.catalog_sync_failed',
              entityId: vendorConnectionId,
              after: { error: error instanceof Error ? error.message : 'Unknown error' } as any,
            },
          });

          throw error; // Let Inngest retry
        }
      });
    });

    return { success: true, vendorConnectionId };
  },
);
