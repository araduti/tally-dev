import Decimal from 'decimal.js';
import { inngest } from '../client';
import { withTenantContext } from '@/lib/tenant';
import { createRLSProxy } from '@/lib/rls-proxy';
import { getAdapter, decryptCredentials } from '@/adapters';
import { prisma } from '@/lib/db';

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

          // Persist catalog entries as Bundle + ProductOffering records.
          // These are NOT org-scoped models, so we use raw prisma (not the RLS proxy).
          const syncedAt = new Date();
          let persisted = 0;
          for (const entry of catalog) {
            const bundle = await prisma.bundle.upsert({
              where: { globalSkuId: entry.externalSku },
              create: {
                globalSkuId: entry.externalSku,
                name: entry.name,
                friendlyName: entry.name,
              },
              update: {
                name: entry.name,
                friendlyName: entry.name,
              },
            });

            await prisma.productOffering.upsert({
              where: {
                bundleId_sourceType_externalSku: {
                  bundleId: bundle.id,
                  sourceType: connection.vendorType,
                  externalSku: entry.externalSku,
                },
              },
              create: {
                bundleId: bundle.id,
                vendorConnectionId: connection.id,
                sourceType: connection.vendorType,
                externalSku: entry.externalSku,
                effectiveUnitCost: new Decimal(entry.unitCost),
                currency: entry.currency,
                availability: entry.availability,
                minQuantity: entry.minQuantity ?? null,
                maxQuantity: entry.maxQuantity ?? null,
                lastPricingFetchedAt: syncedAt,
              },
              update: {
                vendorConnectionId: connection.id,
                effectiveUnitCost: new Decimal(entry.unitCost),
                currency: entry.currency,
                availability: entry.availability,
                minQuantity: entry.minQuantity ?? null,
                maxQuantity: entry.maxQuantity ?? null,
                lastPricingFetchedAt: syncedAt,
              },
            });

            persisted++;
          }

          // Update the last sync timestamp
          await db.vendorConnection.update({
            where: { id: vendorConnectionId },
            data: {
              lastSyncAt: new Date(),
              status: 'ACTIVE',
            },
          });

          // Write audit log (organizationId auto-injected by RLS proxy)
          await (db as any).auditLog.create({
            data: {
              userId: null,
              action: 'vendor.catalog_synced',
              entityId: vendorConnectionId,
              after: { itemCount: catalog.length, persisted },
              traceId: traceId ?? null,
            },
          });
        } catch (error) {
          // Update connection status to ERROR
          await db.vendorConnection.update({
            where: { id: vendorConnectionId },
            data: { status: 'ERROR' },
          });

          await (db as any).auditLog.create({
            data: {
              userId: null,
              action: 'vendor.catalog_sync_failed',
              entityId: vendorConnectionId,
              after: { error: sanitizeErrorMessage(error) },
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
