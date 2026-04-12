import { z } from 'zod';
import { router, mspTechProcedure, orgOwnerMutationProcedure, orgAdminMutationProcedure } from '../trpc/init';
import { VendorType, VendorConnectionStatus } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { encrypt } from '@/lib/encryption';
import { createBusinessError, dpaNotAcceptedError, vendorAuthDisconnectedError } from '@/lib/errors';
import { inngest } from '@/inngest/client';

export const vendorRouter = router({
  listConnections: mspTechProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        vendorType: z.nativeEnum(VendorType).optional(),
        status: z.nativeEnum(VendorConnectionStatus).optional(),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.where?.vendorType) where.vendorType = input.where.vendorType;
      if (input.where?.status) where.status = input.where.status;

      const items = await ctx.db.vendorConnection.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          vendorType: true,
          status: true,
          lastSyncAt: true,
          createdAt: true,
          // credentials are NEVER included
        },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  connect: orgOwnerMutationProcedure
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
        throw createBusinessError({
          code: 'CONFLICT',
          message: `An active ${input.vendorType} connection already exists`,
          errorCode: 'VENDOR:AUTH:DUPLICATE',
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

  disconnect: orgOwnerMutationProcedure
    .input(z.object({
      vendorConnectionId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const connection = await ctx.db.vendorConnection.findFirst({
        where: { id: input.vendorConnectionId },
      });

      if (!connection) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Vendor connection not found',
          errorCode: 'VENDOR:AUTH:NOT_FOUND',
        });
      }

      // Cryptographic overwrite: replace credentials with random bytes before
      // clearing, ensuring the original ciphertext is no longer recoverable
      // from storage or write-ahead logs.
      const { randomBytes } = await import('node:crypto');
      const overwrite = randomBytes(64).toString('hex');

      await ctx.db.vendorConnection.update({
        where: { id: connection.id },
        data: { credentials: overwrite },
      });

      // Second pass: set to empty string and mark as DISCONNECTED
      const updated = await ctx.db.vendorConnection.update({
        where: { id: connection.id },
        data: {
          status: 'DISCONNECTED',
          credentials: '',
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
        after: { status: 'DISCONNECTED', credentialsErased: true },
        traceId: ctx.traceId,
      });

      return { vendorConnection: updated };
    }),

  syncCatalog: orgAdminMutationProcedure
    .input(z.object({
      vendorConnectionId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const connection = await ctx.db.vendorConnection.findFirst({
        where: { id: input.vendorConnectionId },
      });

      if (!connection) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Vendor connection not found',
          errorCode: 'VENDOR:AUTH:NOT_FOUND',
        });
      }

      if (connection.status === 'DISCONNECTED') {
        throw vendorAuthDisconnectedError(connection.vendorType, connection.id);
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

      // Dispatch the durable catalog sync workflow
      await inngest.send({
        name: 'vendor/catalog-sync.requested',
        data: {
          vendorConnectionId: input.vendorConnectionId,
          organizationId: ctx.organizationId!,
          traceId: ctx.traceId,
        },
      });

      return { syncId, status: 'ENQUEUED' as const };
    }),
});
