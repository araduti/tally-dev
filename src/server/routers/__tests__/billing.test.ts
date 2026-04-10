/**
 * Unit tests for the billing router.
 *
 * The billing router exposes three procedures:
 *   - listTransactions  (orgMemberProcedure — any org member)
 *   - getSnapshot       (orgAdminProcedure  — ORG_ADMIN+ only)
 *   - projectInvoice    (orgAdminProcedure  — ORG_ADMIN+ only)
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const { prisma, buildDbProxy, mockRedis, rlsDb } = vi.hoisted(() => {
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

  return { prisma: buildDbProxy(), buildDbProxy, mockRedis, rlsDb };
});

vi.mock('@/lib/db', () => ({ prisma }));

vi.mock('@/lib/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
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

import Decimal from 'decimal.js';
import { billingRouter } from '../billing';

// ──────────────────────────────────────────────
// Constants & auth helpers
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';

const SESSION_TOKEN = 'test-session-token';
const USER_ID = 'test-user-id';
const ORG_ID = 'test-org-id';

function createAuthHeaders() {
  const headers = new Headers();
  headers.set('cookie', `better-auth.session_token=${SESSION_TOKEN}`);
  return headers;
}

function mockAuth(orgRole: string = 'ORG_OWNER') {
  prisma.session.findUnique.mockResolvedValue({
    id: 'session-1',
    token: SESSION_TOKEN,
    userId: USER_ID,
    expiresAt: new Date(Date.now() + 3_600_000),
    activeOrganizationId: ORG_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { id: USER_ID, platformRole: null },
  });

  prisma.member.findUnique.mockResolvedValue({
    id: 'member-1',
    organizationId: ORG_ID,
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
    ...overrides,
  };
}

function createAuthedCaller(orgRole: string = 'ORG_OWNER') {
  mockAuth(orgRole);
  const ctx = createTestContext({
    headers: createAuthHeaders(),
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
// Tests
// ──────────────────────────────────────────────

describe('billingRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────
  //  listTransactions
  // ─────────────────────────────────────
  describe('listTransactions', () => {
    it('returns transactions with pagination', async () => {
      const transactions = [
        makeMockTransaction({ id: 'clh1234567890abcdefghij50' }),
        makeMockTransaction({ id: 'clh1234567890abcdefghij51' }),
      ];

      const caller = createAuthedCaller('ORG_OWNER');
      
      rlsDb.purchaseTransaction.findMany.mockResolvedValue(transactions);

      const result = await caller.listTransactions({ limit: 25 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(rlsDb.purchaseTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 26,
          orderBy: { createdAt: 'desc' },
          include: expect.objectContaining({
            productOffering: expect.objectContaining({
              include: { bundle: true },
            }),
          }),
        }),
      );
    });

    it('returns empty results when no transactions exist', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      
      rlsDb.purchaseTransaction.findMany.mockResolvedValue([]);

      const result = await caller.listTransactions({ limit: 25 });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('handles pagination when more results exist', async () => {
      // Return limit + 1 items to indicate more results
      const transactions = Array.from({ length: 3 }, (_, i) =>
        makeMockTransaction({ id: `clh1234567890abcdefghij${60 + i}` }),
      );

      const caller = createAuthedCaller('ORG_OWNER');
      
      rlsDb.purchaseTransaction.findMany.mockResolvedValue(transactions);

      const result = await caller.listTransactions({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('clh1234567890abcdefghij61');
    });

    it('filters transactions by status', async () => {
      const pendingTx = makeMockTransaction({ status: 'PENDING' });

      const caller = createAuthedCaller('ORG_OWNER');
      
      rlsDb.purchaseTransaction.findMany.mockResolvedValue([pendingTx]);

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

    it('applies custom ordering when specified', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      
      rlsDb.purchaseTransaction.findMany.mockResolvedValue([]);

      await caller.listTransactions({
        limit: 25,
        orderBy: { field: 'grossAmount', direction: 'asc' },
      });

      expect(rlsDb.purchaseTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { grossAmount: 'asc' },
        }),
      );
    });
  });

  // ─────────────────────────────────────
  //  getSnapshot
  // ─────────────────────────────────────
  describe('getSnapshot', () => {
    it('returns a billing snapshot for valid filters', async () => {
      const mockSnapshot = makeMockSnapshot();

      const caller = createAuthedCaller('ORG_ADMIN');
      
      rlsDb.billingSnapshot.findFirst.mockResolvedValue(mockSnapshot);

      const result = await caller.getSnapshot({
        subscriptionId: VALID_CUID,
      });

      expect(result).toEqual(mockSnapshot);
      expect(rlsDb.billingSnapshot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subscriptionId: VALID_CUID,
          }),
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('throws NOT_FOUND when no snapshot exists', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');
      
      rlsDb.billingSnapshot.findFirst.mockResolvedValue(null);

      await expect(
        caller.getSnapshot({ subscriptionId: VALID_CUID }),
      ).rejects.toThrow('No billing snapshot found for the specified period');
    });

    it('filters by period dates when provided', async () => {
      const start = new Date('2024-06-01');
      const end = new Date('2024-06-30');
      const mockSnapshot = makeMockSnapshot({ periodStart: start, periodEnd: end });

      const caller = createAuthedCaller('ORG_ADMIN');
      
      rlsDb.billingSnapshot.findFirst.mockResolvedValue(mockSnapshot);

      const result = await caller.getSnapshot({
        periodStart: start,
        periodEnd: end,
      });

      expect(result).toEqual(mockSnapshot);
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

  // ─────────────────────────────────────
  //  projectInvoice
  // ─────────────────────────────────────
  describe('projectInvoice', () => {
    it('returns projected invoice with Decimal.js math', async () => {
      const subscription = makeMockSubscription();

      const caller = createAuthedCaller('ORG_ADMIN');
      
      rlsDb.subscription.findMany.mockResolvedValue([subscription]);

      const result = await caller.projectInvoice({});

      // unitCost = 6.00, quantity = 10 → lineTotal = 60.00
      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].unitCost).toBe('6.00');
      expect(result.lineItems[0].lineTotal).toBe('60.00');
      expect(result.lineItems[0].quantity).toBe(10);
      expect(result.lineItems[0].bundleName).toBe('M365 Business Basic');
      expect(result.lineItems[0].vendorType).toBe('PAX8');
      expect(result.totalProjectedAmount).toBe('60.00');

      // Verify Decimal.js precision
      const expectedTotal = new Decimal('6.00').mul(10);
      expect(new Decimal(result.totalProjectedAmount).eq(expectedTotal)).toBe(true);
    });

    it('returns empty line items when no active subscriptions', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');
      
      rlsDb.subscription.findMany.mockResolvedValue([]);

      const result = await caller.projectInvoice({});

      expect(result.lineItems).toHaveLength(0);
      expect(result.totalProjectedAmount).toBe('0.00');
      expect(result.periodStart).toBeInstanceOf(Date);
      expect(result.periodEnd).toBeInstanceOf(Date);
    });

    it('sums multiple licenses across subscriptions', async () => {
      const sub1 = makeMockSubscription({
        id: 'clh1234567890abcdefghij20',
        licenses: [
          {
            id: 'clh1234567890abcdefghijl1',
            quantity: 5,
            pendingQuantity: null,
            productOffering: { id: 'clh1234567890abcdefghij30', effectiveUnitCost: '10.00' },
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
            productOffering: { id: 'clh1234567890abcdefghij31', effectiveUnitCost: '8.50' },
          },
        ],
      });

      const caller = createAuthedCaller('ORG_ADMIN');
      
      rlsDb.subscription.findMany.mockResolvedValue([sub1, sub2]);

      const result = await caller.projectInvoice({});

      expect(result.lineItems).toHaveLength(2);

      // sub1: 10.00 * 5 = 50.00
      expect(result.lineItems[0].lineTotal).toBe('50.00');
      // sub2: 8.50 * 3 = 25.50
      expect(result.lineItems[1].lineTotal).toBe('25.50');

      // Total: 50.00 + 25.50 = 75.50
      expect(result.totalProjectedAmount).toBe('75.50');

      // Verify with Decimal.js
      const expected = new Decimal('50.00').add(new Decimal('25.50'));
      expect(new Decimal(result.totalProjectedAmount).eq(expected)).toBe(true);
    });

    it('handles null effectiveUnitCost by treating as zero', async () => {
      const sub = makeMockSubscription({
        licenses: [
          {
            id: 'clh1234567890abcdefghijl3',
            quantity: 10,
            pendingQuantity: null,
            productOffering: { id: 'clh1234567890abcdefghij32', effectiveUnitCost: null },
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
    });

    it('uses provided period dates', async () => {
      const periodStart = new Date('2024-07-01');
      const periodEnd = new Date('2024-07-31');

      const caller = createAuthedCaller('ORG_ADMIN');
      
      rlsDb.subscription.findMany.mockResolvedValue([]);

      const result = await caller.projectInvoice({ periodStart, periodEnd });

      expect(result.periodStart).toEqual(periodStart);
      expect(result.periodEnd).toEqual(periodEnd);
    });

    it('includes pendingQuantity and commitmentEndDate in line items', async () => {
      const commitDate = new Date('2025-06-01');
      const sub = makeMockSubscription({
        commitmentEndDate: commitDate,
        licenses: [
          {
            id: 'clh1234567890abcdefghijl4',
            quantity: 10,
            pendingQuantity: 5,
            productOffering: { id: 'clh1234567890abcdefghij33', effectiveUnitCost: '6.00' },
          },
        ],
      });

      const caller = createAuthedCaller('ORG_ADMIN');
      
      rlsDb.subscription.findMany.mockResolvedValue([sub]);

      const result = await caller.projectInvoice({});

      expect(result.lineItems[0].pendingQuantity).toBe(5);
      expect(result.lineItems[0].commitmentEndDate).toEqual(commitDate);
    });
  });
});
