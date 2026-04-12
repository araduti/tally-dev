/**
 * Unit tests for the billing snapshot generation Inngest workflow.
 *
 * Tests cover:
 *   - Happy path: per-subscription + aggregate snapshots created with correct
 *     Decimal.js math, audit log written
 *   - Multiple subscriptions: totals aggregated correctly across subscriptions
 *   - Zero-cost licenses: licenses without productOffering default to Decimal(0)
 *   - Empty org: no active subscriptions → only aggregate snapshot created
 *   - Period boundaries: periodStart = 1st of month, periodEnd = last day
 *   - Line item metadata: correct structure persisted in snapshot metadata
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const {
  rlsDb,
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
    rlsDb: buildDbProxy(),
    mockWithTenantContext: vi.fn((_orgId: string, fn: () => Promise<any>) => fn()),
    mockCreateRLSProxy: vi.fn(),
    mockSleepUntil: vi.fn().mockResolvedValue(undefined),
    mockStepRun: vi.fn((_name: string, fn: () => Promise<any>) => fn()),
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

vi.mock('@/lib/db', () => ({
  prisma: {},
}));

vi.mock('@/lib/tenant', () => ({
  withTenantContext: mockWithTenantContext,
}));

vi.mock('@/lib/rls-proxy', () => ({
  createRLSProxy: mockCreateRLSProxy.mockReturnValue(rlsDb),
}));

// ──────────────────────────────────────────────
// Import under test (after all vi.mock calls)
// ──────────────────────────────────────────────

import { billingSnapshotGeneration } from '../billing-snapshot';
import Decimal from 'decimal.js';

// ──────────────────────────────────────────────
// Test constants
// ──────────────────────────────────────────────

const ORG_ID = 'org-test-001';
const TRACE_ID = 'trace-test-001';

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
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

function makeSubscription(
  id: string,
  licenses: Array<{ quantity: number; unitCost: string | null; pendingQuantity?: number | null }>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    status: 'ACTIVE',
    commitmentEndDate: new Date('2025-06-30'),
    bundle: { name: `Bundle for ${id}` },
    vendorConnection: { vendorType: 'PAX8' },
    licenses: licenses.map((lic, i) => ({
      id: `lic-${id}-${i}`,
      quantity: lic.quantity,
      pendingQuantity: lic.pendingQuantity ?? null,
      productOffering: lic.unitCost
        ? { effectiveUnitCost: new Decimal(lic.unitCost) }
        : null,
    })),
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('billingSnapshotGeneration', () => {
  let snapshotCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    snapshotCounter = 0;
    rlsDb.billingSnapshot.create.mockImplementation(async () => {
      snapshotCounter++;
      return { id: `snap-${snapshotCounter}` };
    });
  });

  it('creates per-subscription and aggregate snapshots with correct Decimal math', async () => {
    // Subscription with 2 licenses:
    //   License A: 10 seats × $12.50 = $125.00
    //   License B: 5 seats × $25.00  = $125.00
    //   Sub total: $250.00
    const sub = makeSubscription('sub-001', [
      { quantity: 10, unitCost: '12.50' },
      { quantity: 5, unitCost: '25.00' },
    ]);
    rlsDb.subscription.findMany.mockResolvedValue([sub]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const result = await (billingSnapshotGeneration as any).fn({
      event: makeEvent(),
      step: makeStep(),
    });

    expect(result).toEqual({ success: true, organizationId: ORG_ID });

    // Should create 2 snapshots: 1 per-subscription + 1 aggregate
    expect(rlsDb.billingSnapshot.create).toHaveBeenCalledTimes(2);

    // Per-subscription snapshot
    const subSnapshotCall = rlsDb.billingSnapshot.create.mock.calls[0][0];
    expect(subSnapshotCall.data.subscriptionId).toBe('sub-001');
    expect(subSnapshotCall.data.projectedAmount).toEqual(new Decimal('250.00'));

    // Aggregate snapshot (no subscriptionId)
    const aggSnapshotCall = rlsDb.billingSnapshot.create.mock.calls[1][0];
    expect(aggSnapshotCall.data.subscriptionId).toBeUndefined();
    expect(aggSnapshotCall.data.projectedAmount).toEqual(new Decimal('250.00'));
  });

  it('aggregates totals correctly across multiple subscriptions', async () => {
    // Sub 1: 10 × $10.00 = $100.00
    // Sub 2: 20 × $5.00  = $100.00
    // Total: $200.00
    const subs = [
      makeSubscription('sub-001', [{ quantity: 10, unitCost: '10.00' }]),
      makeSubscription('sub-002', [{ quantity: 20, unitCost: '5.00' }]),
    ];
    rlsDb.subscription.findMany.mockResolvedValue(subs);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({ event: makeEvent(), step: makeStep() });

    // 2 per-subscription + 1 aggregate = 3 total
    expect(rlsDb.billingSnapshot.create).toHaveBeenCalledTimes(3);

    // Aggregate snapshot should contain total of $200.00
    const aggCall = rlsDb.billingSnapshot.create.mock.calls[2][0];
    expect(aggCall.data.projectedAmount).toEqual(new Decimal('200.00'));
  });

  it('handles licenses without productOffering (zero-cost default)', async () => {
    // License with no productOffering → unitCost = Decimal(0)
    const sub = makeSubscription('sub-001', [{ quantity: 100, unitCost: null }]);
    rlsDb.subscription.findMany.mockResolvedValue([sub]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({ event: makeEvent(), step: makeStep() });

    const subSnapshotCall = rlsDb.billingSnapshot.create.mock.calls[0][0];
    expect(subSnapshotCall.data.projectedAmount).toEqual(new Decimal('0.00'));

    // Line item should show $0.00 unit cost
    const lineItem = subSnapshotCall.data.metadata.lineItems[0];
    expect(lineItem.unitCost).toBe('0.00');
    expect(lineItem.lineTotal).toBe('0.00');
  });

  it('creates only an aggregate snapshot when no active subscriptions exist', async () => {
    rlsDb.subscription.findMany.mockResolvedValue([]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({ event: makeEvent(), step: makeStep() });

    // Only aggregate snapshot created (no per-subscription snapshots)
    expect(rlsDb.billingSnapshot.create).toHaveBeenCalledTimes(1);

    const aggCall = rlsDb.billingSnapshot.create.mock.calls[0][0];
    expect(aggCall.data.projectedAmount).toEqual(new Decimal('0.00'));
    expect(aggCall.data.metadata.lineItems).toEqual([]);
  });

  it('sets correct period boundaries (1st to last day of month)', async () => {
    rlsDb.subscription.findMany.mockResolvedValue([]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({ event: makeEvent(), step: makeStep() });

    const aggCall = rlsDb.billingSnapshot.create.mock.calls[0][0];
    const periodStart: Date = aggCall.data.periodStart;
    const periodEnd: Date = aggCall.data.periodEnd;

    // periodStart should be the 1st of the current month
    expect(periodStart.getDate()).toBe(1);
    expect(periodStart.getHours()).toBe(0);
    expect(periodStart.getMinutes()).toBe(0);

    // periodEnd should be the last day of the current month
    // new Date(year, month + 1, 0) gives the last day of the current month
    const now = new Date();
    const expectedLastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    expect(periodEnd.getDate()).toBe(expectedLastDay);
  });

  it('writes audit log with correct metadata', async () => {
    const sub = makeSubscription('sub-001', [
      { quantity: 10, unitCost: '15.00' },
    ]);
    rlsDb.subscription.findMany.mockResolvedValue([sub]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({ event: makeEvent(), step: makeStep() });

    expect(rlsDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        action: 'billing.snapshot_generated',
        entityId: 'snap-2', // aggregate snapshot ID
        after: expect.objectContaining({
          projectedAmount: '150.00',
          subscriptionCount: 1,
          snapshotIds: ['snap-1', 'snap-2'],
        }),
        traceId: TRACE_ID,
      },
    });
  });

  it('stores line item metadata with correct structure', async () => {
    const sub = makeSubscription(
      'sub-001',
      [{ quantity: 8, unitCost: '20.00', pendingQuantity: 5 }],
      { commitmentEndDate: new Date('2025-12-31') },
    );
    rlsDb.subscription.findMany.mockResolvedValue([sub]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({ event: makeEvent(), step: makeStep() });

    const subCall = rlsDb.billingSnapshot.create.mock.calls[0][0];
    const lineItem = subCall.data.metadata.lineItems[0];

    expect(lineItem).toEqual({
      subscriptionId: 'sub-001',
      bundleName: 'Bundle for sub-001',
      vendorType: 'PAX8',
      quantity: 8,
      unitCost: '20.00',
      lineTotal: '160.00',
      pendingQuantity: 5,
      commitmentEndDate: new Date('2025-12-31'),
    });
  });

  it('handles precise Decimal math without floating-point errors', async () => {
    // Classic floating-point trap: 0.1 + 0.2 ≠ 0.3 in IEEE 754
    // Decimal.js should handle this correctly
    const sub = makeSubscription('sub-001', [
      { quantity: 3, unitCost: '0.10' },
      { quantity: 1, unitCost: '0.20' },
    ]);
    rlsDb.subscription.findMany.mockResolvedValue([sub]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({ event: makeEvent(), step: makeStep() });

    const subCall = rlsDb.billingSnapshot.create.mock.calls[0][0];
    // 3 × 0.10 + 1 × 0.20 = 0.30 + 0.20 = 0.50 (exact, not 0.5000000000000001)
    expect(subCall.data.projectedAmount).toEqual(new Decimal('0.50'));
  });

  it('establishes tenant context with correct organizationId', async () => {
    rlsDb.subscription.findMany.mockResolvedValue([]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({ event: makeEvent(), step: makeStep() });

    expect(mockWithTenantContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
    expect(mockCreateRLSProxy).toHaveBeenCalledWith(ORG_ID);
  });

  it('passes null traceId when not provided', async () => {
    rlsDb.subscription.findMany.mockResolvedValue([]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({
      event: makeEvent({ traceId: undefined }),
      step: makeStep(),
    });

    expect(rlsDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traceId: null,
      }),
    });
  });

  it('fetches only ACTIVE subscriptions with full relationship graph', async () => {
    rlsDb.subscription.findMany.mockResolvedValue([]);
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (billingSnapshotGeneration as any).fn({ event: makeEvent(), step: makeStep() });

    expect(rlsDb.subscription.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      include: {
        bundle: true,
        licenses: { include: { productOffering: true } },
        vendorConnection: { select: { vendorType: true } },
      },
    });
  });
});
