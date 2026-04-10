/**
 * Unit tests for the admin router.
 *
 * The admin router exposes five procedures:
 *   - listMembers    (orgOwnerProcedure)
 *   - inviteMember   (orgOwnerMutationProcedure — idempotent)
 *   - updateRole     (orgOwnerMutationProcedure — idempotent)
 *   - removeMember   (orgOwnerMutationProcedure — idempotent)
 *   - listAuditLogs  (orgOwnerProcedure)
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers that are available to vi.mock
// factories. Both blocks are hoisted above all imports by vitest.
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

import { TRPCError } from '@trpc/server';
import { adminRouter } from '../admin';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const VALID_CUID = 'clh1234567890abcdefghij00';
const VALID_CUID_2 = 'clh1234567890abcdefghij01';
const VALID_CUID_3 = 'clh1234567890abcdefghij02';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';

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
  return { caller: adminRouter.createCaller(ctx), ctx };
}

// ──────────────────────────────────────────────
// Mock data factories
// ──────────────────────────────────────────────

function makeMockMember(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    userId: 'user-1',
    orgRole: 'ORG_MEMBER',
    mspRole: null,
    createdAt: new Date('2024-01-01'),
    user: { id: 'user-1', name: 'Jane Doe', email: 'jane@example.com' },
    ...overrides,
  };
}

function makeMockAuditLog(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID,
    action: 'admin.member_invited',
    entityId: VALID_CUID_2,
    userId: USER_ID,
    user: { name: 'Test User', email: 'test@example.com' },
    before: null,
    after: { email: 'jane@example.com' },
    traceId: 'trace-1',
    createdAt: new Date('2024-01-15'),
    ...overrides,
  };
}

function makeMockInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID_2,
    email: 'newuser@example.com',
    orgRole: 'ORG_MEMBER',
    mspRole: null,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date('2024-01-10'),
    inviterId: USER_ID,
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('adminRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset redis to return null (no cached idempotency)
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockWriteAuditLog.mockResolvedValue(undefined);
  });

  // ─────────────────────────────────────
  //  listMembers
  // ─────────────────────────────────────
  describe('listMembers', () => {
    it('returns members with user info', async () => {
      const { caller, ctx } = createAuthedCaller();
      const member = makeMockMember();
      ctx.db.member.findMany.mockResolvedValue([member]);

      const result = await caller.listMembers({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: member.id,
        user: member.user,
        orgRole: member.orgRole,
        mspRole: member.mspRole,
        createdAt: member.createdAt,
      });
      expect(result.nextCursor).toBeNull();
    });

    it('returns empty results when no members exist', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.member.findMany.mockResolvedValue([]);

      const result = await caller.listMembers({});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('paginates correctly when more results exist', async () => {
      const { caller, ctx } = createAuthedCaller();
      const limit = 2;
      // Return limit + 1 items to indicate there are more
      const members = [
        makeMockMember({ id: VALID_CUID }),
        makeMockMember({ id: VALID_CUID_2 }),
        makeMockMember({ id: VALID_CUID_3 }),
      ];
      ctx.db.member.findMany.mockResolvedValue(members);

      const result = await caller.listMembers({ limit });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe(VALID_CUID_2);
    });

    it('respects cursor parameter', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.member.findMany.mockResolvedValue([]);

      await caller.listMembers({ cursor: VALID_CUID, limit: 10 });

      expect(ctx.db.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: VALID_CUID },
          take: 11,
        }),
      );
    });

    it('uses default limit of 25', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.member.findMany.mockResolvedValue([]);

      await caller.listMembers({});

      expect(ctx.db.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 26, // 25 + 1
        }),
      );
    });
  });

  // ─────────────────────────────────────
  //  inviteMember
  // ─────────────────────────────────────
  describe('inviteMember', () => {
    it('creates invitation with orgRole', async () => {
      const { caller, ctx } = createAuthedCaller();
      const invitation = makeMockInvitation();

      prisma.user.findUnique.mockResolvedValue(null);
      ctx.db.invitation.findFirst.mockResolvedValue(null);
      ctx.db.invitation.create.mockResolvedValue(invitation);

      const result = await caller.inviteMember({
        email: 'newuser@example.com',
        orgRole: 'ORG_MEMBER',
        idempotencyKey: VALID_UUID,
      });

      expect(result.invitation.email).toBe('newuser@example.com');
      expect(result.invitation.orgRole).toBe('ORG_MEMBER');
      expect(result.invitation.status).toBe('PENDING');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.member_invited',
          entityId: invitation.id,
          after: expect.objectContaining({ email: 'newuser@example.com' }),
        }),
      );
    });

    it('creates invitation with mspRole', async () => {
      const { caller, ctx } = createAuthedCaller();
      const invitation = makeMockInvitation({ orgRole: null, mspRole: 'MSP_ADMIN' });

      prisma.user.findUnique.mockResolvedValue(null);
      ctx.db.invitation.findFirst.mockResolvedValue(null);
      ctx.db.invitation.create.mockResolvedValue(invitation);

      const result = await caller.inviteMember({
        email: 'newuser@example.com',
        mspRole: 'MSP_ADMIN',
        idempotencyKey: VALID_UUID,
      });

      expect(result.invitation.mspRole).toBe('MSP_ADMIN');
      expect(result.invitation.orgRole).toBeNull();
    });

    it('throws when user is already a member', async () => {
      const { caller, ctx } = createAuthedCaller();

      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user', email: 'existing@example.com' });
      ctx.db.member.findFirst.mockResolvedValue(makeMockMember());

      await expect(
        caller.inviteMember({
          email: 'existing@example.com',
          orgRole: 'ORG_MEMBER',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('throws when invitation is already pending', async () => {
      const { caller, ctx } = createAuthedCaller();

      prisma.user.findUnique.mockResolvedValue(null);
      ctx.db.invitation.findFirst.mockResolvedValue(makeMockInvitation());

      await expect(
        caller.inviteMember({
          email: 'newuser@example.com',
          orgRole: 'ORG_MEMBER',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('throws when neither orgRole nor mspRole is provided', async () => {
      const { caller } = createAuthedCaller();

      await expect(
        caller.inviteMember({
          email: 'newuser@example.com',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('throws when both orgRole and mspRole are provided', async () => {
      const { caller } = createAuthedCaller();

      await expect(
        caller.inviteMember({
          email: 'newuser@example.com',
          orgRole: 'ORG_MEMBER',
          mspRole: 'MSP_ADMIN',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('returns cached result on duplicate idempotency key', async () => {
      const { caller } = createAuthedCaller();
      const cachedResult = JSON.stringify({
        invitation: makeMockInvitation(),
      });
      mockRedis.get.mockResolvedValue(cachedResult);

      const result = await caller.inviteMember({
        email: 'newuser@example.com',
        orgRole: 'ORG_MEMBER',
        idempotencyKey: VALID_UUID,
      });

      expect(result).toEqual(JSON.parse(cachedResult));
      // Should not have called create since we got a cached result
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────
  //  updateRole
  // ─────────────────────────────────────
  describe('updateRole', () => {
    it('updates member orgRole', async () => {
      const { caller, ctx } = createAuthedCaller();
      const member = makeMockMember({ id: VALID_CUID, orgRole: 'ORG_MEMBER', mspRole: null });
      const updatedMember = { ...member, orgRole: 'ORG_ADMIN' };

      ctx.db.member.findFirst.mockResolvedValue(member);
      ctx.db.member.update.mockResolvedValue(updatedMember);

      const result = await caller.updateRole({
        memberId: VALID_CUID,
        orgRole: 'ORG_ADMIN',
        idempotencyKey: VALID_UUID,
      });

      expect(result.member.orgRole).toBe('ORG_ADMIN');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.role_updated',
          entityId: VALID_CUID,
          before: { orgRole: 'ORG_MEMBER', mspRole: null },
          after: { orgRole: 'ORG_ADMIN', mspRole: null },
        }),
      );
    });

    it('throws NOT_FOUND when member does not exist', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.member.findFirst.mockResolvedValue(null);

      await expect(
        caller.updateRole({
          memberId: VALID_CUID,
          orgRole: 'ORG_ADMIN',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('returns cached result on duplicate idempotency key', async () => {
      const { caller } = createAuthedCaller();
      const cachedResult = JSON.stringify({
        member: { id: VALID_CUID, orgRole: 'ORG_ADMIN', mspRole: null },
      });
      mockRedis.get.mockResolvedValue(cachedResult);

      const result = await caller.updateRole({
        memberId: VALID_CUID,
        orgRole: 'ORG_ADMIN',
        idempotencyKey: VALID_UUID,
      });

      expect(result).toEqual(JSON.parse(cachedResult));
    });
  });

  // ─────────────────────────────────────
  //  removeMember
  // ─────────────────────────────────────
  describe('removeMember', () => {
    it('deletes member and writes audit log', async () => {
      const { caller, ctx } = createAuthedCaller();
      const member = makeMockMember({ id: VALID_CUID });

      ctx.db.member.findFirst.mockResolvedValue(member);
      ctx.db.member.delete.mockResolvedValue(member);

      const result = await caller.removeMember({
        memberId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result).toEqual({ success: true });
      expect(ctx.db.member.delete).toHaveBeenCalledWith({ where: { id: VALID_CUID } });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.member_removed',
          entityId: VALID_CUID,
          before: expect.objectContaining({
            userId: member.userId,
            orgRole: member.orgRole,
          }),
        }),
      );
    });

    it('throws NOT_FOUND when member does not exist', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.member.findFirst.mockResolvedValue(null);

      await expect(
        caller.removeMember({
          memberId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('returns cached result on duplicate idempotency key', async () => {
      const { caller } = createAuthedCaller();
      const cachedResult = JSON.stringify({ success: true });
      mockRedis.get.mockResolvedValue(cachedResult);

      const result = await caller.removeMember({
        memberId: VALID_CUID,
        idempotencyKey: VALID_UUID,
      });

      expect(result).toEqual({ success: true });
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────
  //  listAuditLogs
  // ─────────────────────────────────────
  describe('listAuditLogs', () => {
    it('returns audit logs with user info', async () => {
      const { caller, ctx } = createAuthedCaller();
      const log = makeMockAuditLog();
      ctx.db.auditLog.findMany.mockResolvedValue([log]);

      const result = await caller.listAuditLogs({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: log.id,
        action: log.action,
        entityId: log.entityId,
        userId: log.userId,
        user: log.user,
        before: log.before,
        after: log.after,
        traceId: log.traceId,
        createdAt: log.createdAt,
      });
      expect(result.nextCursor).toBeNull();
    });

    it('returns empty results', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.auditLog.findMany.mockResolvedValue([]);

      const result = await caller.listAuditLogs({});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('paginates correctly when more results exist', async () => {
      const { caller, ctx } = createAuthedCaller();
      const limit = 2;
      const logs = [
        makeMockAuditLog({ id: VALID_CUID }),
        makeMockAuditLog({ id: VALID_CUID_2 }),
        makeMockAuditLog({ id: VALID_CUID_3 }),
      ];
      ctx.db.auditLog.findMany.mockResolvedValue(logs);

      const result = await caller.listAuditLogs({ limit });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe(VALID_CUID_2);
    });

    it('filters by action', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.auditLog.findMany.mockResolvedValue([]);

      await caller.listAuditLogs({
        where: { action: 'admin.member_invited' },
      });

      expect(ctx.db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: { contains: 'admin.member_invited' } },
        }),
      );
    });

    it('filters by entityId', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.auditLog.findMany.mockResolvedValue([]);

      await caller.listAuditLogs({
        where: { entityId: VALID_CUID },
      });

      expect(ctx.db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entityId: VALID_CUID },
        }),
      );
    });

    it('filters by userId', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.auditLog.findMany.mockResolvedValue([]);

      await caller.listAuditLogs({
        where: { userId: VALID_CUID },
      });

      expect(ctx.db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: VALID_CUID },
        }),
      );
    });

    it('supports custom orderBy', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.auditLog.findMany.mockResolvedValue([]);

      await caller.listAuditLogs({
        orderBy: { field: 'createdAt', direction: 'asc' },
      });

      expect(ctx.db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('defaults to desc order by createdAt', async () => {
      const { caller, ctx } = createAuthedCaller();
      ctx.db.auditLog.findMany.mockResolvedValue([]);

      await caller.listAuditLogs({});

      expect(ctx.db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });
});
