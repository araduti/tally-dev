import { PrismaClient } from '@prisma/client';
import { prisma } from './db';

/**
 * Creates an org-scoped Prisma proxy that automatically filters all
 * queries by organizationId. This is the ONLY way tRPC procedures
 * should access the database.
 *
 * Models without an organizationId field (User, Product, Bundle, BundleProduct,
 * Verification, Account) pass through unmodified.
 */

// Models that have organizationId as a direct field.
// ⚠️  SECURITY: Every model in prisma/schema.prisma that carries an
//    `organizationId` column MUST be listed here so the proxy auto-injects
//    the tenant filter.  Missing an entry is an RLS bypass (CRITICAL).
const DIRECT_ORG_MODELS = new Set([
  'member',
  'invitation',
  'dpaAcceptance',
  'vendorConnection',
  'subscription',
  'purchaseTransaction',
  'billingSnapshot',
  'auditLog',
  'insightSnapshot',
  'notification',
]);

// Methods that bypass model-level scoping and must NEVER be called
// through the RLS proxy.  If code needs these, use the raw `prisma`
// client with explicit organizationId filters.
const BLOCKED_RAW_METHODS = new Set([
  '$executeRaw',
  '$executeRawUnsafe',
  '$queryRaw',
  '$queryRawUnsafe',
  '$transaction',
]);

type RLSPrismaClient = PrismaClient;

export function createRLSProxy(organizationId: string): RLSPrismaClient {
  return new Proxy(prisma, {
    get(target, prop: string) {
      // Block raw SQL methods — they bypass all model-level scoping.
      if (BLOCKED_RAW_METHODS.has(prop)) {
        return () => {
          throw new Error(
            `[RLS] ${prop}() is blocked on the org-scoped proxy. ` +
            'Use the raw prisma client with explicit organizationId filters.',
          );
        };
      }

      if (DIRECT_ORG_MODELS.has(prop)) {
        const model = target[prop as keyof typeof target] as any;
        return createModelProxy(model, organizationId);
      }
      // For organization model, scope to the org itself
      if (prop === 'organization') {
        const model = target[prop as keyof typeof target] as any;
        return createOrgModelProxy(model, organizationId);
      }
      return target[prop as keyof typeof target];
    },
  }) as RLSPrismaClient;
}

function createModelProxy(model: any, organizationId: string) {
  return new Proxy(model, {
    get(target: any, prop: string) {
      const original = target[prop];
      if (typeof original !== 'function') return original;

      if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(prop)) {
        return (args: any = {}) => {
          args.where = { ...args.where, organizationId };
          return original.call(target, args);
        };
      }

      if (['create', 'createMany', 'createManyAndReturn'].includes(prop)) {
        return (args: any) => {
          if (args.data) {
            if (Array.isArray(args.data)) {
              args.data = args.data.map((d: any) => ({ ...d, organizationId }));
            } else {
              args.data = { ...args.data, organizationId };
            }
          }
          return original.call(target, args);
        };
      }

      if (['update', 'updateMany', 'delete', 'deleteMany'].includes(prop)) {
        return (args: any = {}) => {
          args.where = { ...args.where, organizationId };
          return original.call(target, args);
        };
      }

      if (prop === 'upsert') {
        return (args: any) => {
          args.where = { ...args.where, organizationId };
          if (args.create) args.create = { ...args.create, organizationId };
          if (args.update) args.update = { ...args.update, organizationId };
          return original.call(target, args);
        };
      }

      return original.bind(target);
    },
  });
}

function createOrgModelProxy(model: any, organizationId: string) {
  return new Proxy(model, {
    get(target: any, prop: string) {
      const original = target[prop];
      if (typeof original !== 'function') return original;

      // Read operations — scope to the org itself via `id`
      if (['findFirst', 'findUnique', 'findMany', 'count', 'aggregate', 'groupBy'].includes(prop)) {
        return (args: any = {}) => {
          args.where = { ...args.where, id: organizationId };
          return original.call(target, args);
        };
      }

      // Mutation operations — scope to the org itself via `id`
      if (['update', 'delete'].includes(prop)) {
        return (args: any = {}) => {
          args.where = { ...args.where, id: organizationId };
          return original.call(target, args);
        };
      }

      // Bulk mutations are blocked — organizations should be mutated
      // individually via the scoped `update` / `delete` above.
      if (['updateMany', 'deleteMany'].includes(prop)) {
        return () => {
          throw new Error(
            `[RLS] organization.${prop}() is blocked on the org-scoped proxy. ` +
            'Use the raw prisma client with explicit id filters for bulk org operations.',
          );
        };
      }

      return original.bind(target);
    },
  });
}
