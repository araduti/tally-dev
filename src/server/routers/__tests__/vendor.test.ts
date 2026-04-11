/**
 * Unit tests for the vendor router.
 *
 * The vendor router exposes four procedures:
 *   - listConnections  (mspTechProcedure — ORG_ADMIN+, MSP_TECHNICIAN+)
 *   - connect          (orgOwnerMutationProcedure — ORG_OWNER+, idempotent)
 *   - disconnect       (orgOwnerMutationProcedure — ORG_OWNER+, idempotent)
 *   - syncCatalog      (orgAdminMutationProcedure — ORG_ADMIN+, idempotent)
 *
 * NOTE: The idempotency guard middleware (`idempotencyGuard`) is a cross-
 * cutting concern tested separately. It accesses `input` which is not
 * available in `createCaller` when positioned before `.input()` in the
 * tRPC v11 procedure chain. We replace mutation procedures with their
 * query counterparts (same RBAC, no idempotency guard) so we can test
 * the handler logic in isolation.
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// Both blocks are hoisted above all imports by vitest.
// ──────────────────────────────────────────────

const { prisma, rlsDb, buildDbProxy, mockWriteAuditLog, mockEncrypt, mockInngestSend } = vi.hoisted(() => {
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
  // The vendor router reads from ctx.db, which the isAuthenticated
  // middleware replaces with the return value of createRLSProxy.
  return {
    prisma: buildDbProxy(),
    rlsDb: buildDbProxy(),
    buildDbProxy,
    mockWriteAuditLog: vi.fn().mockResolvedValue(undefined),
    mockEncrypt: vi.fn().mockReturnValue('encrypted-credentials'),
    mockInngestSend: vi.fn().mockResolvedValue({ ids: ['mock-event-id'] }),
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
  createRLSProxy: vi.fn(() => rlsDb),
}));

// Replace mutation procedures with their query counterparts so the
// idempotency guard (which cannot access `input` via createCaller in
// tRPC v11) is bypassed. RBAC is still enforced via the base procedures.
vi.mock('@/server/trpc/init', async () => {
  const actual = await vi.importActual<typeof import('@/server/trpc/init')>(
    '@/server/trpc/init',
  );
  return {
    ...actual,
    orgOwnerMutationProcedure: actual.orgOwnerProcedure,
    orgAdminMutationProcedure: actual.orgAdminProcedure,
  };
});

import { vendorRouter } from '../vendor';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

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
 * and returns a typed tRPC caller for the vendor router.
 *
 * All vendor queries/mutations use `rlsDb` — the stable proxy returned
 * by `createRLSProxy` — because the isAuthenticated middleware replaces
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
    resHeaders: null,
  };
  return vendorRouter.createCaller(ctx);
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
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────
  //  listConnections
  // ─────────────────────────────────────
  describe('listConnections', () => {
    it('returns connections for the active org', async () => {
      const caller = createAuthedCaller();
      const conn = makeMockConnection();
      rlsDb.vendorConnection.findMany.mockResolvedValue([conn]);

      const result = await caller.listConnections({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(VALID_CUID);
      expect(result.items[0].vendorType).toBe('PAX8');
      expect(result.items[0].status).toBe('ACTIVE');
      expect(result.nextCursor).toBeNull();
    });

    it('returns empty list when no connections exist', async () => {
      const caller = createAuthedCaller();
      rlsDb.vendorConnection.findMany.mockResolvedValue([]);

      const result = await caller.listConnections({});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('filters by vendorType when specified', async () => {
      const caller = createAuthedCaller();
      rlsDb.vendorConnection.findMany.mockResolvedValue([]);

      await caller.listConnections({
        where: { vendorType: 'PAX8' },
      });

      expect(rlsDb.vendorConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vendorType: 'PAX8' },
        }),
      );
    });

    it('filters by status when specified', async () => {
      const caller = createAuthedCaller();
      rlsDb.vendorConnection.findMany.mockResolvedValue([]);

      await caller.listConnections({
        where: { status: 'ACTIVE' },
      });

      expect(rlsDb.vendorConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE' },
        }),
      );
    });

    it('filters by both vendorType and status', async () => {
      const caller = createAuthedCaller();
      rlsDb.vendorConnection.findMany.mockResolvedValue([]);

      await caller.listConnections({
        where: { vendorType: 'PAX8', status: 'ACTIVE' },
      });

      expect(rlsDb.vendorConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vendorType: 'PAX8', status: 'ACTIVE' },
        }),
      );
    });

    it('returns nextCursor when more items exist than the limit', async () => {
      const caller = createAuthedCaller();
      // limit=2 → findMany called with take=3 → return 3 → hasMore=true
      const connections = [
        makeMockConnection({ id: 'clh1234567890abcdefghij00' }),
        makeMockConnection({ id: 'clh1234567890abcdefghij01' }),
        makeMockConnection({ id: 'clh1234567890abcdefghij02' }),
      ];
      rlsDb.vendorConnection.findMany.mockResolvedValue(connections);

      const result = await caller.listConnections({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('clh1234567890abcdefghij01');
    });

    it('does not include credentials in the response', async () => {
      const caller = createAuthedCaller();
      const conn = makeMockConnection();
      rlsDb.vendorConnection.findMany.mockResolvedValue([conn]);

      await caller.listConnections({});

      // Verify select does not include credentials
      expect(rlsDb.vendorConnection.findMany).toHaveBeenCalledWith(
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
      const caller = createAuthedCaller();

      // DPA accepted
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });

      // No existing connection
      rlsDb.vendorConnection.findFirst.mockResolvedValue(null);

      const created = {
        id: VALID_CUID,
        vendorType: 'PAX8',
        status: 'PENDING',
      };
      rlsDb.vendorConnection.create.mockResolvedValue(created);

      const result = await caller.connect({
        vendorType: 'PAX8',
        credentials: 'my-api-key',
        idempotencyKey: VALID_UUID,
      });

      expect(result.vendorConnection).toEqual(created);
      expect(mockEncrypt).toHaveBeenCalledWith('my-api-key');
      expect(rlsDb.vendorConnection.create).toHaveBeenCalledWith(
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
      const caller = createAuthedCaller();

      // No DPA record
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue(null);

      await expect(
        caller.connect({
          vendorType: 'PAX8',
          credentials: 'my-api-key',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();

      // Verify no connection was created
      expect(rlsDb.vendorConnection.create).not.toHaveBeenCalled();
    });

    it('throws CONFLICT when an active connection of same type exists', async () => {
      const caller = createAuthedCaller();

      // DPA accepted
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });

      // Existing active connection
      rlsDb.vendorConnection.findFirst.mockResolvedValue(
        makeMockConnection({ status: 'ACTIVE' }),
      );

      await expect(
        caller.connect({
          vendorType: 'PAX8',
          credentials: 'my-api-key',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/already exists/);

      expect(rlsDb.vendorConnection.create).not.toHaveBeenCalled();
    });

    it('allows reconnecting when existing connection is DISCONNECTED', async () => {
      const caller = createAuthedCaller();

      // DPA accepted
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });

      // Existing DISCONNECTED connection — should not block
      rlsDb.vendorConnection.findFirst.mockResolvedValue(
        makeMockConnection({ status: 'DISCONNECTED' }),
      );

      const created = {
        id: VALID_CUID_2,
        vendorType: 'PAX8',
        status: 'PENDING',
      };
      rlsDb.vendorConnection.create.mockResolvedValue(created);

      const result = await caller.connect({
        vendorType: 'PAX8',
        credentials: 'new-api-key',
        idempotencyKey: VALID_UUID,
      });

      expect(result.vendorConnection).toEqual(created);
    });
  });

  // ─────────────────────────────────────
  //  disconnect
  // ─────────────────────────────────────
  describe('disconnect', () => {
    it('disconnects an existing vendor connection (happy path)', async () => {
      const caller = createAuthedCaller();

      const existing = makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' });
      rlsDb.vendorConnection.findFirst.mockResolvedValue(existing);

      const updated = { id: VALID_CUID, status: 'DISCONNECTED' };
      rlsDb.vendorConnection.update.mockResolvedValue(updated);

      const result = await caller.disconnect({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.vendorConnection).toEqual(updated);
      expect(rlsDb.vendorConnection.update).toHaveBeenCalledWith(
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
      const caller = createAuthedCaller();

      rlsDb.vendorConnection.findFirst.mockResolvedValue(null);

      await expect(
        caller.disconnect({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/not found/i);

      expect(rlsDb.vendorConnection.update).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────
  //  syncCatalog
  // ─────────────────────────────────────
  describe('syncCatalog', () => {
    it('enqueues a catalog sync (happy path)', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');

      const connection = makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' });
      rlsDb.vendorConnection.findFirst.mockResolvedValue(connection);

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
      const caller = createAuthedCaller('ORG_ADMIN');

      rlsDb.vendorConnection.findFirst.mockResolvedValue(null);

      await expect(
        caller.syncCatalog({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/not found/i);

      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it('throws PRECONDITION_FAILED when connection is DISCONNECTED', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');

      const connection = makeMockConnection({ id: VALID_CUID, status: 'DISCONNECTED' });
      rlsDb.vendorConnection.findFirst.mockResolvedValue(connection);

      await expect(
        caller.syncCatalog({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/disconnected/i);

      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it('allows ORG_OWNER to sync catalog', async () => {
      const caller = createAuthedCaller('ORG_OWNER');

      const connection = makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' });
      rlsDb.vendorConnection.findFirst.mockResolvedValue(connection);

      const result = await caller.syncCatalog({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.status).toBe('ENQUEUED');
    });
  });
});
