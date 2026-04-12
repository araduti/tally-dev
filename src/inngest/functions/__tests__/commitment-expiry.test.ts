/**
 * Unit tests for the commitment-expiry cancellation Inngest workflow.
 *
 * Tests cover:
 *   - Happy path: sleepUntil called, vendor cancellation called before local
 *     update (vendor-first), subscription status updated to CANCELLED, audit log written
 *   - Idempotency: already-cancelled subscription → early exit
 *   - Missing subscription: not found → early exit without error
 *   - Non-SUSPENDED subscription: status != SUSPENDED → early exit
 *   - Vendor-first ordering: vendor API called before local DB update
 *   - Vendor failure: error propagated for Inngest retry
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const {
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
    rlsDb: buildDbProxy(),
    mockGetAdapter: vi.fn(),
    mockDecryptCredentials: vi.fn().mockReturnValue({ apiKey: 'test-key' }),
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

vi.mock('@/adapters', () => ({
  getAdapter: mockGetAdapter,
  decryptCredentials: mockDecryptCredentials,
}));

// ──────────────────────────────────────────────
// Import under test (after all vi.mock calls)
// ──────────────────────────────────────────────

import { commitmentExpiry } from '../commitment-expiry';

// ──────────────────────────────────────────────
// Test constants
// ──────────────────────────────────────────────

const ORG_ID = 'org-test-001';
const SUB_ID = 'sub-test-001';
const USER_ID = 'user-test-001';
const TRACE_ID = 'trace-test-001';
const COMMITMENT_END = '2025-06-30T00:00:00.000Z';

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      subscriptionId: SUB_ID,
      organizationId: ORG_ID,
      commitmentEndDate: COMMITMENT_END,
      userId: USER_ID,
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

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: SUB_ID,
    status: 'SUSPENDED',
    externalId: 'ext-sub-001',
    vendorConnection: {
      vendorType: 'PAX8',
      credentials: 'encrypted-vendor-creds',
    },
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('commitmentExpiry', () => {
  const mockCancelSubscription = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset implementation (clearAllMocks only clears call history, not impl)
    mockCancelSubscription.mockResolvedValue(undefined);
    mockGetAdapter.mockReturnValue({
      cancelSubscription: mockCancelSubscription,
    });
  });

  it('calls sleepUntil with the correct commitment end date', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(makeSubscription());
    rlsDb.subscription.update.mockResolvedValue({ id: SUB_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentExpiry as any).fn({ event: makeEvent(), step: makeStep() });

    expect(mockSleepUntil).toHaveBeenCalledWith(
      'wait-for-commitment',
      new Date(COMMITMENT_END),
    );
  });

  it('cancels on vendor BEFORE updating local state (vendor-first pattern)', async () => {
    const callOrder: string[] = [];

    mockCancelSubscription.mockImplementation(async () => {
      callOrder.push('vendor-cancel');
    });
    rlsDb.subscription.findFirst.mockResolvedValue(makeSubscription());
    rlsDb.subscription.update.mockImplementation(async () => {
      callOrder.push('db-update');
      return { id: SUB_ID };
    });
    rlsDb.auditLog.create.mockImplementation(async () => {
      callOrder.push('audit-log');
      return { id: 'audit-1' };
    });

    await (commitmentExpiry as any).fn({ event: makeEvent(), step: makeStep() });

    // Vendor cancellation MUST happen before local state update
    expect(callOrder).toEqual(['vendor-cancel', 'db-update', 'audit-log']);
  });

  it('updates subscription status to CANCELLED after vendor cancellation', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(makeSubscription());
    rlsDb.subscription.update.mockResolvedValue({ id: SUB_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const result = await (commitmentExpiry as any).fn({
      event: makeEvent(),
      step: makeStep(),
    });

    expect(result).toEqual({ success: true, subscriptionId: SUB_ID });

    // Verify vendor adapter called with correct args
    expect(mockDecryptCredentials).toHaveBeenCalledWith('encrypted-vendor-creds');
    expect(mockCancelSubscription).toHaveBeenCalledWith(
      { apiKey: 'test-key' },
      'ext-sub-001',
    );

    // Verify local status update
    expect(rlsDb.subscription.update).toHaveBeenCalledWith({
      where: { id: SUB_ID },
      data: { status: 'CANCELLED' },
    });
  });

  it('writes audit log with before/after status', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(makeSubscription());
    rlsDb.subscription.update.mockResolvedValue({ id: SUB_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentExpiry as any).fn({ event: makeEvent(), step: makeStep() });

    expect(rlsDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        action: 'subscription.commitment_expired',
        entityId: SUB_ID,
        before: { status: 'SUSPENDED' },
        after: { status: 'CANCELLED' },
        traceId: TRACE_ID,
      },
    });
  });

  it('returns early when subscription is not found (idempotent)', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(null);

    const result = await (commitmentExpiry as any).fn({
      event: makeEvent(),
      step: makeStep(),
    });

    expect(result).toEqual({ success: true, subscriptionId: SUB_ID });
    expect(mockGetAdapter).not.toHaveBeenCalled();
    expect(mockCancelSubscription).not.toHaveBeenCalled();
    expect(rlsDb.subscription.update).not.toHaveBeenCalled();
    expect(rlsDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns early when subscription is already CANCELLED (idempotent)', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(
      makeSubscription({ status: 'CANCELLED' }),
    );

    const result = await (commitmentExpiry as any).fn({
      event: makeEvent(),
      step: makeStep(),
    });

    expect(result).toEqual({ success: true, subscriptionId: SUB_ID });
    expect(mockCancelSubscription).not.toHaveBeenCalled();
    expect(rlsDb.subscription.update).not.toHaveBeenCalled();
  });

  it('returns early when subscription is ACTIVE (not SUSPENDED)', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(
      makeSubscription({ status: 'ACTIVE' }),
    );

    const result = await (commitmentExpiry as any).fn({
      event: makeEvent(),
      step: makeStep(),
    });

    expect(result).toEqual({ success: true, subscriptionId: SUB_ID });
    expect(mockCancelSubscription).not.toHaveBeenCalled();
    expect(rlsDb.subscription.update).not.toHaveBeenCalled();
  });

  it('propagates vendor cancellation error for Inngest retry', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(makeSubscription());
    mockCancelSubscription.mockRejectedValue(
      new Error('Vendor API: 503 Service Unavailable'),
    );

    await expect(
      (commitmentExpiry as any).fn({ event: makeEvent(), step: makeStep() }),
    ).rejects.toThrow('503 Service Unavailable');

    // Local state should NOT be updated on vendor failure
    expect(rlsDb.subscription.update).not.toHaveBeenCalled();
    expect(rlsDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('fetches subscription with vendorConnection include', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(makeSubscription());
    rlsDb.subscription.update.mockResolvedValue({ id: SUB_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentExpiry as any).fn({ event: makeEvent(), step: makeStep() });

    expect(rlsDb.subscription.findFirst).toHaveBeenCalledWith({
      where: { id: SUB_ID },
      include: { vendorConnection: true },
    });
  });

  it('establishes tenant context with correct organizationId', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(makeSubscription());
    rlsDb.subscription.update.mockResolvedValue({ id: SUB_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentExpiry as any).fn({ event: makeEvent(), step: makeStep() });

    expect(mockWithTenantContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
    expect(mockCreateRLSProxy).toHaveBeenCalledWith(ORG_ID);
  });

  it('passes null userId and traceId when not provided', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(makeSubscription());
    rlsDb.subscription.update.mockResolvedValue({ id: SUB_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentExpiry as any).fn({
      event: makeEvent({ userId: undefined, traceId: undefined }),
      step: makeStep(),
    });

    expect(rlsDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: null,
        traceId: null,
      }),
    });
  });

  it('uses correct adapter based on vendor type from connection', async () => {
    rlsDb.subscription.findFirst.mockResolvedValue(
      makeSubscription({
        vendorConnection: {
          vendorType: 'INGRAM',
          credentials: 'ingram-encrypted',
        },
      }),
    );
    rlsDb.subscription.update.mockResolvedValue({ id: SUB_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentExpiry as any).fn({ event: makeEvent(), step: makeStep() });

    expect(mockGetAdapter).toHaveBeenCalledWith('INGRAM');
    expect(mockDecryptCredentials).toHaveBeenCalledWith('ingram-encrypted');
  });
});
