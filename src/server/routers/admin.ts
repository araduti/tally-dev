import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, orgOwnerProcedure } from '../trpc/init';
import { OrgRole, MspRole, InvitationStatus } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';

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
        items: items.map((m) => ({
          id: m.id,
          user: m.user,
          orgRole: m.orgRole,
          mspRole: m.mspRole,
          createdAt: m.createdAt,
        })),
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  inviteMember: orgOwnerProcedure
    .input(z.object({
      email: z.string().email(),
      orgRole: z.nativeEnum(OrgRole).optional(),
      mspRole: z.nativeEnum(MspRole).optional(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate that exactly one role is provided
      if ((!input.orgRole && !input.mspRole) || (input.orgRole && input.mspRole)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Exactly one of orgRole or mspRole must be provided',
        });
      }

      // Check if already a member
      const { prisma } = await import('@/lib/db');
      const existingUser = await prisma.user.findUnique({
        where: { email: input.email },
      });

      if (existingUser) {
        const existingMember = await ctx.db.member.findFirst({
          where: { userId: existingUser.id },
        });
        if (existingMember) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'User is already a member of this organization',
            cause: { errorCode: 'ADMIN:MEMBER:ALREADY_EXISTS' },
          });
        }
      }

      // Check for existing pending invitation
      const existingInvitation = await ctx.db.invitation.findFirst({
        where: { email: input.email, status: 'PENDING' },
      });
      if (existingInvitation) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'An invitation is already pending for this email',
          cause: { errorCode: 'ADMIN:INVITATION:ALREADY_PENDING' },
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

  updateRole: orgOwnerProcedure
    .input(z.object({
      memberId: z.string().cuid(),
      orgRole: z.nativeEnum(OrgRole).optional(),
      mspRole: z.nativeEnum(MspRole).optional(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.member.findFirst({
        where: { id: input.memberId },
      });

      if (!member) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
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

  removeMember: orgOwnerProcedure
    .input(z.object({
      memberId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.member.findFirst({
        where: { id: input.memberId },
      });

      if (!member) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
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

  listAuditLogs: orgOwnerProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        action: z.string().optional(),
        entityId: z.string().cuid().optional(),
        userId: z.string().cuid().optional(),
      }).optional(),
      orderBy: z.object({
        field: z.enum(['createdAt']),
        direction: z.enum(['asc', 'desc']).default('desc'),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: any = {};
      if (input.where?.action) where.action = { contains: input.where.action };
      if (input.where?.entityId) where.entityId = input.where.entityId;
      if (input.where?.userId) where.userId = input.where.userId;

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
        items: items.map((log) => ({
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
