# Tally API Reference

**Version:** 1.0 (April 2026)
**Status:** Living Document — updated as procedures are added

> This document describes every tRPC procedure in Tally's API. For conventions, error codes, pagination patterns, and authorization rules, see [API-Conventions.md](./API-Conventions.md).

---

## Table of Contents

1. [Catalog Router](#1-catalog-router)
2. [Subscription Router](#2-subscription-router)
3. [License Router](#3-license-router)
4. [Vendor Router](#4-vendor-router)
5. [Billing Router](#5-billing-router)
6. [Admin Router](#6-admin-router)
7. [Organization Router](#7-organization-router)

---

## Procedure Entry Format

Each procedure is documented with:

| Field | Description |
|---|---|
| **Type** | `query` or `mutation` |
| **Description** | What the procedure does |
| **Minimum Role** | Lowest role tier that can call this procedure |
| **Idempotent** | Whether the procedure requires an `Idempotency-Key` (all mutations do) |
| **Input** | Zod schema for the request payload |
| **Output** | Shape of the response |
| **Side Effects** | AuditLog entries, Inngest jobs, cache invalidations |

---

## 1. Catalog Router

Manages the canonical catalog: Products, Bundles, and distributor-specific ProductOfferings.

### `catalog.listBundles`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | List all Bundles with optional filtering and pagination |
| **Minimum Role** | `ORG_MEMBER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  where: z.object({
    category: z.string().optional(),
    name: z.string().optional(), // partial match
  }).optional(),
  orderBy: z.object({
    field: z.enum(['name', 'createdAt']),
    direction: z.enum(['asc', 'desc']).default('desc'),
  }).optional(),
})
```

**Output:**

```typescript
{
  items: Bundle[],            // { id, globalSkuId, name, friendlyName, description, category }
  nextCursor: string | null,
}
```

---

### `catalog.getBundle`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | Get a single Bundle by ID, including its Products and available ProductOfferings |
| **Minimum Role** | `ORG_MEMBER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  bundleId: z.string().cuid(),
})
```

**Output:**

```typescript
{
  id: string,
  globalSkuId: string,
  name: string,
  friendlyName: string,
  description: string | null,
  category: string | null,
  products: Product[],
  offerings: ProductOffering[],  // all distributor price points for this bundle
}
```

---

### `catalog.listProductOfferings`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | List ProductOfferings with filtering by bundle, vendor type, or availability |
| **Minimum Role** | `ORG_MEMBER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  where: z.object({
    bundleId: z.string().cuid().optional(),
    sourceType: z.nativeEnum(VendorType).optional(),
    availability: z.string().optional(),
  }).optional(),
})
```

**Output:**

```typescript
{
  items: ProductOffering[],   // includes effectiveUnitCost, partnerMarginPercent, currency, etc.
  nextCursor: string | null,
}
```

---

### `catalog.comparePricing`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | Compare pricing for a Bundle across all available distributors. Returns ranked options with margin calculations. |
| **Minimum Role** | `ORG_ADMIN` |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  bundleId: z.string().cuid(),
  quantity: z.number().int().positive(),
})
```

**Output:**

```typescript
{
  bundleId: string,
  bundleName: string,
  quantity: number,
  options: Array<{
    productOfferingId: string,
    sourceType: VendorType,           // PAX8, INGRAM, TDSYNNEX, DIRECT
    effectiveUnitCost: string,        // Decimal as string
    totalCost: string,                // Decimal as string (unitCost * quantity)
    partnerMarginPercent: string | null,
    currency: string,
    availability: string | null,
    minQuantity: number | null,
    maxQuantity: number | null,
    isEligible: boolean,              // false if quantity is out of min/max range
  }>,
}
```

**Notes:**
- Options are sorted by `totalCost` ascending (cheapest first).
- All monetary values use `Decimal.js` and are serialized as strings.
- `isEligible` is `false` when the requested quantity falls outside `minQuantity`/`maxQuantity`.

---

## 2. Subscription Router

Manages the lifecycle of Subscriptions — active commercial agreements for Bundles within an org.

### `subscription.list`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | List all subscriptions for the active organization |
| **Minimum Role** | `ORG_MEMBER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  where: z.object({
    status: z.nativeEnum(SubscriptionStatus).optional(),
    bundleId: z.string().cuid().optional(),
  }).optional(),
})
```

**Output:**

```typescript
{
  items: Array<Subscription & {
    bundle: Bundle,
    licenses: License[],
  }>,
  nextCursor: string | null,
}
```

---

### `subscription.get`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | Get a single subscription by ID with full details |
| **Minimum Role** | `ORG_MEMBER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  subscriptionId: z.string().cuid(),
})
```

**Output:**

```typescript
{
  id: string,
  status: SubscriptionStatus,
  externalId: string,
  commitmentEndDate: Date | null,
  bundle: Bundle,
  licenses: Array<License & { productOffering: ProductOffering | null }>,
  vendorConnection: { id: string, vendorType: VendorType, status: VendorConnectionStatus },
}
```

---

### `subscription.create`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Create a new subscription by purchasing a Bundle through a specific ProductOffering |
| **Minimum Role** | `ORG_ADMIN` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  productOfferingId: z.string().cuid(),
  quantity: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  subscription: Subscription,
  license: License,
  purchaseTransaction: PurchaseTransaction,
}
```

**Side Effects:**
- `AuditLog` entry: `subscription.created`
- `PurchaseTransaction` record created
- Vendor adapter called to provision on the distributor

**Preconditions:**
- DPA must be accepted (`DPA_NOT_ACCEPTED` error if not)
- Org must have `provisioningEnabled: true` (`PROVISIONING_DISABLED` error if not)
- ProductOffering must have `effectiveUnitCost` populated (`OFFERING_PRICE_MISSING` error if not)
- Requested quantity must be within `minQuantity`/`maxQuantity` (`QUANTITY_OUT_OF_RANGE` error if not)

---

### `subscription.cancel`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Cancel a subscription. If within a commitment window, the cancellation is scheduled. |
| **Minimum Role** | `ORG_OWNER` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  subscriptionId: z.string().cuid(),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  subscription: Subscription,  // updated status
  scheduledDate: Date | null,  // non-null if cancellation is deferred
}
```

**Side Effects:**
- `AuditLog` entry: `subscription.cancelled` or `subscription.cancellation_scheduled`
- If commitment window is active, Inngest workflow enqueued

---

## 3. License Router

Manages live license entitlements — quantity changes, scale-up/down, and commitment-gated operations.

### `license.list`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | List all licenses for the active organization |
| **Minimum Role** | `ORG_MEMBER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  where: z.object({
    subscriptionId: z.string().cuid().optional(),
    hasPendingScaleDown: z.boolean().optional(), // filter for licenses with pendingQuantity set
  }).optional(),
})
```

**Output:**

```typescript
{
  items: Array<License & {
    subscription: Subscription & { bundle: Bundle },
    productOffering: ProductOffering | null,
  }>,
  nextCursor: string | null,
}
```

---

### `license.get`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | Get a single license by ID with full context |
| **Minimum Role** | `ORG_MEMBER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  licenseId: z.string().cuid(),
})
```

**Output:**

```typescript
{
  id: string,
  quantity: number,
  pendingQuantity: number | null,
  inngestRunId: string | null,
  subscription: Subscription & { bundle: Bundle, commitmentEndDate: Date | null },
  productOffering: ProductOffering | null,
}
```

---

### `license.scaleUp`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Increase license quantity. Executed immediately — no commitment window restriction on scale-ups. |
| **Minimum Role** | `ORG_ADMIN` / `MSP_TECHNICIAN` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  licenseId: z.string().cuid(),
  newQuantity: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  license: License,           // updated quantity
  purchaseTransaction: PurchaseTransaction,
}
```

