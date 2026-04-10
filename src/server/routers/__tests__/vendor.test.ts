/**
 * Unit tests for the vendor router.
 *
 * The vendor router exposes four procedures:
 *   - listConnections  (mspTechProcedure — ORG_ADMIN+, MSP_TECHNICIAN+)
 *   - connect          (orgOwnerMutationProcedure — ORG_OWNER+, idempotent)
 *   - disconnect       (orgOwnerMutationProcedure — ORG_OWNER+, idempotent)
 *   - syncCatalog      (orgAdminMutationProcedure — ORG_ADMIN+, idempotent)
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories
// ──────────────────────────────────────────────

const { prisma, buildDbProxy, mockWriteAuditLog, mockEncrypt } = vi.hoisted(() => {
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
    buildDbProxy,
    mockWriteAuditLog: vi.fn().mockResolvedValue(undefined),
    mockEncrypt: vi.fn().mockReturnValue('encrypted-credentials'),
  };
});

vi.mock('@/lib/db', () => ({ prisma }));

vi.mock('@/lib/audit', () => ({
  writeAuditLog: mockWriteAuditLog,
}));

vi.mock('@/lib/encryption', () => ({
  encrypt: mockEncrypt,
  decrypt: vi.fn().mockReturnValue('decrypted-credentials'),
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
import { vendorRouter } from '../vendor';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '550e8400-e29b-41d4-a716-446655440001';

const SESSION_TOKEN = 'test-session-token';
const USER_ID = 'test-user-id';
const ORG_ID = 'test-org-id';

// ──────────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────────

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
  return {
    headers: new Headers(),
    userId: USER_ID,
    organizationId: ORG_ID,
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: 'ORG_OWNER' as const,
    },
    db: buildDbProxy(),
    traceId: 'test-trace-id',
    ...overrides,
  };
}

function createAuthedCaller(orgRole: string = 'ORG_OWNER') {
  mockAuth(orgRole);
  const ctx = createTestContext({ headers: createAuthHeaders() });
  return { caller: vendorRouter.createCaller(ctx), ctx };
}

// ──────────────────────────────────────────────
// Mock data factories
// ──────────────────────────────────────────────

function makeMockConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    vendorType: 'PAX8',
    status: 'ACTIVE',
    lastSyncAt: new Date('2024-06-01'),
    createdAt: new Date('2024-01-01'),
    credentials: 'encrypted-credentials',
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('vendorRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ─────────────────────────────────────
  //  listConnections
  // ─────────────────────────────────────
  describe('listConnections', () => {
    it('returns connections for the active org', async () => {
      const { caller, ctx } = createAuthedCaller();
      const conn = makeMockConnection();
      ctx.db.vendorConnection.findMany.mockResolvedValue([conn]);

      const result = await caller.listConnections({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(VALID_CUID);
      expect(result.items[0].vendorType).toBe('PAX8');
      expect(result.items[0].status).toBe('ACTIVE');
      expect(result.nextCursor).toBeNull();
    });

    it('returns empty list when no connections exist', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.vendorConnection.findMany.mockResolvedValue([]);

      const result = await caller.listConnections({});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('filters by vendorType when specified', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.vendorConnection.findMany.mockResolvedValue([]);

      await caller.listConnections({
        where: { vendorType: 'PAX8' },
      });

      expect(ctx.db.vendorConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vendorType: 'PAX8' },
        }),
      );
    });

    it('filters by status when specified', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.vendorConnection.findMany.mockResolvedValue([]);

      await caller.listConnections({
        where: { status: 'ACTIVE' },
      });

      expect(ctx.db.vendorConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE' },
        }),
      );
    });

    it('filters by both vendorType and status', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.vendorConnection.findMany.mockResolvedValue([]);

      await caller.listConnections({
        where: { vendorType: 'PAX8', status: 'ACTIVE' },
      });

      expect(ctx.db.vendorConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vendorType: 'PAX8', status: 'ACTIVE' },
        }),
      );
    });

    it('returns nextCursor when more items exist than the limit', async () => {
      const { caller, ctx } = createAuthedCaller();
      // limit=2 → findMany called with take=3 → return 3 → hasMore=true
      const connections = [
        makeMockConnection({ id: 'clh1234567890abcdefghij00' }),
        makeMockConnection({ id: 'clh1234567890abcdefghij01' }),
        makeMockConnection({ id: 'clh1234567890abcdefghij02' }),
      ];
      ctx.db.vendorConnection.findMany.mockResolvedValue(connections);

      const result = await caller.listConnections({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('clh1234567890abcdefghij01');
    });

    it('does not include credentials in the response', async () => {
      const { caller, ctx } = createAuthedCaller();
      const conn = makeMockConnection();
      ctx.db.vendorConnection.findMany.mockResolvedValue([conn]);

      await caller.listConnections({});

      // Verify select does not include credentials
      expect(ctx.db.vendorConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.objectContaining({ credentials: true }),
        }),
      );
    });
  });

  // ─────────────────────────────────────
  //  connect
  // ─────────────────────────────────────
  describe('connect', () => {
    it('creates a new vendor connection (happy path)', async () => {
      const { caller, ctx } = createAuthedCaller();

      // DPA accepted
      ctx.db.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });

      // No existing connection
      ctx.db.vendorConnection.findFirst.mockResolvedValue(null);

      const created = {
        id: VALID_CUID,
        vendorType: 'PAX8',
        status: 'PENDING',
      };
      ctx.db.vendorConnection.create.mockResolvedValue(created);

      const result = await caller.connect({
        vendorType: 'PAX8',
        credentials: 'my-api-key',
        idempotencyKey: VALID_UUID,
      });

      expect(result.vendorConnection).toEqual(created);
      expect(mockEncrypt).toHaveBeenCalledWith('my-api-key');
      expect(ctx.db.vendorConnection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vendorType: 'PAX8',
            credentials: 'encrypted-credentials',
            status: 'PENDING',
          }),
        }),
      );
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'vendor.connected',
          entityId: VALID_CUID,
          after: { vendorType: 'PAX8', status: 'PENDING' },
        }),
      );
    });

    it('throws when DPA has not been accepted', async () => {
      const { caller, ctx } = createAuthedCaller();

      // No DPA record
      ctx.db.dpaAcceptance.findFirst.mockResolvedValue(null);

      await expect(
        caller.connect({
          vendorType: 'PAX8',
          credentials: 'my-api-key',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();

      // Verify no connection was created
      expect(ctx.db.vendorConnection.create).not.toHaveBeenCalled();
    });

    it('throws CONFLICT when an active connection of same type exists', async () => {
      const { caller, ctx } = createAuthedCaller();

      // DPA accepted
      ctx.db.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });

      // Existing active connection
      ctx.db.vendorConnection.findFirst.mockResolvedValue(
        makeMockConnection({ status: 'ACTIVE' }),
      );

      await expect(
        caller.connect({
          vendorType: 'PAX8',
          credentials: 'my-api-key',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/already exists/);

      expect(ctx.db.vendorConnection.create).not.toHaveBeenCalled();
    });

    it('allows reconnecting when existing connection is DISCONNECTED', async () => {
      const { caller, ctx } = createAuthedCaller();

      // DPA accepted
      ctx.db.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });

      // Existing DISCONNECTED connection — should not block
      ctx.db.vendorConnection.findFirst.mockResolvedValue(
        makeMockConnection({ status: 'DISCONNECTED' }),
      );

      const created = {
        id: VALID_CUID_2,
        vendorType: 'PAX8',
        status: 'PENDING',
      };
      ctx.db.vendorConnection.create.mockResolvedValue(created);

      const result = await caller.connect({
        vendorType: 'PAX8',
        credentials: 'new-api-key',
        idempotencyKey: VALID_UUID,
      });

      expect(result.vendorConnection).toEqual(created);
    });

    it('returns cached result on duplicate idempotency key', async () => {
      const { caller } = createAuthedCaller();
      const { redis } = await import('@/lib/redis');

      const cachedResult = JSON.stringify({
        result: {
          type: 'data',
          data: { vendorConnection: { id: VALID_CUID, vendorType: 'PAX8', status: 'PENDING' } },
        },
      });
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(cachedResult);

      const result = await caller.connect({
        vendorType: 'PAX8',
        credentials: 'my-api-key',
        idempotencyKey: VALID_UUID,
      });

      // The idempotency middleware returns the cached response, skipping mutation logic
      expect(result).toBeDefined();
    });
  });

  // ─────────────────────────────────────
  //  disconnect
  // ─────────────────────────────────────
  describe('disconnect', () => {
    it('disconnects an existing vendor connection (happy path)', async () => {
      const { caller, ctx } = createAuthedCaller();

      const existing = makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' });
      ctx.db.vendorConnection.findFirst.mockResolvedValue(existing);

      const updated = { id: VALID_CUID, status: 'DISCONNECTED' };
      ctx.db.vendorConnection.update.mockResolvedValue(updated);

      const result = await caller.disconnect({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.vendorConnection).toEqual(updated);
      expect(ctx.db.vendorConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: VALID_CUID },
          data: {
            status: 'DISCONNECTED',
            credentials: '', // securely erased
          },
        }),
      );
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'vendor.disconnected',
          entityId: VALID_CUID,
          before: { status: 'ACTIVE' },
          after: { status: 'DISCONNECTED' },
        }),
      );
    });

    it('throws NOT_FOUND when vendor connection does not exist', async () => {
      const { caller, ctx } = createAuthedCaller();

      ctx.db.vendorConnection.findFirst.mockResolvedValue(null);

      await expect(
        caller.disconnect({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/not found/i);

      expect(ctx.db.vendorConnection.update).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it('returns cached result on duplicate idempotency key', async () => {
      const { caller } = createAuthedCaller();
      const { redis } = await import('@/lib/redis');

      const cachedResult = JSON.stringify({
        result: {
          type: 'data',
          data: { vendorConnection: { id: VALID_CUID, status: 'DISCONNECTED' } },
        },
      });
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(cachedResult);

      const result = await caller.disconnect({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result).toBeDefined();
    });
  });

  // ─────────────────────────────────────
  //  syncCatalog
  // ─────────────────────────────────────
  describe('syncCatalog', () => {
    it('enqueues a catalog sync (happy path)', async () => {
      const { caller, ctx } = createAuthedCaller('ORG_ADMIN');

      const connection = makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' });
      ctx.db.vendorConnection.findFirst.mockResolvedValue(connection);

      const result = await caller.syncCatalog({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.status).toBe('ENQUEUED');
      expect(result.syncId).toBeDefined();
      expect(result.syncId).toMatch(/^sync-/);
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'vendor.sync_catalog.enqueued',
          entityId: VALID_CUID,
          after: expect.objectContaining({ syncId: expect.stringMatching(/^sync-/) }),
        }),
      );
    });

    it('throws NOT_FOUND when vendor connection does not exist', async () => {
      const { caller, ctx } = createAuthedCaller('ORG_ADMIN');

      ctx.db.vendorConnection.findFirst.mockResolvedValue(null);

      await expect(
        caller.syncCatalog({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/not found/i);

      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it('throws PRECONDITION_FAILED when connection is DISCONNECTED', async () => {
      const { caller, ctx } = createAuthedCaller('ORG_ADMIN');

      const connection = makeMockConnection({ id: VALID_CUID, status: 'DISCONNECTED' });
      ctx.db.vendorConnection.findFirst.mockResolvedValue(connection);

      await expect(
        caller.syncCatalog({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/disconnected/i);

      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it('allows ORG_OWNER to sync catalog', async () => {
      const { caller, ctx } = createAuthedCaller('ORG_OWNER');

      const connection = makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' });
      ctx.db.vendorConnection.findFirst.mockResolvedValue(connection);

      const result = await caller.syncCatalog({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.status).toBe('ENQUEUED');
    });

    it('returns cached result on duplicate idempotency key', async () => {
      const { caller } = createAuthedCaller('ORG_ADMIN');
      const { redis } = await import('@/lib/redis');

      const cachedResult = JSON.stringify({
        result: {
          type: 'data',
          data: { syncId: 'sync-abc', status: 'ENQUEUED' },
        },
      });
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(cachedResult);

      const result = await caller.syncCatalog({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result).toBeDefined();
    });
  });
});
