# Tally Architecture

**Version:** 2.3 (April 2026)
**Status:** Locked & Production-Ready

---

## Table of Contents

1. [Core Principles](#1-core-principles)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Request Lifecycle](#3-request-lifecycle)
4. [Key Rules (Enforced Globally)](#4-key-rules-enforced-globally)
5. [RBAC & MSP Multi-Tenancy](#5-rbac--msp-multi-tenancy)
6. [Canonical Catalog Layer](#6-canonical-catalog-layer-bundle-aware)
7. [Data Model Overview](#7-data-model-overview)
8. [Durable Workflows (Inngest)](#8-durable-workflows-inngest)
9. [Security & Compliance](#9-security--compliance)
10. [Observability & Error Handling](#10-observability--error-handling)
11. [Deployment Overview](#11-deployment-overview)
12. [Glossary](#12-glossary)

---

## 1. Core Principles

| Principle | Description |
|---|---|
| **Discovery-First Onboarding** | Value is demonstrated before any technical integration is required. |
| **Multi-Distributor Neutrality** | Unified business logic handles Pax8, Ingram, and direct vendors without special-casing. |
| **Strict Commitment Model** | NCE-style no-refund windows are enforced natively via durable workflows. |
| **Zero-Trust Multi-Tenancy** | Every database query is scoped to an `organizationId` via Row-Level Security (RLS). Direct `PrismaClient` usage is **forbidden**. |
| **Financial & Legal Precision** | `Decimal.js` is used for all monetary math. DPA acceptance gates are integrated into provisioning flows. |
| **MSP-Native RBAC** | Three-tier role model (Platform → MSP → Client Org) with parent-child org hierarchy. MSP staff access client orgs via delegation, not membership duplication. |

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────┐
│         Client                              │
│   Next.js 16.2 (App Router + RSC)          │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│         proxy.ts                            │
│   Central Trust Boundary & Auth             │
│   - Session validation                      │
│   - organizationId injection                │
│   - RBAC role resolution                   │
│   - Idempotency-Key enforcement             │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│         tRPC v11 Context                    │
│   RLS Prisma Proxy + AsyncLocalStorage      │
│   - All DB access scoped by org             │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│         Business Logic                      │
│   Bundle Resolution + Commitment Logic      │
└──────────┬───────────────────────┬──────────┘
           │                       │
┌──────────▼──────────┐  ┌────────▼──────────┐
│   Inngest           │  │   Redis Cache      │
│   Durable Workflows │  │   (per-org ns.)    │
└──────────┬──────────┘  └───────────────────┘
           │
┌──────────▼──────────────────────────────────┐
│         Vendor Adapters                     │
│   Pax8 · Ingram · Direct · (extensible)    │
└─────────────────────────────────────────────┘
```

**Storage at rest:**

- **PostgreSQL 18** — primary datastore with RLS enforced via Prisma Proxy.
- **Garage (S3-compatible)** — binary/file storage, partitioned as `org/{organizationId}/...`.
- **Redis** — ephemeral cache, namespaced as `cache:{organizationId}:...`.

---

## 3. Request Lifecycle

Every mutating request follows this path:

1. **Client** sends a request with a session cookie and an `Idempotency-Key` header.
2. **`proxy.ts`** validates the session, extracts `organizationId`, resolves the effective role, and rejects duplicates via the idempotency store.
3. **tRPC router** receives the request; the RLS Prisma Proxy is initialised with the resolved `organizationId` via `AsyncLocalStorage`.
4. **Business logic** executes — all DB calls are automatically scoped. Sensitive vendor credentials are decrypted only at call time.
5. **Inngest** is enqueued for any operation that requires a deferred or durable step (e.g., commitment-gated scale-downs).
6. **AuditLog** entry is written before the response is returned.

---

## 4. Key Rules (Enforced Globally)

> These rules are non-negotiable. PRs that violate them will not be merged.

### 4.1 Idempotency
Every `tRPC` mutation **must** validate an `Idempotency-Key`. Duplicate requests within the validity window return the cached response without re-executing.

### 4.2 Access Control
**Never** instantiate `new PrismaClient()` directly. Always use the RLS-wrapped proxy instance provided via tRPC context. Queries that bypass RLS are a critical security violation.

### 4.3 Credential Safety
- Vendor secrets are encrypted at rest using **AES-256-GCM**.
- Secrets are **never logged**, exposed in API responses, or stored in plaintext.
- Decryption occurs only within the vendor adapter, scoped to the executing request.

### 4.4 Durable Context
All Inngest job functions must wrap their logic with `withTenantContext(orgId)` to ensure RLS remains active in async execution:

```typescript
await withTenantContext(organizationId, async () => {
  // All DB calls here are automatically scoped to organizationId
});
```

### 4.5 Namespace Isolation

| Store | Pattern |
|---|---|
| Redis | `cache:{organizationId}:...` |
| Garage (S3) | `org/{organizationId}/...` |

---

## 5. RBAC & MSP Multi-Tenancy

### 5.1 Organization Types

Every `Organization` has an `organizationType` that determines its place in the hierarchy:

| Type | Description |
|---|---|
| `DIRECT` | A standalone org with no MSP parent. Members have `OrgRole` only. |
| `MSP` | A Managed Service Provider. Members have `MspRole` and can act on all child client orgs. |
| `CLIENT` | A client org managed by an MSP. Has a `parentOrganizationId` pointing to the MSP org. |

### 5.2 Three-Tier Role Model

```
Tier 1 — Platform (Tally staff only)
  SUPER_ADMIN   Full access across all orgs on the platform
  SUPPORT       Read-only access across all orgs for support purposes

Tier 2 — MSP (set on Member records within an MSP org)
  MSP_OWNER      Full control of the MSP org and all its client orgs
  MSP_ADMIN      Manage client orgs, billing, and provisioning
  MSP_TECHNICIAN Operate within assigned client orgs (read + provision)

Tier 3 — Client Org (set on Member records within a DIRECT or CLIENT org)
  ORG_OWNER  Full control — typically the customer admin
  ORG_ADMIN  Manage subscriptions and licenses
  ORG_MEMBER Read-only / limited actions
```

### 5.3 MSP Hierarchy & Delegated Access

MSP staff do **not** need a `Member` row in every client org they manage. Access is resolved at the RLS layer by traversing `parentOrganizationId`:

```
RLS access check order for a given organizationId:
  1. User.platformRole is set         → ALLOW (Tally staff)
  2. User has Member row in this org
     with orgRole set                 → ALLOW (direct org member)
  3. This org has a parentOrganizationId,
     and user has Member row in the
     parent MSP org with mspRole set  → ALLOW (MSP delegated access)
  4. None of the above               → DENY
```

This means adding a new MSP technician requires one `Member` row on the MSP org — not one row per client org.

### 5.4 Member Role Assignment Rules

A `Member` record has two nullable role fields. **Exactly one must be set**, determined by the org type:

| Org Type | Field to set | Field to leave null |
|---|---|---|
| `MSP` | `mspRole` | `orgRole` |
| `CLIENT` or `DIRECT` | `orgRole` | `mspRole` |

A user may hold `Member` rows in both an MSP org and a client org simultaneously (e.g., an MSP technician who is also the `ORG_OWNER` of their own client account).

### 5.5 Session & Org Switching

`Session.activeOrganizationId` tracks which org the user is currently acting as. For MSP users this may be set to:
- The **MSP org** — to manage the MSP's own settings, members, and billing.
- Any **client org** — to act on behalf of that client. The RLS proxy validates delegated access before scoping the session.

---

## 6. Canonical Catalog Layer (Bundle-Aware)

Tally models complex commercial licenses (e.g., Microsoft 365 E3) using a three-tier hierarchy:

```
Product          — The atomic service (e.g., Exchange Online, Teams, SharePoint)
    └── Bundle/SKU   — The commercial package (e.g., Microsoft 365 E3)
            └── ProductOffering — Distributor-specific price point
                                  (e.g., Pax8's price for M365 E3)
```

**Why this matters:** A single `Bundle` can be fulfilled by multiple distributors. The `ProductOffering` layer enables Tally to compare pricing across Pax8, Ingram, and direct vendors without duplicating catalog data.

### Adding a New Bundle

1. Define the atomic `Product` records that make up the bundle.
2. Create the `Bundle` record, mapping the vendor `globalSkuId` to those products.
3. Attach one `ProductOffering` per distributor that carries the SKU.

---

## 7. Data Model Overview

| Entity | Purpose |
|---|---|
| `Organization` | The tenant hub. Holds billing metadata, contract status, DPA state, org type (`MSP` / `CLIENT` / `DIRECT`), and optional `parentOrganizationId`. Supports soft-delete via `deletedAt`. |
| `Member` | Scopes a `User` to an `Organization` with either an `OrgRole` (for CLIENT/DIRECT orgs) or an `MspRole` (for MSP orgs). |
| `Invitation` | Tracks pending invitations to join an org. Uses `InvitationStatus` enum (`PENDING` / `ACCEPTED` / `REJECTED` / `EXPIRED` / `REVOKED`) and typed role fields (`orgRole` / `mspRole`). Linked to the inviting user via `inviterId`. |
| `VendorConnection` | Encrypted credentials for a third-party distributor, scoped to an org. |
| `Bundle` | A commercial SKU (e.g., M365 E3) composed of one or more `Product` records. |
| `ProductOffering` | A distributor-specific price point for a `Bundle`. |
| `Subscription` | The active commercial agreement for a `Bundle` within an org. |
| `License` | The live entitlement linked to a `Subscription`. Tracks `quantity` and `pendingQuantity`. |
| `DpaAcceptance` | Records which user accepted the DPA and at what version, per org. Unique per `[organizationId, version]`. |
| `AuditLog` | Immutable append-only record of every mutation. Never updated or deleted. Uses `onDelete: Restrict` — audit logs survive org deletion. |

### Key Relationships

```
Organization (MSP)
  ├── Member (1:N, mspRole set)        ← MSP_OWNER / MSP_ADMIN / MSP_TECHNICIAN
  ├── Invitation (1:N)                 ← pending invitations (InvitationStatus enum)
  ├── clientOrganizations (1:N)        ← child CLIENT orgs this MSP manages
  │     ├── Member (1:N, orgRole set)  ← ORG_OWNER / ORG_ADMIN / ORG_MEMBER
  │     ├── VendorConnection (1:N)
  │     ├── Subscription (1:N)
  │     │     ├── Bundle (N:1)         ← what SKU this subscription covers
  │     │     └── License (1:1)
  │     │           └── ProductOffering (N:1)  ← distributor + price
  │     ├── DpaAcceptance (1:N)        ← unique per [organizationId, version]
  │     └── AuditLog (1:N)            ← onDelete: Restrict (immutable)
  ├── DpaAcceptance (1:N)
  └── AuditLog (1:N)                  ← onDelete: Restrict (immutable)

Organization (DIRECT)
  ├── Member (1:N, orgRole set)
  ├── Invitation (1:N)
  ├── VendorConnection (1:N)
  ├── Subscription (1:N)
  ├── DpaAcceptance (1:N)
  └── AuditLog (1:N)                  ← onDelete: Restrict (immutable)

Bundle
  ├── Product (N:M via BundleProduct)
  └── ProductOffering (1:N) → per distributor
        └── Subscription (1:N) ← fulfilled via this offering

User
  ├── platformRole (PlatformRole?)  ← Tally staff only; null for regular users
  ├── Member (1:N)                  ← one record per org the user belongs to
  └── sentInvitations (1:N)         ← invitations this user has sent
```

> A `Subscription` references a `Bundle` to record *what* was purchased, and a `License` references a `ProductOffering` to record *from which distributor* and *at what price*.

---

## 8. Durable Workflows (Inngest)

Inngest handles operations that cannot be executed immediately — primarily scale-downs blocked by an NCE commitment window.

### Commitment-Gated Scale-Down Flow

```
User requests scale-down
        │
        ▼
[ Stage ] Save target quantity to License.pendingQuantity
          Store Inngest run ID in License.inngestRunId
        │
        ▼
[ Wait ] Inngest step.sleepUntil(commitmentEndDate)
        │
        ▼
[ Execute ] withTenantContext → call Vendor API with pendingQuantity
        │
        ▼
[ Promote ] pendingQuantity → quantity on License record
        │
        ▼
[ Verify ] Write AuditLog entry
```

### Workflow Guarantees

- **At-least-once delivery**: Inngest retries failed steps automatically.
- **Idempotency**: Each workflow step is keyed to prevent double-execution on retry.
- **Tenant isolation**: `withTenantContext` ensures RLS is active even in async background jobs.
- **Cancellable**: `License.inngestRunId` allows in-flight workflows to be cancelled if the user reverses their scale-down request.

---

## 9. Security & Compliance

| Control | Implementation |
|---|---|
| Row-Level Security | Enforced via Prisma Proxy on every query; bypassing it is a build-time violation. |
| RBAC | Three-tier role model resolved at `proxy.ts`; MSP delegation checked via `parentOrganizationId` traversal. |
| Encryption at rest | AES-256-GCM for all `VendorConnection` credential fields. |
| File isolation | Garage (S3) objects prefixed with `org/{organizationId}/`. Cross-org access is impossible by design. |
| Cache isolation | Redis keys prefixed with `cache:{organizationId}:`. |
| DPA gate | Data Processing Agreement acceptance is checked before any vendor provisioning flow begins. Unique per `[organizationId, version]` — cannot be duplicated. |
| Audit trail | Every mutation produces an immutable `AuditLog` row before the response is returned. Uses `onDelete: Restrict` — audit logs cannot be cascade-deleted when an organization is removed. Archive or reassign audit logs before deleting an org. |
| Organization soft-delete | Organizations are deactivated via `deletedAt` (soft-delete) rather than hard-deleted. This preserves referential integrity across subscriptions, audit logs, and billing snapshots. Application code filters on `deletedAt IS NULL` for normal queries. |
| Secret hygiene | No secret may carry the `NEXT_PUBLIC_` prefix. Secrets are never logged. |

---

## 10. Observability & Error Handling

### Logging

- Structured JSON logs are emitted at the tRPC middleware layer.
- Log entries include `organizationId`, `traceId`, and the tRPC procedure name.
- **Secrets and credential fields must never appear in log output.**

### Error Classes

All business errors use a hierarchical `DOMAIN:CATEGORY:CODE` format with optional structured recovery hints. See [API-Conventions.md §6](../docs/API-Conventions.md#6-error-handling) for the full error catalog.

| Error Type | Example Code | Handling Strategy |
|---|---|---|
| Validation error (Zod) | — | Rejected at the router boundary; client receives a typed `BAD_REQUEST` error. |
| Auth / RBAC violation | `AUTH:RBAC:INSUFFICIENT` | Rejected at `proxy.ts`; returns 403 with `recovery: REQUEST_ACCESS`. No internal detail leaked. |
| Vendor API error | `VENDOR:API:UPSTREAM_ERROR` | Caught in the adapter layer; written to `AuditLog`; surfaced as 500 with safe message only. |
| Vendor auth expired | `VENDOR:AUTH:EXPIRED` | Returns 412 with `recovery: REAUTH_VENDOR`; vendor connection set to stalled state. |
| Commitment violation | `LICENSE:NCE:WINDOW_ACTIVE` | Blocked at business logic; returns 412 with `recovery: SCHEDULE_FOR_RENEWAL` and `commitmentEndDate`. |
| Compliance gate | `COMPLIANCE:DPA:NOT_ACCEPTED` | Returns 412 with `recovery: ACCEPT_DPA`; provisioning blocked until DPA is signed. |
| Sync staleness | `DATA:SYNC:STALE` | Returns 412 with `recovery: FORCE_SYNC`; provisioning blocked until fresh data is available. |
| Queue conflict | `PROVISION:QUEUE:CONFLICT` | Returns 409 with `recovery: REVIEW_QUEUE`; shows existing scheduled action. |
| Inngest step failure | — | Automatic retry with exponential backoff; alerting after max retries exceeded. |

### Tracing

Each request carries a `traceId` (generated at `proxy.ts`) that is threaded through tRPC context, Inngest jobs, and log output for end-to-end correlation.

---

## 11. Deployment Overview

| Layer | Technology |
|---|---|
| Application | Next.js 16.2, deployed as a Node.js server |
| Database | PostgreSQL 18 (managed or self-hosted) |
| Background jobs | Inngest Cloud (or self-hosted Inngest Dev Server for local) |
| Cache | Redis (managed or Docker for local) |
| File storage | Garage (S3-compatible; AWS S3 or compatible in production) |

### Environment Tiers

| Tier | Purpose |
|---|---|
| `local` | Docker Compose stack; Inngest Dev Server |
| `staging` | Full cloud stack; mirrors production config |
| `production` | Live tenant traffic; change-controlled deploys |

> See [Developer.md](../docs/Developer.md) for local setup instructions and environment variable reference.

---

## 12. Glossary

| Term | Definition |
|---|---|
| **NCE** | New Commerce Experience — Microsoft's licensing model with fixed commitment windows and no mid-term refunds. |
| **RLS** | Row-Level Security — a PostgreSQL feature (enforced via Prisma Proxy) that scopes every query to the active `organizationId`. |
| **Commitment window** | The period during which a subscription quantity cannot be reduced without penalty. |
| **`pendingQuantity`** | A staged quantity change on a `License` that will be promoted to `quantity` once the commitment window expires. |
| **Idempotency-Key** | A client-supplied header that prevents duplicate execution of the same mutation. |
| **ProductOffering** | A distributor-specific price point that links a `Bundle` to a vendor's catalog entry. |
| **Vendor adapter** | A module that translates Tally's internal model into the API contract of a specific distributor (Pax8, Ingram, etc.). |
| **`withTenantContext`** | A utility that activates RLS for a given `organizationId` within an async execution scope. |
| **MSP** | Managed Service Provider — an organization that manages subscriptions and licenses on behalf of multiple client organizations. |
| **`OrganizationType`** | Enum classifying an org as `MSP`, `CLIENT`, or `DIRECT`, determining which access model applies. |
| **`MspRole`** | A role held by a user within an MSP org (`MSP_OWNER`, `MSP_ADMIN`, `MSP_TECHNICIAN`). Grants delegated access to all child client orgs. |
| **`OrgRole`** | A role held by a user within a CLIENT or DIRECT org (`ORG_OWNER`, `ORG_ADMIN`, `ORG_MEMBER`). |
| **`PlatformRole`** | A Tally staff role (`SUPER_ADMIN`, `SUPPORT`) set directly on `User`. Null for all regular users. |
| **`InvitationStatus`** | Enum tracking invitation lifecycle: `PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `REVOKED`. |
| **Soft-delete** | Deactivation pattern using a nullable `deletedAt` timestamp instead of hard deletion. Active records have `deletedAt IS NULL`. Used on `Organization` to preserve referential integrity. |
| **Delegated access** | MSP user access to a client org resolved via `parentOrganizationId` traversal, without requiring a `Member` row on the client org. |