**Side Effects:**
- `AuditLog` entry: `license.scale_up.executed`
- `PurchaseTransaction` record created
- Vendor adapter called to update quantity on the distributor

**Validation:**
- `newQuantity` must be greater than current `quantity` (otherwise use `scaleDown`)
- `newQuantity` must not exceed `maxQuantity` on the ProductOffering

---

### `license.scaleDown`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Decrease license quantity. If a commitment window is active, the change is staged as `pendingQuantity` and executed by an Inngest workflow after the window expires. |
| **Minimum Role** | `ORG_ADMIN` / `MSP_TECHNICIAN` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  licenseId: z.string().cuid(),
  newQuantity: z.number().int().min(0),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  license: License,                     // quantity unchanged if staged; pendingQuantity set
  isStaged: boolean,                    // true if blocked by commitment window
  commitmentEndDate: Date | null,       // when the staged change will execute
  inngestRunId: string | null,          // ID of the scheduled workflow
}
```

**Side Effects:**
- `AuditLog` entry: `license.scale_down.staged` or `license.scale_down.executed`
- If staged: Inngest workflow enqueued with `step.sleepUntil(commitmentEndDate)`
- If immediate: Vendor adapter called directly

**Validation:**
- `newQuantity` must be less than current `quantity`
- `newQuantity` must not be less than `minQuantity` on the ProductOffering
- A pending scale-down must not already exist (`PENDING_SCALE_DOWN_EXISTS` error)

---

### `license.cancelPendingScaleDown`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Cancel a previously staged scale-down. Clears `pendingQuantity` and cancels the Inngest workflow. |
| **Minimum Role** | `ORG_ADMIN` / `MSP_TECHNICIAN` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  licenseId: z.string().cuid(),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  license: License,  // pendingQuantity cleared, inngestRunId cleared
}
```

