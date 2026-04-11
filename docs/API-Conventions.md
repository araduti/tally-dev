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

All inputs and outputs use **Zod v3** schemas. No untyped data crosses the API boundary.

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

All errors use two layers:

1. **tRPC transport code** — the HTTP-semantic category (e.g., `PRECONDITION_FAILED` → 412)
2. **Hierarchical business code** — a stable, namespaced `errorCode` in `cause` that clients and AI agents can route on programmatically

Every `TRPCError` carries a safe, client-facing `message`. Internal details (stack traces, raw SQL errors) are never leaked.

```typescript
throw new TRPCError({
  code: 'PRECONDITION_FAILED',                // Layer 1 — transport
  message: 'Scale-down blocked by active commitment window',
  cause: {
    errorCode: 'LICENSE:NCE:WINDOW_ACTIVE',   // Layer 2 — business code
    recovery: {                                // Optional — structured recovery hint
      action: 'SCHEDULE_FOR_RENEWAL',
      label: 'Schedule for Next Renewal',
      params: {
        commitmentEndDate: license.subscription.commitmentEndDate,
        licenseId: license.id,
      },
    },
  },
});
```

### Transport Codes (Layer 1)

These are standard tRPC error codes used for HTTP-level routing. Every error uses exactly one of these:

| tRPC Code | HTTP | When to Use |
|---|---|---|
| `BAD_REQUEST` | 400 | Zod validation failure, malformed input |
| `UNAUTHORIZED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Valid session but insufficient role |
| `NOT_FOUND` | 404 | Entity not found (within RLS scope) |
| `CONFLICT` | 409 | Idempotency key collision, duplicate resource, queue conflict |
| `PRECONDITION_FAILED` | 412 | Business rule violation (commitment window, DPA gate, stale data) |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected errors (logged, never details to client) |

### Business Error Codes (Layer 2)

Business errors use a hierarchical `DOMAIN:CATEGORY:CODE` format in `cause.errorCode`. This enables clients to:

- Match broadly on `AUTH:*` for all auth errors
- Match on `VENDOR:AUTH:*` for all vendor credential errors
- Match on `LICENSE:NCE:WINDOW_ACTIVE` for a specific business case

#### Error Code Format

```
DOMAIN:CATEGORY:CODE
  │       │       └── Specific error condition (e.g., WINDOW_ACTIVE)
  │       └────────── Error category within the domain (e.g., NCE, AUTH, QUANTITY)
  └─────────────────── Business domain (e.g., LICENSE, VENDOR, AUTH)
