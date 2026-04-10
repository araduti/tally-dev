import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantContext {
  organizationId: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Returns the current organization ID from the async-local tenant context.
 * Throws if called outside of a tenant context.
 */
export function getOrganizationId(): string {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error('No tenant context available. Wrap with withTenantContext().');
  }
  return ctx.organizationId;
}

/**
 * Executes the given function within a tenant context.
 * All database calls via the RLS proxy inside this scope
 * will be automatically scoped to the given organizationId.
 *
 * Required for Inngest durable workflows and any background job.
 */
export async function withTenantContext<T>(
  organizationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tenantStorage.run({ organizationId }, fn);
}
