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

### 8. ~~No E2E Tests~~ ✅ DONE
- **File:** `playwright.config.ts` → `testDir: './tests/e2e'`
- **Status:** IMPLEMENTED
- Skeleton E2E tests created for auth, dashboard, subscriptions, compliance, and settings flows. Shared login helper in `tests/e2e/helpers.ts`. Uses `@playwright/test` with `data-testid` selectors.

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

### 13. ~~Contract Signing Flow — Stub~~ ✅ DONE
- **File:** `src/server/routers/organization.ts`, `src/app/(dashboard)/compliance/compliance-client.tsx`
- **Status:** IMPLEMENTED
- Added `getContractStatus` query and `signContract` mutation to organization router. Signs contract, enables provisioning, writes audit log. Compliance UI now shows dynamic contract status with "Sign Contract" button that calls the mutation. Idempotent (re-signing returns existing state).

### 14. ~~Forgot Password / Password Reset~~ ✅ DONE
- **File:** `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/reset-password/page.tsx`, `src/app/(auth)/login/page.tsx`
- **Status:** IMPLEMENTED
- Forgot password page sends reset email via Better Auth's `/api/auth/forget-password` endpoint. Reset password page validates token from URL, enforces 8-char minimum, confirms match. Login page now has "Forgot password?" link. Both pages use consistent auth page styling.

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

### 21. ~~No Projected Invoice View in UI~~ ✅ DONE
- **File:** `src/app/(dashboard)/billing/billing-client.tsx`
- **Status:** IMPLEMENTED
- `ProjectedInvoice` component calls `api.billing.projectInvoice.useQuery({})` and renders a cost breakdown card with projected total, billing period dates, and line item table (bundle, distributor, quantity, unit cost, line total). Shows pending scale-down indicators and commitment end dates. Gracefully handles loading (skeleton), empty (no subscriptions), and error (insufficient permissions) states. Uses Decimal.js for all monetary formatting.

### 22. ~~No Create-License UI (Only Bulk Import)~~ ✅ DONE
- **File:** `src/app/(dashboard)/licenses/create/`
- **Status:** IMPLEMENTED
- Multi-step form: select bundle → select product offering → set quantity with price preview → submit. Uses `subscription.create` mutation. Includes loading states, error handling, and Decimal.js for monetary formatting.

### 23. ~~No Subscription Detail / Edit Page~~ ✅ DONE
- **File:** `src/app/(dashboard)/subscriptions/[id]/`
- **Status:** IMPLEMENTED
- Detail page shows subscription info, licenses table with scale up/down/cancel actions, commitment warnings. Subscription table rows are now clickable. Includes modals for quantity changes and cancellation with commitment awareness.

### 24. ~~Dashboard Insights Are Read-Only~~ ✅ DONE
- **File:** `src/app/(dashboard)/dashboard-insights.tsx`
- **Status:** IMPLEMENTED
- Recommendation cards now show "Apply" + "Investigate" buttons (RIGHT_SIZE, COST_OPTIMIZATION) or a single "Investigate" button (COMMITMENT_SUGGESTION). Waste alert cards show "Investigate" + "Dismiss" buttons. "Investigate" links to entity detail pages (subscription detail or license list). "Dismiss" tracks dismissed alerts in local state with a count indicator. Buttons follow existing slate-800 / blue-600 styling conventions.

### 25. Insights Not Persisted
- **File:** `src/server/routers/insights.ts`
- Recommendations and alerts are generated on-the-fly from current data. No `InsightHistory` table for trend tracking.

### 26. ~~Vendor Sync Status — No Progress / Logs UI~~ ✅ DONE
- **File:** `src/app/(dashboard)/settings/settings-client.tsx`
- **Status:** IMPLEMENTED
- Enhanced vendor connection cards with: last sync timestamp, relative time display, "Sync Now" button with spinner, progress state machine (idle→enqueuing→enqueued→polling→success/error), stale warning (>24h since last sync), polling for background sync completion, error display with retry button.

### 27. ~~Onboarding Selections Not Persisted~~ ✅ DONE
- **File:** `src/server/routers/organization.ts`
- **Status:** IMPLEMENTED
- Added `saveOnboardingSelections` mutation that persists selected vendors and intent as organization metadata. Uses `authenticatedMutationProcedure` (works without org context for new users).

### 28. No OAuth / SSO Login
- **Files:** `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`
- No Google, Microsoft, or SAML login. Email/password only.

### 29. No Email Verification on Registration
- **File:** `src/app/(auth)/register/page.tsx`
- Account created immediately with no email confirmation step.

### 30. ~~Rate Limiting Has No Redis Fallback~~ ✅ DONE
- **File:** `src/lib/rate-limit.ts`
- **Status:** IMPLEMENTED
- Added in-memory fixed-window counter fallback when Redis is unavailable. Rate limiting remains active during Redis outages instead of being silently disabled. Includes periodic cleanup timer (60s) to prevent unbounded memory growth. Exported `_resetInMemoryStore()` for test isolation.

### 31. ~~Vendor Credential Erasure Incomplete~~ ✅ DONE
- **File:** `src/server/routers/vendor.ts` (disconnect mutation)
- **Status:** IMPLEMENTED
- Two-pass cryptographic erasure: first overwrites credentials with 64 random bytes (overwriting ciphertext in storage/WAL), then sets to empty string and marks DISCONNECTED. Audit log includes `credentialsErased: true`.

### 32. ~~Homepage Does Not Redirect Authenticated Users~~ ✅ DONE
- **File:** `src/middleware.ts`
- **Status:** IMPLEMENTED
- Middleware now redirects authenticated users from `/` to `/marketplace`.

