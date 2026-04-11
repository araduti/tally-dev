/**
 * Unit tests for the insights router.
 *
 * The insights router exposes two procedures:
 *   - getRecommendations  (orgMemberProcedure — any org member)
 *   - getWasteAlerts      (orgMemberProcedure — any org member)
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers
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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 100,
    remaining: 99,
    reset: Math.floor(Date.now() / 1000) + 60,
  }),
}));

import { insightsRouter } from '../insights';

// ──────────────────────────────────────────────
// Constants & helpers
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';
const VALID_CUID_3 = 'clh1234567890abcdefghij02';

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

function createAuthedCaller() {
  mockAuth();
  const ctx = {
    headers: createAuthHeaders(),
    userId: USER_ID,
    organizationId: ORG_ID,
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: 'ORG_OWNER' as const,
    },
    db: rlsDb,
    traceId: 'test-trace-id',
    resHeaders: null,
  };
  return insightsRouter.createCaller(ctx);
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('insightsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRecommendations', () => {
    it('returns empty recommendations when no subscriptions exist', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([]);

      const result = await caller.getRecommendations({});

      expect(result.recommendations).toEqual([]);
      expect(result.generatedAt).toBeInstanceOf(Date);
    });

    it('generates RIGHT_SIZE recommendation when license has pending scale-down', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([{
        id: VALID_CUID,
        bundleId: VALID_CUID_2,
        status: 'ACTIVE',
        commitmentEndDate: new Date(Date.now() + 86400000),
        bundle: { id: VALID_CUID_2, name: 'Microsoft 365 E3' },
        licenses: [{
          id: VALID_CUID_3,
          quantity: 100,
          pendingQuantity: 50,
          productOfferingId: VALID_CUID,
          productOffering: {
            id: VALID_CUID,
            effectiveUnitCost: '10.00',
            sourceType: 'PAX8',
          },
        }],
      }]);

      // Mock for cost optimization lookups
      prisma.productOffering.findMany.mockResolvedValue([]);

      const result = await caller.getRecommendations({});

      const rightSizeRecs = result.recommendations.filter((r: any) => r.type === 'RIGHT_SIZE');
      expect(rightSizeRecs.length).toBe(1);
      expect(rightSizeRecs[0].severity).toBe('HIGH');
      expect(rightSizeRecs[0].potentialSavings).toBe('500.00');
    });

    it('generates COST_OPTIMIZATION recommendation when cheaper offering exists', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([{
        id: VALID_CUID,
        bundleId: VALID_CUID_2,
        status: 'ACTIVE',
        commitmentEndDate: new Date(Date.now() + 86400000),
        bundle: { id: VALID_CUID_2, name: 'Microsoft 365 E3' },
        licenses: [{
          id: VALID_CUID_3,
          quantity: 10,
          pendingQuantity: null,
          productOfferingId: VALID_CUID,
          productOffering: {
            id: VALID_CUID,
            effectiveUnitCost: '15.00',
            sourceType: 'PAX8',
          },
        }],
      }]);

      prisma.productOffering.findMany.mockResolvedValue([
        {
          id: VALID_CUID,
          effectiveUnitCost: '15.00',
          sourceType: 'PAX8',
          minQuantity: null,
          maxQuantity: null,
        },
        {
          id: VALID_CUID_2,
          effectiveUnitCost: '12.00',
          sourceType: 'INGRAM',
          minQuantity: null,
          maxQuantity: null,
        },
      ]);

      const result = await caller.getRecommendations({});

      const costRecs = result.recommendations.filter((r: any) => r.type === 'COST_OPTIMIZATION');
      expect(costRecs.length).toBe(1);
      expect(costRecs[0].severity).toBe('MEDIUM');
      expect(costRecs[0].potentialSavings).toBe('30.00');
    });

    it('generates COMMITMENT_SUGGESTION when no commitment date', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([{
        id: VALID_CUID,
        bundleId: VALID_CUID_2,
        status: 'ACTIVE',
        commitmentEndDate: null,
        bundle: { id: VALID_CUID_2, name: 'Microsoft 365 E3' },
        licenses: [{
          id: VALID_CUID_3,
          quantity: 10,
          pendingQuantity: null,
          productOfferingId: VALID_CUID,
          productOffering: {
            id: VALID_CUID,
            effectiveUnitCost: '10.00',
            sourceType: 'PAX8',
          },
        }],
      }]);

      prisma.productOffering.findMany.mockResolvedValue([]);

      const result = await caller.getRecommendations({});

      const commitRecs = result.recommendations.filter((r: any) => r.type === 'COMMITMENT_SUGGESTION');
      expect(commitRecs.length).toBe(1);
      expect(commitRecs[0].severity).toBe('LOW');
    });
  });

  describe('getWasteAlerts', () => {
    it('returns empty alerts when no waste detected', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([{
        id: VALID_CUID,
        status: 'ACTIVE',
        commitmentEndDate: new Date(Date.now() + 86400000),
        bundle: { id: VALID_CUID_2, name: 'Test Bundle' },
        licenses: [{
          id: VALID_CUID_3,
          quantity: 10,
          pendingQuantity: null,
          productOffering: {
            effectiveUnitCost: '10.00',
            maxQuantity: 100,
          },
        }],
      }]);

      const result = await caller.getWasteAlerts({});

      expect(result.alerts).toEqual([]);
      expect(result.analyzedAt).toBeInstanceOf(Date);
    });

    it('detects STALE_SUBSCRIPTION when subscription has no licenses', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([{
        id: VALID_CUID,
        status: 'ACTIVE',
        commitmentEndDate: null,
        bundle: { id: VALID_CUID_2, name: 'Empty Bundle' },
        licenses: [],
      }]);

      const result = await caller.getWasteAlerts({});

      const staleAlerts = result.alerts.filter((a: any) => a.type === 'STALE_SUBSCRIPTION');
      expect(staleAlerts.length).toBe(1);
      expect(staleAlerts[0].severity).toBe('MEDIUM');
    });

    it('detects OVER_PROVISIONED when quantity exceeds max', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([{
        id: VALID_CUID,
        status: 'ACTIVE',
        commitmentEndDate: null,
        bundle: { id: VALID_CUID_2, name: 'Test Bundle' },
        licenses: [{
          id: VALID_CUID_3,
          quantity: 150,
          pendingQuantity: null,
          productOffering: {
            effectiveUnitCost: '10.00',
            maxQuantity: 100,
          },
        }],
      }]);

      const result = await caller.getWasteAlerts({});

      const overAlerts = result.alerts.filter((a: any) => a.type === 'OVER_PROVISIONED');
      expect(overAlerts.length).toBe(1);
      expect(overAlerts[0].severity).toBe('HIGH');
      expect(overAlerts[0].estimatedWaste).toBe('500.00');
    });

    it('detects STALE_PENDING_SCALEDOWN when commitment has ended', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([{
        id: VALID_CUID,
        status: 'ACTIVE',
        commitmentEndDate: new Date(Date.now() - 86400000),
        bundle: { id: VALID_CUID_2, name: 'Test Bundle' },
        licenses: [{
          id: VALID_CUID_3,
          quantity: 100,
          pendingQuantity: 50,
          productOffering: {
            effectiveUnitCost: '10.00',
            maxQuantity: null,
          },
        }],
      }]);

      const result = await caller.getWasteAlerts({});

      const staleAlerts = result.alerts.filter((a: any) => a.type === 'STALE_PENDING_SCALEDOWN');
      expect(staleAlerts.length).toBe(1);
      expect(staleAlerts[0].severity).toBe('HIGH');
      expect(staleAlerts[0].estimatedWaste).toBe('500.00');
    });

    it('detects UNUSED_LICENSE when quantity is zero', async () => {
      const caller = createAuthedCaller();
      rlsDb.subscription.findMany.mockResolvedValue([{
        id: VALID_CUID,
        status: 'ACTIVE',
        commitmentEndDate: null,
        bundle: { id: VALID_CUID_2, name: 'Test Bundle' },
        licenses: [{
          id: VALID_CUID_3,
          quantity: 0,
          pendingQuantity: null,
          productOffering: {
            effectiveUnitCost: '10.00',
            maxQuantity: null,
          },
        }],
      }]);

      const result = await caller.getWasteAlerts({});

      const unusedAlerts = result.alerts.filter((a: any) => a.type === 'UNUSED_LICENSE');
      expect(unusedAlerts.length).toBe(1);
      expect(unusedAlerts[0].severity).toBe('LOW');
    });
  });
});
