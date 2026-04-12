/**
 * Integration tests for the subscription router.
 *
 * These tests exercise multi-step subscription lifecycle flows,
 * verifying cross-procedure interactions and end-to-end data
 * consistency across create → scale → cancel operations.
 *
 * Unlike unit tests (subscription.test.ts), these integration tests:
 *   - Test multi-step workflows spanning multiple procedures
 *   - Verify state transitions across procedure calls
 *   - Test cross-router interactions (subscription ↔ license)
 *   - Validate audit trail completeness across flows
 *   - Verify tenant isolation during full lifecycle operations
 *
 * NOTE: The idempotency guard middleware (`idempotencyGuard`) is a cross-
 * cutting concern tested separately. We replace mutation procedures with
 * their query counterparts (same RBAC, no idempotency guard) so we can
 * test the handler logic in isolation via `createCaller`.
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// Both blocks are hoisted above all imports by vitest.
// ──────────────────────────────────────────────

const {
  prisma,
  rlsDb,
  buildDbProxy,
  mockWriteAuditLog,
  mockCreateSubscription,
  mockCancelSubscription,
  mockInngestSend,
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
    buildDbProxy,
    mockWriteAuditLog: vi.fn().mockResolvedValue(undefined),
    mockCreateSubscription: vi.fn().mockResolvedValue({
      externalId: 'vendor-ext-001',
      status: 'active',
      quantity: 10,
    }),
    mockCancelSubscription: vi.fn().mockResolvedValue(undefined),
    mockInngestSend: vi.fn().mockResolvedValue({ ids: ['mock-event-id'] }),
  };
});

vi.mock('@/lib/db', () => ({ prisma }));

vi.mock('@/lib/audit', () => ({
  writeAuditLog: mockWriteAuditLog,
}));

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn().mockReturnValue('encrypted'),
  decrypt: vi.fn().mockReturnValue('decrypted'),
}));

vi.mock('@/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

vi.mock('@/adapters', () => ({
  getAdapter: vi.fn().mockReturnValue({
    createSubscription: mockCreateSubscription,
    cancelSubscription: mockCancelSubscription,
  }),
  decryptCredentials: vi.fn().mockReturnValue({ clientId: 'id', clientSecret: 'secret' }),
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
import { subscriptionRouter } from '../subscription';

// ──────────────────────────────────────────────
// Constants & auth helpers
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';
const VALID_CUID_3 = 'clh1234567890abcdefghij02';
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

function createAuthedCaller(orgRole: string = 'ORG_OWNER', orgId: string = ORG_ID) {
  mockAuth(orgRole, orgId);
  const ctx = {
    headers: createAuthHeaders(),
    userId: USER_ID,
    organizationId: orgId,
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: orgRole as any,
    },
    db: buildDbProxy(),
    traceId: 'test-trace-id',
    resHeaders: null,
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
    vendorConnection: {
      id: 'vc-1',
      vendorType: 'PAX8',
      status: 'ACTIVE',
      credentials: 'encrypted-creds',
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
// Integration Tests
// ──────────────────────────────────────────────

describe('subscriptionRouter — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  //  Full lifecycle: create → list → get → cancel
  // ─────────────────────────────────────────────
  describe('full lifecycle: create → list → get → cancel', () => {
    it('walks through subscription creation, retrieval, and cancellation', async () => {
      const caller = createAuthedCaller();

      // Step 1: Set up prerequisites for creation
      // The create procedure uses ctx.db (rlsDb) for DPA, org, and vendor lookups,
      // and global prisma for productOffering.
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });
      rlsDb.organization.findUnique.mockResolvedValue({
        id: ORG_ID,
        provisioningEnabled: true,
      });
      rlsDb.vendorConnection.findFirst.mockResolvedValue({
        id: 'vc-1',
        vendorType: 'PAX8',
        status: 'ACTIVE',
        credentials: 'encrypted-creds',
      });

      const offering = makeMockOffering();
      prisma.productOffering.findUnique.mockResolvedValue(offering);

      const createdSub = makeMockSubscription({
        id: VALID_CUID,
        status: 'ACTIVE',
        licenses: [
          {
            id: 'lic-1',
            subscriptionId: VALID_CUID,
            productOfferingId: VALID_CUID_3,
            quantity: 10,
          },
        ],
      });
      rlsDb.subscription.create.mockResolvedValue(createdSub);
      rlsDb.license.create.mockResolvedValue({
        id: 'lic-1',
        subscriptionId: VALID_CUID,
        productOfferingId: VALID_CUID_3,
        quantity: 10,
      });
      rlsDb.purchaseTransaction.create.mockResolvedValue({
        id: 'pt-1',
        quantity: 10,
        grossAmount: '60.00',
        status: 'COMPLETED',
      });

      const result = await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 10,
        idempotencyKey: VALID_UUID,
      });

      expect(result.subscription).toBeDefined();
      expect(result.subscription.status).toBe('ACTIVE');

      // Step 2: Verify audit log was written for creation
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.created',
          organizationId: ORG_ID,
          userId: USER_ID,
        }),
      );

      // Step 3: List subscriptions — newly created sub is visible
      vi.clearAllMocks();
      mockAuth();
      const listCaller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([createdSub]);

      const listed = await listCaller.list({});
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0].id).toBe(VALID_CUID);

      // Step 4: Get subscription by ID
      vi.clearAllMocks();
      mockAuth();
      const getCaller = createAuthedCaller();
      rlsDb.subscription.findFirst.mockResolvedValue(createdSub);

      const fetched = await getCaller.get({ subscriptionId: VALID_CUID });
      expect(fetched.id).toBe(VALID_CUID);
      expect(fetched.bundle).toBeDefined();

      // Step 5: Cancel the subscription
      vi.clearAllMocks();
      mockAuth();
      const cancelCaller = createAuthedCaller();
      const activeSub = makeMockSubscription({ id: VALID_CUID, status: 'ACTIVE' });
      rlsDb.subscription.findFirst.mockResolvedValue(activeSub);

      const cancelled = { ...activeSub, status: 'CANCELLED' };
      rlsDb.subscription.update.mockResolvedValue(cancelled);

      const cancelResult = await cancelCaller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID_2,
      });

      expect(cancelResult.subscription.status).toBe('CANCELLED');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.cancelled',
          entityId: VALID_CUID,
          before: expect.objectContaining({ status: 'ACTIVE' }),
          after: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Multi-tenant isolation
  // ─────────────────────────────────────────────
  describe('multi-tenant isolation', () => {
    it('org A cannot see org B subscriptions', async () => {
      // Org A has 1 subscription
      const subOrgA = makeMockSubscription({ id: VALID_CUID });

      // Query as Org A — should see only org A's subscription
      const callerA = createAuthedCaller('ORG_OWNER', ORG_ID);
      rlsDb.subscription.findMany.mockResolvedValue([subOrgA]);

      const resultA = await callerA.list({});
      expect(resultA.items).toHaveLength(1);
      expect(resultA.items[0].id).toBe(VALID_CUID);

      // Reset and query as Org B — should see nothing (different RLS context)
      vi.clearAllMocks();
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.subscription.findMany.mockResolvedValue([]);

      const resultB = await callerB.list({});
      expect(resultB.items).toHaveLength(0);
    });

    it('get returns NOT_FOUND for subscription in another org', async () => {
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.subscription.findFirst.mockResolvedValue(null);

      await expect(
        callerB.get({ subscriptionId: VALID_CUID }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ─────────────────────────────────────────────
  //  RBAC enforcement across operations
  // ─────────────────────────────────────────────
  describe('RBAC enforcement', () => {
    it('ORG_MEMBER can list but cannot create subscriptions', async () => {
      // list — should succeed
      const memberCaller = createAuthedCaller('ORG_MEMBER');
      rlsDb.subscription.findMany.mockResolvedValue([]);

      const listResult = await memberCaller.list({});
      expect(listResult.items).toHaveLength(0);

      // create — should be rejected (ORG_ADMIN+ required)
      vi.clearAllMocks();
      const memberCaller2 = createAuthedCaller('ORG_MEMBER');

      await expect(
        memberCaller2.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('ORG_MEMBER cannot cancel subscriptions', async () => {
      const memberCaller = createAuthedCaller('ORG_MEMBER');

      await expect(
        memberCaller.cancel({
          subscriptionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ─────────────────────────────────────────────
  //  Error recovery: create failure doesn't leave artifacts
  // ─────────────────────────────────────────────
  describe('error recovery', () => {
    it('vendor API failure during create does not leave a subscription record', async () => {
      const caller = createAuthedCaller();

      // Set up all prerequisites
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });
      rlsDb.organization.findUnique.mockResolvedValue({
        id: ORG_ID,
        provisioningEnabled: true,
      });
      rlsDb.vendorConnection.findFirst.mockResolvedValue({
        id: 'vc-1',
        vendorType: 'PAX8',
        status: 'ACTIVE',
        credentials: 'encrypted-creds',
      });

      const offering = makeMockOffering();
      prisma.productOffering.findUnique.mockResolvedValue(offering);

      // Vendor adapter throws
      mockCreateSubscription.mockRejectedValueOnce(new Error('Vendor API timeout'));

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();

      // Verify no subscription was persisted in the DB
      expect(rlsDb.subscription.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  //  Audit trail completeness
  // ─────────────────────────────────────────────
  describe('audit trail completeness', () => {
    it('create and cancel produce distinct audit entries', async () => {
      const caller = createAuthedCaller();

      // Create prerequisites (same as create flow)
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });
      rlsDb.organization.findUnique.mockResolvedValue({
        id: ORG_ID,
        provisioningEnabled: true,
      });
      rlsDb.vendorConnection.findFirst.mockResolvedValue({
        id: 'vc-1',
        vendorType: 'PAX8',
        status: 'ACTIVE',
        credentials: 'encrypted-creds',
      });

      const offering = makeMockOffering();
      prisma.productOffering.findUnique.mockResolvedValue(offering);

      const createdSub = makeMockSubscription({ id: VALID_CUID, status: 'ACTIVE' });
      rlsDb.subscription.create.mockResolvedValue(createdSub);
      rlsDb.license.create.mockResolvedValue({
        id: 'lic-1',
        subscriptionId: VALID_CUID,
        productOfferingId: VALID_CUID_3,
        quantity: 10,
      });
      rlsDb.purchaseTransaction.create.mockResolvedValue({
        id: 'pt-1',
        quantity: 10,
        grossAmount: '60.00',
        status: 'COMPLETED',
      });

      await caller.create({
        productOfferingId: VALID_CUID_3,
        quantity: 10,
        idempotencyKey: VALID_UUID,
      });

      // Cancel
      vi.clearAllMocks();
      mockAuth();
      const cancelCaller = createAuthedCaller();
      rlsDb.subscription.findFirst.mockResolvedValue(createdSub);
      rlsDb.subscription.update.mockResolvedValue({ ...createdSub, status: 'CANCELLED' });

      await cancelCaller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID_2,
      });

      // Cancel should have its own audit entry
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.cancelled',
          entityId: VALID_CUID,
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Cancel on already-cancelled subscription
  // ─────────────────────────────────────────────
  describe('cancel on already-cancelled subscription', () => {
    it('cancel proceeds and calls vendor adapter even for already-cancelled sub', async () => {
      // The cancel procedure does not guard against re-cancellation.
      // It re-issues the vendor API call for idempotent vendor-side cleanup
      // and updates the status to CANCELLED again (no-op transition).
      const caller = createAuthedCaller();
      const cancelledSub = makeMockSubscription({
        id: VALID_CUID,
        status: 'CANCELLED',
      });
      rlsDb.subscription.findFirst.mockResolvedValue(cancelledSub);
      rlsDb.subscription.update.mockResolvedValue({
        ...cancelledSub,
        status: 'CANCELLED',
      });

      const result = await caller.cancel({
        subscriptionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      // Procedure doesn't guard against re-cancellation; it proceeds
      expect(result.subscription.status).toBe('CANCELLED');
      expect(mockCancelSubscription).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  //  Input validation across procedures
  // ─────────────────────────────────────────────
  describe('input validation', () => {
    it('rejects create with invalid CUID for productOfferingId', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.create({
          productOfferingId: 'not-a-cuid',
          quantity: 10,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects create with zero quantity', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.create({
          productOfferingId: VALID_CUID_3,
          quantity: 0,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects cancel with invalid UUID for idempotencyKey', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.cancel({
          subscriptionId: VALID_CUID,
          idempotencyKey: 'not-a-uuid',
        }),
      ).rejects.toThrow();
    });

    it('rejects get with invalid CUID for subscriptionId', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.get({ subscriptionId: 'bad-id' }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────
  //  Pagination consistency across list calls
  // ─────────────────────────────────────────────
  describe('pagination consistency', () => {
    it('cursor-based pagination traverses all items', async () => {
      const caller = createAuthedCaller();

      // Page 1: returns 2 items + hasMore indicator
      const page1 = [
        makeMockSubscription({ id: 'clh1234567890abcdefgh0001' }),
        makeMockSubscription({ id: 'clh1234567890abcdefgh0002' }),
        makeMockSubscription({ id: 'clh1234567890abcdefgh0003' }),
      ];
      rlsDb.subscription.findMany.mockResolvedValueOnce(page1);

      const result1 = await caller.list({ limit: 2 });
      expect(result1.items).toHaveLength(2);
      expect(result1.nextCursor).toBe('clh1234567890abcdefgh0002');

      // Page 2: use cursor from previous page
      const page2 = [
        makeMockSubscription({ id: 'clh1234567890abcdefgh0003' }),
      ];
      rlsDb.subscription.findMany.mockResolvedValueOnce(page2);

      const result2 = await caller.list({
        limit: 2,
        cursor: result1.nextCursor!,
      });
      expect(result2.items).toHaveLength(1);
      expect(result2.nextCursor).toBeNull();
    });
  });
});
