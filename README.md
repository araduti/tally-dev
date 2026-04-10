# Tally

**AI-powered optimization for your entire multi-distributor stack.**

Tally analyzes usage, spend, and compliance posture across every vendor and distributor you work with — Pax8, Ingram Micro, TD Synnex, direct Microsoft, Adobe, Google Workspace, and more. Using secure API connections and AI, it surfaces real cost savings, compliance gaps, and optimized purchasing recommendations. Customers can act on every insight with one click: scale licenses up or down (immediate or scheduled), or purchase new products through their preferred distributor — all while respecting strict commitment windows and NCE-style rules.

**One-liner**  
Tally — AI-powered optimization for your entire stack. Analyze usage, cut waste, stay compliant, and buy what you need — all in one place.

**Tagline**  
Tally. Every vendor counted. Every gap closed. Every action a click away.

---

## Why Tally?

Tally is built for real-world enterprise and MSP realities:

- **Discovery-First Onboarding** — Start with zero technical setup. Select the vendors you use and choose whether you want to analyze existing spend or buy new licenses.
- **Multi-Distributor Intelligence** — Real-time pricing and availability from every connected distributor. AI shows the best option right now.
- **Strict Commitment Model** — NCE-style no-refund windows are enforced natively. Scale-downs become scheduled decreases with clear non-refundable dates.
- **Guided Purchasing** — One-click “Buy through Tally” creates the order on the chosen distributor while logging your exact margin.
- **Enterprise-Grade Compliance** — DPA signing, contract versioning, tax ID, separate billing emails, and manual invoicing flows for large organizations.
- **MSP-Native RBAC** — Three-tier role model with MSP delegation via parent-child organization hierarchy.

---

## Who is Tally for?

- **MSPs & Partners** — Full multi-distributor optimization with automated actions and margin tracking.
- **Enterprise IT / Procurement Teams** — Single pane of glass across direct vendors and distributors, with procurement-friendly invoicing and compliance controls.
- **New or Small Organizations** — Start with manual invoice uploads and upgrade to full API sync when ready.

Three customer modes are supported in the same platform:
- **Tracker** — Read-only AI insights and waste alerts.
- **Buyer** — Guided marketplace with real-time pricing and one-click purchasing.
- **Power User** — Full provisioning, scheduled decreases, and automated workflows.

---

## Key Features

### Discovery-First Onboarding
- Netflix-style logo grid: select the vendors you use.
- Intent choice: “Analyze my current spend” or “I want to buy new licenses”.
- Instant value path: manual CSV/invoice upload (no API keys needed yet).

### AI-Powered Recommendations
- Real-time cross-distributor pricing and availability.
- Flex vs Commit options with exact non-refundable dates.
- Waste detection, compliance posture, and projected invoice views.

### One-Click Actions
- Scale licenses up or down (immediate or scheduled).
- Purchase new products through any connected distributor.
- Automatic post-purchase license inventory updates.

### Enterprise Controls
- Contract signing, DPA, tax ID, and separate billing email.
- Manual invoicing mode for large organizations.
- Full audit trail and idempotency protection on every mutation.

### Security & Privacy
- Zero-trust multi-tenant architecture with row-level security.
- GDAP and distributor credentials encrypted at rest.
- No secrets ever exposed to the client bundle.

---

## How It Works

1. **Onboard** — Tell Tally what you use and what you want to achieve.
2. **Connect or Upload** — API sync for full automation or manual CSV for instant insights.
3. **AI Analyzes** — Live pricing from all distributors + your usage data.
4. **Act** — One-click purchase, scheduled decrease, or export projected invoice.
5. **Stay in Control** — Strict commitment windows are enforced and clearly communicated.

---

## Tech & Architecture Highlights

- Next.js 16.2 (App Router + RSC + Turbopack)
- Better Auth + Organization plugin (multi-tenant)
- Prisma 7.7 + PostgreSQL 18 with strict RLS proxy
- Inngest for durable workflows (time-travel, scheduled decreases, Pulse Monitor)
- Garage (S3-compatible) for scoped file storage
- Decimal.js for all monetary calculations
- Three-tier RBAC with MSP delegation via parent-child organizations

Self-hosted Docker-first deployment. No cloud lock-in.

---

## Getting Started

See [Developer.md](docs/Developer.md) for full local setup instructions.

```bash
git clone <repo>
cp .env.example .env
docker compose up -d db redis garage
npx prisma db push
npm run dev
```

