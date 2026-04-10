/**
 * Unit tests for the organization router.
 *
 * The organization router exposes four procedures:
 *   - get           (orgMemberProcedure — any org member)
 *   - update        (orgOwnerMutationProcedure — ORG_OWNER only, idempotency-guarded)
 *   - listClients   (mspTechProcedure — MSP_TECHNICIAN+)
 *   - createClient  (mspAdminMutationProcedure — MSP_ADMIN+, idempotency-guarded)
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const { prisma, buildDbProxy, mockWriteAuditLog, mockRedis } = vi.hoisted(() => {
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

  return { prisma: buildDbProxy(), buildDbProxy, mockWriteAuditLog, mockRedis };
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
  createRLSProxy: vi.fn(() => buildDbProxy()),
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
      prisma.organization.findUnique.mockResolvedValue(mockOrg);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.get({});

      expect(result).toEqual(mockOrg);
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: ORG_ID },
      });
    });

    it('throws NOT_FOUND when organization does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

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
      prisma.organization.findUnique.mockResolvedValue(existingOrg);
      prisma.organization.update.mockResolvedValue(updatedOrg);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.update({
        name: 'Updated Name',
        idempotencyKey: VALID_UUID,
      });

      expect(result.organization).toEqual(updatedOrg);
      expect(prisma.organization.update).toHaveBeenCalledWith({
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
      prisma.organization.findUnique.mockResolvedValue(null);

      const caller = createAuthedCaller('ORG_OWNER');
      await expect(
        caller.update({ name: 'Foo', idempotencyKey: VALID_UUID }),
      ).rejects.toThrow('Organization not found');
    });

    it('updates metadata when provided', async () => {
      const existingOrg = makeMockOrg();
      const updatedOrg = makeMockOrg({ metadata: { key: 'value' } });

      prisma.organization.findUnique.mockResolvedValue(existingOrg);
      prisma.organization.update.mockResolvedValue(updatedOrg);

      const caller = createAuthedCaller('ORG_OWNER');
      const result = await caller.update({
        metadata: { key: 'value' },
        idempotencyKey: VALID_UUID,
      });

      expect(result.organization.metadata).toEqual({ key: 'value' });
      expect(prisma.organization.update).toHaveBeenCalledWith({
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
});
