import { z } from 'zod';
import { router, orgMemberProcedure, orgAdminMutationProcedure } from '../trpc/init';
import { writeAuditLog } from '@/lib/audit';

export const notificationRouter = router({
  /**
   * List notifications for the current user within the active organization.
   * Cursor-based pagination using createdAt + id.
   */
  list: orgMemberProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().nullish(), // notification id
      }),
    )
    .query(async ({ ctx, input }) => {
      const { limit, cursor } = input;

      const items = await ctx.db.notification.findMany({
        where: {
          organizationId: ctx.organizationId,
          OR: [
            { userId: ctx.userId },
            { userId: null }, // org-wide notifications
          ],
        },
        take: limit + 1,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip: 1,
            }
          : {}),
        orderBy: { createdAt: 'desc' },
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const next = items.pop();
        nextCursor = next?.id;
      }

      return { items, nextCursor };
    }),

  /**
   * Count of unread notifications for the current user.
   */
  unreadCount: orgMemberProcedure
    .input(z.object({}))
    .query(async ({ ctx }) => {
      const count = await ctx.db.notification.count({
        where: {
          organizationId: ctx.organizationId,
          read: false,
          OR: [
            { userId: ctx.userId },
            { userId: null },
          ],
        },
      });

      return { count };
    }),

  /**
   * Mark a single notification as read.
   */
  markAsRead: orgAdminMutationProcedure
    .input(
      z.object({
        notificationId: z.string(),
        idempotencyKey: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const notification = await ctx.db.notification.update({
        where: { id: input.notificationId },
        data: {
          read: true,
          readAt: new Date(),
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'notification.markAsRead',
        entityId: input.notificationId,
        before: { read: false },
        after: { read: true },
        traceId: ctx.traceId,
      });

      return notification;
    }),

  /**
   * Mark all notifications as read for the current user.
   */
  markAllAsRead: orgAdminMutationProcedure
    .input(
      z.object({
        idempotencyKey: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.notification.updateMany({
        where: {
          organizationId: ctx.organizationId,
          read: false,
          OR: [
            { userId: ctx.userId },
            { userId: null },
          ],
        },
        data: {
          read: true,
          readAt: new Date(),
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'notification.markAllAsRead',
        entityId: null,
        before: null,
        after: { markedCount: result.count },
        traceId: ctx.traceId,
      });

      return { count: result.count };
    }),
});
