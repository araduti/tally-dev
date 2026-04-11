# LEFT.md — Remaining Features, TODOs & Missing Wirings

> Comprehensive audit of the Tally codebase. Organized by severity and layer.

---

## 🔴 P0 — Critical (Core Business Logic Broken)

### 1. ~~Catalog Sync Does Not Persist Products~~ ✅ DONE
- **File:** `src/inngest/functions/catalog-sync.ts`
- **Status:** IMPLEMENTED
- Catalog sync now upserts `Bundle` + `ProductOffering` records for each `VendorCatalogEntry`. Uses `globalSkuId` for cross-distributor matching. Audit log includes `persisted` count.

### 2. ~~Subscription Create Never Provisions on Vendor~~ ✅ DONE
- **File:** `src/server/routers/subscription.ts` (create mutation)
- **Status:** IMPLEMENTED
- `subscription.create()` now calls `adapter.createSubscription()` before creating local records. Uses the vendor's real `externalId` and stores `commitmentEndDate` when provided.

### 3. ~~License Scale Operations Don't Call Vendor API~~ ✅ DONE
- **File:** `src/server/routers/license.ts` (scaleUp / scaleDown mutations)
- **Status:** IMPLEMENTED
- Both `scaleUp` and `scaleDown` now call `adapter.setQuantity()` before updating local records. Vendor-first pattern ensures consistency. Staged (committed) scale-downs still defer to Inngest workflow.

### 4. ~~Subscription Cancellation Never Calls Vendor~~ ✅ DONE
- **File:** `src/server/routers/subscription.ts` (cancel mutation)
- **Status:** IMPLEMENTED
- Immediate cancellation now calls `adapter.cancelSubscription()` before updating local status. Scheduled cancellation (during commitment) still only sets `SUSPENDED` locally.

### 5. ~~Invitation Accept/Reject Procedures Missing~~ ✅ DONE
- **File:** `src/server/routers/admin.ts`
- **Status:** IMPLEMENTED
- `acceptInvitation()` validates invitation (email match, PENDING status, not expired, not already a member), creates `Member` + updates `Invitation` atomically via `$transaction`, and writes audit log. `rejectInvitation()` validates and updates status to `REJECTED`. Both use `authenticatedMutationProcedure` (no org context required).

### 6. ~~No Dockerfile — Cannot Build for Production~~ ✅ DONE
- **File:** `Dockerfile`, `.dockerignore`
- **Status:** IMPLEMENTED
- Multi-stage build (deps → build → runner) with `node:24-alpine`, non-root user, standalone output.

### 7. ~~No CI/CD Workflows~~ ✅ DONE
- **File:** `.github/workflows/ci.yml`
- **Status:** IMPLEMENTED
- CI pipeline: lint+typecheck → unit tests → build. Runs on push/PR to main.

### 8. No E2E Tests
- **File:** `playwright.config.ts` → `testDir: './tests/e2e'`
- **Status:** NOT IMPLEMENTED
- Config references `./tests/e2e/` but the directory does not exist. Zero end-to-end test files.

### 9. No Integration Tests
- **File:** `vitest.integration.config.ts` → `**/__tests__/**/*.integration.test.ts`
- **Status:** NOT IMPLEMENTED
- Config exists but no `*.integration.test.ts` files anywhere in the codebase.

---

## 🟠 P1 — High (Business Features Incomplete)

### 10. ~~Billing Snapshots Never Generated~~ ✅ DONE
- **File:** `src/server/routers/billing.ts`, `src/inngest/functions/billing-snapshot.ts`
- **Status:** IMPLEMENTED
- `createSnapshot()` mutation calculates projected amounts from active subscriptions using Decimal.js, persists BillingSnapshot with line items metadata, and is idempotent per period. Inngest `billing-snapshot-generation` workflow handles scheduled generation within tenant context.

### 11. ~~Commitment End-Date Workflows Missing~~ ✅ DONE
- **File:** `src/inngest/functions/commitment-expiry.ts`, `src/server/routers/subscription.ts`
- **Status:** IMPLEMENTED
- `commitment-expiry` Inngest function sleeps until commitmentEndDate, then executes vendor-first cancellation (calls `adapter.cancelSubscription()` before updating local status to CANCELLED). `subscription.cancel` now dispatches `subscription/commitment-expired` event when scheduling committed cancellations.

