import { z } from 'zod';
import { router, orgMemberProcedure, orgOwnerMutationProcedure, mspTechProcedure, mspAdminMutationProcedure } from '../trpc/init';
import { BillingType } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { createBusinessError } from '@/lib/errors';

/**
 * Explicit schema for Organization metadata — flat key-value pairs
 * with primitive values only. No z.any() or z.unknown() per §3.
 */
const metadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const organizationRouter = router({
  get: orgMemberProcedure
    .input(z.object({}))
    .query(async ({ ctx }) => {
      const { prisma } = await import('@/lib/db');
      const org = await prisma.organization.findUnique({
        where: { id: ctx.organizationId! },
      });

      if (!org) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Organization not found',
          errorCode: 'ADMIN:MEMBER:NOT_FOUND',
        });
      }

      return org;
    }),

  update: orgOwnerMutationProcedure
    .input(z.object({
      name: z.string().min(1).max(255).optional(),
      logo: z.string().url().optional(),
      billingType: z.nativeEnum(BillingType).optional(),
      metadata: metadataSchema.optional(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');
      const org = await prisma.organization.findUnique({
        where: { id: ctx.organizationId! },
      });

      if (!org) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Organization not found',
          errorCode: 'ADMIN:MEMBER:NOT_FOUND',
        });
      }

      const before = {
        name: org.name,
        logo: org.logo,
        billingType: org.billingType,
        metadata: org.metadata,
      };

      const { idempotencyKey: _ikey, metadata, ...rest } = input;
      const updateData: Record<string, unknown> = { ...rest };
      if (metadata !== undefined) {
        updateData.metadata = metadata;
      }
      const updated = await prisma.organization.update({
        where: { id: ctx.organizationId! },
        data: updateData,
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'organization.updated',
        entityId: org.id,
        before,
        after: {
          name: updated.name,
          logo: updated.logo,
          billingType: updated.billingType,
          metadata: updated.metadata,
        },
        traceId: ctx.traceId,
      });

      return { organization: updated };
    }),

  listClients: mspTechProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }))
    .query(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');

      // Verify current org is MSP
      const org = await prisma.organization.findUnique({
        where: { id: ctx.organizationId! },
        select: { organizationType: true },
      });

      if (org?.organizationType !== 'MSP') {
        throw createBusinessError({
          code: 'BAD_REQUEST',
          message: 'This action is only available for MSP organizations',
          errorCode: 'AUTH:RBAC:MSP_DELEGATION_DENIED',
        });
      }

      const items = await prisma.organization.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where: {
          parentOrganizationId: ctx.organizationId!,
          deletedAt: null,
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          organizationType: true,
          provisioningEnabled: true,
          isContractSigned: true,
          billingType: true,
          deletedAt: true,
        },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  createClient: mspAdminMutationProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
      billingType: z.nativeEnum(BillingType).default('MANUAL_INVOICE'),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');

      // Verify current org is MSP
      const org = await prisma.organization.findUnique({
        where: { id: ctx.organizationId! },
        select: { organizationType: true },
      });

      if (org?.organizationType !== 'MSP') {
        throw createBusinessError({
          code: 'BAD_REQUEST',
          message: 'Only MSP organizations can create client organizations',
          errorCode: 'AUTH:RBAC:MSP_DELEGATION_DENIED',
        });
      }

      // Check slug uniqueness
      const existingSlug = await prisma.organization.findUnique({
        where: { slug: input.slug },
      });
      if (existingSlug) {
        throw createBusinessError({
          code: 'CONFLICT',
          message: 'An organization with this slug already exists',
          errorCode: 'ADMIN:MEMBER:ALREADY_EXISTS',
        });
      }

      const clientOrg = await prisma.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          organizationType: 'CLIENT',
          parentOrganizationId: ctx.organizationId!,
          billingType: input.billingType,
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'organization.client_created',
        entityId: clientOrg.id,
        after: { name: input.name, slug: input.slug, billingType: input.billingType },
        traceId: ctx.traceId,
      });

      return { organization: clientOrg };
    }),
});
