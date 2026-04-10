# Tally GitHub Copilot Agents

Custom AI agents for the Tally multi-distributor license optimization platform, adapted for **GitHub Copilot with Claude 4.6 Opus**.

> These agents are inspired by [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) and customized for Tally's specific architecture, security model, and business domain.

## How to Use

These agents are automatically available to GitHub Copilot when working in this repository. Reference them by name in your prompts:

```
@tally-api-architect Design a tRPC procedure for cross-distributor pricing comparison
@tally-security-auditor Review this PR for RLS bypass vulnerabilities
@tally-license-optimizer Implement the commitment-gated scale-down flow
```

## Agent Directory

### Tier 1 — Core Business (10 agents)

These agents embody Tally's core domain knowledge and non-negotiable architectural rules.

| Agent | Source Inspiration | Tally Specialization |
|---|---|---|
| [tally-api-architect](tally-api-architect.md) | api-designer | tRPC v11 + Zod v4 + idempotency + RLS scoping |
| [tally-backend-developer](tally-backend-developer.md) | backend-developer | Next.js 16.2 server-side + Prisma RLS proxy |
| [tally-nextjs-developer](tally-nextjs-developer.md) | nextjs-developer | App Router + RSC + multi-tenant UI patterns |
| [tally-security-auditor](tally-security-auditor.md) | security-auditor | Zero-trust, RLS enforcement, AES-256-GCM credentials |
| [tally-compliance-auditor](tally-compliance-auditor.md) | compliance-auditor | DPA gates, audit trails, NCE commitment compliance |
| [tally-fintech-engineer](tally-fintech-engineer.md) | fintech-engineer | Decimal.js, margin tracking, cross-distributor pricing |
| [tally-license-optimizer](tally-license-optimizer.md) | license-engineer | NCE commitment windows, scale-up/down, waste detection |
| [tally-postgres-pro](tally-postgres-pro.md) | postgres-pro | PostgreSQL 18, RLS, Prisma 7.7, multi-tenant indexing |
| [tally-code-reviewer](tally-code-reviewer.md) | code-reviewer | Tally-specific review standards, security violations |
| [tally-vendor-adapter-engineer](tally-vendor-adapter-engineer.md) | _(custom)_ | Pax8, Ingram, TD Synnex adapter development |

### Tier 2 — Development Workflow (5 agents)

These agents support the day-to-day development process with Tally-aware tooling knowledge.

| Agent | Source Inspiration | Tally Specialization |
|---|---|---|
| [tally-debugger](tally-debugger.md) | debugger | RLS debugging, Inngest workflow failures, traceId correlation |
| [tally-documentation-engineer](tally-documentation-engineer.md) | documentation-engineer | Complex domain docs, commitment models, catalog hierarchy |
| [tally-test-engineer](tally-test-engineer.md) | qa-expert + test-automator | Multi-tenant test isolation, financial precision tests |
| [tally-inngest-workflow](tally-inngest-workflow.md) | _(custom)_ | Durable workflows, withTenantContext, scheduled operations |
| [tally-rbac-specialist](tally-rbac-specialist.md) | _(custom)_ | Three-tier RBAC, MSP delegation, org hierarchy |

### Tier 3 — Supporting (3 agents)

These agents handle specialized aspects of the platform.

| Agent | Source Inspiration | Tally Specialization |
|---|---|---|
| [tally-frontend-developer](tally-frontend-developer.md) | frontend-developer | Pricing comparison UI, onboarding flows, org switcher |
| [tally-devops-engineer](tally-devops-engineer.md) | devops-engineer | Docker-first deployment, CI/CD, self-hosted architecture |
| [tally-refactoring-specialist](tally-refactoring-specialist.md) | refactoring-specialist | Safe refactoring with RLS and audit trail preservation |

---

## Mapping: Awesome Claude Code Subagents → Tally Agents

This table maps every category from the [awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) repo to Tally's needs, explaining which agents were selected and why.

### 01. Core Development

| Original Agent | Tally Decision | Reason |
|---|---|---|
| api-designer | ✅ → `tally-api-architect` | tRPC v11 API design is central to Tally |
| backend-developer | ✅ → `tally-backend-developer` | Server-side logic is the bulk of Tally's code |
| frontend-developer | ✅ → `tally-frontend-developer` | Complex UI for pricing, licensing, onboarding |
| fullstack-developer | ⏭️ Covered by backend + nextjs | Split into specialized agents instead |
| design-bridge | ❌ Not needed | No dedicated design team workflow |
| electron-pro | ❌ Not needed | Tally is web-only |
| graphql-architect | ❌ Not needed | Tally uses tRPC, not GraphQL |
| microservices-architect | ❌ Not needed | Tally is a monolith (Next.js) |
| mobile-developer | ❌ Not needed | No native mobile app |
| ui-designer | ❌ Not needed | Covered by frontend-developer |
| websocket-engineer | ❌ Not needed | No WebSocket requirements |

### 02. Language Specialists

