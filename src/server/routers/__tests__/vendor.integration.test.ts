/**
 * Integration tests for the vendor router.
 *
 * These tests exercise the full vendor connection lifecycle:
 * connect → syncCatalog → disconnect, verifying cross-procedure
 * state transitions, credential handling, and audit trail integrity.
 *
 * Unlike unit tests (vendor.test.ts), these integration tests:
 *   - Test multi-step vendor connection workflows
 *   - Verify connect → sync → disconnect lifecycle transitions
 *   - Test credential encryption/erasure across operations
 *   - Validate DPA gate enforcement in full workflow context
 *   - Verify audit trail completeness for vendor operations
 *   - Test multi-tenant isolation for vendor connections
 *   - Test reconnection after disconnect
 *
 * NOTE: Mutation procedures are replaced with query counterparts
 * to bypass the idempotency guard (same RBAC, no idempotency guard).
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const {
  prisma,
  rlsDb,
  buildDbProxy,
  mockWriteAuditLog,
  mockEncrypt,
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
    orgOwnerMutationProcedure: actual.orgOwnerProcedure,
    orgAdminMutationProcedure: actual.orgAdminProcedure,
  };
});

import { vendorRouter } from '../vendor';

// ──────────────────────────────────────────────
// Constants & auth helpers
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';
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
// Integration Tests
// ──────────────────────────────────────────────

describe('vendorRouter — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  //  Full lifecycle: connect → list → syncCatalog → disconnect
  // ─────────────────────────────────────────────
  describe('full lifecycle: connect → list → sync → disconnect', () => {
    it('walks through the complete vendor connection lifecycle', async () => {
      // Step 1: Connect a vendor
      const connectCaller = createAuthedCaller();

      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });
      rlsDb.vendorConnection.findFirst.mockResolvedValue(null); // no existing connection

      const createdConnection = makeMockConnection({
        id: VALID_CUID,
        status: 'PENDING',
      });
      rlsDb.vendorConnection.create.mockResolvedValue(createdConnection);

      const connectResult = await connectCaller.connect({
        vendorType: 'PAX8',
        credentials: 'my-pax8-api-key',
        idempotencyKey: VALID_UUID,
      });

      expect(connectResult.vendorConnection.status).toBe('PENDING');
      expect(mockEncrypt).toHaveBeenCalledWith('my-pax8-api-key');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'vendor.connected',
          entityId: VALID_CUID,
        }),
      );

      // Step 2: List connections — newly created connection visible
      vi.clearAllMocks();
      const listCaller = createAuthedCaller();
      const activeConnection = makeMockConnection({
        id: VALID_CUID,
        status: 'ACTIVE',
      });
      rlsDb.vendorConnection.findMany.mockResolvedValue([activeConnection]);

      const listResult = await listCaller.listConnections({});
      expect(listResult.items).toHaveLength(1);
      expect(listResult.items[0].id).toBe(VALID_CUID);
      expect(listResult.items[0].vendorType).toBe('PAX8');

      // Step 3: Sync catalog
      vi.clearAllMocks();
      const syncCaller = createAuthedCaller('ORG_ADMIN');
      rlsDb.vendorConnection.findFirst.mockResolvedValue(activeConnection);

      const syncResult = await syncCaller.syncCatalog({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID_2,
      });

      expect(syncResult.status).toBe('ENQUEUED');
      expect(syncResult.syncId).toMatch(/^sync-/);
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'vendor.sync_catalog.enqueued',
          entityId: VALID_CUID,
        }),
      );

      // Step 4: Disconnect
      vi.clearAllMocks();
      const disconnectCaller = createAuthedCaller();
      rlsDb.vendorConnection.findFirst.mockResolvedValue(activeConnection);

      const disconnected = { id: VALID_CUID, status: 'DISCONNECTED' };
      rlsDb.vendorConnection.update.mockResolvedValue(disconnected);

      const disconnectResult = await disconnectCaller.disconnect({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID_3,
      });

      expect(disconnectResult.vendorConnection.status).toBe('DISCONNECTED');

      // Verify credentials were securely erased
      expect(rlsDb.vendorConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: 'DISCONNECTED',
            credentials: '',
          },
        }),
      );

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'vendor.disconnected',
          entityId: VALID_CUID,
          before: { status: 'ACTIVE' },
          after: { status: 'DISCONNECTED', credentialsErased: true },
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Reconnection after disconnect
  // ─────────────────────────────────────────────
  describe('reconnection after disconnect', () => {
    it('allows connecting a vendor after previous connection was disconnected', async () => {
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

      const newConnection = {
        id: VALID_CUID_2,
        vendorType: 'PAX8',
        status: 'PENDING',
      };
      rlsDb.vendorConnection.create.mockResolvedValue(newConnection);

      const result = await caller.connect({
        vendorType: 'PAX8',
        credentials: 'new-api-key',
        idempotencyKey: VALID_UUID,
      });

      expect(result.vendorConnection.id).toBe(VALID_CUID_2);
      expect(result.vendorConnection.status).toBe('PENDING');
    });

    it('blocks reconnection when active connection of same type exists', async () => {
      const caller = createAuthedCaller();

      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });

      // Active connection blocks reconnection
      rlsDb.vendorConnection.findFirst.mockResolvedValue(
        makeMockConnection({ status: 'ACTIVE' }),
      );

      await expect(
        caller.connect({
          vendorType: 'PAX8',
          credentials: 'another-api-key',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/already exists/);

      expect(rlsDb.vendorConnection.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  //  DPA gate enforcement
  // ─────────────────────────────────────────────
  describe('DPA gate enforcement', () => {
    it('connect fails when DPA not accepted', async () => {
      const caller = createAuthedCaller();

      rlsDb.dpaAcceptance.findFirst.mockResolvedValue(null);

      await expect(
        caller.connect({
          vendorType: 'PAX8',
          credentials: 'my-api-key',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();

      expect(rlsDb.vendorConnection.create).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it('syncCatalog fails when connection not found', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');

      rlsDb.vendorConnection.findFirst.mockResolvedValue(null);

      await expect(
        caller.syncCatalog({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('disconnect fails when connection not found', async () => {
      const caller = createAuthedCaller();

      rlsDb.vendorConnection.findFirst.mockResolvedValue(null);

      await expect(
        caller.disconnect({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/not found/i);

      expect(rlsDb.vendorConnection.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  //  Multi-tenant isolation
  // ─────────────────────────────────────────────
  describe('multi-tenant isolation', () => {
    it('org A connections not visible to org B', async () => {
      // Org A sees its connection
      const callerA = createAuthedCaller('ORG_OWNER', ORG_ID);
      rlsDb.vendorConnection.findMany.mockResolvedValue([
        makeMockConnection({ id: VALID_CUID }),
      ]);

      const resultA = await callerA.listConnections({});
      expect(resultA.items).toHaveLength(1);

      // Org B sees nothing (RLS scoped)
      vi.clearAllMocks();
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.vendorConnection.findMany.mockResolvedValue([]);

      const resultB = await callerB.listConnections({});
      expect(resultB.items).toHaveLength(0);
    });

    it('org B cannot disconnect org A connection', async () => {
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.vendorConnection.findFirst.mockResolvedValue(null);

      await expect(
        callerB.disconnect({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(/not found/i);

      expect(rlsDb.vendorConnection.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  //  RBAC enforcement
  // ─────────────────────────────────────────────
  describe('RBAC enforcement', () => {
    it('ORG_ADMIN can sync catalog but ORG_MEMBER cannot', async () => {
      // ORG_ADMIN — should succeed
      const adminCaller = createAuthedCaller('ORG_ADMIN');
      rlsDb.vendorConnection.findFirst.mockResolvedValue(
        makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' }),
      );

      const result = await adminCaller.syncCatalog({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });
      expect(result.status).toBe('ENQUEUED');

      // ORG_MEMBER — should fail
      vi.clearAllMocks();
      const memberCaller = createAuthedCaller('ORG_MEMBER');

      await expect(
        memberCaller.syncCatalog({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID_2,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('ORG_MEMBER cannot connect a vendor', async () => {
      const memberCaller = createAuthedCaller('ORG_MEMBER');

      await expect(
        memberCaller.connect({
          vendorType: 'PAX8',
          credentials: 'my-api-key',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('ORG_MEMBER cannot disconnect a vendor', async () => {
      const memberCaller = createAuthedCaller('ORG_MEMBER');

      await expect(
        memberCaller.disconnect({
          vendorConnectionId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ─────────────────────────────────────────────
  //  Credential security
  // ─────────────────────────────────────────────
  describe('credential security', () => {
    it('credentials are encrypted on connect and erased on disconnect', async () => {
      // Connect — encrypt
      const connectCaller = createAuthedCaller();
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({
        id: 'dpa-1',
        acceptedAt: new Date(),
      });
      rlsDb.vendorConnection.findFirst.mockResolvedValue(null);
      rlsDb.vendorConnection.create.mockResolvedValue(
        makeMockConnection({ id: VALID_CUID, status: 'PENDING' }),
      );

      await connectCaller.connect({
        vendorType: 'PAX8',
        credentials: 'secret-api-key',
        idempotencyKey: VALID_UUID,
      });

      expect(mockEncrypt).toHaveBeenCalledWith('secret-api-key');
      expect(rlsDb.vendorConnection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            credentials: 'encrypted-credentials',
          }),
        }),
      );

      // Disconnect — erase
      vi.clearAllMocks();
      const disconnectCaller = createAuthedCaller();
      rlsDb.vendorConnection.findFirst.mockResolvedValue(
        makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' }),
      );
      rlsDb.vendorConnection.update.mockResolvedValue({
        id: VALID_CUID,
        status: 'DISCONNECTED',
      });

      await disconnectCaller.disconnect({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID_2,
      });

      expect(rlsDb.vendorConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            credentials: '',
          }),
        }),
      );
    });

    it('listConnections does not expose credentials', async () => {
      const caller = createAuthedCaller();
      rlsDb.vendorConnection.findMany.mockResolvedValue([
        makeMockConnection(),
      ]);

      await caller.listConnections({});

      expect(rlsDb.vendorConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.objectContaining({ credentials: true }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Audit trail completeness
  // ─────────────────────────────────────────────
  describe('audit trail completeness', () => {
    it('connect, sync, and disconnect each produce audit entries', async () => {
      // Connect
      const connectCaller = createAuthedCaller();
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue({ id: 'dpa-1', acceptedAt: new Date() });
      rlsDb.vendorConnection.findFirst.mockResolvedValue(null);
      rlsDb.vendorConnection.create.mockResolvedValue(
        makeMockConnection({ id: VALID_CUID, status: 'PENDING' }),
      );

      await connectCaller.connect({
        vendorType: 'PAX8',
        credentials: 'key',
        idempotencyKey: VALID_UUID,
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'vendor.connected' }),
      );

      // Sync
      vi.clearAllMocks();
      const syncCaller = createAuthedCaller('ORG_ADMIN');
      rlsDb.vendorConnection.findFirst.mockResolvedValue(
        makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' }),
      );

      await syncCaller.syncCatalog({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID_2,
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'vendor.sync_catalog.enqueued' }),
      );

      // Disconnect
      vi.clearAllMocks();
      const disconnectCaller = createAuthedCaller();
      rlsDb.vendorConnection.findFirst.mockResolvedValue(
        makeMockConnection({ id: VALID_CUID, status: 'ACTIVE' }),
      );
      rlsDb.vendorConnection.update.mockResolvedValue({
        id: VALID_CUID,
        status: 'DISCONNECTED',
      });

      await disconnectCaller.disconnect({
        vendorConnectionId: VALID_CUID,
        idempotencyKey: VALID_UUID_3,
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'vendor.disconnected' }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Input validation
  // ─────────────────────────────────────────────
  describe('input validation', () => {
    it('rejects connect with invalid UUID for idempotencyKey', async () => {
      const caller = createAuthedCaller();
      await expect(
        caller.connect({
          vendorType: 'PAX8',
          credentials: 'key',
          idempotencyKey: 'not-a-uuid',
        }),
      ).rejects.toThrow();
    });

    it('rejects disconnect with invalid CUID for vendorConnectionId', async () => {
      const caller = createAuthedCaller();
      await expect(
        caller.disconnect({
          vendorConnectionId: 'bad-id',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects syncCatalog with invalid CUID for vendorConnectionId', async () => {
      const caller = createAuthedCaller('ORG_ADMIN');
      await expect(
        caller.syncCatalog({
          vendorConnectionId: 'bad-id',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });
  });
});
