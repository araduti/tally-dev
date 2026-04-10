# Tally Developer Guide

**Last Updated:** April 10, 2026

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Tech Stack](#2-tech-stack)
3. [Local Development Setup](#3-local-development-setup)
4. [Environment Variables](#4-environment-variables)
5. [Coding Standards](#5-coding-standards)
6. [Database Migrations](#6-database-migrations)
7. [Common Workflows](#7-common-workflows)
8. [Adding a Vendor Adapter](#8-adding-a-vendor-adapter)
9. [Testing](#9-testing)
10. [Contributing & Branch Conventions](#10-contributing--branch-conventions)
11. [Troubleshooting](#11-troubleshooting)

> For system design and architectural decisions, see [Architecture.md](./Architecture.md).

---

## 1. Prerequisites

Before starting, ensure the following are installed:

| Tool | Minimum Version | Notes |
|---|---|---|
| Node.js | 24.x | Use [nvm](https://github.com/nvm-sh/nvm) to manage versions |
| npm | 11.x | Bundled with Node.js 24 |
| Docker | 29.x | Required for PostgreSQL, Redis, and Garage |
| Docker Compose | 5.x | Included in Docker Desktop |

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router, RSC, Turbopack) |
| Auth | Better Auth 1.6.x (Organization plugin) |
| API | tRPC v11 + Zod v4 |
| Database | PostgreSQL 18 + Prisma ORM 7.7 |
| Background Jobs | Inngest |
| Storage | Garage (S3-compatible) & Redis |
| Precision math | `Decimal.js` (mandatory for all currency) |

---

## 3. Local Development Setup

### Step 1 — Clone & configure environment

```bash
git clone https://github.com/your-org/tally.git
cd tally
cp .env.example .env
```

Edit `.env` with your local secrets. See [Section 4](#4-environment-variables) for a full reference.

### Step 2 — Start infrastructure

```bash
docker compose up -d db redis garage
```

This starts PostgreSQL, Redis, and a local Garage (S3-compatible) instance.

### Step 3 — Prepare the database

```bash
npx prisma generate   # generates the type-safe Prisma client
npx prisma db push    # applies the schema to the local DB
```

> To seed initial data (e.g., catalog entries), run: `npm run db:seed`

### Step 4 — Run the application

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

### Essential Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npx prisma studio` | Open the Prisma DB GUI at `localhost:5555` |
| `npx prisma db push` | Sync schema changes to the local DB |
| `npm run test:unit` | Run unit tests |
| `npm run test:integration` | Run integration tests against Docker services |
| `npm run test:e2e` | Run end-to-end tests for critical provisioning paths |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript compiler checks |

---

## 4. Environment Variables

All variables are defined in `.env.example`. Copy it to `.env` and fill in values for local development.

> **Rule:** Variables that should be accessible in the browser **must** use the `NEXT_PUBLIC_` prefix. Secrets **must never** use this prefix.

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/tally` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `GARAGE_ENDPOINT` | S3-compatible storage endpoint | `http://localhost:3900` |
| `GARAGE_ACCESS_KEY` | Garage access key | `GK...` |
| `GARAGE_SECRET_KEY` | Garage secret key | `...` |
| `ENCRYPTION_KEY` | AES-256-GCM key for vendor credentials | 32-byte hex string |
| `BETTER_AUTH_SECRET` | Session signing secret | Random 32+ char string |
| `INNGEST_EVENT_KEY` | Inngest event key | `local` for dev server |
| `INNGEST_SIGNING_KEY` | Inngest signing key | `local` for dev server |

---

## 5. Coding Standards

### 5.1 The Trust Boundary — `proxy.ts`

`proxy.ts` is the single entry point for all authenticated requests. It validates the session, extracts `organizationId`, and enforces idempotency.

**Never instantiate `PrismaClient` directly.** Always use the RLS-wrapped proxy from tRPC context:

```typescript
// ✅ Correct — RLS automatically scopes all queries to organizationId
const { db } = ctx; // db is the RLS Prisma proxy
const subscriptions = await db.subscription.findMany();

// ❌ Wrong — bypasses Row-Level Security, a critical security violation
const db = new PrismaClient();
```

### 5.2 Financial Math

Always use `Decimal.js` for monetary values. JavaScript's floating-point arithmetic is not suitable for currency:

```typescript
import Decimal from 'decimal.js';

// ✅ Correct
const total = new Decimal(price).mul(quantity).toFixed(2);

// ❌ Wrong — floating-point errors will corrupt financial data
const total = price * quantity;
```

### 5.3 Idempotency

Every tRPC mutation must validate an `Idempotency-Key`. The key is provided by the client and checked in `proxy.ts`. If the key has been seen before, the cached response is returned without re-executing the handler.

### 5.4 Background Jobs

Wrap all Inngest logic with `withTenantContext` to ensure RLS stays active in async execution:

```typescript
import { withTenantContext } from '@/lib/tenant';

// Inside an Inngest function handler:
await withTenantContext(organizationId, async () => {
  // All db calls here are automatically scoped to organizationId
  await db.license.update({ ... });
});
```

### 5.5 File Storage

All files written to Garage (S3) must be prefixed with the org ID:

```typescript
const key = `org/${organizationId}/reports/${filename}`;
```


Never write to a path without this prefix — it would allow cross-org data access.

### 5.6 RBAC & Role Checks

Role resolution is handled at `proxy.ts` — tRPC procedures receive a resolved `effectiveRole` in context. Never re-query the database to check roles inside a procedure.

**Checking roles in a tRPC procedure:**

```typescript
import { OrgRole, MspRole, PlatformRole } from '@prisma/client';

// ✅ Correct — use the resolved role from context
const { effectiveRole, organizationId } = ctx;

if (effectiveRole.platformRole === PlatformRole.SUPER_ADMIN) {
  // Tally staff — full access
}

if (effectiveRole.mspRole === MspRole.MSP_TECHNICIAN) {
  // MSP technician acting on behalf of a client org
}

if (effectiveRole.orgRole === OrgRole.ORG_MEMBER) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient role' });
}

// ❌ Wrong — bypasses the resolved role, causes an extra DB round-trip
const member = await db.member.findFirst({ where: { userId, organizationId } });
```

**Creating a Member in an MSP org:**

```typescript
// MSP org — set mspRole, leave orgRole null
await db.member.create({
  data: {
    organizationId: mspOrgId,
    userId,
    mspRole: MspRole.MSP_TECHNICIAN,
    orgRole: null,
  },
});

// DIRECT or CLIENT org — set orgRole, leave mspRole null
await db.member.create({
  data: {
    organizationId: clientOrgId,
    userId,
    orgRole: OrgRole.ORG_ADMIN,
    mspRole: null,
  },
});
```

**Creating a new client org for an MSP:**

```typescript
await db.organization.create({
  data: {
    name: 'Acme Corp',
    slug: 'acme-corp',
    organizationType: OrganizationType.CLIENT,
    parentOrganizationId: mspOrgId, // links to the MSP parent
    billingType: BillingType.MANUAL_INVOICE,
  },
});
```

> MSP staff do not need a `Member` row on the new client org. Access is automatically delegated via `parentOrganizationId` at the RLS layer.

**Creating an Invitation with typed roles:**

```typescript
import { InvitationStatus, OrgRole, MspRole } from '@prisma/client';

// Invite to a CLIENT/DIRECT org — set orgRole, leave mspRole null
await db.invitation.create({
  data: {
    organizationId: clientOrgId,
    email: 'user@example.com',
    orgRole: OrgRole.ORG_ADMIN,
    mspRole: null,
    status: InvitationStatus.PENDING,  // default, but explicit is clearer
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    inviterId: ctx.userId,
  },
});

// Invite to an MSP org — set mspRole, leave orgRole null
await db.invitation.create({
  data: {
    organizationId: mspOrgId,
    email: 'tech@example.com',
    mspRole: MspRole.MSP_TECHNICIAN,
    orgRole: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    inviterId: ctx.userId,
  },
});
```

### 5.7 Soft-Delete & Organization Lifecycle

Organizations use soft-delete via `deletedAt`. When deactivating an org, set `deletedAt` instead of deleting the record:

```typescript
// ✅ Correct — soft-delete preserves audit logs, billing snapshots, etc.
await db.organization.update({
  where: { id: orgId },
  data: { deletedAt: new Date() },
});

// ❌ Wrong — hard delete is blocked by AuditLog onDelete: Restrict,
//    and would destroy billing and compliance data
await db.organization.delete({ where: { id: orgId } });
```

When querying organizations, always filter out soft-deleted records unless explicitly accessing archived data:

```typescript
// ✅ Normal queries — exclude soft-deleted orgs
const activeOrgs = await db.organization.findMany({
  where: { deletedAt: null },
});
```

---

## 6. Database Migrations

### Local Development

For local development, use `prisma db push` to sync schema changes directly:

```bash
npx prisma db push
```

This is fast and convenient but **does not create migration files**. It is suitable only for local iteration.

### Staging & Production

For staging and production environments, always use **Prisma Migrate** to create versioned, reviewable migration files:

```bash
# Generate a new migration from schema changes
npx prisma migrate dev --name describe_your_change

# Apply pending migrations in staging/production
npx prisma migrate deploy
```

### Migration Rules

- Never use `prisma db push` in staging or production — it can cause data loss.
- Every schema change must produce a migration file committed to version control.
- Migration files live in `prisma/migrations/` and must never be edited after they have been applied to any environment.
- Destructive changes (dropping columns, renaming tables) require a two-step migration: first add the new structure, deploy, then remove the old one in a subsequent release.

### Docker Compose Database

The local Docker Compose stack provides PostgreSQL, Redis, and Garage. The database service is named `db`:

```bash
docker compose up -d db redis garage  # start infrastructure
docker compose down                   # stop all services
docker compose down -v                # stop and remove volumes (resets data)
```

---

## 7. Common Workflows

### 7.1 Adding a New Bundle (e.g., M365 Business Premium)

1. **Define Products** — create `Product` records for each atomic service in the bundle (e.g., Exchange Online, Teams).
2. **Create Bundle** — create a `Bundle` record, linking the `globalSkuId` to those products.
3. **Attach ProductOfferings** — create one `ProductOffering` per distributor that carries this SKU, with distributor-specific pricing.

### 7.2 Discovery / Savings Analysis Flow

This is how Tally identifies optimisation opportunities from a customer's existing licenses:

```
1. Upload   — User provides a CSV export of their current license holdings
2. Match    — Each row is matched to a Bundle via globalSkuId
3. Analyse  — Current holdings are compared against available ProductOfferings
4. Surface  — Savings opportunities are presented to the user
```

### 7.3 Commitment-Gated Scale-Down

When a user requests a quantity reduction blocked by a commitment window:

1. The target quantity is saved to `License.pendingQuantity`.
2. An Inngest workflow is enqueued, sleeping until `commitmentEndDate`.
3. On wake, the workflow calls the vendor API and promotes `pendingQuantity` → `quantity`.
4. An `AuditLog` entry is written.

> See `Architecture.md §8` for the full workflow diagram.

---

## 8. Adding a Vendor Adapter

Vendor adapters live in `src/adapters/`. Each adapter translates Tally's internal model to a specific distributor's API.

### Steps

1. **Create the adapter file**: `src/adapters/{vendor}.ts`
2. **Implement the `VendorAdapter` interface**:

```typescript
import type { VendorAdapter } from '@/adapters/types';

export const myVendorAdapter: VendorAdapter = {
  async getSubscriptions(connection) { ... },
  async setQuantity(connection, subscriptionId, quantity) { ... },
  async getProductCatalog(connection) { ... },
};
```

3. **Register the adapter** in `src/adapters/index.ts`.
4. **Add a `VendorConnection` type** entry in the Prisma schema if the vendor requires a unique credential shape.
5. **Write integration tests** in `tests/adapters/{vendor}.test.ts`.

### Rules for Adapter Code

- Credentials from `VendorConnection` must be decrypted inside the adapter, never outside.
- Never log credential fields, tokens, or API keys.
- All vendor API errors must be caught and re-thrown as typed `VendorError` instances.

---

## 9. Testing

### Test Types

| Type | Command | What it covers |
|---|---|---|
| Unit | `npm run test:unit` | Pure functions, business logic, Zod schemas |
| Integration | `npm run test:integration` | tRPC procedures against a live Docker DB |
| E2E | `npm run test:e2e` | Critical provisioning flows (browser-level) |

### Guidelines

- Integration tests run against the Docker stack — ensure it's running before executing them.
- E2E tests should cover every provisioning path (create, scale-up, scale-down, cancellation).
- Use factory helpers in `tests/factories/` to create test data rather than seeding raw SQL.
- Never hard-code `organizationId` values in tests — use the test tenant factory.

---

## 10. Contributing & Branch Conventions

### Branch Naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/{short-description}` | `feat/pax8-adapter` |
| Bug fix | `fix/{short-description}` | `fix/commitment-date-off-by-one` |
| Chore / infra | `chore/{short-description}` | `chore/upgrade-prisma-7.7` |
| Docs | `docs/{short-description}` | `docs/vendor-adapter-guide` |

### Pull Request Checklist

Before opening a PR, confirm:

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no warnings
- [ ] `npm run test:unit` and `npm run test:integration` pass
- [ ] No new `PrismaClient` instantiations outside of the RLS proxy
- [ ] No secrets or credentials in logs or API responses
- [ ] New `Bundle` / `ProductOffering` records are covered by a migration or seed
- [ ] `AuditLog` entries are written for any new mutations
- [ ] Organization queries filter on `deletedAt IS NULL` unless explicitly accessing soft-deleted orgs
- [ ] Invitation flows use `InvitationStatus` enum — never raw strings for status

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Ingram vendor adapter
fix: correct pendingQuantity promotion after sleep
chore: upgrade Prisma to 7.7
docs: document commitment-gated scale-down flow
```

---

## 11. Troubleshooting

### Database connection refused

**Symptom:** `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Fix:** The PostgreSQL container isn't running.
```bash
docker compose up -d db
```

---

### Prisma client out of sync

**Symptom:** Type errors referencing missing Prisma models, or runtime errors about unknown fields.

**Fix:** Regenerate the client after any schema change.
```bash
npx prisma generate
npx prisma db push
```

---

### Inngest jobs not firing locally

**Symptom:** Background workflows are enqueued but never execute.

**Fix:** Ensure the Inngest Dev Server is running and `INNGEST_EVENT_KEY=local` is set in `.env`. Start it with:
```bash
npx inngest-cli dev
```

---

### Redis key collisions between orgs

**Symptom:** Unexpected data appearing for the wrong organization.

**Fix:** Check that all Redis writes use the `cache:{organizationId}:` prefix. Unscoped keys are a multi-tenancy violation.

---

### S3/Garage access denied

**Symptom:** `AccessDenied` errors when reading or writing files.

**Fix:**
1. Confirm `GARAGE_ACCESS_KEY` and `GARAGE_SECRET_KEY` are set in `.env`.
2. Confirm the file path starts with `org/{organizationId}/`.
3. Confirm the Garage container is running: `docker compose up -d garage`.