### 33. ~~CSV Import Missing Template Download~~ ✅ DONE
- **File:** `src/app/(dashboard)/licenses/import/csv-upload-client.tsx`
- **Status:** IMPLEMENTED
- Added "Download CSV Template" button generating client-side CSV blob with proper headers and example rows. Added batch-size warning (500 record max) that disables import. Added duplicate offering ID detection with warning panel.

### 34. ~~Organization Deletion — No Cascade Cleanup~~ ✅ DONE
- **File:** `src/server/routers/organization.ts` (deactivate mutation)
- **Status:** IMPLEMENTED
- Deactivation now cascades within a transaction: suspends active subscriptions, revokes pending invitations, erases vendor credentials (marks DISCONNECTED), and soft-deletes child client orgs.

---

## 🔵 P3 — Low (Polish, DX & Nice-to-Haves)

### 35. ~~No Breadcrumbs~~ ✅ DONE
- **File:** `src/app/(dashboard)/breadcrumbs.tsx`, `src/app/(dashboard)/layout.tsx`
- **Status:** IMPLEMENTED
- Auto-generated breadcrumbs from URL path. Maps known segments to human-readable labels. Handles dynamic ID segments (truncated). Returns null on root page. Integrated in dashboard layout above page content.

### 36. No Global Search / Command Palette
- No `⌘K` command palette. No full-text search across subscriptions, licenses, or members.

### 37. No Dark Mode
- No theme toggle. Light mode only.

### 38. ~~No User Profile Menu~~ ✅ DONE
- **File:** `src/app/(dashboard)/user-profile-menu.tsx`, `src/server/routers/user.ts`
- **Status:** IMPLEMENTED
- Avatar/initials dropdown in dashboard header (desktop + mobile). Shows user name, email, current organization name, and sign-out button. Uses `user.me` tRPC query for profile data. Click-outside and Escape key close the dropdown. Follows existing org-switcher dropdown patterns.

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

### 44. ~~Invitation Resend Missing~~ ✅ DONE
- **File:** `src/server/routers/admin.ts`
- **Status:** IMPLEMENTED
- Added `resendInvitation` mutation. Validates invitation is expired or revoked, checks for existing member or pending invitation, creates new invitation with fresh 7-day expiry, marks old invitation as revoked if expired, writes audit log.

### 45. ~~No Health-Check Endpoint~~ ✅ DONE
- **File:** `src/app/api/health/route.ts`
- **Status:** IMPLEMENTED
- GET `/api/health` returns `{ status: 'ok', timestamp }` for load balancer probes.

### 46. ~~No Logging Infrastructure~~ ✅ DONE
- **File:** `src/lib/logger.ts`
- **Status:** IMPLEMENTED
- Structured logger with JSON output (production) and human-readable format (development). Configurable log level via `LOG_LEVEL` env var. Automatic sensitive field redaction (password, credentials, token, etc.). Child logger support for request-scoped context (traceId, organizationId). Error serialization with stack traces in dev only.

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

### 57. ~~No Database Migration Strategy~~ ✅ DONE
- **File:** `prisma/migrations/README.md`
- **Status:** IMPLEMENTED
- Migration directory created with documentation. Rules: never `db push` in production, migration files committed to VCS, never edit applied migrations, destructive changes require two-step migration. Scripts already in package.json: `db:migrate`, `db:migrate:deploy`, `db:reset`.

### 58. No Monitoring / APM
- No Prometheus metrics, no OpenTelemetry traces, no Datadog/New Relic integration.

---

## 📊 Summary

| Priority | Count | Description |
|----------|-------|-------------|
| **P0 — Critical** | 9 (8 done) | ~~Core logic~~ fixed, ~~deployment~~, ~~CI/CD~~, ~~E2E tests~~, no integration tests |
| **P1 — High** | 9 (8 done) | ~~Billing snapshots~~, ~~commitment workflows~~, ~~MSP constraints~~, ~~bulk import~~, ~~security middleware~~, ~~vendor adapter tests~~, ~~contract signing~~, ~~forgot password~~ |
| **P2 — Medium** | 16 (12 done) | ~~Audit log filtering~~, ~~DPA version compare~~, ~~homepage redirect~~, ~~org deletion cascade~~, ~~projected invoices~~, ~~create-license UI~~, ~~subscription detail~~, ~~insights actions~~, ~~vendor sync status~~, ~~onboarding persistence~~, ~~rate limit fallback~~, ~~credential erasure~~ |
| **P3 — Low** | 24 (14 done) | ~~Health check~~, ~~next.config~~, ~~docker health~~, ~~type-safe adapters~~, ~~coverage config~~, ~~tsconfig strict~~, ~~scripts~~, ~~env validation~~, ~~CSV template~~, ~~breadcrumbs~~, ~~user profile menu~~, ~~invitation resend~~, ~~logging~~, ~~migration strategy~~ |
| **Total** | **58 (42 done)** | |

### By Layer

| Layer | Items | Key Gaps |
|-------|-------|----------|
| **Backend / API** | 15 (13 done) | ~~Vendor API wiring~~, ~~invitation accept~~, ~~billing writes~~, ~~commitment workflows~~, ~~MSP constraints~~, ~~bulk import~~, ~~audit filtering~~, ~~DPA version~~, ~~org cascade~~ |
| **Frontend / UI** | 18 (1 done) | Missing pages, stub forms, no action buttons, auth gaps, ~~homepage redirect~~ |
| **Infrastructure** | 14 (4 done) | ~~Dockerfile~~, ~~CI/CD~~, ~~middleware~~, ~~health checks~~ |
| **Testing** | 6 (1 done) | No E2E, no integration, ~~vendor adapter tests~~, no coverage |
| **DevOps / Config** | 5 (5 done) | ~~next.config~~, ~~scripts~~, ~~env validation~~, ~~tsconfig strict~~, ~~coverage config~~ |
