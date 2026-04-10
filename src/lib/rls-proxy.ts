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
const ORG_SCOPED_MODELS = new Set([
  'organization',
  'session',
  'member',
  'invitation',
  'dpaAcceptance',
  'vendorConnection',
  'subscription',
  'license',
  'purchaseTransaction',
  'billingSnapshot',
  'auditLog',
  'productOffering',
]);

// Models that are org-scoped indirectly (through relations) but don't have organizationId directly
const INDIRECT_ORG_MODELS = new Set([
  'license',       // scoped via subscription.organizationId
  'productOffering', // may or may not be org-scoped
]);

// Models that have organizationId as a direct field
const DIRECT_ORG_MODELS = new Set([
  'session',
  'member',
  'invitation',
  'dpaAcceptance',
  'vendorConnection',
  'subscription',
  'purchaseTransaction',
  'billingSnapshot',
  'auditLog',
]);

type RLSPrismaClient = PrismaClient;

export function createRLSProxy(organizationId: string): RLSPrismaClient {
  return new Proxy(prisma, {
    get(target, prop: string) {
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

      if (['create', 'createMany'].includes(prop)) {
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

      if (['findFirst', 'findUnique', 'update'].includes(prop)) {
        return (args: any = {}) => {
          args.where = { ...args.where, id: organizationId };
          return original.call(target, args);
        };
      }

      if (prop === 'findMany') {
        return (args: any = {}) => {
          args.where = { ...args.where, id: organizationId };
          return original.call(target, args);
        };
      }

      return original.bind(target);
    },
  });
}