```

#### Error Code Domains

| Domain | Maps To | Description |
|---|---|---|
| `AUTH` | `src/server/trpc/init.ts` | Session validation, RBAC, org context |
| `CATALOG` | `catalog` router | Bundles, offerings, pricing |
| `LICENSE` | `license` router | Seat management, scale-up/down, commitments |
| `SUBSCRIPTION` | `subscription` router | Subscription lifecycle |
| `VENDOR` | `vendor` router | Distributor connections, syncing |
| `BILLING` | `billing` router | Transactions, snapshots, invoicing |
| `COMPLIANCE` | Cross-cutting | DPA gates, contract signing |
| `PROVISION` | Cross-cutting | Provisioning validation, queue management |
| `DATA` | Cross-cutting | Sync freshness, cache staleness |
| `ADMIN` | `admin` router | Members, invitations, roles |

### Business Error Catalog

#### AUTH — Session & Access Control

| Error Code | tRPC Code | Description | Recovery |
|---|---|---|---|
| `AUTH:SESSION:NO_ORG` | `PRECONDITION_FAILED` | User is logged in but `activeOrganizationId` is not set | `REDIRECT_ORG_SWITCHER` |
| `AUTH:RBAC:INSUFFICIENT` | `FORBIDDEN` | Role resolved but lacks required permission for this action | `REQUEST_ACCESS` |
| `AUTH:RBAC:MSP_DELEGATION_DENIED` | `FORBIDDEN` | MSP user's role doesn't cover this action on the client org | `REQUEST_ACCESS` |

#### VENDOR — Distributor Connections & APIs

| Error Code | tRPC Code | Description | Recovery |
|---|---|---|---|
| `VENDOR:AUTH:EXPIRED` | `PRECONDITION_FAILED` | VendorConnection credentials are expired or revoked | `REAUTH_VENDOR` |
| `VENDOR:AUTH:DISCONNECTED` | `PRECONDITION_FAILED` | VendorConnection status is `DISCONNECTED` | `REAUTH_VENDOR` |
| `VENDOR:API:UPSTREAM_ERROR` | `INTERNAL_SERVER_ERROR` | Distributor API returned an error | `CONTACT_SUPPORT` |
| `VENDOR:API:RATE_LIMITED` | `TOO_MANY_REQUESTS` | Distributor API quota exceeded | `NONE` |

#### LICENSE — Seat Management & Commitments

| Error Code | tRPC Code | Description | Recovery |
|---|---|---|---|
| `LICENSE:NCE:WINDOW_ACTIVE` | `PRECONDITION_FAILED` | Scale-down blocked by active NCE commitment window | `SCHEDULE_FOR_RENEWAL` |
| `LICENSE:QUANTITY:OUT_OF_RANGE` | `BAD_REQUEST` | Requested quantity outside `minQuantity`/`maxQuantity` bounds | `NONE` |
| `LICENSE:SCALE_DOWN:PENDING` | `CONFLICT` | A `pendingQuantity` is already staged for this license | `REVIEW_QUEUE` |

#### CATALOG — Offerings & Pricing

| Error Code | tRPC Code | Description | Recovery |
|---|---|---|---|
| `CATALOG:OFFERING:UNAVAILABLE` | `PRECONDITION_FAILED` | ProductOffering is out of stock or delisted | `NONE` |
| `CATALOG:OFFERING:PRICE_MISSING` | `PRECONDITION_FAILED` | `effectiveUnitCost` is null — pricing not yet fetched | `FORCE_SYNC` |

#### PROVISION — Provisioning Validation

| Error Code | tRPC Code | Description | Recovery |
|---|---|---|---|
| `PROVISION:COST:MISMATCH` | `PRECONDITION_FAILED` | Estimated proration differs from vendor actuals by > 1% | `MANUAL_OVERRIDE` |
| `PROVISION:QUEUE:CONFLICT` | `CONFLICT` | A conflicting action is already scheduled for this resource | `REVIEW_QUEUE` |
| `PROVISION:GATE:DISABLED` | `PRECONDITION_FAILED` | `Organization.provisioningEnabled` is false — contract not signed | `SIGN_CONTRACT` |

#### COMPLIANCE — Legal & Regulatory Gates

| Error Code | tRPC Code | Description | Recovery |
|---|---|---|---|
| `COMPLIANCE:DPA:NOT_ACCEPTED` | `PRECONDITION_FAILED` | DPA not yet signed — provisioning blocked | `ACCEPT_DPA` |
| `COMPLIANCE:CONTRACT:UNSIGNED` | `PRECONDITION_FAILED` | Organization contract not signed — org not activated | `SIGN_CONTRACT` |

#### DATA — Sync & Freshness

| Error Code | tRPC Code | Description | Recovery |
|---|---|---|---|
| `DATA:SYNC:STALE` | `PRECONDITION_FAILED` | Last successful vendor sync > 24 hours ago — data may be outdated | `FORCE_SYNC` |

#### ADMIN — Member & Role Management

| Error Code | tRPC Code | Description | Recovery |
|---|---|---|---|
| `ADMIN:MEMBER:ALREADY_EXISTS` | `CONFLICT` | User already has a Member record in this organization | `NONE` |
| `ADMIN:INVITATION:ALREADY_PENDING` | `CONFLICT` | An active invitation already exists for this email in this org | `NONE` |
| `ADMIN:INVITATION:EXPIRED` | `PRECONDITION_FAILED` | Invitation has expired and cannot be accepted | `RESEND_INVITATION` |
| `ADMIN:INVITATION:INVALID_STATUS` | `BAD_REQUEST` | Invitation is not in `PENDING` status — cannot be accepted/rejected | `NONE` |

### Recovery Hints

Every business error may include an optional `recovery` object in `cause`. Recovery hints are **suggestions** — the client (UI or AI agent) decides whether and how to act on them.

#### Recovery Action Types

| Action | Description | Typical UI Behavior |
|---|---|---|
| `REDIRECT_ORG_SWITCHER` | User must select an org context | Navigate to org switcher / onboarding |
| `REQUEST_ACCESS` | User needs a higher role | Show "Request Access" flow or contact admin |
| `SCHEDULE_FOR_RENEWAL` | Action blocked now, can be scheduled for commitment end | Show scheduling UI with `commitmentEndDate` |
| `REAUTH_VENDOR` | Vendor credentials need re-authorization | Redirect to vendor connection settings |
| `MANUAL_OVERRIDE` | Automated action halted, user approval required | Show diff and confirm/cancel dialog |
| `REVIEW_QUEUE` | Conflicting scheduled action exists | Show pending actions list with replace/cancel options |
| `FORCE_SYNC` | Data is stale, sync needed before proceeding | Trigger sync and retry the original action |
| `ACCEPT_DPA` | DPA acceptance required | Show DPA acceptance flow |
| `SIGN_CONTRACT` | Contract signing required to activate org | Redirect to contract signing flow |
| `RESEND_INVITATION` | Invitation expired, a new one is needed | Offer to resend the invitation |
| `CONTACT_SUPPORT` | No automated recovery — support ticket needed | Show support contact / ticket creation |
| `NONE` | No automated recovery available | Display the error message only |

#### Recovery Object Shape

```typescript
recovery: {
  action: string,   // One of the recovery action types above
  label: string,    // Human-readable button/action text (e.g., "Schedule for Next Renewal")
  params: {         // Contextual data the client needs to execute the recovery
    // Varies by action — see examples below
  },
}
```

#### Recovery Params by Action

| Action | Expected Params |
|---|---|
| `REDIRECT_ORG_SWITCHER` | — (no params needed) |
| `REQUEST_ACCESS` | `requiredRole`, `currentRole` |
| `SCHEDULE_FOR_RENEWAL` | `commitmentEndDate`, `licenseId` |
| `REAUTH_VENDOR` | `vendorType`, `vendorConnectionId` |
| `MANUAL_OVERRIDE` | `estimated`, `actual`, `diffPercent` |
| `REVIEW_QUEUE` | `conflictingActionId`, `scheduledAt` |
| `FORCE_SYNC` | `vendorConnectionId`, `lastSyncAt` |
| `ACCEPT_DPA` | `organizationId`, `latestVersion` |
| `SIGN_CONTRACT` | `organizationId` |
| `CONTACT_SUPPORT` | `vendorType`, `retryAfter` (optional) |

### Error Handling Examples

#### Simple error (no recovery)

```typescript
throw new TRPCError({
  code: 'BAD_REQUEST',
  message: 'Requested quantity exceeds maximum allowed',
  cause: {
    errorCode: 'LICENSE:QUANTITY:OUT_OF_RANGE',
    recovery: {
      action: 'NONE',
      label: 'Adjust quantity',
      params: { min: 1, max: 300, requested: 500 },
    },
  },
});
```

#### Error with automated recovery hint

```typescript
throw new TRPCError({
  code: 'PRECONDITION_FAILED',
  message: 'Vendor credentials have expired',
  cause: {
    errorCode: 'VENDOR:AUTH:EXPIRED',
    recovery: {
      action: 'REAUTH_VENDOR',
      label: 'Reconnect Vendor',
      params: {
        vendorType: 'PAX8',
        vendorConnectionId: connection.id,
      },
    },
  },
});
```

#### Error with queue conflict

```typescript
throw new TRPCError({
  code: 'CONFLICT',
  message: 'A scale-down is already scheduled for this license',
  cause: {
    errorCode: 'LICENSE:SCALE_DOWN:PENDING',
    recovery: {
      action: 'REVIEW_QUEUE',
      label: 'Review Pending Changes',
      params: {
        licenseId: license.id,
        pendingQuantity: license.pendingQuantity,
        inngestRunId: license.inngestRunId,
      },
    },
  },
});
```

### Rules

1. **Never leak internals** — `message` must be safe for end users. No stack traces, SQL, or internal IDs beyond what the client already knows.
2. **Always use Layer 1 + Layer 2** — Every business error must set both the tRPC `code` (transport) and `cause.errorCode` (business).
3. **Recovery hints are optional but encouraged** — If a clear next step exists, include `recovery`. If not, omit it or use `action: 'NONE'`.
4. **Error codes are a stable contract** — Once shipped, an error code is never renamed or removed. New codes are added freely. Deprecation follows the process in [§11](#11-versioning-strategy).
5. **`cause.errorCode` is the programmatic key** — Clients must never parse `message` for logic. The `message` is for humans; the `errorCode` is for code.
6. **Vendor errors are wrapped** — Raw distributor API errors are caught in the adapter layer and re-thrown as `VENDOR:API:UPSTREAM_ERROR` with safe details only.

---

## 7. Idempotency

### Overview

Every tRPC mutation requires an `idempotencyKey` field in the mutation input. This is enforced by the `idempotencyGuard` middleware in `src/server/trpc/init.ts` before the procedure handler executes.

### Key Format

- **Type:** UUID v4 (e.g., `550e8400-e29b-41d4-a716-446655440000`)
- **Generated by:** The client, before sending the request
- **Uniqueness scope:** Per-organization (scoped to `organizationId` to prevent cross-org cache collisions)

### Storage & TTL

| Property | Value |
|---|---|
| **Store** | Redis |
| **Key pattern** | `idempotency:{organizationId}:{key}` |
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
const response = await trpc.license.scaleUp.mutate({
  licenseId: 'clx...',
  newQuantity: 50,
  idempotencyKey: crypto.randomUUID(),
});
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
| `vendor` (connect/disconnect) | ✅ | ❌ | ✅ | ❌ | ❌ | 🔑 | ❌ | ❌ |
| `vendor` (syncCatalog) | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| `billing` (read) | ✅ | 👁 | ✅ | ✅ | ❌ | ✅ | ✅ | 👁 |
| `admin` | ✅ | 👁 | ✅ | ✅ | ❌ | 🔑 | ❌ | ❌ |
| `organization` (read) | ✅ | 👁 | ✅ | ✅ | 👁 | ✅ | ✅ | 👁 |
| `organization` (update/deactivate/acceptDpa) | ✅ | ❌ | ✅ | ❌ | ❌ | 🔑 | ❌ | ❌ |
| `organization` (createClient) | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `organization` (switchOrg) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> **MSP delegation:** When an MSP user's session is scoped to a client org (`Session.activeOrganizationId` = client org), their MSP role grants the access level shown in the matrix above. They do not need a separate `Member` record on the client org.
>
> **Note on billing:** The billing router currently has no mutations — all procedures are read-only queries. A `billing (write)` row is omitted until mutation procedures are added.
>
> **Note on `organization.switchOrg`:** This mutation uses `authenticatedMutationProcedure` — any authenticated user can call it. Access to the target org is validated dynamically (direct membership, MSP delegation, or platform admin role).

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
