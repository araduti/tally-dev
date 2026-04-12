/**
 * Unit tests for the commitment-gated scale-down Inngest workflow.
 *
 * Tests cover:
 *   - Happy path: sleepUntil called, pendingQuantity promoted to quantity,
 *     inngestRunId cleared, audit log written
 *   - Cancelled scale-down: pendingQuantity is null → early exit
 *   - Missing license: license not found → early exit without error
 *   - License in wrong org: subscription ID check prevents cross-org access
 *   - sleepUntil called with correct commitment end date
 *   - Audit log captures before/after quantities
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const {
  prisma,
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
    prisma: buildDbProxy(),
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

vi.mock('@/lib/db', () => ({ prisma }));

vi.mock('@/lib/tenant', () => ({
  withTenantContext: mockWithTenantContext,
}));

vi.mock('@/lib/rls-proxy', () => ({
  createRLSProxy: mockCreateRLSProxy.mockReturnValue(rlsDb),
}));

// ──────────────────────────────────────────────
// Import under test (after all vi.mock calls)
// ──────────────────────────────────────────────

import { commitmentScaleDown } from '../scale-down';

// ──────────────────────────────────────────────
// Test constants
// ──────────────────────────────────────────────

const ORG_ID = 'org-test-001';
const LICENSE_ID = 'lic-test-001';
const USER_ID = 'user-test-001';
const TRACE_ID = 'trace-test-001';
const COMMITMENT_END = '2025-03-15T00:00:00.000Z';

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      licenseId: LICENSE_ID,
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

function makeLicense(overrides: Record<string, unknown> = {}) {
  return {
    id: LICENSE_ID,
    subscriptionId: 'sub-001',
    quantity: 50,
    pendingQuantity: 30,
    inngestRunId: 'inngest-run-001',
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('commitmentScaleDown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls sleepUntil with the correct commitment end date', async () => {
    // Set up minimal mocks so the workflow runs through
    rlsDb.subscription.findMany.mockResolvedValue([{ id: 'sub-001' }]);
    prisma.license.findFirst.mockResolvedValue(makeLicense());
    prisma.license.update.mockResolvedValue({ id: LICENSE_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentScaleDown as any).fn({ event: makeEvent(), step: makeStep() });

    expect(mockSleepUntil).toHaveBeenCalledWith(
      'wait-for-commitment',
      new Date(COMMITMENT_END),
    );
  });

  it('promotes pendingQuantity to quantity and clears inngestRunId', async () => {
    const license = makeLicense({ quantity: 50, pendingQuantity: 25 });
    rlsDb.subscription.findMany.mockResolvedValue([{ id: 'sub-001' }]);
    prisma.license.findFirst.mockResolvedValue(license);
    prisma.license.update.mockResolvedValue({ id: LICENSE_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const result = await (commitmentScaleDown as any).fn({
      event: makeEvent(),
      step: makeStep(),
    });

    expect(result).toEqual({ success: true, licenseId: LICENSE_ID });

    // Verify license update: pending → active, cleared tracking fields
    expect(prisma.license.update).toHaveBeenCalledWith({
      where: { id: LICENSE_ID },
      data: {
        quantity: 25,
        pendingQuantity: null,
        inngestRunId: null,
      },
    });
  });

  it('writes audit log with before/after quantities', async () => {
    const license = makeLicense({ quantity: 100, pendingQuantity: 60 });
    rlsDb.subscription.findMany.mockResolvedValue([{ id: 'sub-001' }]);
    prisma.license.findFirst.mockResolvedValue(license);
    prisma.license.update.mockResolvedValue({ id: LICENSE_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentScaleDown as any).fn({ event: makeEvent(), step: makeStep() });

    expect(rlsDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        action: 'license.scale_down.executed',
        entityId: LICENSE_ID,
        before: { quantity: 100 },
        after: { quantity: 60 },
        traceId: TRACE_ID,
      },
    });
  });

  it('returns early when license is not found', async () => {
    rlsDb.subscription.findMany.mockResolvedValue([{ id: 'sub-001' }]);
    prisma.license.findFirst.mockResolvedValue(null);

    const result = await (commitmentScaleDown as any).fn({
      event: makeEvent(),
      step: makeStep(),
    });

    expect(result).toEqual({ success: true, licenseId: LICENSE_ID });
    expect(prisma.license.update).not.toHaveBeenCalled();
    expect(rlsDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns early when pendingQuantity is null (cancelled scale-down)', async () => {
    const license = makeLicense({ pendingQuantity: null });
    rlsDb.subscription.findMany.mockResolvedValue([{ id: 'sub-001' }]);
    prisma.license.findFirst.mockResolvedValue(license);

    const result = await (commitmentScaleDown as any).fn({
      event: makeEvent(),
      step: makeStep(),
    });

    expect(result).toEqual({ success: true, licenseId: LICENSE_ID });
    expect(prisma.license.update).not.toHaveBeenCalled();
    expect(rlsDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('scopes license lookup to org subscriptions for cross-org isolation', async () => {
    const orgSubs = [{ id: 'sub-001' }, { id: 'sub-002' }];
    rlsDb.subscription.findMany.mockResolvedValue(orgSubs);
    prisma.license.findFirst.mockResolvedValue(makeLicense());
    prisma.license.update.mockResolvedValue({ id: LICENSE_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentScaleDown as any).fn({ event: makeEvent(), step: makeStep() });

    // Verify subscriptions fetched via RLS proxy
    expect(rlsDb.subscription.findMany).toHaveBeenCalledWith({ select: { id: true } });

    // Verify license lookup is scoped to those subscription IDs
    expect(prisma.license.findFirst).toHaveBeenCalledWith({
      where: {
        id: LICENSE_ID,
        subscriptionId: { in: ['sub-001', 'sub-002'] },
      },
    });
  });

  it('returns early when org has no subscriptions', async () => {
    rlsDb.subscription.findMany.mockResolvedValue([]);
    prisma.license.findFirst.mockResolvedValue(null);

    const result = await (commitmentScaleDown as any).fn({
      event: makeEvent(),
      step: makeStep(),
    });

    expect(result).toEqual({ success: true, licenseId: LICENSE_ID });
    expect(prisma.license.update).not.toHaveBeenCalled();
  });

  it('passes null userId and traceId when not provided', async () => {
    rlsDb.subscription.findMany.mockResolvedValue([{ id: 'sub-001' }]);
    prisma.license.findFirst.mockResolvedValue(makeLicense());
    prisma.license.update.mockResolvedValue({ id: LICENSE_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentScaleDown as any).fn({
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

  it('establishes tenant context with correct organizationId', async () => {
    rlsDb.subscription.findMany.mockResolvedValue([{ id: 'sub-001' }]);
    prisma.license.findFirst.mockResolvedValue(makeLicense());
    prisma.license.update.mockResolvedValue({ id: LICENSE_ID });
    rlsDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await (commitmentScaleDown as any).fn({ event: makeEvent(), step: makeStep() });

    expect(mockWithTenantContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
    expect(mockCreateRLSProxy).toHaveBeenCalledWith(ORG_ID);
  });
});
