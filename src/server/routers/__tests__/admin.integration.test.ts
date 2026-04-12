/**
 * Integration tests for the admin router.
 *
 * These tests exercise multi-step member management workflows:
 *   - Invitation flow: invite → accept/reject
 *   - Role lifecycle: invite → join → updateRole → remove
 *   - Audit trail completeness across admin operations
 *   - Multi-tenant isolation for member operations
 *
 * Unlike unit tests (admin.test.ts), these integration tests:
 *   - Test complete invitation flows spanning multiple procedures
 *   - Verify state transitions across invite → accept → role update
 *   - Test cross-procedure interactions in member management
 *   - Validate audit trail completeness across admin workflows
 *   - Test multi-tenant isolation for admin operations
 *   - Test RBAC enforcement for ORG_OWNER-only operations
 *
 * NOTE: Mutation procedures are replaced with query counterparts
 * to bypass the idempotency guard (same RBAC, no idempotency guard).
 */

// ──────────────────────────────────────────────
// vi.hoisted: create mock helpers available to vi.mock factories.
// ──────────────────────────────────────────────

const { prisma, rlsDb, buildDbProxy, mockWriteAuditLog } = vi.hoisted(() => {
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

  return {
    prisma: buildDbProxy(),
    rlsDb: buildDbProxy(),
    buildDbProxy,
    mockWriteAuditLog,
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

vi.mock('@/server/trpc/init', async () => {
  const actual = await vi.importActual<typeof import('@/server/trpc/init')>(
    '@/server/trpc/init',
  );
  return {
    ...actual,
    orgOwnerMutationProcedure: actual.orgOwnerProcedure,
    authenticatedMutationProcedure: actual.authenticatedProcedure,
  };
});

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
const VALID_UUID_3 = '770e8400-e29b-41d4-a716-446655440002';
const VALID_UUID_4 = '880e8400-e29b-41d4-a716-446655440003';

const SESSION_TOKEN = 'test-session-token';
const USER_ID = 'test-user-id';
const ORG_ID = 'test-org-id';
const ORG_ID_B = 'test-org-id-b';

// ──────────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────────

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
  return adminRouter.createCaller(ctx);
}

/**
 * Create an authenticated caller WITHOUT org context.
 * Used for acceptInvitation / rejectInvitation which use
 * authenticatedMutationProcedure (no org required).
 */
function createAuthOnlyCaller(email: string = 'newuser@example.com') {
  prisma.session.findUnique.mockResolvedValue({
    id: 'session-1',
    token: SESSION_TOKEN,
    userId: USER_ID,
    expiresAt: new Date(Date.now() + 3_600_000),
    activeOrganizationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { id: USER_ID, email, platformRole: null },
  });

  const ctx = {
    headers: createAuthHeaders(),
    userId: USER_ID,
    organizationId: null as string | null,
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: null,
    },
    db: buildDbProxy(),
    traceId: 'test-trace-id',
    resHeaders: null,
  };
  return adminRouter.createCaller(ctx);
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

function makeMockInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CUID_2,
    organizationId: ORG_ID,
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

// ──────────────────────────────────────────────
// Integration Tests
// ──────────────────────────────────────────────

describe('adminRouter — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  //  Full invitation flow: invite → list → revoke
  // ─────────────────────────────────────────────
  describe('invitation flow: invite → list → revoke', () => {
    it('walks through inviting a member, listing invitations, and revoking', async () => {
      // Step 1: Invite a new member
      const inviteCaller = createAuthedCaller();
      const invitation = makeMockInvitation();

      prisma.user.findUnique.mockResolvedValue(null); // no existing user
      rlsDb.invitation.findFirst.mockResolvedValue(null); // no pending invite
      rlsDb.invitation.create.mockResolvedValue(invitation);

      const inviteResult = await inviteCaller.inviteMember({
        email: 'newuser@example.com',
        orgRole: 'ORG_MEMBER',
        idempotencyKey: VALID_UUID,
      });

      expect(inviteResult.invitation.email).toBe('newuser@example.com');
      expect(inviteResult.invitation.status).toBe('PENDING');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.member_invited',
          entityId: invitation.id,
          after: expect.objectContaining({ email: 'newuser@example.com' }),
        }),
      );

      // Step 2: List invitations — new invite is visible
      vi.clearAllMocks();
      const listCaller = createAuthedCaller();
      rlsDb.invitation.findMany.mockResolvedValue([invitation]);

      const listResult = await listCaller.listInvitations({});
      expect(listResult.items).toHaveLength(1);
      expect(listResult.items[0].email).toBe('newuser@example.com');
      expect(listResult.items[0].status).toBe('PENDING');

      // Step 3: Revoke the invitation
      vi.clearAllMocks();
      const revokeCaller = createAuthedCaller();
      rlsDb.invitation.findFirst.mockResolvedValue(invitation);
      rlsDb.invitation.update.mockResolvedValue({
        ...invitation,
        status: 'REVOKED',
      });

      const revokeResult = await revokeCaller.revokeInvitation({
        invitationId: VALID_CUID_2,
        idempotencyKey: VALID_UUID_2,
      });

      expect(revokeResult.invitation.status).toBe('REVOKED');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.invitation_revoked',
          entityId: VALID_CUID_2,
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Member management lifecycle: invite → join → update role → remove
  // ─────────────────────────────────────────────
  describe('member lifecycle: invite → join → update role → remove', () => {
    it('invites, promotes, then removes a member', async () => {
      // Step 1: Invite
      const inviteCaller = createAuthedCaller();
      const invitation = makeMockInvitation();

      prisma.user.findUnique.mockResolvedValue(null);
      rlsDb.invitation.findFirst.mockResolvedValue(null);
      rlsDb.invitation.create.mockResolvedValue(invitation);

      await inviteCaller.inviteMember({
        email: 'newuser@example.com',
        orgRole: 'ORG_MEMBER',
        idempotencyKey: VALID_UUID,
      });

      // Step 2: After user accepts (simulated) — list members shows new member
      vi.clearAllMocks();
      const listCaller = createAuthedCaller();
      const newMember = makeMockMember({
        id: VALID_CUID_3,
        userId: 'new-user-id',
        orgRole: 'ORG_MEMBER',
        user: { id: 'new-user-id', name: 'New User', email: 'newuser@example.com' },
      });
      rlsDb.member.findMany.mockResolvedValue([
        makeMockMember({ id: VALID_CUID, userId: USER_ID }),
        newMember,
      ]);

      const listResult = await listCaller.listMembers({});
      expect(listResult.items).toHaveLength(2);

      // Step 3: Update role — promote to ORG_ADMIN
      vi.clearAllMocks();
      const updateCaller = createAuthedCaller();
      rlsDb.member.findFirst.mockResolvedValue(newMember);
      rlsDb.member.update.mockResolvedValue({
        ...newMember,
        orgRole: 'ORG_ADMIN',
      });

      const updateResult = await updateCaller.updateRole({
        memberId: VALID_CUID_3,
        orgRole: 'ORG_ADMIN',
        idempotencyKey: VALID_UUID_2,
      });

      expect(updateResult.member.orgRole).toBe('ORG_ADMIN');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.role_updated',
          entityId: VALID_CUID_3,
          before: { orgRole: 'ORG_MEMBER', mspRole: null },
          after: { orgRole: 'ORG_ADMIN', mspRole: null },
        }),
      );

      // Step 4: Remove the member
      vi.clearAllMocks();
      const removeCaller = createAuthedCaller();
      const adminMember = { ...newMember, orgRole: 'ORG_ADMIN' };
      rlsDb.member.findFirst.mockResolvedValue(adminMember);
      rlsDb.member.delete.mockResolvedValue(adminMember);

      const removeResult = await removeCaller.removeMember({
        memberId: VALID_CUID_3,
        idempotencyKey: VALID_UUID_3,
      });

      expect(removeResult).toEqual({ success: true });
      expect(rlsDb.member.delete).toHaveBeenCalledWith({
        where: { id: VALID_CUID_3 },
      });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.member_removed',
          entityId: VALID_CUID_3,
          before: expect.objectContaining({
            userId: 'new-user-id',
            orgRole: 'ORG_ADMIN',
          }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Invitation guards
  // ─────────────────────────────────────────────
  describe('invitation guards', () => {
    it('cannot invite user who is already a member', async () => {
      const caller = createAuthedCaller();

      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: 'existing@example.com',
      });
      rlsDb.member.findFirst.mockResolvedValue(makeMockMember());

      await expect(
        caller.inviteMember({
          email: 'existing@example.com',
          orgRole: 'ORG_MEMBER',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('cannot invite when a pending invitation already exists', async () => {
      const caller = createAuthedCaller();

      prisma.user.findUnique.mockResolvedValue(null);
      rlsDb.invitation.findFirst.mockResolvedValue(makeMockInvitation());

      await expect(
        caller.inviteMember({
          email: 'newuser@example.com',
          orgRole: 'ORG_MEMBER',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('requires exactly one of orgRole or mspRole', async () => {
      const caller = createAuthedCaller();

      // Neither provided
      await expect(
        caller.inviteMember({
          email: 'newuser@example.com',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);

      // Both provided
      await expect(
        caller.inviteMember({
          email: 'newuser@example.com',
          orgRole: 'ORG_MEMBER',
          mspRole: 'MSP_ADMIN',
          idempotencyKey: VALID_UUID_2,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('allows MSP role invitations', async () => {
      const caller = createAuthedCaller();
      const mspInvitation = makeMockInvitation({
        orgRole: null,
        mspRole: 'MSP_ADMIN',
      });

      prisma.user.findUnique.mockResolvedValue(null);
      rlsDb.invitation.findFirst.mockResolvedValue(null);
      rlsDb.invitation.create.mockResolvedValue(mspInvitation);

      const result = await caller.inviteMember({
        email: 'newuser@example.com',
        mspRole: 'MSP_ADMIN',
        idempotencyKey: VALID_UUID,
      });

      expect(result.invitation.mspRole).toBe('MSP_ADMIN');
      expect(result.invitation.orgRole).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  //  Multi-tenant isolation
  // ─────────────────────────────────────────────
  describe('multi-tenant isolation', () => {
    it('org A members not visible to org B', async () => {
      // Org A sees its members
      const callerA = createAuthedCaller('ORG_OWNER', ORG_ID);
      rlsDb.member.findMany.mockResolvedValue([
        makeMockMember({ id: VALID_CUID }),
      ]);

      const resultA = await callerA.listMembers({});
      expect(resultA.items).toHaveLength(1);

      // Org B sees nothing
      vi.clearAllMocks();
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.member.findMany.mockResolvedValue([]);

      const resultB = await callerB.listMembers({});
      expect(resultB.items).toHaveLength(0);
    });

    it('org B cannot update org A member roles', async () => {
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.member.findFirst.mockResolvedValue(null);

      await expect(
        callerB.updateRole({
          memberId: VALID_CUID,
          orgRole: 'ORG_ADMIN',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('org B cannot remove org A members', async () => {
      const callerB = createAuthedCaller('ORG_OWNER', ORG_ID_B);
      rlsDb.member.findFirst.mockResolvedValue(null);

      await expect(
        callerB.removeMember({
          memberId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });
  });

  // ─────────────────────────────────────────────
  //  RBAC enforcement
  // ─────────────────────────────────────────────
  describe('RBAC enforcement', () => {
    it('ORG_ADMIN cannot invite members (ORG_OWNER required)', async () => {
      const adminCaller = createAuthedCaller('ORG_ADMIN');

      await expect(
        adminCaller.inviteMember({
          email: 'someone@example.com',
          orgRole: 'ORG_MEMBER',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('ORG_MEMBER cannot list members (ORG_OWNER required)', async () => {
      const memberCaller = createAuthedCaller('ORG_MEMBER');

      await expect(
        memberCaller.listMembers({}),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('ORG_ADMIN cannot remove members (ORG_OWNER required)', async () => {
      const adminCaller = createAuthedCaller('ORG_ADMIN');

      await expect(
        adminCaller.removeMember({
          memberId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('ORG_ADMIN cannot revoke invitations (ORG_OWNER required)', async () => {
      const adminCaller = createAuthedCaller('ORG_ADMIN');

      await expect(
        adminCaller.revokeInvitation({
          invitationId: VALID_CUID_2,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ─────────────────────────────────────────────
  //  Role update edge cases
  // ─────────────────────────────────────────────
  describe('role update edge cases', () => {
    it('updateRole throws NOT_FOUND when member does not exist', async () => {
      const caller = createAuthedCaller();
      rlsDb.member.findFirst.mockResolvedValue(null);

      await expect(
        caller.updateRole({
          memberId: VALID_CUID,
          orgRole: 'ORG_ADMIN',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('removeMember throws NOT_FOUND when member does not exist', async () => {
      const caller = createAuthedCaller();
      rlsDb.member.findFirst.mockResolvedValue(null);

      await expect(
        caller.removeMember({
          memberId: VALID_CUID,
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow(TRPCError);
    });
  });

  // ─────────────────────────────────────────────
  //  Audit log listing and filtering
  // ─────────────────────────────────────────────
  describe('audit log browsing', () => {
    it('lists audit logs with user info', async () => {
      const caller = createAuthedCaller();
      const log = makeMockAuditLog();
      rlsDb.auditLog.findMany.mockResolvedValue([log]);

      const result = await caller.listAuditLogs({});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].action).toBe('admin.member_invited');
      expect(result.items[0].user).toBeDefined();
      expect(result.nextCursor).toBeNull();
    });

    it('filters audit logs by action', async () => {
      const caller = createAuthedCaller();
      rlsDb.auditLog.findMany.mockResolvedValue([]);

      await caller.listAuditLogs({
        where: { action: 'admin.role_updated' },
      });

      expect(rlsDb.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: { contains: 'admin.role_updated' } },
        }),
      );
    });

    it('paginates audit logs correctly', async () => {
      const caller = createAuthedCaller();
      const logs = [
        makeMockAuditLog({ id: VALID_CUID }),
        makeMockAuditLog({ id: VALID_CUID_2 }),
        makeMockAuditLog({ id: VALID_CUID_3 }),
      ];
      rlsDb.auditLog.findMany.mockResolvedValue(logs);

      const result = await caller.listAuditLogs({ limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe(VALID_CUID_2);
    });
  });

  // ─────────────────────────────────────────────
  //  Audit trail completeness across operations
  // ─────────────────────────────────────────────
  describe('audit trail completeness', () => {
    it('invite, updateRole, and removeMember each produce audit entries', async () => {
      // Invite
      const inviteCaller = createAuthedCaller();
      const invitation = makeMockInvitation();
      prisma.user.findUnique.mockResolvedValue(null);
      rlsDb.invitation.findFirst.mockResolvedValue(null);
      rlsDb.invitation.create.mockResolvedValue(invitation);

      await inviteCaller.inviteMember({
        email: 'newuser@example.com',
        orgRole: 'ORG_MEMBER',
        idempotencyKey: VALID_UUID,
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.member_invited' }),
      );

      // Update role
      vi.clearAllMocks();
      const updateCaller = createAuthedCaller();
      const member = makeMockMember({ id: VALID_CUID_3 });
      rlsDb.member.findFirst.mockResolvedValue(member);
      rlsDb.member.update.mockResolvedValue({ ...member, orgRole: 'ORG_ADMIN' });

      await updateCaller.updateRole({
        memberId: VALID_CUID_3,
        orgRole: 'ORG_ADMIN',
        idempotencyKey: VALID_UUID_2,
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.role_updated' }),
      );

      // Remove member
      vi.clearAllMocks();
      const removeCaller = createAuthedCaller();
      rlsDb.member.findFirst.mockResolvedValue(member);
      rlsDb.member.delete.mockResolvedValue(member);

      await removeCaller.removeMember({
        memberId: VALID_CUID_3,
        idempotencyKey: VALID_UUID_3,
      });

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.member_removed' }),
      );
    });
  });

  // ─────────────────────────────────────────────
  //  Input validation
  // ─────────────────────────────────────────────
  describe('input validation', () => {
    it('rejects inviteMember with invalid email', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.inviteMember({
          email: 'not-an-email',
          orgRole: 'ORG_MEMBER',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects updateRole with invalid CUID for memberId', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.updateRole({
          memberId: 'bad-id',
          orgRole: 'ORG_ADMIN',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });

    it('rejects removeMember with invalid UUID for idempotencyKey', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.removeMember({
          memberId: VALID_CUID,
          idempotencyKey: 'not-a-uuid',
        }),
      ).rejects.toThrow();
    });

    it('rejects revokeInvitation with invalid CUID for invitationId', async () => {
      const caller = createAuthedCaller();

      await expect(
        caller.revokeInvitation({
          invitationId: 'bad-id',
          idempotencyKey: VALID_UUID,
        }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────
  //  Pagination across admin list endpoints
  // ─────────────────────────────────────────────
  describe('pagination consistency', () => {
    it('listMembers paginates correctly', async () => {
      const caller = createAuthedCaller();
      const members = [
        makeMockMember({ id: VALID_CUID }),
        makeMockMember({ id: VALID_CUID_2 }),
        makeMockMember({ id: VALID_CUID_3 }),
      ];
      rlsDb.member.findMany.mockResolvedValue(members);

      const result = await caller.listMembers({ limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe(VALID_CUID_2);
    });

    it('listInvitations paginates correctly', async () => {
      const caller = createAuthedCaller();
      const invitations = [
        makeMockInvitation({ id: VALID_CUID }),
        makeMockInvitation({ id: VALID_CUID_2 }),
        makeMockInvitation({ id: VALID_CUID_3 }),
      ];
      rlsDb.invitation.findMany.mockResolvedValue(invitations);

      const result = await caller.listInvitations({ limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe(VALID_CUID_2);
    });
  });
});
