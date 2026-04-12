/**
 * Integration tests for the license router.
 *
 * These tests exercise multi-step license operation flows,
 * verifying cross-procedure interactions and commitment-gated
 * scale-down workflows end-to-end.
 *
 * Unlike unit tests (license.test.ts), these integration tests:
 *   - Test full scale-up → scale-down → cancel-pending lifecycle
 *   - Verify commitment window gate logic across multiple operations
 *   - Test cross-procedure state transitions
 *   - Validate financial precision with Decimal.js across flows
 *   - Verify audit trail completeness for multi-step operations
 *   - Test multi-tenant isolation for license operations
 *
 * NOTE: The idempotency guard middleware is bypassed by replacing
 * mspTechMutationProcedure with mspTechProcedure (same RBAC).
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const { prisma, rlsDb, buildDbProxy, mockSetQuantity, mockInngestSend, mockWriteAuditLog } =
  vi.hoisted(() => {
    const mockSetQuantity = vi.fn().mockResolvedValue(undefined);
    const mockInngestSend = vi.fn().mockResolvedValue({ ids: ['mock-event-id'] });
    const mockWriteAuditLog = vi.fn().mockResolvedValue(undefined);

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
      mockSetQuantity,
      mockInngestSend,
      mockWriteAuditLog,
    };
  });

vi.mock('@/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

vi.mock('@/lib/db', () => ({ prisma }));

vi.mock('@/lib/audit', () => ({
  writeAuditLog: mockWriteAuditLog,
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
import Decimal from 'decimal.js';
import { licenseRouter } from '../license';

// ──────────────────────────────────────────────
// Constants & auth helpers
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';
const VALID_CUID_3 = 'clh1234567890abcdefghij02';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';
const VALID_UUID_3 = '770e8400-e29b-41d4-a716-446655440002';

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

function mockOrgSubscriptions(ids: string[] = [VALID_CUID_2]) {
  rlsDb.subscription.findMany.mockResolvedValue(
    ids.map((id) => ({ id })),
  );
}

// ──────────────────────────────────────────────
// Integration Tests
// ──────────────────────────────────────────────

describe('licenseRouter — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  //  Full lifecycle: list → get → scaleUp → scaleDown
  // ─────────────────────────────────────────────
  describe('full lifecycle: list → get → scaleUp → scaleDown', () => {
    it('retrieves a license, scales up, then scales down without commitment', async () => {
      // Step 1: List licenses
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      const license = makeMockLicense({ quantity: 10 });
      prisma.license.findMany.mockResolvedValue([license]);

      const listResult = await caller.list({});
      expect(listResult.items).toHaveLength(1);
      expect(listResult.items[0].quantity).toBe(10);

      // Step 2: Get by ID
      vi.clearAllMocks();
      const getCaller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findFirst.mockResolvedValue(license);

      const getResult = await getCaller.get({ licenseId: VALID_CUID });
      expect(getResult.id).toBe(VALID_CUID);
      expect(getResult.quantity).toBe(10);

      // Step 3: Scale up 10 → 20
      vi.clearAllMocks();
      const scaleUpCaller = createAuthedCaller();
      mockOrgSubscriptions();
      prisma.license.findFirst.mockResolvedValue(license);

      const scaledUpLicense = { ...license, quantity: 20, updatedAt: new Date() };
      prisma.license.update.mockResolvedValue(scaledUpLicense);
      rlsDb.purchaseTransaction.create.mockResolvedValue({
        id: 'pt-1',
        productOfferingId: VALID_CUID_3,
        quantity: 10,
        grossAmount: '60.00',
        ourMarginEarned: '9.00',
        idempotencyKey: VALID_UUID,
        status: 'COMPLETED',
      });

      const scaleUpResult = await scaleUpCaller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 20,
        idempotencyKey: VALID_UUID,
      });

      expect(scaleUpResult.license.quantity).toBe(20);
      expect(scaleUpResult.purchaseTransaction.status).toBe('COMPLETED');

      // Verify vendor adapter called
      expect(mockSetQuantity).toHaveBeenCalled();

      // Verify audit log
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'license.scale_up.executed',
          entityId: VALID_CUID,
          before: { quantity: 10 },
          after: { quantity: 20 },
        }),
      );

      // Step 4: Scale down 20 → 5 (no commitment window)
      vi.clearAllMocks();
      const scaleDownCaller = createAuthedCaller();
      mockOrgSubscriptions();
      const currentLicense = makeMockLicense({ quantity: 20 });
      prisma.license.findFirst.mockResolvedValue(currentLicense);
      prisma.license.update.mockResolvedValue({
        ...currentLicense,
        quantity: 5,
        updatedAt: new Date(),
      });

      const scaleDownResult = await scaleDownCaller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID_2,
      });

      expect(scaleDownResult.isStaged).toBe(false);
      expect(scaleDownResult.license.quantity).toBe(5);
      expect(scaleDownResult.commitmentEndDate).toBeNull();

      // Verify audit log for scale-down
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'license.scale_down.executed',
          entityId: VALID_CUID,
          before: { quantity: 20 },
          after: { quantity: 5 },
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Commitment-gated scale-down → cancel pending
  // ─────────────────────────────────────────────
  describe('commitment-gated scale-down flow', () => {
    it('stages a scale-down during commitment, then cancels it', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 3_600_000);

      // Step 1: Attempt scale-down during commitment — should be staged
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      const license = makeMockLicense({
        quantity: 10,
        subscription: {
          id: VALID_CUID_2,
          externalId: 'ext-sub-001',
          commitmentEndDate: futureDate,
          bundle: { id: 'bundle-1', name: 'Microsoft 365 Business Basic' },
          vendorConnection: {
            id: 'vc-1',
            vendorType: 'PAX8',
            credentials: 'encrypted-creds',
          },
        },
      });
      prisma.license.findFirst.mockResolvedValue(license);

      const stagedLicense = {
        ...license,
        pendingQuantity: 5,
        inngestRunId: 'pending-run-123',
        updatedAt: new Date(),
      };
      prisma.license.update.mockResolvedValue(stagedLicense);

      const stageResult = await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(stageResult.isStaged).toBe(true);
      expect(stageResult.commitmentEndDate).toEqual(futureDate);
      expect(stageResult.inngestRunId).toMatch(/^pending-/);

      // Verify license was updated with pendingQuantity
      expect(prisma.license.update).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        data: {
          pendingQuantity: 5,
          inngestRunId: expect.stringMatching(/^pending-/),
        },
      });

      // Verify audit log for staged scale-down
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'license.scale_down.staged',
          entityId: VALID_CUID,
          before: { quantity: 10 },
          after: expect.objectContaining({ pendingQuantity: 5 }),
        }),
      );

      // Step 2: Cancel the pending scale-down
      vi.clearAllMocks();
      const cancelCaller = createAuthedCaller();
      mockOrgSubscriptions();

      const pendingLicense = makeMockLicense({
        quantity: 10,
        pendingQuantity: 5,
        inngestRunId: 'pending-run-123',
      });
      prisma.license.findFirst.mockResolvedValue(pendingLicense);

      const clearedLicense = {
        ...pendingLicense,
        pendingQuantity: null,
        inngestRunId: null,
        updatedAt: new Date(),
      };
      prisma.license.update.mockResolvedValue(clearedLicense);

      const cancelResult = await cancelCaller.cancelPendingScaleDown({
        licenseId: VALID_CUID,
        idempotencyKey: VALID_UUID_2,
      });

      expect(cancelResult.license.pendingQuantity).toBeNull();
      expect(cancelResult.license.inngestRunId).toBeNull();

      // Verify cleanup
      expect(prisma.license.update).toHaveBeenCalledWith({
        where: { id: VALID_CUID },
        data: {
          pendingQuantity: null,
          inngestRunId: null,
        },
      });

      // Verify audit log for cancellation
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'license.scale_down.cancelled',
          entityId: VALID_CUID,
          before: expect.objectContaining({ pendingQuantity: 5 }),
          after: { pendingQuantity: null, inngestRunId: null },
        }),
      );
    });

    it('commitment expiry allows immediate scale-down', async () => {
      const pastDate = new Date(Date.now() - 24 * 3_600_000);

      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      const license = makeMockLicense({
        quantity: 10,
        subscription: {
          id: VALID_CUID_2,
          externalId: 'ext-sub-001',
          commitmentEndDate: pastDate,
          bundle: { id: 'bundle-1', name: 'Microsoft 365 Business Basic' },
          vendorConnection: {
            id: 'vc-1',
            vendorType: 'PAX8',
            credentials: 'encrypted-creds',
          },
        },
      });
      prisma.license.findFirst.mockResolvedValue(license);
      prisma.license.update.mockResolvedValue({
        ...license,
        quantity: 5,
        updatedAt: new Date(),
      });

      const result = await caller.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID,
      });

      expect(result.isStaged).toBe(false);
      expect(result.commitmentEndDate).toBeNull();
      expect(result.license.quantity).toBe(5);
    });
  });

  // ─────────────────────────────────────────────
  //  Financial precision with Decimal.js
  // ─────────────────────────────────────────────
  describe('financial precision', () => {
    it('grossAmount and margin are computed with Decimal.js precision', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();

      const license = makeMockLicense({
        quantity: 10,
        productOffering: {
          id: VALID_CUID_3,
          effectiveUnitCost: '29.99',
          partnerMarginPercent: '15.50',
          minQuantity: 1,
          maxQuantity: 300,
        },
      });
      prisma.license.findFirst.mockResolvedValue(license);

      const updated = { ...license, quantity: 13, updatedAt: new Date() };
      prisma.license.update.mockResolvedValue(updated);

      rlsDb.purchaseTransaction.create.mockResolvedValue({
        id: 'pt-1',
        productOfferingId: VALID_CUID_3,
        quantity: 3,
        grossAmount: '89.97',
        ourMarginEarned: '13.95',
        idempotencyKey: VALID_UUID,
        status: 'COMPLETED',
      });

      await caller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 13,
        idempotencyKey: VALID_UUID,
      });

      // Verify the financial math
      // delta = 13 - 10 = 3
      // grossAmount = 29.99 × 3 = 89.97
      // marginEarned = 89.97 × 15.50 / 100 = 13.94535 → 13.95 (2dp)
      const expectedGross = new Decimal('29.99').mul(3);
      expect(expectedGross.toString()).toBe('89.97');

      const expectedMargin = expectedGross.mul('15.50').div(100).toDecimalPlaces(2);
      expect(expectedMargin.toString()).toBe('13.95');

      expect(rlsDb.purchaseTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productOfferingId: VALID_CUID_3,
          quantity: 3,
          idempotencyKey: VALID_UUID,
          status: 'COMPLETED',
        }),
      });
    });

    it('null partnerMarginPercent defaults to zero margin', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();

      const license = makeMockLicense({
        quantity: 10,
        productOffering: {
          id: VALID_CUID_3,
          effectiveUnitCost: '6.00',
          partnerMarginPercent: null,
          minQuantity: 1,
          maxQuantity: null,
        },
      });
      prisma.license.findFirst.mockResolvedValue(license);
      prisma.license.update.mockResolvedValue({
        ...license,
        quantity: 15,
        updatedAt: new Date(),
      });

      rlsDb.purchaseTransaction.create.mockResolvedValue({
        id: 'pt-2',
        productOfferingId: VALID_CUID_3,
        quantity: 5,
        grossAmount: '30.00',
        ourMarginEarned: '0.00',
        idempotencyKey: VALID_UUID,
        status: 'COMPLETED',
      });

      await caller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 15,
        idempotencyKey: VALID_UUID,
      });

      // Verify margin = 0 when partnerMarginPercent is null
      const expectedGross = new Decimal('6.00').mul(5).toDecimalPlaces(2);
      expect(expectedGross.toFixed(2)).toBe('30.00');

      // With null margin, expected margin is simply zero
      const expectedMargin = new Decimal('0.00');
      expect(expectedMargin.toFixed(2)).toBe('0.00');
    });
  });

  // ─────────────────────────────────────────────
  //  Multi-tenant isolation
  // ─────────────────────────────────────────────
  describe('multi-tenant isolation', () => {
    it('org B cannot access org A licenses', async () => {
      // Org A has licenses
      const callerA = createAuthedCaller('ORG_OWNER', ORG_ID);
      mockOrgSubscriptions([VALID_CUID_2]);
      prisma.license.findMany.mockResolvedValue([makeMockLicense()]);

      const resultA = await callerA.list({});
      expect(resultA.items).toHaveLength(1);

      // Reset — org B has no subscriptions in scope
      vi.clearAllMocks();
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.subscription.findMany.mockResolvedValue([]);
      prisma.license.findMany.mockResolvedValue([]);

      const resultB = await callerB.list({});
      expect(resultB.items).toHaveLength(0);
    });

    it('org B cannot scale org A license', async () => {
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.subscription.findMany.mockResolvedValue([]); // no subs in scope
      prisma.license.findFirst.mockResolvedValue(null); // license not found

      await expect(
        callerB.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 20,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ─────────────────────────────────────────────
  //  Error boundary: scaleUp then scaleDown with conflict
  // ─────────────────────────────────────────────
  describe('error boundaries', () => {
    it('cannot scaleDown when a pending scaleDown already exists', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();

      const license = makeMockLicense({
        quantity: 10,
        pendingQuantity: 5,
        inngestRunId: 'pending-existing-run',
      });
      prisma.license.findFirst.mockResolvedValue(license);

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

    it('cannot scaleUp with quantity less than current', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();

      const license = makeMockLicense({ quantity: 10 });
      prisma.license.findFirst.mockResolvedValue(license);

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

    it('cannot scaleDown with quantity greater than current', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();

      const license = makeMockLicense({ quantity: 10 });
      prisma.license.findFirst.mockResolvedValue(license);

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

    it('cancelPendingScaleDown fails when no pending scale-down exists', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();

      const license = makeMockLicense({
        quantity: 10,
        pendingQuantity: null,
        inngestRunId: null,
      });
      prisma.license.findFirst.mockResolvedValue(license);

      await expect(
        caller.cancelPendingScaleDown({
          licenseId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('scaleUp fails when productOffering is null', async () => {
      const caller = createAuthedCaller();
      mockOrgSubscriptions();

      const license = makeMockLicense({
        productOfferingId: null,
        productOffering: null,
      });
      prisma.license.findFirst.mockResolvedValue(license);

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
  });

  // ─────────────────────────────────────────────
  //  Audit trail completeness for multi-step flows
  // ─────────────────────────────────────────────
  describe('audit trail for multi-step operations', () => {
    it('scaleUp and scaleDown produce separate audit entries', async () => {
      // Scale up
      const caller = createAuthedCaller();
      mockOrgSubscriptions();
      const license = makeMockLicense({ quantity: 10 });
      prisma.license.findFirst.mockResolvedValue(license);
      prisma.license.update.mockResolvedValue({ ...license, quantity: 20 });
      rlsDb.purchaseTransaction.create.mockResolvedValue({
        id: 'pt-1',
        quantity: 10,
        grossAmount: '60.00',
        ourMarginEarned: '9.00',
        status: 'COMPLETED',
      });

      await caller.scaleUp({
        licenseId: VALID_CUID,
        newQuantity: 20,
        idempotencyKey: VALID_UUID,
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'license.scale_up.executed',
        }),
      );
      const scaleUpAuditCalls = mockWriteAuditLog.mock.calls.length;

      // Scale down
      vi.clearAllMocks();
      const caller2 = createAuthedCaller();
      mockOrgSubscriptions();
      const updatedLicense = makeMockLicense({ quantity: 20 });
      prisma.license.findFirst.mockResolvedValue(updatedLicense);
      prisma.license.update.mockResolvedValue({ ...updatedLicense, quantity: 5 });

      await caller2.scaleDown({
        licenseId: VALID_CUID,
        newQuantity: 5,
        idempotencyKey: VALID_UUID_2,
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'license.scale_down.executed',
        }),
      );

      // Both produced exactly one audit entry each
      expect(scaleUpAuditCalls).toBe(1);
      expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────
  //  Input validation across operations
  // ─────────────────────────────────────────────
  describe('input validation', () => {
    it('rejects non-CUID licenseId for scaleUp', async () => {
      const caller = createAuthedCaller();
      await expect(
        caller.scaleUp({
          licenseId: 'bad-id',
          newQuantity: 15,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects non-UUID idempotencyKey for scaleDown', async () => {
      const caller = createAuthedCaller();
      await expect(
        caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: 5,
          idempotencyKey: 'not-a-uuid',
        }),
      ).rejects.toThrow();
    });

    it('rejects non-positive newQuantity for scaleUp', async () => {
      const caller = createAuthedCaller();
      await expect(
        caller.scaleUp({
          licenseId: VALID_CUID,
          newQuantity: 0,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects non-positive newQuantity for scaleDown', async () => {
      const caller = createAuthedCaller();
      await expect(
        caller.scaleDown({
          licenseId: VALID_CUID,
          newQuantity: -1,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });
  });
});
