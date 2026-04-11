import { z } from 'zod';
import { router, orgMemberProcedure, orgOwnerMutationProcedure, mspTechProcedure, mspAdminMutationProcedure, authenticatedMutationProcedure } from '../trpc/init';
import { BillingType } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { createBusinessError, insufficientRoleError, provisioningDisabledError } from '@/lib/errors';

/**
 * Parses a named cookie value from a raw cookie header string.
 */
function parseCookie(cookieHeader: string, name: string): string | undefined {
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return undefined;
}

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
      const org = await ctx.db.organization.findUnique({
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
      const org = await ctx.db.organization.findUnique({
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
      const updated = await ctx.db.organization.update({
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
      billingType: z.nativeEnum(BillingType).optional(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');

      // Verify current org is MSP and has provisioning enabled
      const org = await prisma.organization.findUnique({
        where: { id: ctx.organizationId! },
        select: { organizationType: true, provisioningEnabled: true, billingType: true },
      });

      if (org?.organizationType !== 'MSP') {
        throw createBusinessError({
          code: 'BAD_REQUEST',
          message: 'Only MSP organizations can create client organizations',
          errorCode: 'AUTH:RBAC:MSP_DELEGATION_DENIED',
        });
      }

      if (!org.provisioningEnabled) {
        throw provisioningDisabledError(ctx.organizationId!);
      }

      // Inherit billingType from parent MSP when not explicitly provided
      const effectiveBillingType = input.billingType ?? org.billingType;

      // Check slug uniqueness
      const existingSlug = await prisma.organization.findUnique({
        where: { slug: input.slug },
      });
      if (existingSlug) {
        throw createBusinessError({
          code: 'CONFLICT',
          message: 'An organization with this slug already exists',
          errorCode: 'ORGANIZATION:SLUG:DUPLICATE',
        });
      }

      const clientOrg = await prisma.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          organizationType: 'CLIENT',
          parentOrganizationId: ctx.organizationId!,
          billingType: effectiveBillingType,
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'organization.client_created',
        entityId: clientOrg.id,
        after: {
          name: input.name,
          slug: input.slug,
          billingType: effectiveBillingType,
          parentBillingType: org.billingType,
        },
        traceId: ctx.traceId,
      });

      return { organization: clientOrg };
    }),

  switchOrg: authenticatedMutationProcedure
    .input(z.object({
      organizationId: z.string().cuid(),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = await import('@/lib/db');

      // --- 1. Validate the target organization exists and is active ---
      const targetOrg = await prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          organizationType: true,
          deletedAt: true,
          parentOrganizationId: true,
        },
      });

      if (!targetOrg || targetOrg.deletedAt !== null) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Organization not found',
          errorCode: 'ORGANIZATION:SWITCH:ORG_NOT_FOUND',
        });
      }

      // --- 2. Verify the user has access to the target org ---
      const userId = ctx.userId;

      // Platform admins can switch to any org
      const isPlatformAdmin = ctx.effectiveRole.platformRole === 'SUPER_ADMIN'
        || ctx.effectiveRole.platformRole === 'SUPPORT';

      if (!isPlatformAdmin) {
        // Check direct membership
        const directMember = await prisma.member.findUnique({
          where: { organizationId_userId: { organizationId: targetOrg.id, userId } },
        });

        if (!directMember) {
          // Check MSP delegation — user may be a member of the parent MSP org
          let hasMspAccess = false;

          if (targetOrg.parentOrganizationId) {
            const mspMember = await prisma.member.findUnique({
              where: {
                organizationId_userId: {
                  organizationId: targetOrg.parentOrganizationId,
                  userId,
                },
              },
            });
            hasMspAccess = mspMember?.mspRole !== null && mspMember?.mspRole !== undefined;
          }

          if (!hasMspAccess) {
            throw insufficientRoleError('MEMBER', 'NONE');
          }
        }
      }

      // --- 3. Update the session's active organization ---
      const cookieHeader = ctx.headers.get('cookie') ?? '';
      const sessionToken = parseCookie(cookieHeader, 'better-auth.session_token');

      if (!sessionToken) {
        throw createBusinessError({
          code: 'UNAUTHORIZED',
          message: 'Session not found',
          errorCode: 'AUTH:SESSION:TOKEN_NOT_FOUND',
        });
      }

      await prisma.session.update({
        where: { token: sessionToken },
        data: { activeOrganizationId: targetOrg.id },
      });

      // --- 4. Audit log against the target org ---
      await writeAuditLog({
        db: prisma,
        organizationId: targetOrg.id,
        userId,
        action: 'organization.switched',
        entityId: targetOrg.id,
        before: { activeOrganizationId: ctx.organizationId },
        after: { activeOrganizationId: targetOrg.id },
        traceId: ctx.traceId,
      });

      return {
        organization: {
          id: targetOrg.id,
          name: targetOrg.name,
          slug: targetOrg.slug,
          organizationType: targetOrg.organizationType,
        },
      };
    }),

  getDpaStatus: orgMemberProcedure
    .input(z.object({}))
    .query(async ({ ctx }) => {
      const latestDpa = await ctx.db.dpaAcceptance.findFirst({
        where: {
          organizationId: ctx.organizationId!,
        },
        orderBy: { acceptedAt: 'desc' },
        select: {
          version: true,
          acceptedAt: true,
          acceptedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!latestDpa) {
        return {
          accepted: false,
          version: null,
          acceptedAt: null,
          acceptedBy: null,
        };
      }

      return {
        accepted: true,
        version: latestDpa.version,
        acceptedAt: latestDpa.acceptedAt,
        acceptedBy: latestDpa.acceptedBy,
      };
    }),

  deactivate: orgOwnerMutationProcedure
    .input(z.object({
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input: _input }) => {
      const org = await ctx.db.organization.findUnique({
        where: { id: ctx.organizationId! },
        select: {
          id: true,
          deletedAt: true,
        },
      });

      if (!org) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Organization not found',
          errorCode: 'ORGANIZATION:LIFECYCLE:NOT_FOUND',
        });
      }

      if (org.deletedAt !== null) {
        throw createBusinessError({
          code: 'CONFLICT',
          message: 'Organization is already deactivated',
          errorCode: 'ORGANIZATION:LIFECYCLE:ALREADY_DEACTIVATED',
        });
      }

      const now = new Date();

      const updated = await ctx.db.organization.update({
        where: { id: ctx.organizationId! },
        data: { deletedAt: now },
        select: {
          id: true,
          deletedAt: true,
        },
      });

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'organization.deactivated',
        entityId: org.id,
        before: { deletedAt: null },
        after: { deletedAt: now },
        traceId: ctx.traceId,
      });

      return { organization: { id: updated.id, deletedAt: updated.deletedAt! } };
    }),

  acceptDpa: orgOwnerMutationProcedure
    .input(z.object({
      version: z.string().min(1),
      idempotencyKey: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // --- 1. Check for existing acceptance (idempotent) ---
      const existing = await ctx.db.dpaAcceptance.findUnique({
        where: {
          organizationId_version: {
            organizationId: ctx.organizationId!,
            version: input.version,
          },
        },
        select: {
          id: true,
          version: true,
          acceptedAt: true,
          acceptedByUserId: true,
        },
      });

      if (existing) {
        return {
          dpaAcceptance: {
            id: existing.id,
            version: existing.version,
            acceptedAt: existing.acceptedAt,
            userId: existing.acceptedByUserId,
          },
        };
      }

      // --- 2. Create the DPA acceptance record ---
      const dpaAcceptance = await ctx.db.dpaAcceptance.create({
        data: {
          organizationId: ctx.organizationId!,
          acceptedByUserId: ctx.userId,
          version: input.version,
        },
        select: {
          id: true,
          version: true,
          acceptedAt: true,
          acceptedByUserId: true,
        },
      });

      // --- 3. Audit log ---
      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId!,
        userId: ctx.userId,
        action: 'organization.dpa_accepted',
        entityId: dpaAcceptance.id,
        after: {
          version: dpaAcceptance.version,
          acceptedAt: dpaAcceptance.acceptedAt,
        },
        traceId: ctx.traceId,
      });

      return {
        dpaAcceptance: {
          id: dpaAcceptance.id,
          version: dpaAcceptance.version,
          acceptedAt: dpaAcceptance.acceptedAt,
          userId: dpaAcceptance.acceptedByUserId,
        },
      };
    }),
});