**Side Effects:**
- `AuditLog` entry: `license.scale_down.cancelled`
- Inngest workflow cancelled via `inngestRunId`

---

## 4. Vendor Router

Manages connections to third-party distributors (Pax8, Ingram Micro, TD Synnex, direct vendors).

### `vendor.listConnections`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | List all vendor connections for the active organization |
| **Minimum Role** | `ORG_ADMIN` / `MSP_TECHNICIAN` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  where: z.object({
    vendorType: z.nativeEnum(VendorType).optional(),
    status: z.nativeEnum(VendorConnectionStatus).optional(),
  }).optional(),
})
```

**Output:**

```typescript
{
  items: Array<{
    id: string,
    vendorType: VendorType,
    status: VendorConnectionStatus,
    lastSyncAt: Date | null,
    // credentials are NEVER included in output
  }>,
}
```

---

### `vendor.connect`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Establish a new vendor connection with encrypted credentials |
| **Minimum Role** | `ORG_OWNER` / `MSP_OWNER` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  vendorType: z.nativeEnum(VendorType),
  credentials: z.string(), // will be encrypted with AES-256-GCM before storage
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  vendorConnection: {
    id: string,
    vendorType: VendorType,
    status: VendorConnectionStatus, // PENDING until first successful sync
  },
}
```

**Side Effects:**
- `AuditLog` entry: `vendor.connected` (credentials are NOT logged)
- Inngest workflow enqueued for initial catalog sync

**Preconditions:**
- DPA must be accepted
- No existing active connection of the same `vendorType` for this org

---

### `vendor.disconnect`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Disconnect a vendor connection. Credentials are securely erased. |
| **Minimum Role** | `ORG_OWNER` / `MSP_OWNER` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  vendorConnectionId: z.string().cuid(),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  vendorConnection: { id: string, status: 'DISCONNECTED' },
}
```

**Side Effects:**
- `AuditLog` entry: `vendor.disconnected`
- Credentials overwritten in database
- Active subscriptions through this connection are NOT automatically cancelled

---

### `vendor.syncCatalog`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Trigger a manual catalog sync for a vendor connection. Fetches latest pricing and availability. |
| **Minimum Role** | `ORG_ADMIN` / `MSP_ADMIN` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  vendorConnectionId: z.string().cuid(),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  syncId: string,       // Inngest run ID for tracking
  status: 'ENQUEUED',
}
```

