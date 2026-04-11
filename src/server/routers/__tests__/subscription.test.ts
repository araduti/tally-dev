/**
 * Unit tests for the subscription router.
 *
 * The subscription router exposes four procedures:
 *   - list   (orgMemberProcedure — any org member, query)
 *   - get    (orgMemberProcedure — any org member, query)
 *   - create (orgAdminMutationProcedure — ORG_ADMIN+, idempotent mutation)
 *   - cancel (orgAdminMutationProcedure — ORG_ADMIN+, idempotent mutation)
 *
 * Subscriptions use ctx.db (RLS-scoped proxy) for all queries and mutations.
 * The create procedure also uses the global `prisma` for provisioning gates
 * (organization lookup and product offering lookup).
 *
 * NOTE: The idempotency guard middleware (`idempotencyGuard`) is a cross-
 * cutting concern tested separately. It accesses `input` which is not
 * available in `createCaller` when positioned before `.input()` in the
 * tRPC v11 procedure chain. We replace `orgAdminMutationProcedure` with
 * `orgAdminProcedure` (same RBAC, no idempotency guard) so we can test
 * the handler logic in isolation.
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers that are available to vi.mock
// factories. Both blocks are hoisted above all imports by vitest.
// ──────────────────────────────────────────────

const { prisma, rlsDb, buildDbProxy } = vi.hoisted(() => {
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

  // `rlsDb` is the stable proxy that createRLSProxy always returns.
  // The subscription router reads from ctx.db, which the isAuthenticated
  // middleware replaces with the return value of createRLSProxy.
  return { prisma: buildDbProxy(), rlsDb: buildDbProxy(), buildDbProxy };
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
  createRLSProxy: vi.fn(() => rlsDb),
}));

// Replace orgAdminMutationProcedure with orgAdminProcedure so the
// idempotency guard (which cannot access `input` via createCaller in
// tRPC v11) is bypassed. RBAC is still enforced via orgAdminProcedure.
vi.mock('@/server/trpc/init', async () => {
  const actual = await vi.importActual<typeof import('@/server/trpc/init')>(
    '@/server/trpc/init',
  );
  return {
    ...actual,
    orgAdminMutationProcedure: actual.orgAdminProcedure,
  };
});

import { TRPCError } from '@trpc/server';
import { writeAuditLog } from '@/lib/audit';
import { subscriptionRouter } from '../subscription';

// ──────────────────────────────────────────────
// Constants & auth helpers
// ──────────────────────────────────────────────

/** Valid CUIDs that pass z.string().cuid() validation. */
const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';
const VALID_CUID_3 = 'clh1234567890abcdefghij02';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';

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
 * and returns a typed tRPC caller for the subscription router.
 *
 * All subscription queries use `rlsDb` — the stable proxy returned by
 * `createRLSProxy` — because the isAuthenticated middleware replaces
 * ctx.db with it when an organizationId is present.
 */
function createAuthedCaller(orgRole: string = 'ORG_OWNER') {
  mockAuth(orgRole);
  const ctx = {
    headers: createAuthHeaders(),
    userId: USER_ID,
    organizationId: ORG_ID,
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: orgRole as any,
    },
    db: buildDbProxy(),
    traceId: 'test-trace-id',
  };
  return subscriptionRouter.createCaller(ctx);
}

// ──────────────────────────────────────────────
// Mock data factories
// ──────────────────────────────────────────────

function makeMockSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    vendorConnectionId: 'vc-1',
    bundleId: VALID_CUID_2,
    externalId: 'tally-ext-001',
    status: 'ACTIVE',
    commitmentEndDate: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    bundle: { id: VALID_CUID_2, name: 'Microsoft 365 Business Basic' },
    licenses: [],
    ...overrides,
  };
}

function makeMockSubscriptionWithDetails(overrides: Record<string, unknown> = {}) {
  return {
    ...makeMockSubscription(),
    licenses: [
      {
        id: 'lic-1',
        subscriptionId: VALID_CUID,
        productOfferingId: VALID_CUID_3,
        quantity: 10,
        productOffering: {
          id: VALID_CUID_3,
          bundleId: VALID_CUID_2,
          sourceType: 'PAX8',
          effectiveUnitCost: '6.00',
        },
      },
    ],
    vendorConnection: {
      id: 'vc-1',
      vendorType: 'PAX8',
      status: 'ACTIVE',
    },
    ...overrides,
  };
}