### 12. ~~MSP Client Constraints Not Enforced~~ ✅ DONE
- **File:** `src/server/routers/organization.ts` (createClient mutation)
- **Status:** IMPLEMENTED
- `createClient` now verifies parent MSP has `provisioningEnabled === true` (throws PROVISION:GATE:DISABLED if not). billingType input is optional and inherits from parent MSP when not specified.

### 13. Contract Signing Flow — Stub
- **File:** `src/app/(dashboard)/compliance/compliance-client.tsx`
- **Status:** STUB
- Hardcoded "Unsigned" status. No modal, no document viewer, no API call to record a signature. No corresponding tRPC mutation exists.

### 14. Forgot Password / Password Reset
- **File:** `src/app/(auth)/login/page.tsx`
- **Status:** NOT IMPLEMENTED
- No "Forgot Password" link. No password-reset flow, email, or token verification.

### 15. ~~No Next.js Middleware (Edge Auth / Security Headers)~~ ✅ DONE
- **File:** `src/middleware.ts`
- **Status:** IMPLEMENTED
- Security headers (CSP, X-Frame-Options, HSTS, etc.), auth redirects, session cookie check.

### 16. ~~Vendor Adapter Tests — 0% Coverage~~ ✅ DONE
- **Files:** `src/adapters/__tests__/adapters.test.ts`
- **Status:** IMPLEMENTED
- 68 unit tests covering: Direct adapter (all 5 methods), adapter registry (type-safe lookup, `decryptCredentials`), VendorError class, and auth-guard validation for Pax8, Ingram, and TD Synnex adapters. Fetch interaction tests for all three external adapters.

### 17. ~~Bulk Import Does Not Provision on Vendor~~ ✅ DONE
- **File:** `src/server/routers/license.ts` (importLicenses mutation)
- **Status:** IMPLEMENTED
- `importLicenses` now calls `adapter.createSubscription()` before creating local subscription records. Uses vendor's real `externalId` and `commitmentEndDate`. On vendor failure, skips record with SKIPPED status (best-effort bulk import).

### 18. Inngest Workflow Tests — Mocked Only
- **Files:** `src/inngest/functions/catalog-sync.ts`, `src/inngest/functions/scale-down.ts`
- **Status:** STUBBED IN UNIT TESTS
- Critical business workflows (catalog sync, scale-down scheduling) are only tested via mocked `inngest.send()` calls. No integration test validates actual step execution, retries, or failure paths.

---

## 🟡 P2 — Medium (Incomplete Features & UX Gaps)

### 19. ~~Audit Log Filtering — Basic Only~~ ✅ DONE
- **File:** `src/server/routers/admin.ts` (listAuditLogs query)
- **Status:** IMPLEMENTED
- Enhanced filtering with date-range (`from`/`to`), entity-type prefix matching, plus existing `action`, `entityId`, `userId` filters.

### 20. ~~DPA Status Missing Version Comparison~~ ✅ DONE
- **File:** `src/server/routers/organization.ts` (getDpaStatus query)
- **Status:** IMPLEMENTED
- Returns `requiredVersion`, `acceptedVersion`, and `isOutdated` boolean so clients can compare what's required vs what's accepted.

### 21. No Projected Invoice View in UI
- **File:** `src/app/(dashboard)/billing/billing-client.tsx`
- The `projectInvoice` tRPC query exists in the backend but is never called from the billing UI. No cost-breakdown or forecast visualization.

### 22. No Create-License UI (Only Bulk Import)
- **File:** `src/app/(dashboard)/licenses/`
- No single-license creation form. Users must go through marketplace purchase or CSV import.

### 23. No Subscription Detail / Edit Page
- **File:** `src/app/(dashboard)/subscriptions/`
- Subscription table exists but rows are not clickable. No detail view, no inline edit, no per-subscription license list.

### 24. Dashboard Insights Are Read-Only
- **File:** `src/app/(dashboard)/dashboard-insights.tsx`
- Recommendations and waste alerts display but have no "Apply", "Dismiss", or "Investigate" action buttons. No way to act on insights.

### 25. Insights Not Persisted
- **File:** `src/server/routers/insights.ts`
- Recommendations and alerts are generated on-the-fly from current data. No `InsightHistory` table for trend tracking.

