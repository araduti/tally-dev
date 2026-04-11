/**
 * Unit tests for the catalog router.
 *
 * The catalog router exposes four procedures:
 *   - listBundles       (orgMemberProcedure — any org member)
 *   - getBundle         (orgMemberProcedure — any org member)
 *   - listProductOfferings (orgMemberProcedure — any org member)
 *   - comparePricing    (orgAdminProcedure  — ORG_ADMIN+ only)
 *
 * Bundles and ProductOfferings are global catalog data, so the router
 * queries prisma directly (not ctx.db / RLS proxy).
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers that are available to vi.mock
// factories. Both blocks are hoisted above all imports by vitest.
// ──────────────────────────────────────────────

const { prisma, buildDbProxy } = vi.hoisted(() => {
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

  return { prisma: buildDbProxy(), buildDbProxy };
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
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
  IDEMPOTENCY_TTL: 86400,
}));

vi.mock('@/lib/rls-proxy', () => ({
  createRLSProxy: vi.fn(() => buildDbProxy()),
}));

import { TRPCError } from '@trpc/server';
import { catalogRouter } from '../catalog';

// ──────────────────────────────────────────────
// Constants & context helper
// ──────────────────────────────────────────────

/** Valid CUIDs that pass z.string().cuid() validation. */
const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';

// ──────────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────────

const SESSION_TOKEN = 'test-session-token';
const USER_ID = 'test-user-id';
const ORG_ID = 'test-org-id';

/** Build a Headers object containing a valid session cookie. */
function createAuthHeaders() {
  const headers = new Headers();
  headers.set('cookie', `better-auth.session_token=${SESSION_TOKEN}`);
  return headers;
}

/**
 * Configure the mocked prisma so the isAuthenticated middleware
 * resolves a valid session + member with the given OrgRole.
 */
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

/**
 * Convenience: create an authenticated caller in one call.
 * Sets up auth mocks, builds a context with cookie headers,
 * and returns a typed tRPC caller for the catalog router.
 */
function createTestContext(overrides: Record<string, any> = {}) {
  return {
    headers: new Headers(),
    userId: 'test-user-id',
    organizationId: 'test-org-id',
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: 'ORG_OWNER' as const,
    },
    db: buildDbProxy(),
    traceId: 'test-trace-id',
    resHeaders: null,
    ...overrides,
  };
}

function createAuthedCaller(orgRole: string = 'ORG_OWNER') {
  mockAuth(orgRole);
  const ctx = createTestContext({ headers: createAuthHeaders() });
  return catalogRouter.createCaller(ctx);
}

// ──────────────────────────────────────────────
// Mock data factories
// ──────────────────────────────────────────────

function makeMockBundle(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    globalSkuId: 'SKU-001',
    name: 'Microsoft 365 Business Basic',
    friendlyName: 'M365 Basic',
    description: 'Cloud productivity suite',
    category: 'Productivity',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    products: [],
    offerings: [],
    ...overrides,
  };
}

