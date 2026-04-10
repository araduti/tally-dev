# Tally API Conventions

**Version:** 1.0 (April 2026)
**Status:** Active

> This document defines the conventions, contracts, and patterns for Tally's tRPC API layer. All new procedures must conform to these standards.

---

## Table of Contents

1. [Router Organization](#1-router-organization)
2. [Naming Conventions](#2-naming-conventions)
3. [Input & Output Schemas](#3-input--output-schemas)
4. [Pagination](#4-pagination)
5. [Filtering & Sorting](#5-filtering--sorting)
6. [Error Handling](#6-error-handling)
7. [Idempotency](#7-idempotency)
8. [Monetary Fields](#8-monetary-fields)
9. [Authorization Matrix](#9-authorization-matrix)
10. [Rate Limiting](#10-rate-limiting)
11. [Versioning Strategy](#11-versioning-strategy)

---

## 1. Router Organization

Routers are organized by business domain. Each router is a standalone tRPC router merged into the root `appRouter`.

| Router | Domain | Description |
|---|---|---|
| `catalog` | Catalog | Bundles, Products, ProductOfferings, cross-distributor pricing |
| `subscription` | Subscriptions | Active subscription lifecycle (create, cancel, status) |
| `license` | Licensing | Seat management, scale-up/down, commitment-gated operations |
| `vendor` | Vendor Connections | Connect/disconnect distributors, sync catalog, connection status |
| `billing` | Billing & Commerce | Purchase transactions, billing snapshots, projected invoices |
| `admin` | Administration | Members, invitations, roles, audit logs |
| `organization` | Org Management | Org settings, MSP client management, org switching |

### File Structure

```
src/server/routers/
├── index.ts            ← appRouter (merges all domain routers)
├── catalog.ts
├── subscription.ts
├── license.ts
├── vendor.ts
├── billing.ts
├── admin.ts
└── organization.ts
```

---

## 2. Naming Conventions

### Procedure Names

Use `domain.verb` or `domain.verbNoun` pattern. Procedures are always **camelCase**.

| Pattern | Example | Type |
|---|---|---|
| `list{Entity}` | `catalog.listBundles` | Query |
| `get{Entity}` | `catalog.getBundle` | Query |
| `create{Entity}` | `subscription.create` | Mutation |
| `update{Entity}` | `organization.update` | Mutation |
| `delete{Entity}` | `admin.removeMember` | Mutation |
| `{verb}{Entity}` | `license.scaleUp` | Mutation |
| `compare{Entity}` | `catalog.comparePricing` | Query |

### Rules

- **Queries** are read-only and never modify state.
- **Mutations** always modify state and require an `Idempotency-Key`.
- Use domain-specific verbs when generic CRUD doesn't fit (e.g., `scaleUp` not `updateQuantity`).
- Never use abbreviations in procedure names (`listSubscriptions`, not `listSubs`).

---

## 3. Input & Output Schemas

All inputs and outputs use **Zod v4** schemas. No untyped data crosses the API boundary.

### Input Rules

- All fields must be explicitly typed — no `z.any()` or `z.unknown()`.
- IDs are validated as `z.string().cuid()`.
- Optional fields use `.optional()` — never `z.union([z.string(), z.undefined()])`.
- Enums use `z.nativeEnum()` referencing the Prisma enum.

```typescript
// ✅ Correct
z.object({
  bundleId: z.string().cuid(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
})

// ❌ Wrong — untyped, no validation
z.object({ bundleId: z.string(), status: z.string() })
```

### Output Rules

- All procedure outputs must be typed with a Zod schema or inferred from Prisma types.
- Sensitive fields (credentials, tokens) must never appear in output.
- Monetary fields are serialized as strings via `superjson` (see [§8](#8-monetary-fields)).

---

## 4. Pagination

All list procedures use **cursor-based pagination**. Offset pagination is not used because it performs poorly at scale and produces inconsistent results when data changes between pages.

### Standard Pagination Input

```typescript
const paginationInput = z.object({
  cursor: z.string().cuid().optional(), // ID of the last item from the previous page
  limit: z.number().int().min(1).max(100).default(25),
});
```

### Standard Pagination Output

```typescript
const paginatedOutput = <T>(itemSchema: z.ZodType<T>) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().cuid().nullable(), // null when no more pages
    totalCount: z.number().int().optional(),   // included only when cheap to compute
  });
```

### Usage in a Procedure

```typescript
export const listBundles = protectedProcedure
  .input(paginationInput.extend({
    category: z.string().optional(),
  }))
  .query(async ({ ctx, input }) => {
    const items = await ctx.db.bundle.findMany({
      take: input.limit + 1, // fetch one extra to detect next page
      cursor: input.cursor ? { id: input.cursor } : undefined,
      where: { category: input.category },
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = items.length > input.limit;
    if (hasMore) items.pop();

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  });
```

---

## 5. Filtering & Sorting

### Filtering

List procedures accept an optional `where` object scoped to the entity's filterable fields. Only allowlisted fields are exposed — never pass raw Prisma `where` objects from client input.

```typescript
// ✅ Correct — explicit allowlist
.input(z.object({
  where: z.object({
    status: z.nativeEnum(SubscriptionStatus).optional(),
    vendorType: z.nativeEnum(VendorType).optional(),
  }).optional(),
}))

// ❌ Wrong — exposes full Prisma query surface
.input(z.object({ where: z.any() }))
```

### Sorting

List procedures accept an optional `orderBy` with a fixed set of sortable fields and a direction.

```typescript
const orderByInput = z.object({
  field: z.enum(['createdAt', 'name', 'status']),
  direction: z.enum(['asc', 'desc']).default('desc'),
}).optional();
```

---

## 6. Error Handling

### Error Response Shape

All errors are returned as `TRPCError` instances with a safe, client-facing message. Internal details (stack traces, raw SQL errors) are never leaked.

```typescript
throw new TRPCError({
  code: 'NOT_FOUND',
  message: 'Subscription not found',
});
```

### Standard Error Codes

| tRPC Code | HTTP | When to Use |
|---|---|---|
| `BAD_REQUEST` | 400 | Zod validation failure, malformed input |
| `UNAUTHORIZED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Valid session but insufficient role |
| `NOT_FOUND` | 404 | Entity not found (within RLS scope) |
| `CONFLICT` | 409 | Idempotency key collision, duplicate resource |
| `PRECONDITION_FAILED` | 412 | Business rule violation (e.g., commitment window active) |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected errors (logged, never details to client) |

### Business Error Catalog

For business logic errors, include a structured `cause` with a stable error code that clients can programmatically handle:

```typescript
throw new TRPCError({
  code: 'PRECONDITION_FAILED',
  message: 'Cannot reduce quantity during active commitment window',
  cause: {
    errorCode: 'COMMITMENT_WINDOW_ACTIVE',
    commitmentEndDate: license.subscription.commitmentEndDate,
  },
});
```

| Error Code | Domain | Description |
|---|---|---|
| `COMMITMENT_WINDOW_ACTIVE` | License | Scale-down blocked by NCE commitment |
| `DPA_NOT_ACCEPTED` | Compliance | Provisioning blocked — DPA not yet signed |
| `VENDOR_CONNECTION_INACTIVE` | Vendor | Vendor credentials are expired or disconnected |
| `VENDOR_API_ERROR` | Vendor | Upstream distributor API returned an error |
| `PROVISIONING_DISABLED` | Organization | Org has not completed contract signing |
| `OFFERING_UNAVAILABLE` | Catalog | ProductOffering is out of stock or delisted |
| `OFFERING_PRICE_MISSING` | Catalog | Effective unit cost has not been fetched yet |
| `QUANTITY_OUT_OF_RANGE` | License | Requested quantity exceeds min/max bounds |
| `PENDING_SCALE_DOWN_EXISTS` | License | A scale-down is already staged for this license |
| `MEMBER_ALREADY_EXISTS` | Admin | User already has a Member record in this org |

---

## 7. Idempotency

### Overview

Every tRPC mutation requires an `Idempotency-Key` header. This is enforced at `proxy.ts` before the procedure handler executes.

### Key Format

- **Type:** UUID v4 (e.g., `550e8400-e29b-41d4-a716-446655440000`)
- **Generated by:** The client, before sending the request
- **Uniqueness scope:** Global (not per-org)

### Storage & TTL

| Property | Value |
|---|---|
| **Store** | Redis |
| **Key pattern** | `idempotency:{key}` |
| **TTL** | 24 hours |
| **Value** | Serialized response (JSON) + HTTP status code |

### Behavior

| Scenario | Behavior |
|---|---|
| **First request with key** | Execute normally. Store the response in Redis with the TTL. Return the response. |
| **Duplicate key, original succeeded** | Return the cached response without re-executing. The response body and status code match the original. |
| **Duplicate key, original failed (4xx)** | Return the cached error response. Client must generate a new key to retry. |
| **Duplicate key, original failed (5xx)** | The key is not cached on server errors. Client may retry with the same key. |
| **Key missing from request** | Reject with `400 BAD_REQUEST` — idempotency is mandatory for all mutations. |

### Client Usage

```typescript
const response = await trpc.license.scaleUp.mutate(
  { licenseId: 'clx...', newQuantity: 50 },
  {
    context: {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    },
  },
);
```

---

## 8. Monetary Fields

### Rule

All monetary values use `Decimal.js` in business logic and are stored as `Decimal` in PostgreSQL. The `superjson` transformer handles serialization automatically.

### Wire Format

Monetary values cross the API boundary as **strings** (serialized by `superjson`). Clients must parse them before performing arithmetic:

```typescript
// Server returns: { effectiveUnitCost: "12.99" }
// Client parses:
const cost = new Decimal(response.effectiveUnitCost);
```

### Fields That Use Decimal

| Entity | Fields |
|---|---|
| `ProductOffering` | `effectiveUnitCost`, `partnerMarginPercent` |
| `PurchaseTransaction` | `grossAmount`, `ourMarginEarned` |
| `BillingSnapshot` | `projectedAmount` |

### Prohibited

```typescript
// ❌ Never use floating-point for money
const total = price * quantity;

// ✅ Always use Decimal.js
const total = new Decimal(price).mul(quantity);
```

---

## 9. Authorization Matrix

Access to each router is controlled by the three-tier RBAC model. The table below shows the **minimum role required** for each router domain.

### Legend

| Symbol | Meaning |
|---|---|
| ✅ | Full access (read + write) |
| 👁 | Read-only access |
| ❌ | No access |
| 🔑 | Owner-level only (ORG_OWNER / MSP_OWNER) |

### Matrix

| Router | SUPER_ADMIN | SUPPORT | MSP_OWNER | MSP_ADMIN | MSP_TECHNICIAN | ORG_OWNER | ORG_ADMIN | ORG_MEMBER |
|---|---|---|---|---|---|---|---|---|
| `catalog` (read) | ✅ | 👁 | ✅ | ✅ | 👁 | ✅ | ✅ | 👁 |
| `subscription` (read) | ✅ | 👁 | ✅ | ✅ | 👁 | ✅ | ✅ | 👁 |
| `subscription` (write) | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| `license` (read) | ✅ | 👁 | ✅ | ✅ | 👁 | ✅ | ✅ | 👁 |
| `license` (write) | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `vendor` (read) | ✅ | 👁 | ✅ | ✅ | 👁 | ✅ | 👁 | ❌ |
| `vendor` (write) | ✅ | ❌ | ✅ | ✅ | ❌ | 🔑 | ❌ | ❌ |
| `billing` (read) | ✅ | 👁 | ✅ | ✅ | ❌ | ✅ | ✅ | 👁 |
| `billing` (write) | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `admin` | ✅ | 👁 | ✅ | ✅ | ❌ | 🔑 | ❌ | ❌ |
| `organization` (read) | ✅ | 👁 | ✅ | ✅ | 👁 | ✅ | ✅ | 👁 |
| `organization` (write) | ✅ | ❌ | ✅ | ❌ | ❌ | 🔑 | ❌ | ❌ |

> **MSP delegation:** When an MSP user's session is scoped to a client org (`Session.activeOrganizationId` = client org), their MSP role grants the access level shown in the matrix above. They do not need a separate `Member` record on the client org.

---

## 10. Rate Limiting

### Client-Facing API

| Tier | Rate | Window | Scope |
|---|---|---|---|
| Queries | 100 requests | 60 seconds | Per user per org |
| Mutations | 30 requests | 60 seconds | Per user per org |
| Auth (login/signup) | 10 requests | 60 seconds | Per IP |

Rate limit headers are included on every response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1712756400
```

### Vendor API Calls

Vendor adapter calls are rate-limited separately to respect distributor API quotas:

| Vendor | Rate | Notes |
|---|---|---|
| Pax8 | 60 req/min | Per VendorConnection |
| Ingram Micro | 30 req/min | Per VendorConnection |
| TD Synnex | 30 req/min | Per VendorConnection |

Exceeded vendor limits trigger a `VENDOR_API_ERROR` with a `Retry-After` value.

---

## 11. Versioning Strategy

### Approach: Additive Changes Only

Tally does **not** use URL-based versioning (e.g., `/v1/`, `/v2/`). Instead, the API evolves through additive, backward-compatible changes:

| Change Type | Allowed? | Example |
|---|---|---|
| Add a new procedure | ✅ | `catalog.getOfferingHistory` |
| Add an optional input field | ✅ | New optional `category` filter |
| Add a new output field | ✅ | New `lastSyncAt` in response |
| Remove a procedure | ❌ | Must deprecate first |
| Remove an output field | ❌ | Must deprecate first |
| Change a field type | ❌ | Breaking change |
| Make an optional field required | ❌ | Breaking change |

### Deprecation Process

1. Mark the procedure or field as `@deprecated` in the Zod schema / JSDoc.
2. Log usage of deprecated endpoints for 30 days.
3. Announce removal in the next release cycle.
4. Remove after the deprecation window closes.

### Breaking Changes

If a breaking change is unavoidable:

1. Create a new procedure (e.g., `license.scaleUpV2`).
2. Mark the old procedure as deprecated.
3. Follow the deprecation process above.
