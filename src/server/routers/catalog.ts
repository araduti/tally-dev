import { z } from 'zod';
import { router, orgMemberProcedure, orgAdminProcedure } from '../trpc/init';
import { createBusinessError } from '@/lib/errors';
import Decimal from 'decimal.js';
import { VendorType } from '@prisma/client';

export const catalogRouter = router({
  listBundles: orgMemberProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        category: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
      }).optional(),
      orderBy: z.object({
        field: z.enum(['name', 'createdAt']),
        direction: z.enum(['asc', 'desc']).default('desc'),
      }).optional(),
    }))
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {};
      if (input.where?.category) where.category = input.where.category;
      if (input.where?.name) where.name = { contains: input.where.name, mode: 'insensitive' };

      const orderBy = input.orderBy
        ? { [input.orderBy.field]: input.orderBy.direction }
        : { createdAt: 'desc' as const };

      // Bundles are global catalog data, not org-scoped — use raw prisma
      const { prisma } = await import('@/lib/db');
      const items = await prisma.bundle.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where,
        orderBy,
        include: {
          products: { include: { product: true } },
        },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  getBundle: orgMemberProcedure
    .input(z.object({
      bundleId: z.string().cuid(),
    }))
    .query(async ({ input }) => {
      const { prisma } = await import('@/lib/db');
      const bundle = await prisma.bundle.findUnique({
        where: { id: input.bundleId },
        include: {
          products: { include: { product: true } },
          offerings: true,
        },
      });

      if (!bundle) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Bundle not found',
          errorCode: 'CATALOG:OFFERING:UNAVAILABLE',
        });
      }

      return bundle;
    }),

  listProductOfferings: orgMemberProcedure
    .input(z.object({
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      where: z.object({
        bundleId: z.string().cuid().optional(),
        sourceType: z.nativeEnum(VendorType).optional(),
        availability: z.string().min(1).optional(),
      }).optional(),
    }))
    .query(async ({ input }) => {
      const { prisma } = await import('@/lib/db');
      const where: Record<string, unknown> = {};
      if (input.where?.bundleId) where.bundleId = input.where.bundleId;
      if (input.where?.sourceType) where.sourceType = input.where.sourceType;
      if (input.where?.availability) where.availability = input.where.availability;

      const items = await prisma.productOffering.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where,
        orderBy: { createdAt: 'desc' },
      });

      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      };
    }),

  comparePricing: orgAdminProcedure
    .input(z.object({
      bundleId: z.string().cuid(),
      quantity: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const { prisma } = await import('@/lib/db');
      const bundle = await prisma.bundle.findUnique({
        where: { id: input.bundleId },
        include: { offerings: true },
      });

      if (!bundle) {
        throw createBusinessError({
          code: 'NOT_FOUND',
          message: 'Bundle not found',
          errorCode: 'CATALOG:OFFERING:UNAVAILABLE',
        });
      }

      const options = bundle.offerings
        .filter((o: any) => o.effectiveUnitCost !== null)
        .map((o: any) => {
          const unitCost = new Decimal(o.effectiveUnitCost!.toString());
          const totalCost = unitCost.mul(input.quantity);
          const isEligible =
            (o.minQuantity === null || input.quantity >= o.minQuantity) &&
            (o.maxQuantity === null || input.quantity <= o.maxQuantity);

          return {
            productOfferingId: o.id,
            sourceType: o.sourceType,
            effectiveUnitCost: unitCost.toFixed(2),
            totalCost: totalCost.toFixed(2),
            partnerMarginPercent: o.partnerMarginPercent?.toString() ?? null,
            currency: o.currency,
            availability: o.availability,
            minQuantity: o.minQuantity,
            maxQuantity: o.maxQuantity,
            isEligible,
          };
        })
        .sort((a: any, b: any) => new Decimal(a.totalCost).cmp(new Decimal(b.totalCost)));

      return {
        bundleId: bundle.id,
        bundleName: bundle.name,
        quantity: input.quantity,
        options,
      };
    }),
});