| Original Agent | Tally Decision | Reason |
|---|---|---|
| typescript-pro | ⏭️ Covered by all agents | TypeScript knowledge embedded in every Tally agent |
| nextjs-developer | ✅ → `tally-nextjs-developer` | Core framework |
| react-specialist | ⏭️ Covered by frontend | React knowledge in frontend + nextjs agents |
| sql-pro | ⏭️ → `tally-postgres-pro` | Combined with PostgreSQL expertise |
| Others (angular, vue, swift, etc.) | ❌ Not needed | Not in Tally's tech stack |

### 03. Infrastructure

| Original Agent | Tally Decision | Reason |
|---|---|---|
| devops-engineer | ✅ → `tally-devops-engineer` | Docker-first deployment |
| database-administrator | ⏭️ → `tally-postgres-pro` | Combined into PostgreSQL specialist |
| docker-expert | ⏭️ → `tally-devops-engineer` | Docker knowledge in devops agent |
| security-engineer | ⏭️ → `tally-security-auditor` | Combined into security specialist |
| Others (kubernetes, terraform, etc.) | ❌ Not needed | Tally is Docker Compose + self-hosted |

### 04. Quality & Security

| Original Agent | Tally Decision | Reason |
|---|---|---|
| security-auditor | ✅ → `tally-security-auditor` | Zero-trust architecture is critical |
| compliance-auditor | ✅ → `tally-compliance-auditor` | DPA, audit trails, financial compliance |
| code-reviewer | ✅ → `tally-code-reviewer` | Tally-specific review standards |
| debugger | ✅ → `tally-debugger` | Multi-tenant debugging requires context |
| qa-expert | ⏭️ → `tally-test-engineer` | Combined with test-automator |
| test-automator | ⏭️ → `tally-test-engineer` | Combined with qa-expert |
| performance-engineer | ⏭️ Covered by postgres-pro | DB optimization is the main perf concern |
| Others (penetration-tester, chaos-engineer) | ❌ Not needed now | Can add later as team scales |

### 05. Data & AI

| Original Agent | Tally Decision | Reason |
|---|---|---|
| postgres-pro | ✅ → `tally-postgres-pro` | PostgreSQL 18 is the primary datastore |
| ai-engineer | ⏭️ Future consideration | AI recommendations are planned but not yet built |
| Others (data-engineer, ml-engineer, etc.) | ❌ Not needed now | No ML pipeline yet |

### 06. Developer Experience

| Original Agent | Tally Decision | Reason |
|---|---|---|
| documentation-engineer | ✅ → `tally-documentation-engineer` | Complex domain needs clear docs |
| refactoring-specialist | ✅ → `tally-refactoring-specialist` | RLS-aware refactoring is unique |
| Others (build-engineer, cli-developer, etc.) | ❌ Not needed | Standard tooling sufficient |

### 07. Specialized Domains

| Original Agent | Tally Decision | Reason |
|---|---|---|
| fintech-engineer | ✅ → `tally-fintech-engineer` | Financial precision is non-negotiable |
| license-engineer | ✅ → `tally-license-optimizer` | Adapted for NCE commitment models |
| payment-integration | ⏭️ Covered by fintech | Purchase transactions in fintech agent |
| Others (blockchain, game-dev, iot, etc.) | ❌ Not applicable | Not in Tally's domain |

### 08. Business & Product

| Original Agent | Tally Decision | Reason |
|---|---|---|
| product-manager | ❌ Not needed as agent | Human-driven process |
| business-analyst | ❌ Not needed as agent | Human-driven process |
| Others | ❌ Not applicable | Not code-generation focused |

### 09. Meta & Orchestration

| Original Agent | Tally Decision | Reason |
|---|---|---|
| All orchestration agents | ❌ Not needed | GitHub Copilot handles orchestration natively |

### 10. Research & Analysis

| Original Agent | Tally Decision | Reason |
|---|---|---|
| All research agents | ❌ Not needed | Not applicable to code generation |

---

## Key Differences: GitHub Copilot Agents vs Claude Code Subagents

| Aspect | Claude Code Subagents | GitHub Copilot Agents |
|---|---|---|
| Directory | `.claude/agents/` | `.github/agents/` |
| Frontmatter | `name`, `description`, `tools`, `model` | `name`, `description` only |
| Model selection | Per-agent via `model:` field | Set globally in Copilot settings |
| Tool access | Per-agent via `tools:` field | Inherited from Copilot platform |
| Installation | `claude plugin install` or manual copy | Automatic — commit to repo |

All agents in this directory use the GitHub Copilot format with only `name` and `description` in frontmatter, and embed Tally-specific context directly in the system prompt body.

---

## Architecture Rules Enforced by All Agents

Every agent in this directory enforces these non-negotiable rules:

1. **RLS-Only Data Access** — `ctx.db` (Prisma RLS proxy), never `new PrismaClient()`
2. **Idempotency-Key on Mutations** — Every tRPC mutation validates an idempotency key
3. **Decimal.js for Money** — All monetary math uses Decimal.js, never floating-point
4. **AuditLog on Every Mutation** — Immutable append-only audit trail
5. **withTenantContext for Inngest** — Background jobs maintain RLS isolation
6. **Namespace Isolation** — Redis: `cache:{organizationId}:`, S3: `org/{organizationId}/`
7. **Credential Safety** — AES-256-GCM encrypted, decrypted only in adapters, never logged
8. **Resolved Roles** — `ctx.effectiveRole` from proxy.ts, never re-queried from DB