**Side Effects:**
- `AuditLog` entry: `vendor.sync_catalog.enqueued`
- Inngest workflow enqueued with `withTenantContext`

---

## 5. Billing Router

Purchase transactions, billing snapshots, and projected invoices.

### `billing.listTransactions`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | List purchase transactions for the active organization |
| **Minimum Role** | `ORG_MEMBER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  where: z.object({
    status: z.nativeEnum(TransactionStatus).optional(),
  }).optional(),
  orderBy: z.object({
    field: z.enum(['createdAt', 'grossAmount']),
    direction: z.enum(['asc', 'desc']).default('desc'),
  }).optional(),
})
```

**Output:**

```typescript
{
  items: Array<PurchaseTransaction & {
    productOffering: ProductOffering & { bundle: Bundle },
  }>,
  nextCursor: string | null,
}
```

---

### `billing.getSnapshot`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | Get the latest billing snapshot for the active organization, optionally for a specific subscription |
| **Minimum Role** | `ORG_ADMIN` |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  subscriptionId: z.string().cuid().optional(),
  periodStart: z.date().optional(),
  periodEnd: z.date().optional(),
})
```

**Output:**

```typescript
{
  id: string,
  projectedAmount: string,    // Decimal as string
  periodStart: Date,
  periodEnd: Date,
  metadata: {
    distributors: Array<{ vendorType: VendorType, amount: string }>,
    committedChanges: Array<{ licenseId: string, pendingQuantity: number, effectiveDate: Date }>,
  },
}
```

---

### `billing.projectInvoice`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | Generate a projected invoice for the current billing period based on active subscriptions and pending changes |
| **Minimum Role** | `ORG_ADMIN` / `MSP_ADMIN` |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  periodStart: z.date().optional(), // defaults to current period start
  periodEnd: z.date().optional(),   // defaults to current period end
})
```

**Output:**

```typescript
{
  periodStart: Date,
  periodEnd: Date,
  totalProjectedAmount: string,     // Decimal as string
  lineItems: Array<{
    subscriptionId: string,
    bundleName: string,
    vendorType: VendorType,
    quantity: number,
    unitCost: string,               // Decimal as string
    lineTotal: string,              // Decimal as string
    pendingQuantity: number | null,
    commitmentEndDate: Date | null,
  }>,
}
```

---

## 6. Admin Router

Organization administration: members, invitations, roles, and audit log access.

### `admin.listMembers`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | List all members of the active organization |
| **Minimum Role** | `ORG_OWNER` / `MSP_OWNER` |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
})
```

**Output:**

```typescript
{
  items: Array<{
    id: string,
    user: { id: string, name: string, email: string },
    orgRole: OrgRole | null,
    mspRole: MspRole | null,
    createdAt: Date,
  }>,
  nextCursor: string | null,
}
```

---

### `admin.inviteMember`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Invite a user to join the active organization with a specific role |
| **Minimum Role** | `ORG_OWNER` / `MSP_OWNER` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  email: z.string().email(),
  orgRole: z.nativeEnum(OrgRole).optional(),    // for CLIENT/DIRECT orgs
  mspRole: z.nativeEnum(MspRole).optional(),    // for MSP orgs
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  invitation: {
    id: string,
    email: string,
    status: 'PENDING',
    expiresAt: Date,
  },
}
```

**Validation:**
- Exactly one of `orgRole` or `mspRole` must be provided, matching the org type
- Email must not already have an active Member record (`MEMBER_ALREADY_EXISTS` error)

**Side Effects:**
- `AuditLog` entry: `admin.member_invited`
- Invitation email sent

---

