/**
 * Unit tests for the organization router.
 *
 * The organization router exposes eight procedures:
 *   - get           (orgMemberProcedure — any org member)
 *   - update        (orgOwnerMutationProcedure — ORG_OWNER only, idempotency-guarded)
 *   - listClients   (mspTechProcedure — MSP_TECHNICIAN+)
 *   - createClient  (mspAdminMutationProcedure — MSP_ADMIN+, idempotency-guarded)
 *   - switchOrg     (authenticatedMutationProcedure — any authenticated user, idempotency-guarded)
 *   - acceptDpa     (orgOwnerMutationProcedure — ORG_OWNER only, idempotency-guarded)
 *   - getDpaStatus  (orgMemberProcedure — any org member)
 *   - deactivate    (orgOwnerMutationProcedure — ORG_OWNER only, idempotency-guarded)
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const { prisma, rlsDb, buildDbProxy, mockWriteAuditLog, mockRedis } = vi.hoisted(() => {
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

  const mockWriteAuditLog = vi.fn().mockResolvedValue(undefined);

  const mockRedis = {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  };

  // `rlsDb` is the stable proxy that createRLSProxy always returns.
  // The organization router reads from ctx.db, which the isAuthenticated
  // middleware replaces with the return value of createRLSProxy.
  return { prisma: buildDbProxy(), rlsDb: buildDbProxy(), buildDbProxy, mockWriteAuditLog, mockRedis };
});

vi.mock('@/lib/db', () => ({ prisma }));

vi.mock('@/lib/audit', () => ({
  writeAuditLog: mockWriteAuditLog,
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
    mspAdminMutationProcedure: actual.mspAdminProcedure,
    authenticatedMutationProcedure: actual.authenticatedProcedure,
  };
});

import { organizationRouter } from '../organization';

// ──────────────────────────────────────────────
// Constants & auth helpers
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const SESSION_TOKEN = 'test-session-token';
const USER_ID = 'test-user-id';
const ORG_ID = 'test-org-id';

function createAuthHeaders() {
  const headers = new Headers();
  headers.set('cookie', `better-auth.session_token=${SESSION_TOKEN}`);
  return headers;
}

function mockAuth(orgRole: string = 'ORG_OWNER', mspRole: string | null = null) {
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
    mspRole,
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
    resHeaders: null,
    ...overrides,
  };
}

function createAuthedCaller(orgRole: string = 'ORG_OWNER', mspRole: string | null = null) {
  mockAuth(orgRole, mspRole);
  const ctx = createTestContext({
    headers: createAuthHeaders(),
    effectiveRole: {
      platformRole: null,
      mspRole,
      orgRole,
    },
  });
  return organizationRouter.createCaller(ctx);
}

// ──────────────────────────────────────────────
// Mock data factories
// ──────────────────────────────────────────────

function makeMockOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    name: 'Test Organization',
    slug: 'test-org',
    organizationType: 'DIRECT',
    parentOrganizationId: null,
    billingType: 'MANUAL_INVOICE',
    logo: null,
    metadata: {},
    provisioningEnabled: true,
    isContractSigned: false,
    deletedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeMockClientOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    name: 'Client Org',
    slug: 'client-org',
    organizationType: 'CLIENT',
    parentOrganizationId: ORG_ID,
    billingType: 'MANUAL_INVOICE',
    logo: null,
    metadata: {},
    provisioningEnabled: false,
    isContractSigned: false,
    deletedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('organizationRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────
  //  get
  // ─────────────────────────────────────
  describe('get', () => {
    it('returns organization details for a valid org member', async () => {
      const mockOrg = makeMockOrg();
      rlsDb.organization.findUnique.mockResolvedValue(mockOrg);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.get({});

      expect(result).toEqual(mockOrg);
      expect(rlsDb.organization.findUnique).toHaveBeenCalledWith({
        where: { id: ORG_ID },
      });
    });

    it('throws NOT_FOUND when organization does not exist', async () => {
      rlsDb.organization.findUnique.mockResolvedValue(null);

      const caller = createAuthedCaller('ORG_OWNER');
      await expect(caller.get({})).rejects.toThrow('Organization not found');
    });
  });

  // ─────────────────────────────────────
  //  update
  // ─────────────────────────────────────
  describe('update', () => {
    it('updates organization and writes audit log', async () => {
      const existingOrg = makeMockOrg();
      const updatedOrg = makeMockOrg({ name: 'Updated Name' });

      // First call: find existing org; second call: after update
      rlsDb.organization.findUnique.mockResolvedValue(existingOrg);
      rlsDb.organization.update.mockResolvedValue(updatedOrg);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.update({
        name: 'Updated Name',
        idempotencyKey: VALID_UUID,
      });

      expect(result.organization).toEqual(updatedOrg);
      expect(rlsDb.organization.update).toHaveBeenCalledWith({
        where: { id: ORG_ID },
        data: { name: 'Updated Name' },
      });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'organization.updated',
          entityId: ORG_ID,
          before: expect.objectContaining({ name: 'Test Organization' }),
          after: expect.objectContaining({ name: 'Updated Name' }),
        }),
      );
    });

    it('throws NOT_FOUND when organization does not exist for update', async () => {
      rlsDb.organization.findUnique.mockResolvedValue(null);

      const caller = createAuthedCaller('ORG_OWNER');
      await expect(
        caller.update({ name: 'Foo', idempotencyKey: VALID_UUID }),
      ).rejects.toThrow('Organization not found');
    });

    it('updates metadata when provided', async () => {
      const existingOrg = makeMockOrg();
      const updatedOrg = makeMockOrg({ metadata: { key: 'value' } });

      rlsDb.organization.findUnique.mockResolvedValue(existingOrg);
      rlsDb.organization.update.mockResolvedValue(updatedOrg);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.update({
        metadata: { key: 'value' },
        idempotencyKey: VALID_UUID,
      });

      expect(result.organization.metadata).toEqual({ key: 'value' });
      expect(rlsDb.organization.update).toHaveBeenCalledWith({
        where: { id: ORG_ID },
        data: { metadata: { key: 'value' } },
      });
    });
  });

  // ─────────────────────────────────────
  //  listClients
  // ─────────────────────────────────────
  describe('listClients', () => {
    it('returns client organizations for an MSP org', async () => {
      const mspOrg = makeMockOrg({ organizationType: 'MSP' });
      const clients = [
        makeMockClientOrg({ id: 'clh1234567890abcdefghij10', name: 'Client A', slug: 'client-a' }),
        makeMockClientOrg({ id: 'clh1234567890abcdefghij11', name: 'Client B', slug: 'client-b' }),
      ];

      prisma.organization.findUnique.mockResolvedValue(mspOrg);
      prisma.organization.findMany.mockResolvedValue(clients);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.listClients({ limit: 25 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(prisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            parentOrganizationId: ORG_ID,
            deletedAt: null,
          },
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('throws error when organization is not an MSP', async () => {
      const directOrg = makeMockOrg({ organizationType: 'DIRECT' });
      prisma.organization.findUnique.mockResolvedValue(directOrg);

      const caller = createAuthedCaller('ORG_OWNER');
      await expect(caller.listClients({ limit: 25 })).rejects.toThrow(
        'This action is only available for MSP organizations',
      );
    });

    it('handles pagination with cursor', async () => {
      const mspOrg = makeMockOrg({ organizationType: 'MSP' });
      // Return limit + 1 items to indicate there are more
      const clients = Array.from({ length: 3 }, (_, i) =>
        makeMockClientOrg({
          id: `clh1234567890abcdefghij${String(i).padStart(2, '0')}`,
          name: `Client ${i}`,
          slug: `client-${i}`,
        }),
      );

      prisma.organization.findUnique.mockResolvedValue(mspOrg);
      prisma.organization.findMany.mockResolvedValue(clients);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.listClients({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('clh1234567890abcdefghij01');
    });
  });

  // ─────────────────────────────────────
  //  createClient
  // ─────────────────────────────────────
  describe('createClient', () => {
    it('creates a client organization for an MSP org', async () => {
      const mspOrg = makeMockOrg({ organizationType: 'MSP' });
      const newClient = makeMockClientOrg();

      prisma.organization.findUnique
        .mockResolvedValueOnce(mspOrg)       // MSP check
        .mockResolvedValueOnce(null);        // slug uniqueness check
      prisma.organization.create.mockResolvedValue(newClient);

      const caller = createAuthedCaller('MSP_ADMIN', 'MSP_ADMIN');
      const result = await caller.createClient({
        name: 'Client Org',
        slug: 'client-org',
        idempotencyKey: VALID_UUID,
      });

      expect(result.organization).toEqual(newClient);
      expect(prisma.organization.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Client Org',
          slug: 'client-org',
          organizationType: 'CLIENT',
          parentOrganizationId: ORG_ID,
          billingType: 'MANUAL_INVOICE',
        }),
      });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'organization.client_created',
          after: expect.objectContaining({ name: 'Client Org', slug: 'client-org' }),
        }),
      );
    });

    it('throws error when organization is not an MSP', async () => {
      const directOrg = makeMockOrg({ organizationType: 'DIRECT' });
      prisma.organization.findUnique.mockResolvedValue(directOrg);

      const caller = createAuthedCaller('MSP_ADMIN', 'MSP_ADMIN');
      await expect(
        caller.createClient({
          name: 'Client Org',
          slug: 'client-org',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow('Only MSP organizations can create client organizations');
    });

    it('throws CONFLICT when slug already exists', async () => {
      const mspOrg = makeMockOrg({ organizationType: 'MSP' });
      const existingOrg = makeMockOrg({ slug: 'taken-slug' });

      prisma.organization.findUnique
        .mockResolvedValueOnce(mspOrg)         // MSP check
        .mockResolvedValueOnce(existingOrg);   // slug uniqueness — exists!

      const caller = createAuthedCaller('MSP_ADMIN', 'MSP_ADMIN');
      await expect(
        caller.createClient({
          name: 'New Client',
          slug: 'taken-slug',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow('An organization with this slug already exists');
    });
  });

  // ─────────────────────────────────────
  //  switchOrg
  // ─────────────────────────────────────
  describe('switchOrg', () => {
    const TARGET_ORG_ID = VALID_CUID; // different from ORG_ID

    function makeTargetOrg(overrides: Record<string, unknown> = {}) {
      return {
        id: TARGET_ORG_ID,
        name: 'Target Organization',
        slug: 'target-org',
        organizationType: 'DIRECT',
        deletedAt: null,
        parentOrganizationId: null,
        ...overrides,
      };
    }

    it('switches to a valid org as a direct member', async () => {
      const targetOrg = makeTargetOrg();

      // mockAuth sets session + member for auth middleware.
      // prisma.member.findUnique returns a member for ALL calls
      // (auth middleware and switchOrg direct member check).
      mockAuth('ORG_OWNER');
      prisma.organization.findUnique.mockResolvedValue(targetOrg);
      prisma.session.update.mockResolvedValue({});

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.switchOrg({
        organizationId: TARGET_ORG_ID,
        idempotencyKey: VALID_UUID,
      });

      expect(result).toEqual({
        organization: {
          id: TARGET_ORG_ID,
          name: 'Target Organization',
          slug: 'target-org',
          organizationType: 'DIRECT',
        },
      });

      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: TARGET_ORG_ID },
        select: {
          id: true,
          name: true,
          slug: true,
          organizationType: true,
          deletedAt: true,
          parentOrganizationId: true,
        },
      });

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { token: SESSION_TOKEN },
        data: { activeOrganizationId: TARGET_ORG_ID },
      });
    });

    it('allows platform admin (SUPER_ADMIN) to switch without direct membership', async () => {
      const targetOrg = makeTargetOrg();

      // Platform admin session — user.platformRole drives isPlatformAdmin check
      prisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        token: SESSION_TOKEN,
        userId: USER_ID,
        expiresAt: new Date(Date.now() + 3_600_000),
        activeOrganizationId: ORG_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: USER_ID, platformRole: 'SUPER_ADMIN' },
      });

      // No direct membership; middleware won't throw because platformRole is set
      prisma.member.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(targetOrg);
      prisma.session.update.mockResolvedValue({});

      const caller = organizationRouter.createCaller(
        createTestContext({
          headers: createAuthHeaders(),
          effectiveRole: { platformRole: 'SUPER_ADMIN', mspRole: null, orgRole: null },
        }),
      );

      const result = await caller.switchOrg({
        organizationId: TARGET_ORG_ID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.organization.id).toBe(TARGET_ORG_ID);

      // Only the auth middleware checks membership; switchOrg skips it for platform admins
      expect(prisma.member.findUnique).toHaveBeenCalledTimes(1);
    });

    it('allows switching via MSP delegation when user is member of parent org', async () => {
      const MSP_ORG_ID = 'clhmsp_parent_org_000000000';
      const targetOrg = makeTargetOrg({
        organizationType: 'CLIENT',
        parentOrganizationId: MSP_ORG_ID,
      });

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

      // Ordering matters: auth middleware → switchOrg direct check → switchOrg MSP check
      prisma.member.findUnique
        .mockResolvedValueOnce({
          id: 'member-1',
          organizationId: ORG_ID,
          userId: USER_ID,
          orgRole: 'ORG_OWNER',
          mspRole: 'MSP_ADMIN',
        })
        .mockResolvedValueOnce(null) // no direct membership in target
        .mockResolvedValueOnce({
          id: 'msp-member-1',
          organizationId: MSP_ORG_ID,
          userId: USER_ID,
          orgRole: 'ORG_OWNER',
          mspRole: 'MSP_TECHNICIAN',
        });

      prisma.organization.findUnique.mockResolvedValue(targetOrg);
      prisma.session.update.mockResolvedValue({});

      const caller = organizationRouter.createCaller(
        createTestContext({
          headers: createAuthHeaders(),
          effectiveRole: { platformRole: null, mspRole: 'MSP_ADMIN', orgRole: 'ORG_OWNER' },
        }),
      );

      const result = await caller.switchOrg({
        organizationId: TARGET_ORG_ID,
        idempotencyKey: VALID_UUID,
      });

      expect(result.organization.id).toBe(TARGET_ORG_ID);
      expect(result.organization.organizationType).toBe('CLIENT');

      // MSP delegation: 1 (middleware) + 1 (direct, null) + 1 (parent MSP member)
      expect(prisma.member.findUnique).toHaveBeenCalledTimes(3);
    });

    it('throws NOT_FOUND when target org does not exist', async () => {
      mockAuth('ORG_OWNER');
      prisma.organization.findUnique.mockResolvedValue(null);

      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.switchOrg({
          organizationId: TARGET_ORG_ID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow('Organization not found');
    });

    it('throws NOT_FOUND when target org is soft-deleted', async () => {
      const deletedOrg = makeTargetOrg({ deletedAt: new Date('2024-12-01') });

      mockAuth('ORG_OWNER');
      prisma.organization.findUnique.mockResolvedValue(deletedOrg);

      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.switchOrg({
          organizationId: TARGET_ORG_ID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow('Organization not found');
    });

    it('throws FORBIDDEN when user has no access to target org', async () => {
      // Target has no parent → no MSP delegation possible
      const targetOrg = makeTargetOrg();

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

      // Auth middleware succeeds; switchOrg direct member check fails
      prisma.member.findUnique
        .mockResolvedValueOnce({
          id: 'member-1',
          organizationId: ORG_ID,
          userId: USER_ID,
          orgRole: 'ORG_OWNER',
          mspRole: null,
        })
        .mockResolvedValueOnce(null);

      prisma.organization.findUnique.mockResolvedValue(targetOrg);

      const caller = organizationRouter.createCaller(
        createTestContext({
          headers: createAuthHeaders(),
          effectiveRole: { platformRole: null, mspRole: null, orgRole: 'ORG_OWNER' },
        }),
      );

      await expect(
        caller.switchOrg({
          organizationId: TARGET_ORG_ID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow('You do not have permission to perform this action');
    });

    it('writes audit log with organization.switched action', async () => {
      const targetOrg = makeTargetOrg();

      mockAuth('ORG_OWNER');
      prisma.organization.findUnique.mockResolvedValue(targetOrg);
      prisma.session.update.mockResolvedValue({});

      const caller = createAuthedCaller('ORG_OWNER');
      await caller.switchOrg({
        organizationId: TARGET_ORG_ID,
        idempotencyKey: VALID_UUID,
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'organization.switched',
          organizationId: TARGET_ORG_ID,
          userId: USER_ID,
          entityId: TARGET_ORG_ID,
          before: expect.objectContaining({ activeOrganizationId: ORG_ID }),
          after: expect.objectContaining({ activeOrganizationId: TARGET_ORG_ID }),
        }),
      );
    });
  });

  // ─────────────────────────────────────
  //  acceptDpa
  // ─────────────────────────────────────
  describe('acceptDpa', () => {
    const DPA_VERSION = '2024-01';

    const mockDpaAcceptance = {
      id: VALID_CUID,
      version: DPA_VERSION,
      acceptedAt: new Date('2024-06-15'),
      acceptedByUserId: USER_ID,
    };

    it('creates a new DPA acceptance and writes audit log', async () => {
      rlsDb.dpaAcceptance.findUnique.mockResolvedValue(null);
      rlsDb.dpaAcceptance.create.mockResolvedValue(mockDpaAcceptance);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.acceptDpa({
        version: DPA_VERSION,
        idempotencyKey: VALID_UUID,
      });

      expect(result).toEqual({
        dpaAcceptance: {
          id: VALID_CUID,
          version: DPA_VERSION,
          acceptedAt: mockDpaAcceptance.acceptedAt,
          userId: USER_ID,
        },
      });

      expect(rlsDb.dpaAcceptance.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG_ID,
          acceptedByUserId: USER_ID,
          version: DPA_VERSION,
        },
        select: {
          id: true,
          version: true,
          acceptedAt: true,
          acceptedByUserId: true,
        },
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'organization.dpa_accepted',
          organizationId: ORG_ID,
          userId: USER_ID,
          entityId: VALID_CUID,
          after: expect.objectContaining({
            version: DPA_VERSION,
            acceptedAt: mockDpaAcceptance.acceptedAt,
          }),
        }),
      );
    });

    it('returns existing DPA acceptance when already accepted (idempotent)', async () => {
      rlsDb.dpaAcceptance.findUnique.mockResolvedValue(mockDpaAcceptance);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.acceptDpa({
        version: DPA_VERSION,
        idempotencyKey: VALID_UUID,
      });

      expect(result).toEqual({
        dpaAcceptance: {
          id: VALID_CUID,
          version: DPA_VERSION,
          acceptedAt: mockDpaAcceptance.acceptedAt,
          userId: USER_ID,
        },
      });

      expect(rlsDb.dpaAcceptance.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_version: {
            organizationId: ORG_ID,
            version: DPA_VERSION,
          },
        },
        select: {
          id: true,
          version: true,
          acceptedAt: true,
          acceptedByUserId: true,
        },
      });

      // No create or audit log when returning cached acceptance
      expect(rlsDb.dpaAcceptance.create).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it('returns correct shape with id, version, acceptedAt, and userId', async () => {
      const specificAcceptance = {
        id: 'clhspecific_dpa_id_00000000',
        version: '2025-03',
        acceptedAt: new Date('2025-03-01T12:00:00Z'),
        acceptedByUserId: USER_ID,
      };

      rlsDb.dpaAcceptance.findUnique.mockResolvedValue(null);
      rlsDb.dpaAcceptance.create.mockResolvedValue(specificAcceptance);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.acceptDpa({
        version: '2025-03',
        idempotencyKey: VALID_UUID,
      });

      // Verify all properties exist with correct types
      expect(result.dpaAcceptance).toEqual({
        id: expect.any(String),
        version: '2025-03',
        acceptedAt: expect.any(Date),
        userId: expect.any(String),
      });
    });
  });

  // ─────────────────────────────────────
  //  getDpaStatus
  // ─────────────────────────────────────
  describe('getDpaStatus', () => {
    it('returns accepted: false when no DPA record exists', async () => {
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue(null);

      const caller = createAuthedCaller('ORG_MEMBER');
      const result = await caller.getDpaStatus({});

      expect(result).toEqual({
        accepted: false,
        requiredVersion: '1.0',
        acceptedVersion: null,
        isOutdated: true,
        acceptedAt: null,
        acceptedBy: null,
      });
    });

    it('returns accepted: true with correct details when DPA exists', async () => {
      const acceptedAt = new Date('2024-06-15T10:00:00Z');
      const mockDpa = {
        version: '1.0',
        acceptedAt,
        acceptedBy: {
          id: USER_ID,
          name: 'Test User',
          email: 'test@example.com',
        },
      };

      rlsDb.dpaAcceptance.findFirst.mockResolvedValue(mockDpa);

      const caller = createAuthedCaller('ORG_MEMBER');
      const result = await caller.getDpaStatus({});

      expect(result).toEqual({
        accepted: true,
        requiredVersion: '1.0',
        acceptedVersion: '1.0',
        isOutdated: false,
        acceptedAt,
        acceptedBy: {
          id: USER_ID,
          name: 'Test User',
          email: 'test@example.com',
        },
      });
    });

    it('queries with correct parameters (where, orderBy, select)', async () => {
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue(null);

      const caller = createAuthedCaller('ORG_MEMBER');
      await caller.getDpaStatus({});

      expect(rlsDb.dpaAcceptance.findFirst).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID },
        orderBy: { acceptedAt: 'desc' },
        select: {
          version: true,
          acceptedAt: true,
          acceptedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    });

    it('works for ORG_OWNER role as well', async () => {
      rlsDb.dpaAcceptance.findFirst.mockResolvedValue(null);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.getDpaStatus({});

      expect(result.accepted).toBe(false);
    });
  });

  // ─────────────────────────────────────
  //  deactivate
  // ─────────────────────────────────────
  describe('deactivate', () => {
    function setupDeactivateMocks() {
      // $transaction is a top-level Prisma client method — not model-level,
      // so the Proxy doesn't create it automatically. Set it directly.
      prisma.$transaction = vi.fn().mockImplementation(
        async (fn: (tx: any) => Promise<unknown>) => {
          // Provide a mock tx with the same model proxy interface
          const txProxy = buildDbProxy();
          txProxy.subscription.updateMany.mockResolvedValue({ count: 0 });
          txProxy.invitation.updateMany.mockResolvedValue({ count: 0 });
          txProxy.vendorConnection.updateMany.mockResolvedValue({ count: 0 });
          txProxy.organization.update.mockResolvedValue({ id: ORG_ID, deletedAt: new Date() });
          txProxy.organization.updateMany.mockResolvedValue({ count: 0 });
          return fn(txProxy);
        },
      );
    }

    it('successfully soft-deletes an active organization', async () => {
      const activeOrg = makeMockOrg({ deletedAt: null });
      const now = new Date();

      rlsDb.organization.findUnique
        .mockResolvedValueOnce(activeOrg)   // first call: check org exists
        .mockResolvedValueOnce({ id: ORG_ID, deletedAt: now }); // second call: re-fetch after tx
      setupDeactivateMocks();

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.deactivate({ idempotencyKey: VALID_UUID });

      expect(result.organization.id).toBe(ORG_ID);
      expect(result.organization.deletedAt).toEqual(now);
    });

    it('throws NOT_FOUND when organization does not exist', async () => {
      rlsDb.organization.findUnique.mockResolvedValue(null);

      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.deactivate({ idempotencyKey: VALID_UUID }),
      ).rejects.toThrow('Organization not found');
    });

    it('throws CONFLICT when organization is already deactivated', async () => {
      const deactivatedOrg = makeMockOrg({ deletedAt: new Date('2024-12-01') });
      rlsDb.organization.findUnique.mockResolvedValue(deactivatedOrg);

      const caller = createAuthedCaller('ORG_OWNER');

      await expect(
        caller.deactivate({ idempotencyKey: VALID_UUID }),
      ).rejects.toThrow('Organization is already deactivated');
    });

    it('writes audit log on successful deactivation', async () => {
      const activeOrg = makeMockOrg({ deletedAt: null });

      rlsDb.organization.findUnique
        .mockResolvedValueOnce(activeOrg)
        .mockResolvedValueOnce({ id: ORG_ID, deletedAt: new Date() });
      setupDeactivateMocks();

      const caller = createAuthedCaller('ORG_OWNER');
      await caller.deactivate({ idempotencyKey: VALID_UUID });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'organization.deactivated',
          organizationId: ORG_ID,
          userId: USER_ID,
          entityId: ORG_ID,
          before: { deletedAt: null },
          after: { deletedAt: expect.any(Date) },
          traceId: 'test-trace-id',
        }),
      );
    });

    it('returns correct shape with id and deletedAt', async () => {
      const activeOrg = makeMockOrg({ deletedAt: null });
      const deactivatedAt = new Date('2025-01-15T08:30:00Z');

      rlsDb.organization.findUnique
        .mockResolvedValueOnce(activeOrg)
        .mockResolvedValueOnce({ id: ORG_ID, deletedAt: deactivatedAt });
      setupDeactivateMocks();

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.deactivate({ idempotencyKey: VALID_UUID });

      expect(result).toEqual({
        organization: {
          id: ORG_ID,
          deletedAt: deactivatedAt,
        },
      });
    });
  });
});
