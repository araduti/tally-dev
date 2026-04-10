import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, mspTechProcedure, orgOwnerProcedure, orgAdminProcedure } from '../trpc/init';
import { VendorType, VendorConnectionStatus } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { encrypt } from '@/lib/encryption';
import { dpaNotAcceptedError } from '@/lib/errors';

export const vendorRouter = router({
  listConnections: mspTechProcedure
    .input(z.object({
      where: z.object({
        vendorType: z.nativeEnum(VendorType).optional(),
        status: z.nativeEnum(VendorConnectionStatus).optional(),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: any = {};
      if (input.where?.vendorType) where.vendorType = input.where.vendorType;
      if (input.where?.status) where.status = input.where.status;

      const items = await ctx.db.vendorConnection.findMany({
        where,
        select: {
          id: true,
          vendorType: true,
          status: true,
          lastSyncAt: true,
          // credentials are NEVER included
        },
      });

      return { items };
    }),

  connect: orgOwnerProcedure
    .input(z.object({
      vendorType: z.nativeEnum(VendorType),
      credentials: z.string().min(1),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check DPA
      const dpa = await ctx.db.dpaAcceptance.findFirst({
        where: {},
        orderBy: { acceptedAt: 'desc' },
      });
      if (!dpa) {
        throw dpaNotAcceptedError(ctx.organizationId!, '2024-01');
      }

      // Check for existing connection of same type
      const existing = await ctx.db.vendorConnection.findFirst({
        where: { vendorType: input.vendorType },
      });
      if (existing && existing.status !== 'DISCONNECTED') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `An active ${input.vendorType} connection already exists`,
        });
      }

      const encryptedCredentials = encrypt(input.credentials);

      const vendorConnection = await ctx.db.vendorConnection.create({
        data: {
          vendorType: input.vendorType,
          credentials: encryptedCredentials,
          status: 'PENDING',
        },
        select: {
          id: true,
          vendorType: true,
          status: true,
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'vendor.connected',
        entityId: vendorConnection.id,
        after: { vendorType: input.vendorType, status: 'PENDING' },
        traceId: ctx.traceId,
      });

      return { vendorConnection };
    }),

  disconnect: orgOwnerProcedure
    .input(z.object({
      vendorConnectionId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const connection = await ctx.db.vendorConnection.findFirst({
        where: { id: input.vendorConnectionId },
      });

      if (!connection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor connection not found' });
      }

      // Overwrite credentials and set status to DISCONNECTED
      const updated = await ctx.db.vendorConnection.update({
        where: { id: connection.id },
        data: {
          status: 'DISCONNECTED',
          credentials: '', // securely erased
        },
        select: { id: true, status: true },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'vendor.disconnected',
        entityId: connection.id,
        before: { status: connection.status },
        after: { status: 'DISCONNECTED' },
        traceId: ctx.traceId,
      });

      return { vendorConnection: updated };
    }),

  syncCatalog: orgAdminProcedure
    .input(z.object({
      vendorConnectionId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const connection = await ctx.db.vendorConnection.findFirst({
        where: { id: input.vendorConnectionId },
      });

      if (!connection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor connection not found' });
      }

      if (connection.status === 'DISCONNECTED') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Cannot sync a disconnected vendor connection',
          cause: { errorCode: 'VENDOR:AUTH:DISCONNECTED' },
        });
      }

      const syncId = `sync-${crypto.randomUUID()}`;

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'vendor.sync_catalog.enqueued',
        entityId: connection.id,
        after: { syncId },
        traceId: ctx.traceId,
      });

      return { syncId, status: 'ENQUEUED' as const };
    }),
});
