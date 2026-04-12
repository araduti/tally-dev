/**
 * Unit tests for the catalog-sync Inngest workflow.
 *
 * Tests cover:
 *   - Happy path: vendor catalog fetched, bundles/offerings upserted, audit log written
 *   - Skipped sync: disconnected or missing connection returns early
 *   - Error recovery: connection marked ERROR, sanitized error logged, error re-thrown
 *   - Credential sanitization: Bearer tokens and token= strings redacted in audit log
 *   - Empty catalog: zero items synced correctly
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const {
  prisma,
  rlsDb,
  mockGetAdapter,
  mockDecryptCredentials,
  mockWithTenantContext,
  mockCreateRLSProxy,
  mockSleepUntil,
  mockStepRun,
} = vi.hoisted(() => {
  function createModelProxy(): any {
    const store: Record<string, any> = {};
    return new Proxy(store, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (!store[prop]) store[prop] = vi.fn().mockResolvedValue(null);
        return store[prop];
      },
    });
  }

  function buildDbProxy(): any {
    const models: Record<string, any> = {};
    return new Proxy(models, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (!models[prop]) models[prop] = createModelProxy();
        return models[prop];
      },
    });
  }

  return {
    prisma: buildDbProxy(),
    rlsDb: buildDbProxy(),
    mockGetAdapter: vi.fn(),
    mockDecryptCredentials: vi.fn().mockReturnValue({ apiKey: 'test-key' }),
    mockWithTenantContext: vi.fn((_orgId: string, fn: () => Promise<any>) => fn()),
    mockCreateRLSProxy: vi.fn(),
    mockSleepUntil: vi.fn().mockResolvedValue(undefined),
    mockStepRun: vi.fn((name: string, fn: () => Promise<any>) => fn()),
  };
});

// ──────────────────────────────────────────────
// Module mocks
// ──────────────────────────────────────────────

vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn((_config: any, _trigger: any, handler: any) => ({
      fn: handler,
    })),
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));

vi.mock('@/lib/tenant', () => ({
  withTenantContext: mockWithTenantContext,
}));

vi.mock('@/lib/rls-proxy', () => ({
  createRLSProxy: mockCreateRLSProxy.mockReturnValue(rlsDb),
}));

vi.mock('@/adapters', () => ({
  getAdapter: mockGetAdapter,
  decryptCredentials: mockDecryptCredentials,
}));

// ──────────────────────────────────────────────
// Import under test (after all vi.mock calls)
// ──────────────────────────────────────────────

import { catalogSync } from '../catalog-sync';
import Decimal from 'decimal.js';

// ──────────────────────────────────────────────
// Test constants
// ──────────────────────────────────────────────

const ORG_ID = 'org-test-001';
const VC_ID = 'vc-test-001';
const TRACE_ID = 'trace-test-001';

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      vendorConnectionId: VC_ID,
      organizationId: ORG_ID,
      traceId: TRACE_ID,
      ...overrides,
    },
  };
}

function makeStep() {
  return {
    run: mockStepRun,
    sleepUntil: mockSleepUntil,
  };
}

function makeCatalogEntry(overrides: Record<string, unknown> = {}) {
  return {
    externalSku: 'SKU-001',
    name: 'Microsoft 365 Business',
    unitCost: '12.50',
    currency: 'USD',
    availability: 'AVAILABLE',
    minQuantity: 1,
    maxQuantity: 300,
    ...overrides,
  };
}

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: VC_ID,
    vendorType: 'PAX8',
    status: 'ACTIVE',
    credentials: 'encrypted-credentials',
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('catalogSync', () => {
  const mockGetProductCatalog = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdapter.mockReturnValue({
      getProductCatalog: mockGetProductCatalog,
    });
  });

  it('fetches catalog and upserts bundles + offerings', async () => {
    const entry = makeCatalogEntry();
    rlsDb.vendorConnection.findFirst.mockResolvedValue(makeConnection());
    mockGetProductCatalog.mockResolvedValue([entry]);
    prisma.bundle.upsert.mockResolvedValue({ id: 'bundle-1', globalSkuId: 'SKU-001' });
    prisma.productOffering.upsert.mockResolvedValue({ id: 'po-1' });
    rlsDb.vendorConnection.update.mockResolvedValue({ id: VC_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const result = await (catalogSync as any).fn({ event: makeEvent(), step: makeStep() });

    expect(result).toEqual({ success: true, vendorConnectionId: VC_ID });

    // Verify tenant context was established
    expect(mockWithTenantContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
    expect(mockCreateRLSProxy).toHaveBeenCalledWith(ORG_ID);

    // Verify adapter called with decrypted credentials
    expect(mockDecryptCredentials).toHaveBeenCalledWith('encrypted-credentials');
    expect(mockGetProductCatalog).toHaveBeenCalledWith({ apiKey: 'test-key' });

    // Verify bundle upserted
    expect(prisma.bundle.upsert).toHaveBeenCalledWith({
      where: { globalSkuId: 'SKU-001' },
      create: {
        globalSkuId: 'SKU-001',
        name: 'Microsoft 365 Business',
        friendlyName: 'Microsoft 365 Business',
      },
      update: {
        name: 'Microsoft 365 Business',
        friendlyName: 'Microsoft 365 Business',
      },
    });

    // Verify product offering upserted with Decimal cost
    expect(prisma.productOffering.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bundleId_sourceType_externalSku: {
            bundleId: 'bundle-1',
            sourceType: 'PAX8',
            externalSku: 'SKU-001',
          },
        },
        create: expect.objectContaining({
          effectiveUnitCost: new Decimal('12.50'),
          currency: 'USD',
          availability: 'AVAILABLE',
          minQuantity: 1,
          maxQuantity: 300,
        }),
        update: expect.objectContaining({
          effectiveUnitCost: new Decimal('12.50'),
        }),
      }),
    );

    // Verify connection updated to ACTIVE
    expect(rlsDb.vendorConnection.update).toHaveBeenCalledWith({
      where: { id: VC_ID },
      data: expect.objectContaining({ status: 'ACTIVE' }),
    });

    // Verify audit log written with correct action and counts
    expect(rlsDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        action: 'vendor.catalog_synced',
        entityId: VC_ID,
        after: { itemCount: 1, persisted: 1 },
        traceId: TRACE_ID,
      },
    });
  });

  it('persists multiple catalog entries in a single sync', async () => {
    const entries = [
      makeCatalogEntry({ externalSku: 'SKU-001', name: 'Product A', unitCost: '10.00' }),
      makeCatalogEntry({ externalSku: 'SKU-002', name: 'Product B', unitCost: '25.99' }),
      makeCatalogEntry({ externalSku: 'SKU-003', name: 'Product C', unitCost: '7.50' }),
    ];
    rlsDb.vendorConnection.findFirst.mockResolvedValue(makeConnection());
    mockGetProductCatalog.mockResolvedValue(entries);
    prisma.bundle.upsert.mockResolvedValue({ id: 'bundle-x', globalSkuId: 'SKU-x' });
    prisma.productOffering.upsert.mockResolvedValue({ id: 'po-x' });
    rlsDb.vendorConnection.update.mockResolvedValue({ id: VC_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (catalogSync as any).fn({ event: makeEvent(), step: makeStep() });

    expect(prisma.bundle.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.productOffering.upsert).toHaveBeenCalledTimes(3);
    expect(rlsDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          after: { itemCount: 3, persisted: 3 },
        }),
      }),
    );
  });

  it('handles empty catalog gracefully', async () => {
    rlsDb.vendorConnection.findFirst.mockResolvedValue(makeConnection());
    mockGetProductCatalog.mockResolvedValue([]);
    rlsDb.vendorConnection.update.mockResolvedValue({ id: VC_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const result = await (catalogSync as any).fn({ event: makeEvent(), step: makeStep() });

    expect(result).toEqual({ success: true, vendorConnectionId: VC_ID });
    expect(prisma.bundle.upsert).not.toHaveBeenCalled();
    expect(prisma.productOffering.upsert).not.toHaveBeenCalled();

    // Audit log should still be written with zero counts
    expect(rlsDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'vendor.catalog_synced',
        after: { itemCount: 0, persisted: 0 },
      }),
    });
  });

  it('skips sync when connection is not found', async () => {
    rlsDb.vendorConnection.findFirst.mockResolvedValue(null);

    const result = await (catalogSync as any).fn({ event: makeEvent(), step: makeStep() });

    expect(result).toEqual({ success: true, vendorConnectionId: VC_ID });
    expect(mockGetAdapter).not.toHaveBeenCalled();
    expect(prisma.bundle.upsert).not.toHaveBeenCalled();
  });

  it('skips sync when connection is DISCONNECTED', async () => {
    rlsDb.vendorConnection.findFirst.mockResolvedValue(
      makeConnection({ status: 'DISCONNECTED' }),
    );

    const result = await (catalogSync as any).fn({ event: makeEvent(), step: makeStep() });

    expect(result).toEqual({ success: true, vendorConnectionId: VC_ID });
    expect(mockGetAdapter).not.toHaveBeenCalled();
  });

  it('marks connection ERROR and logs sanitized error on vendor failure', async () => {
    rlsDb.vendorConnection.findFirst.mockResolvedValue(makeConnection());
    mockGetProductCatalog.mockRejectedValue(
      new Error('Authentication failed: Bearer sk_live_secret_key_12345 is invalid'),
    );
    rlsDb.vendorConnection.update.mockResolvedValue({ id: VC_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-err' });

    await expect(
      (catalogSync as any).fn({ event: makeEvent(), step: makeStep() }),
    ).rejects.toThrow('Authentication failed');

    // Connection should be marked as ERROR
    expect(rlsDb.vendorConnection.update).toHaveBeenCalledWith({
      where: { id: VC_ID },
      data: { status: 'ERROR' },
    });

    // Audit log should contain sanitized error (no raw token)
    expect(rlsDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'vendor.catalog_sync_failed',
        after: expect.objectContaining({
          error: expect.stringContaining('Bearer [REDACTED]'),
        }),
      }),
    });

    // Must not contain the actual secret
    const auditCall = rlsDb.auditLog.create.mock.calls[0][0];
    expect(auditCall.data.after.error).not.toContain('sk_live_secret_key_12345');
  });

  it('sanitizes token= patterns in error messages', async () => {
    rlsDb.vendorConnection.findFirst.mockResolvedValue(makeConnection());
    mockGetProductCatalog.mockRejectedValue(
      new Error('Failed with token=abc123xyz'),
    );
    rlsDb.vendorConnection.update.mockResolvedValue({ id: VC_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-err' });

    await expect(
      (catalogSync as any).fn({ event: makeEvent(), step: makeStep() }),
    ).rejects.toThrow();

    const auditCall = rlsDb.auditLog.create.mock.calls[0][0];
    expect(auditCall.data.after.error).toContain('token=[REDACTED]');
    expect(auditCall.data.after.error).not.toContain('abc123xyz');
  });

  it('truncates long error messages to MAX_ERROR_MSG_LENGTH', async () => {
    rlsDb.vendorConnection.findFirst.mockResolvedValue(makeConnection());
    const longMessage = 'A'.repeat(500);
    mockGetProductCatalog.mockRejectedValue(new Error(longMessage));
    rlsDb.vendorConnection.update.mockResolvedValue({ id: VC_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-err' });

    await expect(
      (catalogSync as any).fn({ event: makeEvent(), step: makeStep() }),
    ).rejects.toThrow();

    const auditCall = rlsDb.auditLog.create.mock.calls[0][0];
    expect(auditCall.data.after.error.length).toBeLessThanOrEqual(200);
  });

  it('logs "Unknown error" for non-Error exceptions', async () => {
    rlsDb.vendorConnection.findFirst.mockResolvedValue(makeConnection());
    mockGetProductCatalog.mockRejectedValue('string-error');
    rlsDb.vendorConnection.update.mockResolvedValue({ id: VC_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-err' });

    await expect(
      (catalogSync as any).fn({ event: makeEvent(), step: makeStep() }),
    ).rejects.toBe('string-error');

    const auditCall = rlsDb.auditLog.create.mock.calls[0][0];
    expect(auditCall.data.after.error).toBe('Unknown error');
  });

  it('passes null traceId when not provided in event', async () => {
    rlsDb.vendorConnection.findFirst.mockResolvedValue(makeConnection());
    mockGetProductCatalog.mockResolvedValue([]);
    rlsDb.vendorConnection.update.mockResolvedValue({ id: VC_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (catalogSync as any).fn({
      event: makeEvent({ traceId: undefined }),
      step: makeStep(),
    });

    expect(rlsDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traceId: null,
      }),
    });
  });

  it('handles catalog entries without optional min/max quantities', async () => {
    const entry = makeCatalogEntry({
      minQuantity: undefined,
      maxQuantity: undefined,
    });
    rlsDb.vendorConnection.findFirst.mockResolvedValue(makeConnection());
    mockGetProductCatalog.mockResolvedValue([entry]);
    prisma.bundle.upsert.mockResolvedValue({ id: 'bundle-1', globalSkuId: 'SKU-001' });
    prisma.productOffering.upsert.mockResolvedValue({ id: 'po-1' });
    rlsDb.vendorConnection.update.mockResolvedValue({ id: VC_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (catalogSync as any).fn({ event: makeEvent(), step: makeStep() });

    expect(prisma.productOffering.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          minQuantity: null,
          maxQuantity: null,
        }),
      }),
    );
  });
});