### `admin.updateRole`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Update a member's role within the organization |
| **Minimum Role** | `ORG_OWNER` / `MSP_OWNER` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  memberId: z.string().cuid(),
  orgRole: z.nativeEnum(OrgRole).optional(),
  mspRole: z.nativeEnum(MspRole).optional(),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  member: {
    id: string,
    orgRole: OrgRole | null,
    mspRole: MspRole | null,
  },
}
```

**Side Effects:**
- `AuditLog` entry: `admin.role_updated` (with `before` and `after` state)

---

### `admin.removeMember`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Remove a member from the organization |
| **Minimum Role** | `ORG_OWNER` / `MSP_OWNER` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  memberId: z.string().cuid(),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  success: true,
}
```

**Side Effects:**
- `AuditLog` entry: `admin.member_removed`

---

### `admin.listAuditLogs`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | List audit log entries for the active organization |
| **Minimum Role** | `ORG_OWNER` / `MSP_OWNER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  where: z.object({
    action: z.string().optional(),         // e.g., "license.scale_down.*"
    entityId: z.string().cuid().optional(),
    userId: z.string().cuid().optional(),
  }).optional(),
  orderBy: z.object({
    field: z.enum(['createdAt']),
    direction: z.enum(['asc', 'desc']).default('desc'),
  }).optional(),
})
```

**Output:**

```typescript
{
  items: Array<{
    id: string,
    action: string,
    entityId: string | null,
    userId: string | null,
    user: { name: string, email: string } | null,
    before: unknown | null,
    after: unknown | null,
    traceId: string | null,
    createdAt: Date,
  }>,
  nextCursor: string | null,
}
```

---

## 7. Organization Router

Organization settings, MSP client management, and org switching.

### `organization.get`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | Get the active organization's details |
| **Minimum Role** | `ORG_MEMBER` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({}) // no input — uses active org from session
```

**Output:**

```typescript
{
  id: string,
  name: string,
  slug: string,
  logo: string | null,
  organizationType: OrganizationType,
  parentOrganizationId: string | null,
  provisioningEnabled: boolean,
  isContractSigned: boolean,
  billingType: BillingType,
  metadata: unknown | null,
}
```

---

### `organization.update`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Update organization settings |
| **Minimum Role** | `ORG_OWNER` / `MSP_OWNER` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  name: z.string().min(1).max(255).optional(),
  logo: z.string().url().optional(),
  billingType: z.nativeEnum(BillingType).optional(),
  metadata: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  organization: Organization,
}
```

**Side Effects:**
- `AuditLog` entry: `organization.updated` (with `before` and `after` state)

---

### `organization.listClients`

| Field | Value |
|---|---|
| **Type** | `query` |
| **Description** | List all client organizations managed by the active MSP org |
| **Minimum Role** | `MSP_TECHNICIAN` (read-only) |
| **Idempotent** | N/A (query) |

**Input:**

```typescript
z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
})
```

**Output:**

```typescript
{
  items: Array<{
    id: string,
    name: string,
    slug: string,
    organizationType: 'CLIENT',
    provisioningEnabled: boolean,
    isContractSigned: boolean,
    billingType: BillingType,
  }>,
  nextCursor: string | null,
}
```

**Preconditions:**
- Active org must be of type `MSP`. Returns an error if called from a CLIENT or DIRECT org.

---

### `organization.createClient`

| Field | Value |
|---|---|
| **Type** | `mutation` |
| **Description** | Create a new client organization under the active MSP org |
| **Minimum Role** | `MSP_ADMIN` |
| **Idempotent** | Yes — requires `Idempotency-Key` |

**Input:**

```typescript
z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  billingType: z.nativeEnum(BillingType).default('MANUAL_INVOICE'),
  idempotencyKey: z.string().uuid(),
})
```

**Output:**

```typescript
{
  organization: {
    id: string,
    name: string,
    slug: string,
    organizationType: 'CLIENT',
    parentOrganizationId: string,   // the MSP org's ID
    billingType: BillingType,
  },
}
```

**Side Effects:**
- `AuditLog` entry: `organization.client_created`
- No `Member` row created — MSP staff access the new client org via delegation

**Preconditions:**
- Active org must be of type `MSP`
- Slug must be unique across all organizations
