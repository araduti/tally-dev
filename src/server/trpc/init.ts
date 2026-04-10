import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { TRPCContext } from './context';
import { prisma } from '@/lib/db';
import { createRLSProxy } from '@/lib/rls-proxy';
import { redis, IDEMPOTENCY_TTL } from '@/lib/redis';
import { noOrgContextError, insufficientRoleError } from '@/lib/errors';
import type { OrgRole, MspRole, PlatformRole } from '@prisma/client';

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

/**
 * Middleware: Authenticate the user via session cookie.
 * Resolves the session, user, active organization, and effective role.
 */
const isAuthenticated = t.middleware(async ({ ctx, next }) => {
  // Extract session token from cookie
  const cookieHeader = ctx.headers.get('cookie') ?? '';
  const sessionToken = parseCookie(cookieHeader, 'better-auth.session_token');

  if (!sessionToken) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }

  // Look up the session
  const session = await prisma.session.findUnique({
    where: { token: sessionToken },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session expired' });
  }

  const userId = session.userId;
  const organizationId = session.activeOrganizationId;

  // Resolve effective role
  let effectiveRole: TRPCContext['effectiveRole'] = {
    platformRole: session.user.platformRole,
    mspRole: null,
    orgRole: null,
  };

  let db = ctx.db;

  if (organizationId) {
    // Create the RLS-scoped proxy
    db = createRLSProxy(organizationId);

    // Look up the user's member record in the active org
    const member = await prisma.member.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });

    if (member) {
      effectiveRole = {
        ...effectiveRole,
        orgRole: member.orgRole,
        mspRole: member.mspRole,
      };
    } else if (!session.user.platformRole) {
      // Check MSP delegation: is there a parent org where the user has an MSP role?
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { parentOrganizationId: true },
      });

      if (org?.parentOrganizationId) {
        const mspMember = await prisma.member.findUnique({
          where: {
            organizationId_userId: {
              organizationId: org.parentOrganizationId,
              userId,
            },
          },
        });

        if (mspMember?.mspRole) {
          effectiveRole = { ...effectiveRole, mspRole: mspMember.mspRole };
        } else {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied to this organization' });
        }
      } else {
        // Not a member and no MSP delegation — deny unless platform role
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied to this organization' });
      }
    }
  }

  return next({
    ctx: {
      ...ctx,
      userId,
      organizationId,
      effectiveRole,
      db,
    },
  });
});

/**
 * Middleware: Require an active organization context.
 */
const requireOrg = t.middleware(async ({ ctx, next }) => {
  if (!ctx.organizationId) {
    throw noOrgContextError();
  }
  return next({ ctx: { ...ctx, organizationId: ctx.organizationId as string } });
});

/**
 * Creates a role-check middleware.
 * Checks that the user has at least one of the required roles.
 */
function requireRole(...allowedRoles: Array<PlatformRole | MspRole | OrgRole>) {
  return t.middleware(async ({ ctx, next }) => {
    const { effectiveRole } = ctx;

    // Platform roles always pass
    if (effectiveRole.platformRole === 'SUPER_ADMIN') {
      return next();
    }

    const currentRoles = [
      effectiveRole.platformRole,
      effectiveRole.mspRole,
      effectiveRole.orgRole,
    ].filter(Boolean) as string[];

    const hasRequiredRole = allowedRoles.some((role) => currentRoles.includes(role));

    if (!hasRequiredRole) {
      throw insufficientRoleError(
        allowedRoles.join(' | '),
        currentRoles.join(' | ') || 'none',
      );
    }

    return next();
  });
}

/**
 * Middleware: Idempotency key enforcement for mutations.
 * The idempotency key is extracted from the parsed input.
 */
const idempotencyGuard = t.middleware(async ({ ctx, next, input }) => {
  const parsedInput = input as Record<string, unknown> | undefined;
  const idempotencyKey = parsedInput?.idempotencyKey as string | undefined;

  if (!idempotencyKey) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Idempotency-Key is required for all mutations',
    });
  }

  const cacheKey = `idempotency:${idempotencyKey}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    // Return the cached response
    return JSON.parse(cached);
  }

  const result = await next();

  // Cache the result for 24 hours (only for successful responses)
  try {
    await redis.setex(cacheKey, IDEMPOTENCY_TTL, JSON.stringify(result));
  } catch {
    // Non-critical: log but don't fail the request
  }

  return result;
});

// Composed procedure types
export const protectedProcedure = t.procedure.use(isAuthenticated).use(requireOrg);
export const orgMemberProcedure = protectedProcedure;
export const orgAdminProcedure = protectedProcedure.use(requireRole('ORG_ADMIN', 'ORG_OWNER', 'MSP_ADMIN', 'MSP_OWNER'));
export const orgOwnerProcedure = protectedProcedure.use(requireRole('ORG_OWNER', 'MSP_OWNER'));
export const mspTechProcedure = protectedProcedure.use(requireRole('ORG_ADMIN', 'ORG_OWNER', 'MSP_TECHNICIAN', 'MSP_ADMIN', 'MSP_OWNER'));
export const mspAdminProcedure = protectedProcedure.use(requireRole('MSP_ADMIN', 'MSP_OWNER'));
export const mspOwnerProcedure = protectedProcedure.use(requireRole('MSP_OWNER'));
export const mutationProcedure = protectedProcedure.use(idempotencyGuard);
export const adminMutationProcedure = orgOwnerProcedure.use(idempotencyGuard);
export const mspMutationProcedure = mspAdminProcedure.use(idempotencyGuard);

// Helper
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