function makeMockOffering(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    bundleId: VALID_CUID,
    sourceType: 'PAX8',
    externalSku: 'EXT-SKU-001',
    effectiveUnitCost: '6.00',
    partnerMarginPercent: '15.00',
    currency: 'USD',
    availability: 'available',
    minQuantity: null,
    maxQuantity: null,
    leadTimeDays: null,
    metadata: {},
    lastPricingFetchedAt: new Date(),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('catalogRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ─────────────────────────────────────
  //  listBundles
  // ─────────────────────────────────────
  describe('listBundles', () => {
    it('returns bundles with products', async () => {
      const caller = createAuthedCaller();
      const bundle = makeMockBundle({
        products: [
          {
            bundleId: VALID_CUID,
            productId: 'prod-1',
            product: { id: 'prod-1', name: 'Exchange Online' },
          },
        ],
      });
      prisma.bundle.findMany.mockResolvedValue([bundle]);

      const result = await caller.listBundles({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(VALID_CUID);
      expect(result.items[0].products).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('returns empty list when no bundles exist', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      const result = await caller.listBundles({});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('returns nextCursor when more items exist than the limit', async () => {
      const caller = createAuthedCaller();
      // Default limit is 25 → return 26 items to trigger hasMore
      const bundles = Array.from({ length: 26 }, (_, i) =>
        makeMockBundle({
          id: `clh1234567890abcdefgh${String(i).padStart(4, '0')}`,
        }),
      );
      prisma.bundle.findMany.mockResolvedValue(bundles);

      const result = await caller.listBundles({});

      expect(result.items).toHaveLength(25);
      expect(result.nextCursor).toBe(result.items[24].id);
    });

    it('paginates correctly with a custom limit', async () => {
      const caller = createAuthedCaller();
      // limit=1 → findMany is called with take=2 → return 2 → hasMore=true
      const bundles = [
        makeMockBundle({ id: VALID_CUID }),
        makeMockBundle({ id: VALID_CUID_2 }),
      ];
      prisma.bundle.findMany.mockResolvedValue(bundles);

      const result = await caller.listBundles({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(VALID_CUID);
      expect(result.nextCursor).toBe(VALID_CUID);
    });

    it('sets nextCursor to null when result count equals limit', async () => {
      const caller = createAuthedCaller();
      // limit=2, return exactly 2 → hasMore = false
      const bundles = [
        makeMockBundle({ id: VALID_CUID }),
        makeMockBundle({ id: VALID_CUID_2 }),
      ];
      prisma.bundle.findMany.mockResolvedValue(bundles);

      const result = await caller.listBundles({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('passes cursor to prisma when provided', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      await caller.listBundles({ cursor: VALID_CUID });

      expect(prisma.bundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: VALID_CUID },
        }),
      );
    });

    it('omits cursor from prisma query when not provided', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      await caller.listBundles({});

      expect(prisma.bundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: undefined,
        }),
      );
    });

    it('filters by category', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      await caller.listBundles({ where: { category: 'Security' } });

      expect(prisma.bundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'Security' }),
        }),
      );
    });

    it('filters by name with case-insensitive contains', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      await caller.listBundles({ where: { name: 'microsoft' } });

      expect(prisma.bundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: { contains: 'microsoft', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('builds an empty where clause when no filters are provided', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      await caller.listBundles({});

      expect(prisma.bundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('applies custom ordering', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      await caller.listBundles({
        orderBy: { field: 'name', direction: 'asc' },
      });

      expect(prisma.bundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('defaults to createdAt desc ordering', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      await caller.listBundles({});

      expect(prisma.bundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('includes products → product in the prisma query', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      await caller.listBundles({});

      expect(prisma.bundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { products: { include: { product: true } } },
        }),
      );
    });

    it('requests limit + 1 items for pagination detection', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findMany.mockResolvedValue([]);

      await caller.listBundles({ limit: 10 });

      expect(prisma.bundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 11 }),
      );
    });

    it('rejects limit below 1', async () => {
      const caller = createAuthedCaller();

      await expect(caller.listBundles({ limit: 0 })).rejects.toThrow();
    });

    it('rejects limit above 100', async () => {
      const caller = createAuthedCaller();

      await expect(caller.listBundles({ limit: 101 })).rejects.toThrow();
    });

    it('rejects non-integer limit', async () => {
      const caller = createAuthedCaller();

      await expect(caller.listBundles({ limit: 2.5 })).rejects.toThrow();
    });

    it('rejects invalid cursor format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.listBundles({ cursor: 'not-a-cuid' }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────
  //  getBundle
  // ─────────────────────────────────────
  describe('getBundle', () => {
    it('returns bundle with products and offerings', async () => {
      const caller = createAuthedCaller();
      const bundle = makeMockBundle({
        products: [
          {
            bundleId: VALID_CUID,
            productId: 'prod-1',
            product: { id: 'prod-1', name: 'Exchange Online' },
          },
        ],
        offerings: [makeMockOffering()],
      });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.getBundle({ bundleId: VALID_CUID });

      expect(result.id).toBe(VALID_CUID);
      expect(result.products).toHaveLength(1);
      expect(result.offerings).toHaveLength(1);
    });

    it('queries with correct where and include clauses', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findUnique.mockResolvedValue(makeMockBundle());

      await caller.getBundle({ bundleId: VALID_CUID });

      expect(prisma.bundle.findUnique).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        include: {
          products: { include: { product: true } },
          offerings: true,
        },
      });
    });

    it('throws NOT_FOUND when bundle does not exist', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findUnique.mockResolvedValue(null);

      await expect(
        caller.getBundle({ bundleId: VALID_CUID }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Product offering is not available',
      });
    });

    it('thrown error carries the CATALOG:OFFERING:UNAVAILABLE errorCode', async () => {
      const caller = createAuthedCaller();
      prisma.bundle.findUnique.mockResolvedValue(null);

      try {
        await caller.getBundle({ bundleId: VALID_CUID });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as unknown as Record<string, unknown>;
        expect(cause.errorCode).toBe('CATALOG:OFFERING:UNAVAILABLE');
      }
    });

    it('rejects invalid bundleId format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.getBundle({ bundleId: 'not-a-cuid' }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────
  //  listProductOfferings
  // ─────────────────────────────────────
  describe('listProductOfferings', () => {
    it('returns paginated offerings', async () => {
      const caller = createAuthedCaller();
      const offering = makeMockOffering();
      prisma.productOffering.findMany.mockResolvedValue([offering]);

      const result = await caller.listProductOfferings({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(VALID_CUID);
      expect(result.nextCursor).toBeNull();
    });

    it('returns empty list when no offerings exist', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      const result = await caller.listProductOfferings({});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('returns nextCursor when more items exist', async () => {
      const caller = createAuthedCaller();
      const offerings = [
        makeMockOffering({ id: VALID_CUID }),
        makeMockOffering({ id: VALID_CUID_2 }),
      ];
      prisma.productOffering.findMany.mockResolvedValue(offerings);

      const result = await caller.listProductOfferings({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe(VALID_CUID);
    });

    it('sets nextCursor to null when result count equals limit', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([
        makeMockOffering({ id: VALID_CUID }),
      ]);

      const result = await caller.listProductOfferings({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('filters by bundleId', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      await caller.listProductOfferings({
        where: { bundleId: VALID_CUID },
      });

      expect(prisma.productOffering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ bundleId: VALID_CUID }),
        }),
      );
    });

    it('filters by sourceType', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      await caller.listProductOfferings({
        where: { sourceType: 'PAX8' },
      });

      expect(prisma.productOffering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sourceType: 'PAX8' }),
        }),
      );
    });

    it('filters by availability', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      await caller.listProductOfferings({
        where: { availability: 'available' },
      });

      expect(prisma.productOffering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ availability: 'available' }),
        }),
      );
    });

    it('combines multiple filters in where clause', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      await caller.listProductOfferings({
        where: {
          bundleId: VALID_CUID,
          sourceType: 'INGRAM',
          availability: 'available',
        },
      });

      expect(prisma.productOffering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            bundleId: VALID_CUID,
            sourceType: 'INGRAM',
            availability: 'available',
          },
        }),
      );
    });

    it('builds an empty where clause when no filters are provided', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      await caller.listProductOfferings({});

      expect(prisma.productOffering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('orders by createdAt desc', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      await caller.listProductOfferings({});

      expect(prisma.productOffering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('passes cursor to prisma when provided', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      await caller.listProductOfferings({ cursor: VALID_CUID });

      expect(prisma.productOffering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: VALID_CUID },
        }),
      );
    });

    it('requests limit + 1 for pagination detection', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      await caller.listProductOfferings({ limit: 15 });

      expect(prisma.productOffering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 16 }),
      );
    });

    it('uses default limit of 25', async () => {
      const caller = createAuthedCaller();
      prisma.productOffering.findMany.mockResolvedValue([]);

      await caller.listProductOfferings({});

      expect(prisma.productOffering.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 26 }), // 25 + 1
      );
    });
  });

  // ─────────────────────────────────────
  //  comparePricing
  // ─────────────────────────────────────
  describe('comparePricing', () => {
    it('returns pricing options sorted by totalCost ascending', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const expensiveOffering = makeMockOffering({
        id: VALID_CUID,
        sourceType: 'PAX8',
        effectiveUnitCost: '10.00',
        partnerMarginPercent: '15.00',
      });
      const cheapOffering = makeMockOffering({
        id: VALID_CUID_2,
        sourceType: 'INGRAM',
        effectiveUnitCost: '6.00',
        partnerMarginPercent: '12.00',
      });
      const bundle = makeMockBundle({
        offerings: [expensiveOffering, cheapOffering],
      });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 10,
      });

      expect(result.bundleId).toBe(VALID_CUID);
      expect(result.quantity).toBe(10);
      expect(result.options).toHaveLength(2);
      // Cheapest first
      expect(result.options[0].totalCost).toBe('60.00'); // 6.00 × 10
      expect(result.options[0].sourceType).toBe('INGRAM');
      expect(result.options[1].totalCost).toBe('100.00'); // 10.00 × 10
      expect(result.options[1].sourceType).toBe('PAX8');
    });

    it('throws NOT_FOUND when bundle does not exist', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      prisma.bundle.findUnique.mockResolvedValue(null);

      await expect(
        caller.comparePricing({ bundleId: VALID_CUID, quantity: 5 }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Product offering is not available',
      });
    });

    it('filters out offerings with null effectiveUnitCost', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const withCost = makeMockOffering({
        id: VALID_CUID,
        effectiveUnitCost: '10.00',
      });
      const withoutCost = makeMockOffering({
        id: VALID_CUID_2,
        effectiveUnitCost: null,
      });
      const bundle = makeMockBundle({
        offerings: [withCost, withoutCost],
      });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 1,
      });

      expect(result.options).toHaveLength(1);
      expect(result.options[0].productOfferingId).toBe(VALID_CUID);
    });

    it('calculates totalCost with Decimal.js precision', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({
        effectiveUnitCost: '29.99',
        partnerMarginPercent: '15.50',
      });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 3,
      });

      // 29.99 × 3 = 89.97 (exact — no floating-point drift)
      expect(result.options[0].effectiveUnitCost).toBe('29.99');
      expect(result.options[0].totalCost).toBe('89.97');
      expect(result.options[0].partnerMarginPercent).toBe('15.50');
    });

    it('avoids floating-point errors on repeating decimals', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({ effectiveUnitCost: '0.10' });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 3,
      });

      // 0.10 × 3 = 0.30 exactly (IEEE 754 would give 0.30000000000000004)
      expect(result.options[0].totalCost).toBe('0.30');
    });

    it('marks offering as eligible when quantity is within min/max range', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({
        effectiveUnitCost: '5.00',
        minQuantity: 1,
        maxQuantity: 100,
      });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 50,
      });

      expect(result.options[0].isEligible).toBe(true);
    });

    it('marks offering as eligible at exact minQuantity boundary', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({
        effectiveUnitCost: '5.00',
        minQuantity: 10,
        maxQuantity: 100,
      });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 10,
      });

      expect(result.options[0].isEligible).toBe(true);
    });

    it('marks offering as eligible at exact maxQuantity boundary', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({
        effectiveUnitCost: '5.00',
        minQuantity: 1,
        maxQuantity: 100,
      });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 100,
      });

      expect(result.options[0].isEligible).toBe(true);
    });

    it('marks offering as ineligible when quantity is below minQuantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({
        effectiveUnitCost: '5.00',
        minQuantity: 10,
        maxQuantity: null,
      });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 5,
      });

      expect(result.options[0].isEligible).toBe(false);
    });

    it('marks offering as ineligible when quantity exceeds maxQuantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({
        effectiveUnitCost: '5.00',
        minQuantity: null,
        maxQuantity: 25,
      });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 50,
      });

      expect(result.options[0].isEligible).toBe(false);
    });

    it('treats null min/maxQuantity as no restriction (always eligible)', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({
        effectiveUnitCost: '5.00',
        minQuantity: null,
        maxQuantity: null,
      });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 9999,
      });

      expect(result.options[0].isEligible).toBe(true);
    });

    it('returns bundleName from the resolved bundle', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const bundle = makeMockBundle({
        name: 'Custom Bundle Name',
        offerings: [makeMockOffering({ effectiveUnitCost: '1.00' })],
      });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 1,
      });

      expect(result.bundleName).toBe('Custom Bundle Name');
    });

    it('returns empty options array when bundle has no offerings', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const bundle = makeMockBundle({ offerings: [] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 1,
      });

      expect(result.options).toHaveLength(0);
    });

    it('returns empty options when all offerings have null cost', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const bundle = makeMockBundle({
        offerings: [
          makeMockOffering({ id: VALID_CUID, effectiveUnitCost: null }),
          makeMockOffering({ id: VALID_CUID_2, effectiveUnitCost: null }),
        ],
      });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 1,
      });

      expect(result.options).toHaveLength(0);
    });

    it('handles null partnerMarginPercent gracefully', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({
        effectiveUnitCost: '10.00',
        partnerMarginPercent: null,
      });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 2,
      });

      expect(result.options[0].partnerMarginPercent).toBeNull();
      expect(result.options[0].totalCost).toBe('20.00');
    });

    it('exposes offering metadata in each option', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const offering = makeMockOffering({
        effectiveUnitCost: '8.50',
        currency: 'EUR',
        availability: 'limited',
        minQuantity: 5,
        maxQuantity: 500,
      });
      const bundle = makeMockBundle({ offerings: [offering] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 10,
      });

      const opt = result.options[0];
      expect(opt.currency).toBe('EUR');
      expect(opt.availability).toBe('limited');
      expect(opt.minQuantity).toBe(5);
      expect(opt.maxQuantity).toBe(500);
    });

    it('queries prisma with correct where and include clauses', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const bundle = makeMockBundle({ offerings: [] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      await caller.comparePricing({ bundleId: VALID_CUID, quantity: 1 });

      expect(prisma.bundle.findUnique).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        include: { offerings: true },
      });
    });

    // ── RBAC ──────────────────────────────────

    it('denies access to ORG_MEMBER role (requires ORG_ADMIN+)', async () => {
      const caller = createAuthedCaller('ORG_MEMBER');

      await expect(
        caller.comparePricing({ bundleId: VALID_CUID, quantity: 1 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows access to ORG_ADMIN role', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');
      const bundle = makeMockBundle({ offerings: [] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 1,
      });

      expect(result.bundleId).toBe(VALID_CUID);
    });

    it('allows access to ORG_OWNER role', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const bundle = makeMockBundle({ offerings: [] });
      prisma.bundle.findUnique.mockResolvedValue(bundle);

      const result = await caller.comparePricing({
        bundleId: VALID_CUID,
        quantity: 1,
      });

      expect(result.bundleId).toBe(VALID_CUID);
    });

    // ── Input validation ────────────────────

    it('rejects non-positive quantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.comparePricing({ bundleId: VALID_CUID, quantity: 0 }),
      ).rejects.toThrow();
    });

    it('rejects negative quantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.comparePricing({ bundleId: VALID_CUID, quantity: -1 }),
      ).rejects.toThrow();
    });

    it('rejects non-integer quantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.comparePricing({ bundleId: VALID_CUID, quantity: 2.5 }),
      ).rejects.toThrow();
    });

    it('rejects invalid bundleId format', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.comparePricing({ bundleId: 'bad-id', quantity: 1 }),
      ).rejects.toThrow();
    });
  });
});
