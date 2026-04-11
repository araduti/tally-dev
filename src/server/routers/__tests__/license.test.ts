/**
 * Unit tests for the license router.
 *
 * The license router exposes five procedures:
 *   - list                  (orgMemberProcedure — any org member, query)
 *   - get                   (orgMemberProcedure — any org member, query)
 *   - scaleUp               (mspTechMutationProcedure — MSP_TECH+, idempotent mutation)
 *   - scaleDown             (mspTechMutationProcedure — MSP_TECH+, idempotent mutation)
 *   - cancelPendingScaleDown (mspTechMutationProcedure — MSP_TECH+, idempotent mutation)
 *
 * The router uses `ctx.db` (RLS-scoped proxy) for subscription lookups
 * (org-scoping) and purchaseTransaction creation. It uses the global
 * `prisma` (from @/lib/db) for license CRUD operations.
 *
 * NOTE: The idempotency guard middleware (`idempotencyGuard`) is a cross-
 * cutting concern tested separately. We replace `mspTechMutationProcedure`
 * with `mspTechProcedure` (same RBAC, no idempotency guard) so we can test
 * the handler logic in isolation via `createCaller`.
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// Both blocks are hoisted above all imports by vitest.
// ──────────────────────────────────────────────

const { prisma, rlsDb, buildDbProxy, mockSetQuantity, mockInngestSend } = vi.hoisted(() => {
  const mockSetQuantity = vi.fn().mockResolvedValue(undefined);
  const mockInngestSend = vi.fn().mockResolvedValue({ ids: ['mock-event-id'] });
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

  return { prisma: buildDbProxy(), rlsDb: buildDbProxy(), buildDbProxy, mockSetQuantity, mockInngestSend };
});

vi.mock('@/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

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
    eval: vi.fn().mockResolvedValue([1, 60]),
  },
  IDEMPOTENCY_TTL: 86400,
}));

vi.mock('@/lib/rls-proxy', () => ({
  createRLSProxy: vi.fn(() => rlsDb),
}));

vi.mock('@/adapters', () => ({
  getAdapter: vi.fn(() => ({
    setQuantity: mockSetQuantity,
  })),
  decryptCredentials: vi.fn(() => ({ clientId: 'id', clientSecret: 'secret' })),
}));

vi.mock('@/adapters/types', () => {
  class VendorError extends Error {
    constructor(
      public readonly vendorType: string,
      public readonly originalError: unknown,
      message?: string,
    ) {
      super(message ?? `Vendor API error from ${vendorType}`);
      this.name = 'VendorError';
    }
  }
  return { VendorError };
});

// Replace mspTechMutationProcedure with mspTechProcedure so the
// idempotency guard (which cannot access `input` via createCaller in
// tRPC v11) is bypassed. RBAC is still enforced via mspTechProcedure.
vi.mock('@/server/trpc/init', async () => {
  const actual = await vi.importActual<typeof import('@/server/trpc/init')>(
    '@/server/trpc/init',
  );
  return {
    ...actual,
    mspTechMutationProcedure: actual.mspTechProcedure,
  };
});

import { TRPCError } from '@trpc/server';
import { writeAuditLog } from '@/lib/audit';
import { getAdapter, decryptCredentials } from '@/adapters';
import { licenseRouter } from '../license';

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
 * and returns a typed tRPC caller for the license router.
 *
 * All license queries/mutations use `rlsDb` for RLS-scoped operations
 * (subscription lookups, purchaseTransaction creates) and the global
 * `prisma` for license CRUD.
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
    resHeaders: null,
  };
  return licenseRouter.createCaller(ctx);
}

// ──────────────────────────────────────────────
// Mock data factories
// ──────────────────────────────────────────────

function makeMockLicense(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    subscriptionId: VALID_CUID_2,
    productOfferingId: VALID_CUID_3,
    quantity: 10,
    pendingQuantity: null,
    inngestRunId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    subscription: {
      id: VALID_CUID_2,
      externalId: 'ext-sub-001',
      commitmentEndDate: null,
      bundle: { id: 'bundle-1', name: 'Microsoft 365 Business Basic' },
      vendorConnection: {
        id: 'vc-1',
        vendorType: 'PAX8',
        credentials: 'encrypted-creds',
      },
    },
    productOffering: {
      id: VALID_CUID_3,
      bundleId: 'bundle-1',
      sourceType: 'PAX8',
      effectiveUnitCost: '6.00',
      partnerMarginPercent: '15.00',
      minQuantity: 1,
      maxQuantity: 300,
    },
    ...overrides,
  };
}

function makeMockSubscriptionRef(id: string = VALID_CUID_2) {
  return { id };
}

/**
 * Configures `rlsDb.subscription.findMany` to return a list of
 * subscription ID references, simulating the org-scoped lookup the
 * license router performs to enforce tenant isolation.
 */
