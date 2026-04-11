# LEFT.md — Remaining Features, TODOs & Missing Wirings

> Comprehensive audit of the Tally codebase. Organized by severity and layer.

---

## 🔴 P0 — Critical (Core Business Logic Broken)

### 1. Catalog Sync Does Not Persist Products
- **File:** `src/inngest/functions/catalog-sync.ts`
- **Status:** STUB
- `adapter.getProductCatalog()` is called and catalog data is returned, but only `VendorConnection.lastSyncAt` is updated. No loop upserts catalog items into the `ProductOffering` table. Products never appear in the marketplace after a sync.

### 2. Subscription Create Never Provisions on Vendor
- **File:** `src/server/routers/subscription.ts` (create mutation)
- **Status:** PARTIAL
- `subscription.create()` creates local `Subscription` + `License` records but never calls `adapter.createSubscription()`. The vendor/distributor has no knowledge of the subscription and cannot fulfill or bill it.

### 3. License Scale Operations Don't Call Vendor API
- **File:** `src/server/routers/license.ts` (scaleUp / scaleDown mutations)
- **Status:** PARTIAL
- Both `scaleUp` and `scaleDown` update local `License.quantity` and create `PurchaseTransaction` records but never call `adapter.setQuantity()`. Vendor systems remain out of sync.

### 4. Subscription Cancellation Never Calls Vendor
- **File:** `src/server/routers/subscription.ts` (cancel mutation)
- **Status:** PARTIAL
- Updates local status to `SUSPENDED` or `CANCELLED` but never calls `adapter.cancelSubscription()`. Vendor continues billing the organization.

### 5. Invitation Accept/Reject Procedures Missing
- **File:** `src/server/routers/admin.ts`
- **Status:** NOT IMPLEMENTED
- `inviteMember()` and `revokeInvitation()` exist, but `acceptInvitation()` (transforms Invitation → Member) and `rejectInvitation()` (marks Invitation as REJECTED) are completely missing. Invited users have no way to join an organization.

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

### 10. Billing Snapshots Never Generated
- **File:** `src/server/routers/billing.ts`
- **Status:** QUERY-ONLY
- `getSnapshot()` retrieves existing snapshots and `projectInvoice()` calculates projections, but neither persists data. No `createBillingSnapshot()` mutation exists. No scheduled workflow generates snapshots at period boundaries.

### 11. Commitment End-Date Workflows Missing
- **File:** `src/server/routers/subscription.ts`
- **Status:** PARTIAL
- `commitmentEndDate` is checked to gate scale-down/cancel operations, but no Inngest workflow handles automatic renewal, expiration, or grace-period logic when the date arrives. Subscriptions could become orphaned.

### 12. MSP Client Constraints Not Enforced
- **File:** `src/server/routers/organization.ts` (createClient mutation)
- **Status:** PARTIAL
- Creates a CLIENT org and links it to a parent, but does not verify the parent MSP has `provisioningEnabled`, has no quota system for max clients, and does not inherit billing config.

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

### 16. Vendor Adapter Tests — 0% Coverage
- **Files:** `src/adapters/pax8.ts`, `ingram.ts`, `tdsynnex.ts`, `direct.ts`
- **Status:** UNTESTED
- Four vendor adapters with zero test coverage. The `direct` adapter is a no-op stub returning empty arrays.

### 17. Bulk Import Does Not Provision on Vendor
- **File:** `src/server/routers/license.ts` (importLicenses mutation)
- **Status:** PARTIAL
- Creates local License + Subscription records. For new subscriptions, no `adapter.createSubscription()` call is made.

### 18. Inngest Workflow Tests — Mocked Only
- **Files:** `src/inngest/functions/catalog-sync.ts`, `src/inngest/functions/scale-down.ts`
- **Status:** STUBBED IN UNIT TESTS
- Critical business workflows (catalog sync, scale-down scheduling) are only tested via mocked `inngest.send()` calls. No integration test validates actual step execution, retries, or failure paths.

---

## 🟡 P2 — Medium (Incomplete Features & UX Gaps)

### 19. Audit Log Filtering — Basic Only
- **File:** `src/server/routers/admin.ts` (getAuditLog query)
- Filters by `action`, `entityId`, `userId` only. Missing date-range filtering, entity-type filtering, full-text search, and CSV export.

### 20. DPA Status Missing Version Comparison
- **File:** `src/server/routers/organization.ts` (getDpaStatus query)
- Returns latest `DpaAcceptance` or null. Doesn't indicate what DPA version is _required_ vs. what is _accepted_.

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

### 32. Homepage Does Not Redirect Authenticated Users
- **File:** `src/app/page.tsx`
- Shows login/register links regardless of session state. No redirect to `/marketplace` if already logged in.

### 33. CSV Import Missing Template Download
- **File:** `src/app/(dashboard)/licenses/import/csv-upload-client.tsx`
- No "Download CSV Template" button. No batch-size warning, duplicate detection, or import history.

### 34. Organization Deletion — No Cascade Cleanup
- **File:** `src/server/routers/organization.ts` (deleteOrganization mutation)
- Soft-deletes by setting `deletedAt`. No archival strategy or cleanup of child records (subscriptions, licenses, members, vendor connections).

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

### 50. Adapter Registry Not Type-Safe
- **File:** `src/adapters/index.ts`
- `getAdapter()` throws at runtime if a `VendorType` has no registered adapter. No compile-time check ensures all enum values are covered.

### 51. ~~next.config.ts Is Empty~~ ✅ PARTIALLY DONE
- **File:** `next.config.ts`
- **Status:** `output: 'standalone'` configured for Docker builds. Security headers moved to middleware.

### 52. No Test Coverage Reporting
- **File:** `vitest.config.ts`
- No `coverage` config. No threshold enforcement. No CI coverage gate.

### 53. tsconfig.json — No Strict Null Checks
- **File:** `tsconfig.json`
- `strictNullChecks` and `noImplicitAny` not explicitly enabled.

### 54. Missing package.json Scripts
- No `test`, `test:coverage`, `format`, `lint:fix`, `db:migrate`, `db:reset`, `docker:build`, `setup:dev`, or `ci` scripts defined.

### 55. No .env Validation at Runtime
- No Zod schema or `envalid` check that all required environment variables are set before the app starts.

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
| **P0 — Critical** | 9 (2 done) | Core logic broken, ~~no deployment~~, ~~no CI/CD~~, no E2E tests |
| **P1 — High** | 9 (1 done) | Major features incomplete, ~~no security middleware~~, no adapter tests |
| **P2 — Medium** | 16 | Incomplete UI, missing filters, no OAuth, no persistence |
| **P3 — Low** | 24 (3 done) | Polish, DX, monitoring, nice-to-haves |
| **Total** | **58 (6 done)** | |

### By Layer

| Layer | Items | Key Gaps |
|-------|-------|----------|
| **Backend / API** | 15 | Vendor API calls never made, invitation accept, billing writes |
| **Frontend / UI** | 18 | Missing pages, stub forms, no action buttons, auth gaps |
| **Infrastructure** | 14 | No Dockerfile, no CI/CD, no middleware, no health checks |
| **Testing** | 6 | No E2E, no integration, no adapter tests, no coverage |
| **DevOps / Config** | 5 | Empty next.config, missing scripts, no .env validation |