### 26. Vendor Sync Status — No Progress / Logs UI
- **File:** `src/app/(dashboard)/settings/settings-client.tsx`
- `syncCatalog` mutation fires but there is no real-time progress indicator, no sync log viewer, no retry button on failure, and no sync history.

### 27. Onboarding Selections Not Persisted
- **File:** `src/app/onboarding/page.tsx`
- Vendor selections and intent (analyze vs. buy) are captured in local state but discarded on navigation. Nothing is saved to the backend.

### 28. No OAuth / SSO Login
- **Files:** `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`
- No Google, Microsoft, or SAML login. Email/password only.

### 29. No Email Verification on Registration
- **File:** `src/app/(auth)/register/page.tsx`
- Account created immediately with no email confirmation step.

### 30. Rate Limiting Has No Redis Fallback
- **File:** `src/lib/rate-limit.ts`
- All state in Redis. If Redis goes down, rate limiting is silently disabled. No Postgres fallback or circuit breaker.

### 31. Vendor Credential Erasure Incomplete
- **File:** `src/server/routers/vendor.ts` (disconnect mutation)
- Sets `credentials` to empty string. No cryptographic overwrite. No audit trail of destruction.

### 32. ~~Homepage Does Not Redirect Authenticated Users~~ ✅ DONE
- **File:** `src/middleware.ts`
- **Status:** IMPLEMENTED
- Middleware now redirects authenticated users from `/` to `/marketplace`.

### 33. CSV Import Missing Template Download
- **File:** `src/app/(dashboard)/licenses/import/csv-upload-client.tsx`
- No "Download CSV Template" button. No batch-size warning, duplicate detection, or import history.

### 34. ~~Organization Deletion — No Cascade Cleanup~~ ✅ DONE
- **File:** `src/server/routers/organization.ts` (deactivate mutation)
- **Status:** IMPLEMENTED
- Deactivation now cascades within a transaction: suspends active subscriptions, revokes pending invitations, erases vendor credentials (marks DISCONNECTED), and soft-deletes child client orgs.

---

## 🔵 P3 — Low (Polish, DX & Nice-to-Haves)

### 35. No Breadcrumbs
- No breadcrumb navigation on any dashboard page.

### 36. No Global Search / Command Palette
- No `⌘K` command palette. No full-text search across subscriptions, licenses, or members.

### 37. No Dark Mode
- No theme toggle. Light mode only.

### 38. No User Profile Menu
- No avatar dropdown in the header for profile settings, theme toggle, or sign-out.

### 39. No Notifications System
- No bell icon, no in-app notifications, no email notifications for important events (invitation received, subscription expiring, waste alert triggered).

### 40. No Table Export (CSV/PDF)
- No export button on any data table (licenses, subscriptions, billing, audit log).

### 41. No Keyboard Shortcuts
- No documented or implemented keyboard shortcuts for common actions.

### 42. Mobile Experience — Partial
- Mobile sidebar works (swipe-to-close, auto-close on nav). But data tables, modals, and forms are not verified for narrow viewports.

### 43. Team Management — No Bulk Operations
- No multi-select for role change or removal. No member search/filter. No member activity log.

### 44. Invitation Resend Missing
- Can revoke invitations but cannot resend expired or stale invitations.

### 45. ~~No Health-Check Endpoint~~ ✅ DONE
- **File:** `src/app/api/health/route.ts`
- **Status:** IMPLEMENTED
- GET `/api/health` returns `{ status: 'ok', timestamp }` for load balancer probes.

### 46. No Logging Infrastructure
- No structured logging (Winston/Pino). Console.log only. No log aggregation.

### 47. No Error Tracking (Sentry)
- No `SENTRY_DSN` env var. No error-tracking integration. Errors visible only in server logs.

### 48. No Payment Processing (Stripe)
- README mentions "One-click Buy through Tally" but no Stripe integration, no checkout flow, no webhook handler.

### 49. No OpenAPI / Swagger Documentation
- tRPC procedures are documented in `docs/API-Reference.md` but no machine-readable OpenAPI spec exists for external consumers.