function mockOrgSubscriptions(ids: string[] = [VALID_CUID_2]) {
  rlsDb.subscription.findMany.mockResolvedValue(
    ids.map((id) => makeMockSubscriptionRef(id)),
  );
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('licenseRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────
  //  list
  // ─────────────────────────────────────
  describe('list', () => {
    it('returns licenses with subscription and productOffering', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      const license = makeMockLicense();
      prisma.license.findMany.mockResolvedValue([license]);

      const result = await caller.list({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(VALID_CUID);
      expect(result.items[0].subscription).toBeDefined();
      expect(result.items[0].productOffering).toBeDefined();
      expect(result.nextCursor).toBeNull();
    });

    it('returns empty list when no licenses exist', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      const result = await caller.list({});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('returns nextCursor when more items exist than the limit', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      // Default limit is 25 → return 26 items to trigger hasMore
      const licenses = Array.from({ length: 26 }, (_, i) =>
        makeMockLicense({
          id: `clh1234567890abcdefgh${String(i).padStart(4, '0')}`,
        }),
      );
      prisma.license.findMany.mockResolvedValue(licenses);

      const result = await caller.list({});

      expect(result.items).toHaveLength(25);
      expect(result.nextCursor).toBe(result.items[24].id);
    });

    it('paginates correctly with a custom limit', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      const licenses = [
        makeMockLicense({ id: VALID_CUID }),
        makeMockLicense({ id: VALID_CUID_2 }),
      ];
      prisma.license.findMany.mockResolvedValue(licenses);

      const result = await caller.list({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(VALID_CUID);
      expect(result.nextCursor).toBe(VALID_CUID);
    });

    it('sets nextCursor to null when result count equals limit', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      const licenses = [
        makeMockLicense({ id: VALID_CUID }),
        makeMockLicense({ id: VALID_CUID_2 }),
      ];
      prisma.license.findMany.mockResolvedValue(licenses);

      const result = await caller.list({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('passes cursor to prisma when provided', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({ cursor: VALID_CUID });

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: VALID_CUID },
        }),
      );
    });

    it('omits cursor from prisma query when not provided', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: undefined,
        }),
      );
    });

    it('requests limit + 1 items for pagination detection', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({ limit: 10 });

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 11 }),
      );
    });

    it('uses default limit of 25', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 26 }), // 25 + 1
      );
    });

    it('orders by createdAt desc', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('includes subscription with bundle and productOffering', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            subscription: { include: { bundle: true } },
            productOffering: true,
          },
        }),
      );
    });

    it('filters by subscriptionId when provided', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({ where: { subscriptionId: VALID_CUID_2 } });

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subscriptionId: VALID_CUID_2,
          }),
        }),
      );
    });

    it('filters for pending scale-downs when hasPendingScaleDown is true', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({ where: { hasPendingScaleDown: true } });

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pendingQuantity: { not: null },
          }),
        }),
      );
    });

    it('filters for no pending scale-downs when hasPendingScaleDown is false', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({ where: { hasPendingScaleDown: false } });

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pendingQuantity: null,
          }),
        }),
      );
    });

    it('scopes licenses to org subscriptions via subscriptionId IN clause', async () => {
      const caller = createAuthedCaller();
      const subIds = ['sub-a', 'sub-b', 'sub-c'];
      mockOrgSubscriptions(subIds);
      prisma.license.findMany.mockResolvedValue([]);

      await caller.list({});

      expect(prisma.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subscriptionId: { in: subIds },
          }),
        }),
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

    it('rejects invalid subscriptionId format in where', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.list({ where: { subscriptionId: 'not-a-cuid' } }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────
  //  get
  // ─────────────────────────────────────
  describe('get', () => {
    it('returns a license with subscription and productOffering', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      const license = makeMockLicense();
      prisma.license.findFirst.mockResolvedValue(license);

      const result = await caller.get({ licenseId: VALID_CUID });

      expect(result.id).toBe(VALID_CUID);
      expect(result.subscription).toBeDefined();
      expect(result.subscription.bundle).toBeDefined();
      expect(result.productOffering).toBeDefined();
    });

    it('queries with correct where and include clauses', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions([VALID_CUID_2]);
      prisma.license.findFirst.mockResolvedValue(makeMockLicense());

      await caller.get({ licenseId: VALID_CUID });

      expect(prisma.license.findFirst).toHaveBeenCalledWith({
        where: {
          id: VALID_CUID,
          subscriptionId: { in: [VALID_CUID_2] },
        },
        include: {
          subscription: { include: { bundle: true } },
          productOffering: true,
        },
      });
    });

    it('throws NOT_FOUND when license does not exist', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findFirst.mockResolvedValue(null);

      await expect(
        caller.get({ licenseId: VALID_CUID }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'License not found',
      });
    });

    it('thrown error carries the LICENSE:QUANTITY:NOT_FOUND errorCode', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findFirst.mockResolvedValue(null);

      try {
        await caller.get({ licenseId: VALID_CUID });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as unknown as Record<string, unknown>;
        expect(cause.errorCode).toBe('LICENSE:QUANTITY:NOT_FOUND');
      }
    });

    it('rejects invalid licenseId format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.get({ licenseId: 'not-a-cuid' }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────
  //  scaleUp
  // ─────────────────────────────────────
  describe('scaleUp', () => {
    function setupScaleUpMocks(
      overrides: {
        license?: Record<string, unknown>;
        updated?: Record<string, unknown>;
      } = {},
    ) {
      mockOrgSubscriptions();

      const license = makeMockLicense({
        quantity: 10,
        ...overrides.license,
      });
      prisma.license.findFirst.mockResolvedValue(license);

      const updated = {
        ...license,
        quantity: 15,
        updatedAt: new Date(),
        ...overrides.updated,
      };
      prisma.license.update.mockResolvedValue(updated);

      rlsDb.purchaseTransaction.create.mockResolvedValue({
        id: 'pt-new',
        productOfferingId: VALID_CUID_3,
        quantity: 5,
        grossAmount: '30.00',
        ourMarginEarned: '4.50',
        idempotencyKey: VALID_UUID,
        status: 'COMPLETED',
      });

      return { license, updated };
    }

    it('scales up successfully and returns license + purchaseTransaction', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks();

      const result = await caller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 15,
        idempotencyKey: VALID_UUID,
      });

      expect(result.license).toBeDefined();
      expect(result.license.quantity).toBe(15);
      expect(result.purchaseTransaction).toBeDefined();
      expect(result.purchaseTransaction.status).toBe('COMPLETED');
    });

    it('updates the license quantity in prisma', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks();

      await caller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 15,
        idempotencyKey: VALID_UUID,
      });

      expect(prisma.license.update).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        data: { quantity: 15 },
      });
    });

    it('creates a purchase transaction with correct grossAmount and margin', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks({
        license: {
          quantity: 10,
          productOffering: {
            id: VALID_CUID_3,
            effectiveUnitCost: '29.99',
            partnerMarginPercent: '15.50',
            minQuantity: 1,
            maxQuantity: 300,
          },
        },
      });

      await caller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 13,
        idempotencyKey: VALID_UUID,
      });

      // delta = 13 - 10 = 3
      // grossAmount = 29.99 × 3 = 89.97
      // marginEarned = 89.97 × 15.50 / 100 = 13.94535 → 13.95 (2dp)
      expect(rlsDb.purchaseTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productOfferingId: VALID_CUID_3,
          quantity: 3,
          idempotencyKey: VALID_UUID,
          status: 'COMPLETED',
        }),
      });
    });

    it('writes an audit log entry for scale-up', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks();

      await caller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 15,
        idempotencyKey: VALID_UUID,
      });

      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          userId: USER_ID,
          action: 'license.scale_up.executed',
          entityId: VALID_CUID,
          before: { quantity: 10 },
          after: { quantity: 15 },
        }),
      );
    });

    it('throws BAD_REQUEST when newQuantity <= current quantity', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks({ license: { quantity: 10 } });

      await expect(
        caller.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Requested quantity is outside the allowed range',
      });
    });

    it('throws BAD_REQUEST when newQuantity is less than current', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks({ license: { quantity: 10 } });

      await expect(
        caller.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 5,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('throws BAD_REQUEST when newQuantity exceeds maxQuantity', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks({
        license: {
          quantity: 10,
          productOffering: {
            id: VALID_CUID_3,
            effectiveUnitCost: '6.00',
            partnerMarginPercent: '15.00',
            minQuantity: 1,
            maxQuantity: 50,
          },
        },
      });

      await expect(
        caller.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 100,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('scale-up quantity error carries LICENSE:QUANTITY:OUT_OF_RANGE errorCode', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks({ license: { quantity: 10 } });

      try {
        await caller.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 5,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as unknown as Record<string, unknown>;
        expect(cause.errorCode).toBe('LICENSE:QUANTITY:OUT_OF_RANGE');
      }
    });

    it('throws NOT_FOUND when license does not exist', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findFirst.mockResolvedValue(null);

      await expect(
        caller.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 15,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'License not found',
      });
    });

    it('throws PRECONDITION_FAILED when license has no productOfferingId', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks({
        license: {
          quantity: 10,
          productOfferingId: null,
          productOffering: null,
        },
      });

      await expect(
        caller.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 15,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Product offering is not available',
      });
    });

    it('allows scale-up with no maxQuantity on the offering', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks({
        license: {
          quantity: 10,
          productOffering: {
            id: VALID_CUID_3,
            effectiveUnitCost: '6.00',
            partnerMarginPercent: '15.00',
            minQuantity: 1,
            maxQuantity: null,
          },
        },
      });

      const result = await caller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 999,
        idempotencyKey: VALID_UUID,
      });

      expect(result.license).toBeDefined();
    });

    it('computes zero margin when partnerMarginPercent is null', async () => {
      const caller = createAuthedCaller();
      setupScaleUpMocks({
        license: {
          quantity: 10,
          productOffering: {
            id: VALID_CUID_3,
            effectiveUnitCost: '6.00',
            partnerMarginPercent: null,
            minQuantity: 1,
            maxQuantity: null,
          },
        },
      });

      await caller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 15,
        idempotencyKey: VALID_UUID,
      });

      // marginPercent falls back to 0 → marginEarned = 0.00
      expect(rlsDb.purchaseTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quantity: 5,
        }),
      });
    });

    it('rejects non-positive newQuantity', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 0,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid licenseId format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.scaleUp({
          licenseId: 'bad-id',
          newQuantity: 15,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid idempotencyKey format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 15,
          idempotencyKey: 'not-a-uuid',
        }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────
  //  scaleDown
  // ─────────────────────────────────────
  describe('scaleDown', () => {
    function setupScaleDownMocks(
      overrides: {
        license?: Record<string, unknown>;
        subscription?: Record<string, unknown>;
      } = {},
    ) {
      mockOrgSubscriptions();

      const license = makeMockLicense({
        quantity: 10,
        pendingQuantity: null,
        inngestRunId: null,
        subscription: {
          id: VALID_CUID_2,
          externalId: 'ext-sub-001',
          commitmentEndDate: null,
          bundle: { id: 'bundle-1', name: 'Microsoft 365 Business Basic' },
          vendorConnection: {
            id: 'vc-1',
            vendorType: 'PAX8',
            credentials: 'encrypted-creds',
          },
          ...overrides.subscription,
        },
        ...overrides.license,
      });
      prisma.license.findFirst.mockResolvedValue(license);

      const updated = {
        ...license,
        quantity: 5,
        updatedAt: new Date(),
      };
      prisma.license.update.mockResolvedValue(updated);

      return { license, updated };
    }

    // ── Immediate scale-down (no commitment window) ──

    it('performs immediate scale-down when no commitment window is active', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks();

      const result = await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(result.isStaged).toBe(false);
      expect(result.commitmentEndDate).toBeNull();
      expect(result.inngestRunId).toBeNull();
      expect(result.license.quantity).toBe(5);
    });

    it('updates the license quantity for immediate scale-down', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks();

      await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(prisma.license.update).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        data: { quantity: 5 },
      });
    });

    it('writes audit log for immediate scale-down', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks();

      await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'license.scale_down.executed',
          entityId: VALID_CUID,
          before: { quantity: 10 },
          after: { quantity: 5 },
        }),
      );
    });

    // ── Staged scale-down (active commitment window) ──

    it('stages scale-down when commitment window is active', async () => {
      const caller = createAuthedCaller();
      const futureDate = new Date(Date.now() + 30 * 24 * 3_600_000); // 30 days from now
      setupScaleDownMocks({
        subscription: { commitmentEndDate: futureDate },
      });

      const result = await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(result.isStaged).toBe(true);
      expect(result.commitmentEndDate).toEqual(futureDate);
      expect(result.inngestRunId).toMatch(/^pending-/);
    });

    it('sets pendingQuantity and inngestRunId for staged scale-down', async () => {
      const caller = createAuthedCaller();
      const futureDate = new Date(Date.now() + 30 * 24 * 3_600_000);
      setupScaleDownMocks({
        subscription: { commitmentEndDate: futureDate },
      });

      await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(prisma.license.update).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        data: {
          pendingQuantity: 5,
          inngestRunId: expect.stringMatching(/^pending-/),
        },
      });
    });

    it('writes audit log for staged scale-down', async () => {
      const caller = createAuthedCaller();
      const futureDate = new Date(Date.now() + 30 * 24 * 3_600_000);
      setupScaleDownMocks({
        subscription: { commitmentEndDate: futureDate },
      });

      await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'license.scale_down.staged',
          entityId: VALID_CUID,
          before: { quantity: 10 },
          after: {
            pendingQuantity: 5,
            inngestRunId: expect.stringMatching(/^pending-/),
          },
        }),
      );
    });

    it('performs immediate scale-down when commitment has expired', async () => {
      const caller = createAuthedCaller();
      const pastDate = new Date(Date.now() - 24 * 3_600_000); // 1 day ago
      setupScaleDownMocks({
        subscription: { commitmentEndDate: pastDate },
      });

      const result = await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(result.isStaged).toBe(false);
      expect(result.commitmentEndDate).toBeNull();
    });

    // ── Error cases ──

    it('throws BAD_REQUEST when newQuantity >= current quantity', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks({ license: { quantity: 10 } });

      await expect(
        caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Requested quantity is outside the allowed range',
      });
    });

    it('throws BAD_REQUEST when newQuantity is greater than current', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks({ license: { quantity: 10 } });

      await expect(
        caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 15,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('scale-down quantity error carries LICENSE:QUANTITY:OUT_OF_RANGE errorCode', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks({ license: { quantity: 10 } });

      try {
        await caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 10,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as unknown as Record<string, unknown>;
        expect(cause.errorCode).toBe('LICENSE:QUANTITY:OUT_OF_RANGE');
      }
    });

    it('throws BAD_REQUEST when newQuantity is below minQuantity', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks({
        license: {
          quantity: 10,
          productOffering: {
            id: VALID_CUID_3,
            effectiveUnitCost: '6.00',
            partnerMarginPercent: '15.00',
            minQuantity: 5,
            maxQuantity: 300,
          },
        },
      });

      await expect(
        caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 3,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('throws CONFLICT when a pending scale-down already exists', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks({
        license: {
          quantity: 10,
          pendingQuantity: 5,
          inngestRunId: 'pending-existing-run',
        },
      });

      await expect(
        caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 3,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'A scale-down is already scheduled for this license',
      });
    });

    it('pending scale-down error carries LICENSE:SCALE_DOWN:PENDING errorCode', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks({
        license: {
          quantity: 10,
          pendingQuantity: 5,
          inngestRunId: 'pending-existing-run',
        },
      });

      try {
        await caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 3,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as unknown as Record<string, unknown>;
        expect(cause.errorCode).toBe('LICENSE:SCALE_DOWN:PENDING');
      }
    });

    it('pending scale-down error includes recovery with REVIEW_QUEUE action', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks({
        license: {
          quantity: 10,
          pendingQuantity: 5,
          inngestRunId: 'pending-existing-run',
        },
      });

      try {
        await caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 3,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        const cause = (error as TRPCError).cause as unknown as Record<string, unknown>;
        const recovery = cause.recovery as Record<string, unknown>;
        expect(recovery.action).toBe('REVIEW_QUEUE');
        expect(recovery.params).toEqual(
          expect.objectContaining({
            licenseId: VALID_CUID,
            pendingQuantity: 5,
            inngestRunId: 'pending-existing-run',
          }),
        );
      }
    });

    it('throws NOT_FOUND when license does not exist', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findFirst.mockResolvedValue(null);

      await expect(
        caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 5,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'License not found',
      });
    });

    it('allows scale-down to zero', async () => {
      const caller = createAuthedCaller();
      setupScaleDownMocks({
        license: {
          quantity: 10,
          productOffering: {
            id: VALID_CUID_3,
            effectiveUnitCost: '6.00',
            partnerMarginPercent: '15.00',
            minQuantity: null,
            maxQuantity: 300,
          },
        },
      });

      const result = await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 0,
        idempotencyKey: VALID_UUID,
      });

      expect(result.license).toBeDefined();
    });

    it('rejects negative newQuantity', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: -1,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid licenseId format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.scaleDown({
          licenseId: 'bad-id',
          newQuantity: 5,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid idempotencyKey format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 5,
          idempotencyKey: 'not-a-uuid',
        }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────
  //  cancelPendingScaleDown
  // ─────────────────────────────────────
  describe('cancelPendingScaleDown', () => {
    function setupCancelMocks(
      overrides: { license?: Record<string, unknown> } = {},
    ) {
      mockOrgSubscriptions();

      const license = makeMockLicense({
        quantity: 10,
        pendingQuantity: 5,
        inngestRunId: 'pending-abc-123',
        ...overrides.license,
      });
      prisma.license.findFirst.mockResolvedValue(license);

      const updated = {
        ...license,
        pendingQuantity: null,
        inngestRunId: null,
        updatedAt: new Date(),
      };
      prisma.license.update.mockResolvedValue(updated);

      return { license, updated };
    }

    it('clears pendingQuantity and inngestRunId', async () => {
      const caller = createAuthedCaller();
      setupCancelMocks();

      const result = await caller.cancelPendingScaleDown({
        licenseId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.license.pendingQuantity).toBeNull();
      expect(result.license.inngestRunId).toBeNull();
    });

    it('updates the license to clear pending fields', async () => {
      const caller = createAuthedCaller();
      setupCancelMocks();

      await caller.cancelPendingScaleDown({
        licenseId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(prisma.license.update).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        data: {
          pendingQuantity: null,
          inngestRunId: null,
        },
      });
    });

    it('writes audit log for cancellation', async () => {
      const caller = createAuthedCaller();
      setupCancelMocks();

      await caller.cancelPendingScaleDown({
        licenseId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'license.scale_down.cancelled',
          entityId: VALID_CUID,
          before: {
            pendingQuantity: 5,
            inngestRunId: 'pending-abc-123',
          },
          after: {
            pendingQuantity: null,
            inngestRunId: null,
          },
        }),
      );
    });

    it('throws BAD_REQUEST when no pending scale-down exists', async () => {
      const caller = createAuthedCaller();
      setupCancelMocks({
        license: { pendingQuantity: null, inngestRunId: null },
      });

      await expect(
        caller.cancelPendingScaleDown({
          licenseId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'No pending scale-down to cancel',
      });
    });

    it('no-pending error carries LICENSE:SCALE_DOWN:NO_PENDING errorCode', async () => {
      const caller = createAuthedCaller();
      setupCancelMocks({
        license: { pendingQuantity: null, inngestRunId: null },
      });

      try {
        await caller.cancelPendingScaleDown({
          licenseId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        });
        expect.fail('Expected TRPCError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const cause = (error as TRPCError).cause as unknown as Record<string, unknown>;
        expect(cause.errorCode).toBe('LICENSE:SCALE_DOWN:NO_PENDING');
      }
    });

    it('throws NOT_FOUND when license does not exist', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findFirst.mockResolvedValue(null);

      await expect(
        caller.cancelPendingScaleDown({
          licenseId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'License not found',
      });
    });

    it('rejects invalid licenseId format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.cancelPendingScaleDown({
          licenseId: 'bad-id',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid idempotencyKey format', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.cancelPendingScaleDown({
          licenseId: VALID_CUID,
          idempotencyKey: 'not-a-uuid',
        }),
      ).rejects.toThrow();
    });
  });
});
