/**
 * Integration tests for the billing router.
 *
 * These tests exercise multi-step billing workflows:
 *   - Snapshot creation and retrieval
 *   - Invoice projection with Decimal.js precision
 *   - Cross-subscription financial aggregation
 *   - Audit trail for billing operations
 *
 * Unlike unit tests (billing.test.ts), these integration tests:
 *   - Test listTransactions → projectInvoice → createSnapshot flows
 *   - Verify Decimal.js precision across multi-subscription aggregation
 *   - Test snapshot idempotency (same period returns existing)
 *   - Validate audit trail for billing snapshot operations
 *   - Test multi-tenant isolation for billing data
 *   - Test financial edge cases (null costs, zero quantities)
 *
 * NOTE: Mutation procedures are replaced with query counterparts
 * to bypass the idempotency guard (same RBAC, no idempotency guard).
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const { prisma, buildDbProxy, mockRedis, rlsDb, mockWriteAuditLog } = vi.hoisted(() => {
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

  const mockRedis = {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  };

  const rlsDb = buildDbProxy();
  const mockWriteAuditLog = vi.fn().mockResolvedValue(undefined);

  return { prisma: buildDbProxy(), buildDbProxy, mockRedis, rlsDb, mockWriteAuditLog };
});

vi.mock('@/lib/db', () => ({ prisma }));

vi.mock('@/lib/audit', () => ({
  writeAuditLog: mockWriteAuditLog,
}));

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn().mockReturnValue('encrypted'),
  decrypt: vi.fn().mockReturnValue('decrypted'),
}));

vi.mock('@/lib/redis', () => ({
  redis: mockRedis,
  IDEMPOTENCY_TTL: 86400,
}));

vi.mock('@/lib/rls-proxy', () => ({
  createRLSProxy: vi.fn(() => rlsDb),
}));

vi.mock('@/server/trpc/init', async () => {
  const actual = await vi.importActual<typeof import('@/server/trpc/init')>(
    '@/server/trpc/init',
  );
  return {
    ...actual,
    orgAdminMutationProcedure: actual.orgAdminProcedure,
  };
});

import Decimal from 'decimal.js';
import { billingRouter } from '../billing';

// ──────────────────────────────────────────────
// Constants & auth helpers
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';

const SESSION_TOKEN = 'test-session-token';
const USER_ID = 'test-user-id';
const ORG_ID = 'test-org-id';
const ORG_ID_B = 'test-org-id-b';

function createAuthHeaders() {
  const headers = new Headers();
  headers.set('cookie', `better-auth.session_token=${SESSION_TOKEN}`);
  return headers;
}

function mockAuth(orgRole: string = 'ORG_OWNER', orgId: string = ORG_ID) {
  prisma.session.findUnique.mockResolvedValue({
    id: 'session-1',
    token: SESSION_TOKEN,
    userId: USER_ID,
    expiresAt: new Date(Date.now() + 3_600_000),
    activeOrganizationId: orgId,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { id: USER_ID, platformRole: null },
  });

  prisma.member.findUnique.mockResolvedValue({
    id: 'member-1',
    organizationId: orgId,
    userId: USER_ID,
    orgRole,
    mspRole: null,
  });
}

function createTestContext(overrides: Record<string, any> = {}) {
  const db = buildDbProxy();
  return {
    headers: new Headers(),
    userId: USER_ID,
    organizationId: ORG_ID,
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: 'ORG_OWNER' as const,
    },
    db,
    traceId: 'test-trace-id',
    resHeaders: null,
    ...overrides,
  };
}

function createAuthedCaller(orgRole: string = 'ORG_OWNER', orgId: string = ORG_ID) {
  mockAuth(orgRole, orgId);
  const ctx = createTestContext({
    headers: createAuthHeaders(),
    organizationId: orgId,
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole,
    },
  });
  return billingRouter.createCaller(ctx);
}

// ──────────────────────────────────────────────
// Mock data factories
// ──────────────────────────────────────────────

function makeMockTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    organizationId: ORG_ID,
    subscriptionId: 'clh1234567890abcdefghij20',
    productOfferingId: 'clh1234567890abcdefghij30',
    quantity: 5,
    unitCost: '29.99',
    grossAmount: '149.95',
    status: 'COMPLETED',
    type: 'PURCHASE',
    createdAt: new Date('2024-06-01'),
    updatedAt: new Date('2024-06-01'),
    productOffering: {
      id: 'clh1234567890abcdefghij30',
      bundleId: 'clh1234567890abcdefghij40',
      effectiveUnitCost: '29.99',
      bundle: {
        id: 'clh1234567890abcdefghij40',
        name: 'Microsoft 365 Business Basic',
      },
    },
    ...overrides,
  };
}

function makeMockSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    organizationId: ORG_ID,
    subscriptionId: 'clh1234567890abcdefghij20',
    periodStart: new Date('2024-06-01'),
    periodEnd: new Date('2024-06-30'),
    totalAmount: '449.85',
    lineItems: [],
    createdAt: new Date('2024-06-30'),
    updatedAt: new Date('2024-06-30'),
    ...overrides,
  };
}

function makeMockSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clh1234567890abcdefghij20',
    organizationId: ORG_ID,
    status: 'ACTIVE',
    commitmentEndDate: new Date('2025-01-01'),
    bundle: { id: 'clh1234567890abcdefghij40', name: 'M365 Business Basic' },
    licenses: [
      {
        id: 'clh1234567890abcdefghijli',
        quantity: 10,
        pendingQuantity: null,
        productOffering: {
          id: 'clh1234567890abcdefghij30',
          effectiveUnitCost: '6.00',
        },
      },
    ],
    vendorConnection: { vendorType: 'PAX8' },
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Integration Tests
// ──────────────────────────────────────────────

describe('billingRouter — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  //  Full flow: listTransactions → projectInvoice → createSnapshot
  // ─────────────────────────────────────────────
  describe('full flow: transactions → projection → snapshot', () => {
    it('reviews transactions, projects invoice, then creates snapshot', async () => {
      // Step 1: List recent transactions
      const listCaller = createAuthedCaller('ORG_ADMIN');
      const transactions = [
        makeMockTransaction({ id: 'clh1234567890abcdefghij50' }),
        makeMockTransaction({ id: 'clh1234567890abcdefghij51' }),
      ];
      rlsDb.purchaseTransaction.findMany.mockResolvedValue(transactions);

      const listResult = await listCaller.listTransactions({ limit: 25 });
      expect(listResult.items).toHaveLength(2);
      expect(listResult.nextCursor).toBeNull();

      // Step 2: Project an invoice
      vi.clearAllMocks();
      const projectCaller = createAuthedCaller('ORG_ADMIN');
      const subscription = makeMockSubscription();
      rlsDb.subscription.findMany.mockResolvedValue([subscription]);

      const projection = await projectCaller.projectInvoice({});
      expect(projection.lineItems).toHaveLength(1);
      expect(projection.lineItems[0].unitCost).toBe('6.00');
      expect(projection.lineItems[0].quantity).toBe(10);
      expect(projection.lineItems[0].lineTotal).toBe('60.00');
      expect(projection.totalProjectedAmount).toBe('60.00');

      // Verify Decimal.js precision
      const expectedTotal = new Decimal('6.00').mul(10);
      expect(new Decimal(projection.totalProjectedAmount).eq(expectedTotal)).toBe(true);

      // Step 3: Create a billing snapshot
      vi.clearAllMocks();
      const snapshotCaller = createAuthedCaller('ORG_ADMIN');
      rlsDb.billingSnapshot.findFirst.mockResolvedValue(null); // no existing
      rlsDb.subscription.findMany.mockResolvedValue([subscription]);

      const mockSnapshot = makeMockSnapshot({
        projectedAmount: '60.00',
        periodStart: new Date('2024-06-01'),
        periodEnd: new Date('2024-06-30'),
        metadata: { lineItems: projection.lineItems },
      });
      rlsDb.billingSnapshot.create.mockResolvedValue(mockSnapshot);

      const snapshot = await snapshotCaller.createSnapshot({
        periodStart: new Date('2024-06-01'),
        periodEnd: new Date('2024-06-30'),
        idempotencyKey: VALID_UUID,
      });

      expect(snapshot).toBeDefined();
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.snapshot_created',
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Snapshot idempotency
  // ─────────────────────────────────────────────
  describe('snapshot idempotency', () => {
    it('returns existing snapshot for same period without creating duplicate', async () => {
      const existingSnapshot = makeMockSnapshot({
        periodStart: new Date('2024-06-01'),
        periodEnd: new Date('2024-06-30'),
      });

      const caller = createAuthedCaller('ORG_ADMIN');
      rlsDb.billingSnapshot.findFirst.mockResolvedValue(existingSnapshot);

      const result = await caller.createSnapshot({
        periodStart: new Date('2024-06-01'),
        periodEnd: new Date('2024-06-30'),
        idempotencyKey: VALID_UUID,
      });

      expect(result).toEqual(existingSnapshot);
      expect(rlsDb.billingSnapshot.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  //  Decimal.js precision in multi-subscription projection
  // ─────────────────────────────────────────────
  describe('Decimal.js precision across subscriptions', () => {
    it('correctly sums multiple line items with precise decimal math', async () => {
      const sub1 = makeMockSubscription({
        id: 'clh1234567890abcdefghij20',
        licenses: [
          {
            id: 'clh1234567890abcdefghijl1',
            quantity: 5,
            pendingQuantity: null,
            productOffering: {
              id: 'clh1234567890abcdefghij30',
              effectiveUnitCost: '10.00',
            },
          },
        ],
      });
      const sub2 = makeMockSubscription({
        id: 'clh1234567890abcdefghij21',
        bundle: { id: 'clh1234567890abcdefghij41', name: 'Teams Phone' },
        licenses: [
          {
            id: 'clh1234567890abcdefghijl2',
            quantity: 3,
            pendingQuantity: 2,
            productOffering: {
              id: 'clh1234567890abcdefghij31',
              effectiveUnitCost: '8.50',
            },
          },
        ],
      });

      const caller = createAuthedCaller('ORG_ADMIN');
      rlsDb.subscription.findMany.mockResolvedValue([sub1, sub2]);

      const result = await caller.projectInvoice({});

      expect(result.lineItems).toHaveLength(2);

      // sub1: 10.00 × 5 = 50.00
      expect(result.lineItems[0].lineTotal).toBe('50.00');
      // sub2: 8.50 × 3 = 25.50
      expect(result.lineItems[1].lineTotal).toBe('25.50');

      // Total: 50.00 + 25.50 = 75.50
      expect(result.totalProjectedAmount).toBe('75.50');

      // Cross-verify with Decimal.js
      const expected = new Decimal('50.00').add(new Decimal('25.50'));
      expect(new Decimal(result.totalProjectedAmount).eq(expected)).toBe(true);
    });

    it('handles null effectiveUnitCost as zero in projection', async () => {
      const sub = makeMockSubscription({
        licenses: [
          {
            id: 'clh1234567890abcdefghijl3',
            quantity: 10,
            pendingQuantity: null,
            productOffering: {
              id: 'clh1234567890abcdefghij32',
              effectiveUnitCost: null,
            },
          },
        ],
      });

      const caller = createAuthedCaller('ORG_ADMIN');
      rlsDb.subscription.findMany.mockResolvedValue([sub]);

      const result = await caller.projectInvoice({});

      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].unitCost).toBe('0.00');
      expect(result.lineItems[0].lineTotal).toBe('0.00');
      expect(result.totalProjectedAmount).toBe('0.00');

      // Verify zero is precisely zero
      expect(new Decimal(result.totalProjectedAmount).isZero()).toBe(true);
    });

    it('handles zero quantity subscriptions correctly', async () => {
      const sub = makeMockSubscription({
        licenses: [
          {
            id: 'clh1234567890abcdefghijl4',
            quantity: 0,
            pendingQuantity: null,
            productOffering: {
              id: 'clh1234567890abcdefghij33',
              effectiveUnitCost: '10.00',
            },
          },
        ],
      });

      const caller = createAuthedCaller('ORG_ADMIN');
      rlsDb.subscription.findMany.mockResolvedValue([sub]);

      const result = await caller.projectInvoice({});

      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].lineTotal).toBe('0.00');
      expect(result.totalProjectedAmount).toBe('0.00');
    });
  });

  // ─────────────────────────────────────────────
  //  Projection with commitment and pending quantity
  // ─────────────────────────────────────────────
  describe('projection with commitment details', () => {
    it('includes pendingQuantity and commitmentEndDate in projection', async () => {
      const commitDate = new Date('2025-06-01');
      const sub = makeMockSubscription({
        commitmentEndDate: commitDate,
        licenses: [
          {
            id: 'clh1234567890abcdefghijl5',
            quantity: 10,
            pendingQuantity: 5,
            productOffering: {
              id: 'clh1234567890abcdefghij34',
              effectiveUnitCost: '6.00',
            },
          },
        ],
      });

      const caller = createAuthedCaller('ORG_ADMIN');
      rlsDb.subscription.findMany.mockResolvedValue([sub]);

      const result = await caller.projectInvoice({});

      expect(result.lineItems[0].pendingQuantity).toBe(5);
      expect(result.lineItems[0].commitmentEndDate).toEqual(commitDate);
      // Current billing uses active quantity (10), not pending (5)
      expect(result.lineItems[0].lineTotal).toBe('60.00');
    });

    it('uses custom period dates when provided', async () => {
      const periodStart = new Date('2024-07-01');
      const periodEnd = new Date('2024-07-31');

      const caller = createAuthedCaller('ORG_ADMIN');
      rlsDb.subscription.findMany.mockResolvedValue([]);

      const result = await caller.projectInvoice({ periodStart, periodEnd });

      expect(result.periodStart).toEqual(periodStart);
      expect(result.periodEnd).toEqual(periodEnd);
    });
  });

  // ─────────────────────────────────────────────
  //  Multi-tenant isolation
  // ─────────────────────────────────────────────
  describe('multi-tenant isolation', () => {
    it('org A transactions not visible to org B', async () => {
      // Org A has transactions
      const callerA = createAuthedCaller('ORG_OWNER', ORG_ID);
      rlsDb.purchaseTransaction.findMany.mockResolvedValue([
        makeMockTransaction({ id: 'clh1234567890abcdefghij50' }),
      ]);

      const resultA = await callerA.listTransactions({ limit: 25 });
      expect(resultA.items).toHaveLength(1);

      // Org B sees nothing
      vi.clearAllMocks();
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.purchaseTransaction.findMany.mockResolvedValue([]);

      const resultB = await callerB.listTransactions({ limit: 25 });
      expect(resultB.items).toHaveLength(0);
    });

    it('org B cannot view org A snapshots', async () => {
      const callerB = createAuthedCaller('ORG_ADMIN', ORG_ID_B);
      rlsDb.billingSnapshot.findFirst.mockResolvedValue(null);

      await expect(
        callerB.getSnapshot({ subscriptionId: VALID_CUID }),
      ).rejects.toThrow('No billing snapshot found for the specified period');
    });
  });

  // ─────────────────────────────────────────────
  //  RBAC enforcement
  // ─────────────────────────────────────────────
  describe('RBAC enforcement', () => {
    it('ORG_MEMBER can list transactions but cannot project invoice', async () => {
      // ORG_MEMBER — listTransactions succeeds
      const memberCaller = createAuthedCaller('ORG_MEMBER');
      rlsDb.purchaseTransaction.findMany.mockResolvedValue([]);

      const listResult = await memberCaller.listTransactions({ limit: 25 });
      expect(listResult.items).toHaveLength(0);

      // ORG_MEMBER — projectInvoice fails (ORG_ADMIN+ required)
      vi.clearAllMocks();
      const memberCaller2 = createAuthedCaller('ORG_MEMBER');

      await expect(
        memberCaller2.projectInvoice({}),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('ORG_MEMBER cannot get snapshots', async () => {
      const memberCaller = createAuthedCaller('ORG_MEMBER');

      await expect(
        memberCaller.getSnapshot({ subscriptionId: VALID_CUID }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('ORG_MEMBER cannot create snapshots', async () => {
      const memberCaller = createAuthedCaller('ORG_MEMBER');

      await expect(
        memberCaller.createSnapshot({
          periodStart: new Date('2024-06-01'),
          periodEnd: new Date('2024-06-30'),
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ─────────────────────────────────────────────
  //  Transaction pagination
  // ─────────────────────────────────────────────
  describe('transaction pagination', () => {
    it('traverses transactions via cursor-based pagination', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      // Page 1: 3 items with limit 2 → has more
      const page1Txns = [
        makeMockTransaction({ id: 'clh1234567890abcdefghij50' }),
        makeMockTransaction({ id: 'clh1234567890abcdefghij51' }),
        makeMockTransaction({ id: 'clh1234567890abcdefghij52' }),
      ];
      rlsDb.purchaseTransaction.findMany.mockResolvedValueOnce(page1Txns);

      const page1 = await caller.listTransactions({ limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).toBe('clh1234567890abcdefghij51');

      // Page 2: 1 item → no more
      rlsDb.purchaseTransaction.findMany.mockResolvedValueOnce([
        makeMockTransaction({ id: 'clh1234567890abcdefghij52' }),
      ]);

      const page2 = await caller.listTransactions({
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
    });

    it('filters transactions by status during pagination', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      rlsDb.purchaseTransaction.findMany.mockResolvedValue([
        makeMockTransaction({ status: 'PENDING' }),
      ]);

      const result = await caller.listTransactions({
        limit: 25,
        where: { status: 'PENDING' },
      });

      expect(result.items).toHaveLength(1);
      expect(rlsDb.purchaseTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING' },
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Snapshot period filtering
  // ─────────────────────────────────────────────
  describe('snapshot retrieval with period filters', () => {
    it('fetches snapshot filtered by date range', async () => {
      const start = new Date('2024-06-01');
      const end = new Date('2024-06-30');
      const snapshot = makeMockSnapshot({ periodStart: start, periodEnd: end });

      const caller = createAuthedCaller('ORG_ADMIN');
      rlsDb.billingSnapshot.findFirst.mockResolvedValue(snapshot);

      const result = await caller.getSnapshot({
        periodStart: start,
        periodEnd: end,
      });

      expect(result.periodStart).toEqual(start);
      expect(result.periodEnd).toEqual(end);
      expect(rlsDb.billingSnapshot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            periodStart: { gte: start },
            periodEnd: { lte: end },
          }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Empty state handling
  // ─────────────────────────────────────────────
  describe('empty state handling', () => {
    it('returns zero projection when no subscriptions exist', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');
      rlsDb.subscription.findMany.mockResolvedValue([]);

      const result = await caller.projectInvoice({});

      expect(result.lineItems).toHaveLength(0);
      expect(result.totalProjectedAmount).toBe('0.00');
      expect(result.periodStart).toBeInstanceOf(Date);
      expect(result.periodEnd).toBeInstanceOf(Date);
    });

    it('returns empty list when no transactions exist', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      rlsDb.purchaseTransaction.findMany.mockResolvedValue([]);

      const result = await caller.listTransactions({ limit: 25 });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });
  });
});
