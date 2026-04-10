import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import type { PrismaClient } from '@prisma/client';
import type { OrgRole, MspRole, PlatformRole } from '@prisma/client';

export interface EffectiveRole {
  platformRole: PlatformRole | null;
  mspRole: MspRole | null;
  orgRole: OrgRole | null;
}

export interface TRPCContext {
  // Set after authentication
  userId: string | null;
  organizationId: string | null;
  effectiveRole: EffectiveRole;

  // The org-scoped database proxy
  db: PrismaClient;

  // Request metadata
  traceId: string;
  headers: Headers;
}

export function createContext(opts: FetchCreateContextFnOptions): TRPCContext {
  // Base context — authentication is handled by the proxy middleware
  return {
    userId: null,
    organizationId: null,
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: null,
    },
    db: null as unknown as PrismaClient, // Set by auth middleware
    traceId: crypto.randomUUID(),
    headers: opts.req.headers,
  };
}
