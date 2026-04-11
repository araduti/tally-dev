import { z } from 'zod';
import { router, orgOwnerProcedure, orgOwnerMutationProcedure, authenticatedMutationProcedure } from '../trpc/init';
import { OrgRole, MspRole, InvitationStatus } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { createBusinessError, invitationInvalidStatusError, invitationExpiredError } from '@/lib/errors';

export const adminRouter = router({
  listMembers: orgOwnerProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.member.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items: items.map((m: any) => ({
          id: m.id,
          user: m.user,
          orgRole: m.orgRole,
          mspRole: m.mspRole,
          createdAt: m.createdAt,
        })),
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  inviteMember: orgOwnerMutationProcedure
    .input(z.object({
      email: z.string().email(),
      orgRole: z.nativeEnum(OrgRole).optional(),
      mspRole: z.nativeEnum(MspRole).optional(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate that exactly one role is provided
      if ((!input.orgRole && !input.mspRole) || (input.orgRole && input.mspRole)) {
        throw createBusinessError({
          code: 'BAD_REQUEST',
          message: 'Exactly one of orgRole or mspRole must be provided',
          errorCode: 'ADMIN:MEMBER:INVALID_ROLE',
        });
      }

      // Check if already a member (use raw prisma for cross-org User lookup — User is platform-wide)
      const { prisma } = await import('@/lib/db');
      const existingUser = await prisma.user.findUnique({
        where: { email: input.email },
      });

      if (existingUser) {
        const existingMember = await ctx.db.member.findFirst({
          where: { userId: existingUser.id },
        });
        if (existingMember) {
          // Use a generic message to prevent email enumeration
          throw createBusinessError({
            code: 'CONFLICT',
            message: 'Cannot send invitation to this email address',
            errorCode: 'ADMIN:INVITATION:CONFLICT',
          });
        }
      }

      // Check for existing pending invitation
      const existingInvitation = await ctx.db.invitation.findFirst({
        where: { email: input.email, status: 'PENDING' },
      });
      if (existingInvitation) {
        // Use same generic message to prevent enumeration
        throw createBusinessError({
          code: 'CONFLICT',
          message: 'Cannot send invitation to this email address',
          errorCode: 'ADMIN:INVITATION:CONFLICT',
        });
      }

      const invitation = await ctx.db.invitation.create({
        data: {
          email: input.email,
          orgRole: input.orgRole ?? null,
          mspRole: input.mspRole ?? null,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          inviterId: ctx.userId,
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'admin.member_invited',
        entityId: invitation.id,
        after: { email: input.email, orgRole: input.orgRole, mspRole: input.mspRole },
        traceId: ctx.traceId,
      });

      return {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          orgRole: invitation.orgRole,
          mspRole: invitation.mspRole,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        },
      };
    }),

  updateRole: orgOwnerMutationProcedure
    .input(z.object({
      memberId: z.string().cuid(),
      orgRole: z.nativeEnum(OrgRole).optional(),
      mspRole: z.nativeEnum(MspRole).optional(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Prevent owner from demoting themselves — could lock the org out of owner-only actions
      const member = await ctx.db.member.findFirst({
        where: { id: input.memberId },
      });

      if (!member) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Member not found',
          errorCode: 'ADMIN:MEMBER:NOT_FOUND',
        });
      }

      if (member.userId === ctx.userId) {
        throw createBusinessError({
          code: 'BAD_REQUEST',
          message: 'Cannot change your own role. Ask another owner to update your role.',
          errorCode: 'ADMIN:MEMBER:SELF_ROLE_CHANGE',
        });
      }

      const before = { orgRole: member.orgRole, mspRole: member.mspRole };

      const updated = await ctx.db.member.update({
        where: { id: member.id },
        data: {
          orgRole: input.orgRole ?? member.orgRole,
          mspRole: input.mspRole ?? member.mspRole,
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'admin.role_updated',
        entityId: member.id,
        before,
        after: { orgRole: updated.orgRole, mspRole: updated.mspRole },
        traceId: ctx.traceId,
      });

      return {
        member: {
          id: updated.id,
          orgRole: updated.orgRole,
          mspRole: updated.mspRole,
        },
      };
    }),

  removeMember: orgOwnerMutationProcedure
    .input(z.object({
      memberId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.member.findFirst({
        where: { id: input.memberId },
      });

      if (!member) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Member not found',
          errorCode: 'ADMIN:MEMBER:NOT_FOUND',
        });
      }

      // Prevent owner from removing themselves — would lose access permanently
      if (member.userId === ctx.userId) {
        throw createBusinessError({
          code: 'BAD_REQUEST',
          message: 'Cannot remove yourself from the organization. Ask another owner to remove you.',
          errorCode: 'ADMIN:MEMBER:SELF_REMOVAL',
        });
      }

      await ctx.db.member.delete({
        where: { id: member.id },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'admin.member_removed',
        entityId: member.id,
        before: { userId: member.userId, orgRole: member.orgRole, mspRole: member.mspRole },
        traceId: ctx.traceId,
      });

      return { success: true as const };
    }),

  listInvitations: orgOwnerProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        status: z.nativeEnum(InvitationStatus).optional(),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.where?.status) where.status = input.where.status;

      const items = await ctx.db.invitation.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where,
        orderBy: { createdAt: 'desc' },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items: items.map((inv: any) => ({
          id: inv.id,
          email: inv.email,
          orgRole: inv.orgRole,
          mspRole: inv.mspRole,
          status: inv.status,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
        })),
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  revokeInvitation: orgOwnerMutationProcedure
    .input(z.object({
      invitationId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await ctx.db.invitation.findFirst({
        where: { id: input.invitationId },
      });

      if (!invitation) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Invitation not found',
          errorCode: 'ADMIN:INVITATION:NOT_FOUND',
        });
      }

      if (invitation.status !== InvitationStatus.PENDING) {
        throw invitationInvalidStatusError();
      }

      const updated = await ctx.db.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.REVOKED },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'admin.invitation_revoked',
        entityId: invitation.id,
        before: { status: invitation.status },
        after: { status: updated.status },
        traceId: ctx.traceId,
      });

      return {
        invitation: {
          id: updated.id,
          status: updated.status as 'REVOKED',
        },
      };
    }),

  acceptInvitation: authenticatedMutationProcedure
    .input(z.object({
      invitationId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');

      // Find the invitation (use raw prisma since user may not be in the org yet)
      const invitation = await prisma.invitation.findUnique({
        where: { id: input.invitationId },
      });

      if (!invitation) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Invitation not found',
          errorCode: 'ADMIN:INVITATION:NOT_FOUND',
        });
      }

      // Verify the invitation is for this user's email
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
      });

      if (!user || user.email !== invitation.email) {
        throw createBusinessError({
          code: 'FORBIDDEN',
          message: 'This invitation is not for your account',
          errorCode: 'ADMIN:INVITATION:WRONG_USER',
        });
      }

      // Check invitation status
      if (invitation.status !== 'PENDING') {
        throw invitationInvalidStatusError();
      }

      // Check expiry
      if (invitation.expiresAt < new Date()) {
        throw invitationExpiredError();
      }

      // Check if user is already a member
      const existingMember = await prisma.member.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId: ctx.userId,
          },
        },
      });

      if (existingMember) {
        throw createBusinessError({
          code: 'CONFLICT',
          message: 'You are already a member of this organization',
          errorCode: 'ADMIN:MEMBER:ALREADY_EXISTS',
        });
      }

      // Create member and update invitation in a transaction
      const [member, updatedInvitation] = await prisma.$transaction([
        prisma.member.create({
          data: {
            organizationId: invitation.organizationId,
            userId: ctx.userId,
            orgRole: invitation.orgRole,
            mspRole: invitation.mspRole,
          },
        }),
        prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED' },
        }),
      ]);

      // Write audit log (use raw prisma since we need to target the invitation's org)
      await prisma.auditLog.create({
        data: {
          organizationId: invitation.organizationId,
          userId: ctx.userId,
          action: 'admin.invitation_accepted',
          entityId: invitation.id,
          after: {
            memberId: member.id,
            orgRole: member.orgRole,
            mspRole: member.mspRole,
          },
          traceId: ctx.traceId ?? null,
        },
      });

      return {
        member: {
          id: member.id,
          organizationId: member.organizationId,
          orgRole: member.orgRole,
          mspRole: member.mspRole,
        },
        invitation: {
          id: updatedInvitation.id,
          status: updatedInvitation.status,
        },
      };
    }),

  rejectInvitation: authenticatedMutationProcedure
    .input(z.object({
      invitationId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');

      const invitation = await prisma.invitation.findUnique({
        where: { id: input.invitationId },
      });

      if (!invitation) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Invitation not found',
          errorCode: 'ADMIN:INVITATION:NOT_FOUND',
        });
      }

      // Verify the invitation is for this user's email
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
      });

      if (!user || user.email !== invitation.email) {
        throw createBusinessError({
          code: 'FORBIDDEN',
          message: 'This invitation is not for your account',
          errorCode: 'ADMIN:INVITATION:WRONG_USER',
        });
      }

      if (invitation.status !== 'PENDING') {
        throw invitationInvalidStatusError();
      }

      const updated = await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'REJECTED' },
      });

      await prisma.auditLog.create({
        data: {
          organizationId: invitation.organizationId,
          userId: ctx.userId,
          action: 'admin.invitation_rejected',
          entityId: invitation.id,
          before: { status: invitation.status },
          after: { status: updated.status },
          traceId: ctx.traceId ?? null,
        },
      });

      return {
        invitation: {
          id: updated.id,
          status: updated.status as 'REJECTED',
        },
      };
    }),

  listAuditLogs: orgOwnerProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        action: z.string().min(1).optional(),
        entityId: z.string().cuid().optional(),
        userId: z.string().cuid().optional(),
        /** Filter to a specific entity type (domain prefix, e.g. "subscription", "license") */
        entityType: z.string().min(1).optional(),
        /** Inclusive start of the date range */
        from: z.coerce.date().optional(),
        /** Inclusive end of the date range */
        to: z.coerce.date().optional(),
      }).optional(),
      orderBy: z.object({
        field: z.enum(['createdAt']),
        direction: z.enum(['asc', 'desc']).default('desc'),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.where?.action) where.action = { contains: input.where.action };
      if (input.where?.entityId) where.entityId = input.where.entityId;
      if (input.where?.userId) where.userId = input.where.userId;

      // Entity-type filtering: matches the domain prefix of the action (e.g. "subscription.*")
      if (input.where?.entityType) {
        where.action = { startsWith: `${input.where.entityType}.` };
      }

      // Date-range filtering
      if (input.where?.from || input.where?.to) {
        const dateFilter: Record<string, Date> = {};
        if (input.where.from) dateFilter.gte = input.where.from;
        if (input.where.to) dateFilter.lte = input.where.to;
        where.createdAt = dateFilter;
      }

      const orderBy = input.orderBy
        ? { [input.orderBy.field]: input.orderBy.direction }
        : { createdAt: 'desc' as const };

      const items = await ctx.db.auditLog.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where,
        orderBy,
        include: {
          user: { select: { name: true, email: true } },
        },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items: items.map((log: any) => ({
          id: log.id,
          action: log.action,
          entityId: log.entityId,
          userId: log.userId,
          user: log.user,
          before: log.before,
          after: log.after,
          traceId: log.traceId,
          createdAt: log.createdAt,
        })),
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),
});