### 50. ~~Adapter Registry Not Type-Safe~~ ✅ DONE
- **File:** `src/adapters/index.ts`
- **Status:** IMPLEMENTED
- Registry now uses `Record<VendorType, VendorAdapter>` with `satisfies`, ensuring compile-time coverage of all enum values. `getAdapter` returns directly without runtime check.

### 51. ~~next.config.ts Is Empty~~ ✅ PARTIALLY DONE
- **File:** `next.config.ts`
- **Status:** `output: 'standalone'` configured for Docker builds. Security headers moved to middleware.

### 52. ~~No Test Coverage Reporting~~ ✅ DONE
- **File:** `vitest.config.ts`
- **Status:** IMPLEMENTED
- Coverage config added with `v8` provider, `text`/`lcov`/`json-summary` reporters. Run via `npm run test:coverage`.

### 53. ~~tsconfig.json — No Strict Null Checks~~ ✅ DONE
- **File:** `tsconfig.json`
- **Status:** ALREADY ENABLED
- `strict: true` is set, which enables `strictNullChecks`, `noImplicitAny`, and all other strict flags automatically.

### 54. ~~Missing package.json Scripts~~ ✅ DONE
- **File:** `package.json`
- **Status:** IMPLEMENTED
- Added `test`, `test:coverage`, `lint:fix`, `db:migrate`, `db:migrate:deploy`, `db:reset`, `docker:build`, and `ci` scripts.

### 55. ~~No .env Validation at Runtime~~ ✅ DONE
- **File:** `src/lib/env.ts`
- **Status:** IMPLEMENTED
- Zod schema validates all required environment variables (DATABASE_URL, REDIS_URL, GARAGE_*, ENCRYPTION_KEY, BETTER_AUTH_*, INNGEST_*) with descriptive error messages. Call `validateEnv()` at startup.

### 56. ~~docker-compose.yml — No Health Checks~~ ✅ DONE
- **File:** `docker-compose.yml`
- **Status:** IMPLEMENTED
- Health checks added for PostgreSQL (`pg_isready`) and Redis (`redis-cli ping`). Garage uses scratch image (no shell for healthcheck).

### 57. No Database Migration Strategy
- Using `prisma db push` for schema sync. No `prisma migrate` workflow, no migration history, no rollback plan.

### 58. No Monitoring / APM
- No Prometheus metrics, no OpenTelemetry traces, no Datadog/New Relic integration.

---

## 📊 Summary

| Priority | Count | Description |
|----------|-------|-------------|
| **P0 — Critical** | 9 (7 done) | ~~Core logic~~ fixed, ~~deployment~~, ~~CI/CD~~, no E2E tests |
| **P1 — High** | 9 (6 done) | ~~Billing snapshots~~, ~~commitment workflows~~, ~~MSP constraints~~, ~~bulk import~~, ~~security middleware~~, ~~vendor adapter tests~~ |
| **P2 — Medium** | 16 (4 done) | ~~Audit log filtering~~, ~~DPA version compare~~, ~~homepage redirect~~, ~~org deletion cascade~~ |
| **P3 — Low** | 24 (7 done) | ~~Health check~~, ~~next.config~~, ~~docker health~~, ~~type-safe adapters~~, ~~coverage config~~, ~~tsconfig strict~~, ~~scripts~~, ~~env validation~~ |
| **Total** | **58 (24 done)** | |

### By Layer

| Layer | Items | Key Gaps |
|-------|-------|----------|
| **Backend / API** | 15 (13 done) | ~~Vendor API wiring~~, ~~invitation accept~~, ~~billing writes~~, ~~commitment workflows~~, ~~MSP constraints~~, ~~bulk import~~, ~~audit filtering~~, ~~DPA version~~, ~~org cascade~~ |
| **Frontend / UI** | 18 (1 done) | Missing pages, stub forms, no action buttons, auth gaps, ~~homepage redirect~~ |
| **Infrastructure** | 14 (4 done) | ~~Dockerfile~~, ~~CI/CD~~, ~~middleware~~, ~~health checks~~ |
| **Testing** | 6 (1 done) | No E2E, no integration, ~~vendor adapter tests~~, no coverage |
| **DevOps / Config** | 5 (5 done) | ~~next.config~~, ~~scripts~~, ~~env validation~~, ~~tsconfig strict~~, ~~coverage config~~ |
