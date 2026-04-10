# Tally Architecture

**Version:** 2.1 (April 2026)  
**Status:** Locked & Production-Ready

## 1. Core Principles

- Discovery-First Onboarding — users are never forced into technical connections first.
- Multi-Distributor First — Pax8 is just one distributor among many.
- Strict Commitment Model — every license addition respects real-world NCE-style no-refund windows.
- Zero-Trust Multi-Tenancy — every request is scoped to an `organizationId`.
- Financial & Legal Precision — Decimal.js everywhere, DPA/contract gates, taxId/billingEmail enforcement.

## 2. High-Level Architecture

Client (Next.js 16 App Router + RSC)
    ↓
proxy.ts (central trust boundary)
    ↓
tRPC v11 Context (with RLS Prisma Proxy + AsyncLocalStorage)
    ↓
Business Logic (Product + ProductOffering + Strict Commitment)
    ↓
Inngest (durable workflows)
    ↓
Vendor Adapters (Pax8, Ingram, direct, etc.)

## 3. Key Rules (Enforced Everywhere)

- Every tRPC mutation validates `Idempotency-Key` from `proxy.ts`.
- RLS Proxy cannot be bypassed — **no direct PrismaClient usage** anywhere.
- GDAP / distributor credentials are AES-encrypted at rest, never logged, never in error responses.
- Client bundles contain **zero secrets** (no `NEXT_PUBLIC_*` for API keys).
- Inngest background jobs **must** re-establish tenant context via `withTenantContext()`.
- Redis cache keys are namespaced: `cache:${organizationId}:pricing:...`.
- Garage file paths are scoped: `org/${organizationId}/...`.

## 4. Data Model Overview

- **Organization** = Customer (with `billingType`, `isContractSigned`, `isDpaSigned`, `taxId`, `billingEmail`, `contractVersion`).
- **Product** + **ProductOffering** = Canonical catalog layer (supports direct manufacturer contracts).
- **VendorConnection** = Per-distributor credentials and sync state.
- **PurchaseTransaction** = Every buy action (with `nonRefundableUntil`, `provisionedAt`, margin tracking).
- **License** = Current inventory (with `source: DataSource` for MANUAL_FILE / API_SYNC / PREDICTION).
- **BillingSnapshot** = Projected invoice view for large orgs.

Full Prisma schema is in `prisma/schema.prisma`.

## 5. Major Flows

- Discovery-First Onboarding → Intent (Analyze / Buy) → Connection or Manual Upload → AI value in <60s.
- AI Recommendations → Real-time `getCurrentPricingForSkus()` across all offerings → Flex vs Commit options with exact dates.
- Actions → Immediate or Scheduled Decrease (Inngest) → Strict Commitment enforcement.
- Enterprise Gates → MANUAL_INVOICE customers blocked until contract + DPA signed.

## 6. Security & Compliance

- Row-level security via Prisma Proxy + AsyncLocalStorage.
- Full audit trail on every mutation.
- DPA / contract versioning for legal sign-off.
- Idempotency protection on all financial actions.
- Garage storage scoped per organization for data isolation.

---