function makeMockOffering(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID_3,
    bundleId: VALID_CUID_2,
    sourceType: 'PAX8',
    externalSku: 'EXT-SKU-001',
    effectiveUnitCost: '6.00',
    partnerMarginPercent: '15.00',
    currency: 'USD',
    availability: 'available',
    minQuantity: null,
    maxQuantity: null,
    bundle: { id: VALID_CUID_2, name: 'Microsoft 365 Business Basic' },
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('subscriptionRouter', () => {
  beforeEach(() => {
    // clearAllMocks preserves mock implementations (e.g. createRLSProxy → rlsDb)
    // while resetting call counts and recorded arguments.
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────
  //  list
  // ─────────────────────────────────────
  describe('list', () => {
    it('returns subscriptions with bundle and licenses', async () => {
      const caller = createAuthedCaller();
      const sub = makeMockSubscription({
        licenses: [{ id: 'lic-1', quantity: 5 }],
      });
      rlsDb.subscription.findMany.mockResolvedValue([sub]);

      const result = await caller.list({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(VALID_CUID);
      expect(result.items[0].bundle).toBeDefined();
      expect(result.nextCursor).toBeNull();
    });

    it('returns empty list when no subscriptions exist', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      const result = await caller.list({});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('returns nextCursor when more items exist than the limit', async () => {
      const caller = createAuthedCaller();
      // Default limit is 25 → return 26 items to trigger hasMore
      const subs = Array.from({ length: 26 }, (_, i) =>
        makeMockSubscription({
          id: `clh1234567890abcdefgh${String(i).padStart(4, '0')}`,
        }),
      );
      rlsDb.subscription.findMany.mockResolvedValue(subs);

      const result = await caller.list({});

      expect(result.items).toHaveLength(25);
      expect(result.nextCursor).toBe(result.items[24].id);
    });

    it('paginates correctly with a custom limit', async () => {
      const caller = createAuthedCaller();
      // limit=1 → findMany is called with take=2 → return 2 → hasMore=true
      const subs = [
        makeMockSubscription({ id: VALID_CUID }),
        makeMockSubscription({ id: VALID_CUID_2 }),
      ];
      rlsDb.subscription.findMany.mockResolvedValue(subs);

      const result = await caller.list({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(VALID_CUID);
      expect(result.nextCursor).toBe(VALID_CUID);
    });

    it('sets nextCursor to null when result count equals limit', async () => {
      const caller = createAuthedCaller();
      // limit=2, return exactly 2 → hasMore = false
      const subs = [
        makeMockSubscription({ id: VALID_CUID }),
        makeMockSubscription({ id: VALID_CUID_2 }),
      ];
      rlsDb.subscription.findMany.mockResolvedValue(subs);

      const result = await caller.list({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('passes cursor to prisma when provided', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({ cursor: VALID_CUID });

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: VALID_CUID },
        }),
      );
    });

    it('omits cursor from prisma query when not provided', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: undefined,
        }),
      );
    });

    it('requests limit + 1 items for pagination detection', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({ limit: 10 });

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 11 }),
      );
    });

    it('uses default limit of 25', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 26 }), // 25 + 1
      );
    });

    it('orders by createdAt desc', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('includes bundle and licenses in the prisma query', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { bundle: true, licenses: true },
        }),
      );
    });

    it('filters by status', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({ where: { status: 'ACTIVE' } });

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('filters by bundleId', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({ where: { bundleId: VALID_CUID } });

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ bundleId: VALID_CUID }),
        }),
      );
    });

    it('combines status and bundleId filters', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({
        where: { status: 'ACTIVE', bundleId: VALID_CUID },
      });

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE', bundleId: VALID_CUID },
        }),
      );
    });

    it('builds an empty where clause when no filters are provided', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(rlsDb.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('rejects limit below 1', async () => {
      const caller = createAuthedCaller();

      await expect(caller.list({ limit: 0 })).rejects.toThrow();
    });

    it('rejects limit above 100', async () => {
      const caller = createAuthedCaller();

      await expect(caller.list({ limit: 101 })).rejects.toThrow();
    });

    it('rejects non-integer limit', async () => {
      const caller = createAuthedCaller();

      await expect(caller.list({ limit: 2.5 })).rejects.toThrow();
    });

    it('rejects invalid cursor format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.list({ cursor: 'not-a-cuid' }),
      ).rejects.toThrow();
    });

    it('rejects invalid bundleId format in where', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.list({ where: { bundleId: 'not-a-cuid' } }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────
  //  get
  // ─────────────────────────────────────
  describe('get', () => {
    it('returns subscription with bundle, licenses, and vendorConnection', async () => {
      const caller = createAuthedCaller();
      const sub = makeMockSubscriptionWithDetails();
      rlsDb.subscription.findFirst.mockResolvedValue(sub);

      const result = await caller.get({ subscriptionId: VALID_CUID });

      expect(result.id).toBe(VALID_CUID);
      expect(result.bundle).toBeDefined();
      expect(result.licenses).toHaveLength(1);
      expect(result.licenses[0].productOffering).toBeDefined();
      expect(result.vendorConnection).toBeDefined();
      expect(result.vendorConnection.vendorType).toBe('PAX8');
    });

    it('queries with correct where and include clauses', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findFirst.mockResolvedValue(
        makeMockSubscriptionWithDetails(),
      );

      await caller.get({ subscriptionId: VALID_CUID });

      expect(rlsDb.subscription.findFirst).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        include: {
          bundle: true,
          licenses: { include: { productOffering: true } },
          vendorConnection: {
            select: { id: true, vendorType: true, status: true },
          },
        },
      });
    });

    it('throws NOT_FOUND when subscription does not exist', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findFirst.mockResolvedValue(null);

      await expect(
        caller.get({ subscriptionId: VALID_CUID }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Subscription not found',
      });
    });

    it('thrown error carries the SUBSCRIPTION:LIFECYCLE:NOT_FOUND errorCode', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findFirst.mockResolvedValue(null);

      try {
        await caller.get({ subscriptionId: VALID_CUID });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as Record<string, unknown>;
        expect(cause.errorCode).toBe('SUBSCRIPTION:LIFECYCLE:NOT_FOUND');
      }
    });

    it('rejects invalid subscriptionId format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.get({ subscriptionId: 'not-a-cuid' }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────
  //  create
  // ─────────────────────────────────────
  describe('create', () => {
    /**
     * Sets up all prerequisite mocks for a successful create.
     * Uses `rlsDb` for RLS-scoped calls (dpaAcceptance, organization,
     * vendorConnection, subscription, license, purchaseTransaction)
     * and `prisma` for global calls (productOffering).
     */
    function setupCreateMocks(
      overrides: {
        offering?: Record<string, unknown>;
        org?: Record<string, unknown>;
      } = {},
    ) {
      // DPA accepted (via ctx.db → rlsDb)
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date('2024-01-15'),
        version: '2024-01',
      });

      // Provisioning enabled (via ctx.db → rlsDb)
      rlsDb.organization.findUnique.mockResolvedValue({
        id: ORG_ID,
        provisioningEnabled: true,
        ...overrides.org,
      });

      // Product offering (via global prisma)
      const offering = makeMockOffering(overrides.offering);
      prisma.productOffering.findUnique.mockResolvedValue(offering);

      // Vendor connection (via ctx.db → rlsDb)
      rlsDb.vendorConnection.findFirst.mockResolvedValue({
        id: 'vc-1',
        vendorType: offering.sourceType,
        status: 'ACTIVE',
      });

      // DB creates (via ctx.db → rlsDb)
      rlsDb.subscription.create.mockResolvedValue({
        id: 'sub-new',
        vendorConnectionId: 'vc-1',
        bundleId: offering.bundleId,
        externalId: 'tally-mock-uuid',
        status: 'ACTIVE',
      });

      rlsDb.license.create.mockResolvedValue({
        id: 'lic-new',
        subscriptionId: 'sub-new',
        productOfferingId: offering.id,
        quantity: 10,
      });

      rlsDb.purchaseTransaction.create.mockResolvedValue({
        id: 'pt-new',
        productOfferingId: offering.id,
        quantity: 10,
        grossAmount: '60.00',
        ourMarginEarned: '9.00',
        idempotencyKey: VALID_UUID,
        status: 'COMPLETED',
      });

      return offering;
    }

    it('creates a subscription with correct data', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();

      const result = await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 10,
        idempotencyKey: VALID_UUID,
      });

      expect(result.subscription).toBeDefined();
      expect(result.subscription.status).toBe('ACTIVE');
      expect(result.license).toBeDefined();
      expect(result.purchaseTransaction).toBeDefined();
    });

    it('creates subscription with correct vendorConnectionId and bundleId', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();

      await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 10,
        idempotencyKey: VALID_UUID,
      });

      expect(rlsDb.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vendorConnectionId: 'vc-1',
          bundleId: VALID_CUID_2,
          status: 'ACTIVE',
        }),
      });
    });

    it('creates license with correct quantity and productOfferingId', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();

      await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 10,
        idempotencyKey: VALID_UUID,
      });

      expect(rlsDb.license.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: 'sub-new',
          productOfferingId: VALID_CUID_3,
          quantity: 10,
        }),
      });
    });

    it('computes grossAmount and marginEarned with Decimal.js precision', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks({
        offering: {
          effectiveUnitCost: '29.99',
          partnerMarginPercent: '15.50',
        },
      });

      await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 3,
        idempotencyKey: VALID_UUID,
      });

      // grossAmount = 29.99 × 3 = 89.97
      // marginEarned = 89.97 × 15.50 / 100 = 13.94535 → 13.95 (2dp)
      expect(rlsDb.purchaseTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quantity: 3,
          idempotencyKey: VALID_UUID,
          status: 'COMPLETED',
        }),
      });

      const createCall = rlsDb.purchaseTransaction.create.mock.calls[0][0];
      // grossAmount: Decimal('89.97')
      expect(createCall.data.grossAmount.toString()).toBe('89.97');
      // ourMarginEarned: Decimal('13.95') (29.99 * 3 * 0.155 = 13.94535 → 13.95)
      expect(createCall.data.ourMarginEarned.toString()).toBe('13.95');
    });

    it('sets zero margin when partnerMarginPercent is null', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks({
        offering: {
          effectiveUnitCost: '10.00',
          partnerMarginPercent: null,
        },
      });

      await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 5,
        idempotencyKey: VALID_UUID,
      });

      const createCall = rlsDb.purchaseTransaction.create.mock.calls[0][0];
      expect(createCall.data.grossAmount.toFixed(2)).toBe('50.00');
      expect(createCall.data.ourMarginEarned.toFixed(2)).toBe('0.00');
    });

    it('writes an audit log with subscription.created action', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();

      await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 10,
        idempotencyKey: VALID_UUID,
      });

      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          userId: USER_ID,
          action: 'subscription.created',
          entityId: 'sub-new',
          after: expect.objectContaining({
            subscriptionId: 'sub-new',
            quantity: 10,
          }),
        }),
      );
    });

    // ── Precondition gates ──

    it('throws PRECONDITION_FAILED when DPA not accepted', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();
      // Override: no DPA
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue(null);

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Data Processing Agreement must be accepted before proceeding',
      });
    });

    it('DPA error carries COMPLIANCE:DPA:NOT_ACCEPTED errorCode', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue(null);

      try {
        await caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as Record<string, unknown>;
        expect(cause.errorCode).toBe('COMPLIANCE:DPA:NOT_ACCEPTED');
      }
    });

    it('throws PRECONDITION_FAILED when provisioning is disabled', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();
      rlsDb.organization.findUnique.mockResolvedValue({
        id: ORG_ID,
        provisioningEnabled: false,
      });

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Provisioning is not enabled for this organization',
      });
    });

    it('throws PRECONDITION_FAILED when organization not found', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();
      rlsDb.organization.findUnique.mockResolvedValue(null);

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });

    it('throws NOT_FOUND when product offering does not exist', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();
      prisma.productOffering.findUnique.mockResolvedValue(null);

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Product offering is not available',
      });
    });

    it('throws PRECONDITION_FAILED when effectiveUnitCost is null', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks({
        offering: { effectiveUnitCost: null },
      });

      try {
        await caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe('PRECONDITION_FAILED');
        const cause = (error as TRPCError).cause as Record<string, unknown>;
        expect(cause.errorCode).toBe('CATALOG:OFFERING:PRICE_MISSING');
        expect(cause.recovery).toEqual(
          expect.objectContaining({ action: 'FORCE_SYNC' }),
        );
      }
    });

    // ── Quantity bounds ──

    it('throws BAD_REQUEST when quantity is below minQuantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks({
        offering: { minQuantity: 5, maxQuantity: 100 },
      });

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 2,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Requested quantity is outside the allowed range',
      });
    });

    it('throws BAD_REQUEST when quantity exceeds maxQuantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks({
        offering: { minQuantity: 1, maxQuantity: 50 },
      });

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 100,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Requested quantity is outside the allowed range',
      });
    });

    it('quantity error carries LICENSE:QUANTITY:OUT_OF_RANGE errorCode and recovery params', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks({
        offering: { minQuantity: 5, maxQuantity: 100 },
      });

      try {
        await caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 2,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as Record<string, unknown>;
        expect(cause.errorCode).toBe('LICENSE:QUANTITY:OUT_OF_RANGE');
        const recovery = cause.recovery as Record<string, unknown>;
        expect(recovery.params).toEqual(
          expect.objectContaining({ min: 5, max: 100, requested: 2 }),
        );
      }
    });

    it('succeeds at exact minQuantity boundary', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks({
        offering: { minQuantity: 5, maxQuantity: 100 },
      });

      const result = await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(result.subscription).toBeDefined();
    });

    it('succeeds at exact maxQuantity boundary', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks({
        offering: { minQuantity: 1, maxQuantity: 50 },
      });

      const result = await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 50,
        idempotencyKey: VALID_UUID,
      });

      expect(result.subscription).toBeDefined();
    });

    // ── Vendor connection ──

    it('throws PRECONDITION_FAILED when no vendor connection exists', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      setupCreateMocks();
      rlsDb.vendorConnection.findFirst.mockResolvedValue(null);

      try {
        await caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe('PRECONDITION_FAILED');
        const cause = (error as TRPCError).cause as Record<string, unknown>;
        expect(cause.errorCode).toBe('VENDOR:AUTH:DISCONNECTED');
        expect(cause.recovery).toEqual(
          expect.objectContaining({
            action: 'REAUTH_VENDOR',
            params: expect.objectContaining({ vendorType: 'PAX8' }),
          }),
        );
      }
    });

    // ── Validation errors ──

    it('rejects invalid productOfferingId format', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.create({
          productOfferingId: 'not-a-cuid',
          quantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects non-positive quantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 0,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects negative quantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: -5,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects non-integer quantity', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 2.5,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid idempotencyKey format', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: 'not-a-uuid',
        }),
      ).rejects.toThrow();
    });

    // ── RBAC ──

    it('allows ORG_ADMIN to create subscriptions', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');
      setupCreateMocks();

      const result = await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 10,
        idempotencyKey: VALID_UUID,
      });

      expect(result.subscription).toBeDefined();
    });

    it('denies ORG_MEMBER from creating subscriptions', async () => {
      const caller = createAuthedCaller('ORG_MEMBER');
      setupCreateMocks();

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ─────────────────────────────────────
  //  cancel
  // ─────────────────────────────────────
  describe('cancel', () => {
    it('immediately cancels a subscription without active commitment', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const sub = makeMockSubscription({
        status: 'ACTIVE',
        commitmentEndDate: null,
      });
      rlsDb.subscription.findFirst.mockResolvedValue(sub);
      rlsDb.subscription.update.mockResolvedValue({
        ...sub,
        status: 'CANCELLED',
      });

      const result = await caller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.subscription.status).toBe('CANCELLED');
      expect(result.scheduledDate).toBeNull();
    });

    it('updates subscription status to CANCELLED', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const sub = makeMockSubscription({
        status: 'ACTIVE',
        commitmentEndDate: null,
      });
      rlsDb.subscription.findFirst.mockResolvedValue(sub);
      rlsDb.subscription.update.mockResolvedValue({
        ...sub,
        status: 'CANCELLED',
      });

      await caller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(rlsDb.subscription.update).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        data: { status: 'CANCELLED' },
      });
    });

    it('writes audit log with subscription.cancelled action for immediate cancel', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const sub = makeMockSubscription({
        status: 'ACTIVE',
        commitmentEndDate: null,
      });
      rlsDb.subscription.findFirst.mockResolvedValue(sub);
      rlsDb.subscription.update.mockResolvedValue({
        ...sub,
        status: 'CANCELLED',
      });

      await caller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          userId: USER_ID,
          action: 'subscription.cancelled',
          entityId: VALID_CUID,
          before: { status: 'ACTIVE' },
          after: { status: 'CANCELLED' },
        }),
      );
    });

    // ── Commitment window handling ──

    it('suspends subscription when commitment window is active', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
      const sub = makeMockSubscription({
        status: 'ACTIVE',
        commitmentEndDate: futureDate,
      });
      rlsDb.subscription.findFirst.mockResolvedValue(sub);
      rlsDb.subscription.update.mockResolvedValue({
        ...sub,
        status: 'SUSPENDED',
      });

      const result = await caller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.subscription.status).toBe('SUSPENDED');
      expect(result.scheduledDate).toEqual(futureDate);
    });

    it('updates status to SUSPENDED (not CANCELLED) during commitment', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const sub = makeMockSubscription({
        status: 'ACTIVE',
        commitmentEndDate: futureDate,
      });
      rlsDb.subscription.findFirst.mockResolvedValue(sub);
      rlsDb.subscription.update.mockResolvedValue({
        ...sub,
        status: 'SUSPENDED',
      });

      await caller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(rlsDb.subscription.update).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        data: { status: 'SUSPENDED' },
      });
    });

    it('writes audit log with subscription.cancellation_scheduled for committed cancel', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const sub = makeMockSubscription({
        status: 'ACTIVE',
        commitmentEndDate: futureDate,
      });
      rlsDb.subscription.findFirst.mockResolvedValue(sub);
      rlsDb.subscription.update.mockResolvedValue({
        ...sub,
        status: 'SUSPENDED',
      });

      await caller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.cancellation_scheduled',
          entityId: VALID_CUID,
          before: { status: 'ACTIVE' },
          after: expect.objectContaining({
            status: 'SUSPENDED',
            scheduledDate: futureDate,
          }),
        }),
      );
    });

    it('treats expired commitmentEndDate as no commitment (immediate cancel)', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      const sub = makeMockSubscription({
        status: 'ACTIVE',
        commitmentEndDate: pastDate,
      });
      rlsDb.subscription.findFirst.mockResolvedValue(sub);
      rlsDb.subscription.update.mockResolvedValue({
        ...sub,
        status: 'CANCELLED',
      });

      const result = await caller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.subscription.status).toBe('CANCELLED');
      expect(result.scheduledDate).toBeNull();
    });

    // ── Error cases ──

    it('throws NOT_FOUND when subscription does not exist', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      rlsDb.subscription.findFirst.mockResolvedValue(null);

      await expect(
        caller.cancel({
          subscriptionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Subscription not found',
      });
    });

    it('cancel error carries SUBSCRIPTION:LIFECYCLE:NOT_FOUND errorCode', async () => {
      const caller = createAuthedCaller('ORG_OWNER');
      rlsDb.subscription.findFirst.mockResolvedValue(null);

      try {
        await caller.cancel({
          subscriptionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as Record<string, unknown>;
        expect(cause.errorCode).toBe('SUBSCRIPTION:LIFECYCLE:NOT_FOUND');
      }
    });

    // ── Validation errors ──

    it('rejects invalid subscriptionId format', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.cancel({
          subscriptionId: 'not-a-cuid',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid idempotencyKey format', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.cancel({
          subscriptionId: VALID_CUID,
          idempotencyKey: 'not-a-uuid',
        }),
      ).rejects.toThrow();
    });

    // ── RBAC ──

    it('allows ORG_ADMIN to cancel subscriptions', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');
      const sub = makeMockSubscription({
        status: 'ACTIVE',
        commitmentEndDate: null,
      });
      rlsDb.subscription.findFirst.mockResolvedValue(sub);
      rlsDb.subscription.update.mockResolvedValue({
        ...sub,
        status: 'CANCELLED',
      });

      const result = await caller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.subscription.status).toBe('CANCELLED');
    });

    it('denies ORG_MEMBER from cancelling subscriptions', async () => {
      const caller = createAuthedCaller('ORG_MEMBER');
      const sub = makeMockSubscription({ status: 'ACTIVE' });
      rlsDb.subscription.findFirst.mockResolvedValue(sub);

      await expect(
        caller.cancel({
          subscriptionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});
