# System A — Legacy EDMN Production System: Inventory

**Status: NOT INSPECTED — legacy source code, database schema and data were not available.**

This document records exactly what was and was not accessible on 2026-10-04, what little is
verifiable, and what is needed to complete the inventory. Nothing below is inferred from the
legacy login page; no legacy architecture has been fabricated.

## 1. Access check performed

| Source | Result |
|---|---|
| GitHub repositories visible to this session (`list_repos`, 12 repos under `hodaharraz1`) | **No repository containing the legacy backend/admin** (`api.edmneg.com/adminDashboard`). |
| `hodaharraz1/edmn-eg-nextjs` (private) | Cloned **read-only** and inspected. It is the **public marketing website**, not the legacy system (see §3). |
| Local filesystem of this environment | No legacy code, SQL dump, schema export, or legacy documentation. |
| Legacy database / credentials / environment files | Not provided. None were requested or used. |
| `https://api.edmneg.com/adminDashboard/login` | One unauthenticated `GET` returned `HTTP 200`, `text/html`, served through Cloudflare. **No login attempted, no credentials used.** Further fingerprinting of that page was stopped by this session's safety controls; the downloaded page was deleted without analysis. |

**Consequence:** every Phase that needs legacy internals (tables, models, routes, controllers, jobs,
roles, permissions, hashing, storage, data volumes) is **blocked**. Those cells are marked
`NOT INSPECTED` / `UNKNOWN` throughout the audit.

## 2. Verifiable facts about System A (external only)

| Fact | Evidence | Confidence |
|---|---|---|
| A legacy admin dashboard is served at `https://api.edmneg.com/adminDashboard/login` | HTTP 200 HTML response | Verified |
| The `api.edmneg.com` host is fronted by Cloudflare | `server: cloudflare`, `cf-ray` headers | Verified |
| The same host name (`api.`) suggests it also serves an API (likely for the mobile app) | Host naming only | **Hypothesis — verify** |
| A customer-facing app is referenced at `app.edmneg.com` | Marketing site hero section (`HeroSection.tsx`) | Referenced, not inspected |
| An EDMN mobile app exists on iOS and Android ("beta") | Marketing copy (`locales/en.json` → `launch.desc`, `hero.downloadApp`) | Claimed, not inspected |

Capabilities listed in the audit brief (users, KYC, guarantees, wallet/top-ups, withdrawals,
payment methods, tickets, admins, roles, permissions, activity logs, fee settings, statistics,
notifications) are **unverified**; they are carried into the comparison as "reported by owner,
to be verified".

## 3. Adjacent system found: EDMN marketing website (`hodaharraz1/edmn-eg-nextjs`)

Not part of System A or B, but it is live-facing, holds lead PII, and makes product and legal claims
that matter for integration. Inspected read-only (HEAD `4a87884`, 2026-06-17).

| Item | Finding |
|---|---|
| Stack | Next.js 16.2.6, React 19.2, next-intl (ar/en), Tailwind v4, PWA, Sentry, Upstash Redis rate limiting, Vercel-oriented |
| Pages | `/[locale]/` home, about, how-it-works, why-us, faq, blog (+ `[slug]`), contact, register, terms, privacy-policy, refund-policy; `/og` image; `/api/health`, `/api/contact` |
| Backend | **None for transactions.** `/api/contact` validates a contact/register form (name, email, phone, subject, message; honeypot; rate limit) and forwards it to **Formspree**; code also references an **Airtable** lead store (`lib/airtable`) |
| Data held | Lead/contact submissions (PII) in Formspree/Airtable — outside both systems |
| Domains used | `edmneg.com` (canonical URLs, JSON-LD), `app.edmneg.com` (product), `info@edmneg.com` |

### Product claims made publicly (useful context, **not implementation evidence**)

- EDMN is an **escrow / financial-mediation app**: buyer and seller agree on terms **inside the app**,
  buyer deposits funds with EDMN, seller delivers, buyer confirms receipt, funds are released to the
  seller "instantly".
- Covers physical goods **and digital services, rentals, design, programming**.
- **Fees: 5% for individuals, 3% for merchants**, "no hidden fees".
- Disputes reviewed by EDMN support; funds held until resolved; refund policy exists.
- Claims of an "insured", "officially licensed" escrow account, "bank-grade encryption", and
  partnerships (Banque Misr, Fawry, ValU) — **legal/compliance review required** (see RISK_REGISTER).

These claims indicate that System A's core product is a **guarantee/escrow transaction between two
app users**, which is the closest analogue to System B's *External Protected Deal* — but semantics,
statuses, fees and money flow must be verified in the legacy code before any mapping.

## 4. Inventory template still to be completed (legacy)

| Area | Status | Needed artifact |
|---|---|---|
| Framework / language / runtime | NOT INSPECTED | repository + lockfile / composer.json / package.json |
| Frontend (admin) stack | NOT INSPECTED | admin views/templates |
| Backend stack | NOT INSPECTED | source code |
| Database engine & version | NOT INSPECTED | `SELECT version()` output |
| Schema, migrations, models | NOT INSPECTED | schema-only dump + migrations folder |
| Routes / controllers / APIs | NOT INSPECTED | route list (e.g. `php artisan route:list`, Express router dump, OpenAPI) |
| Services, queues, jobs, cron | NOT INSPECTED | source + crontab / supervisor config |
| Authentication (admins, users, mobile tokens) | NOT INSPECTED | auth config, token implementation |
| Password hashing algorithm | NOT INSPECTED | hashing config / sample hash *prefix only* (e.g. `$2y$`) — never full hashes |
| Roles / permissions / admins | NOT INSPECTED | tables + seeders |
| KYC flow and documents | NOT INSPECTED | models, storage config |
| Wallet / top-ups / withdrawals / transactions | NOT INSPECTED | models, services, balance logic |
| Guarantees (lifecycle, statuses, fees) | NOT INSPECTED | models, state handling |
| Payment methods / gateways | NOT INSPECTED | integration code |
| Notifications (push/SMS/email) | NOT INSPECTED | providers, templates |
| Tickets / support | NOT INSPECTED | models |
| Activity logs | NOT INSPECTED | table + writer |
| Fee settings / statistics | NOT INSPECTED | settings table, reports |
| File storage | NOT INSPECTED | filesystem/S3 config, bucket policy |
| Deployment | NOT INSPECTED | hosting description (no secrets) |
| Data volumes | NOT INSPECTED | per-table row counts (aggregate only) |

The exact request list is in [LEGACY_ARTIFACTS_REQUIRED.md](LEGACY_ARTIFACTS_REQUIRED.md).
