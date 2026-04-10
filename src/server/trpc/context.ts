import type { OrgRole, MspRole, PlatformRole } from '@prisma/client';

export interface EffectiveRole {
  platformRole: PlatformRole | null;
  mspRole: MspRole | null;
  orgRole: OrgRole | null;
}

/**
 * The RLS proxy automatically injects organizationId into all queries/mutations.
 * We use a looser type to avoid TypeScript errors when the proxy adds fields
 * that Prisma types require but the caller doesn't need to supply.
 */
export type RLSPrismaProxy = any;

export interface TRPCContext {
  // Set after authentication
  userId: string | null;
  organizationId: string | null;
  effectiveRole: EffectiveRole;

  // The org-scoped database proxy — auto-injects organizationId
  db: RLSPrismaProxy;

  // Request metadata
  traceId: string;
  headers: Headers;
}

export function createContext(opts: { req: Request; resHeaders: Headers }): TRPCContext {
  // Base context — authentication is handled by the proxy middleware
  return {
    userId: null,
    organizationId: null,
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: null,
    },
    db: null, // Set by auth middleware
    traceId: crypto.randomUUID(),
    headers: opts.req.headers,
  };
}
