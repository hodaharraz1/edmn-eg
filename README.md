# EDMN Marketplace (اضمن) — V1

Arabic-first (RTL) multi-vendor marketplace for Egypt, prices in EGP, for **new and used** physical
products — plus EDMN's differentiator: **External Protected Deals** that protect a transaction which
started *outside* the marketplace.

> **بالعربي باختصار:** منصة سوق متعددة البائعين لمصر (عربي/RTL، بالجنيه المصري) للمنتجات الجديدة
> والمستعملة، مع دفع يدوي (تحويل بنكي / إنستاباي / فودافون كاش) يتحقق منه فريق اضمن، وشحن يدير
> البائع تكلفته حسب المحافظة مع رفع إلزامي لبوليصة الشحن، وإتاحة أرباح البائع فقط بعد تأكيد المشتري
> للاستلام، ودفتر قيود مزدوجة غير قابل للتعديل، وسحوبات بمراجِع ومنفّذ، وصفقات خارجية محمية.

## Surfaces

| Surface | Path (single host) | Dedicated host (optional) |
|---|---|---|
| Customer storefront | `/` | `edmneg.com` |
| Seller Center | `/seller` | `seller.edmneg.com` (`SELLER_HOST`) |
| Admin Operations Center | `/admin` | `admin.edmneg.com` (`ADMIN_HOST`) |

`src/proxy.ts` maps the dedicated hosts onto the same app and, with `ENFORCE_HOSTS=true`, refuses
seller/admin paths on the wrong host.

## Stack

- **Next.js 16.3** (App Router, React 19, Server Actions, `proxy.ts`), **TypeScript** (strict)
- **PostgreSQL 16** + **Drizzle ORM 0.45** (SQL migrations in `drizzle/`, DB-level integrity triggers)
- **Tailwind CSS v4**, IBM Plex Sans Arabic (self-hosted via `@fontsource`), `lucide-react`
- `sharp` (image re-encoding), `nodemailer` (SMTP adapter), `zod` (validation)
- **Vitest** (unit + integration against a real PostgreSQL), **Playwright** (E2E against a production build)

Architecture, data model and every control are documented in [`docs/`](docs):
[ARCHITECTURE](docs/ARCHITECTURE.md) · [DATABASE](docs/DATABASE.md) · [STATE_MACHINES](docs/STATE_MACHINES.md) ·
[SECURITY](docs/SECURITY.md) · [FINANCIAL_LEDGER](docs/FINANCIAL_LEDGER.md) · [PAYMENTS](docs/PAYMENTS.md) ·
[SHIPPING](docs/SHIPPING.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [OPERATIONS](docs/OPERATIONS.md) ·
[TESTING](docs/TESTING.md) · [ENVIRONMENT](docs/ENVIRONMENT.md) · [API_CONTRACTS](docs/API_CONTRACTS.md) ·
[FINAL_IMPLEMENTATION_REPORT](docs/FINAL_IMPLEMENTATION_REPORT.md)

## Prerequisites

- Node.js **22+** (uses `process.loadEnvFile`) and npm 10+
- PostgreSQL **16+** with the `pg_trgm` extension available (created by the first migration)
- For E2E only: a Chromium that Playwright can launch (`npx playwright install chromium`, or set
  `PLAYWRIGHT_CHROMIUM_PATH`)

## Installation

```bash
git clone https://github.com/hodaharraz1/edmn-eg.git
cd edmn-eg
git checkout claude/great-tesla-nor0wt   # development branch
npm ci
```

Create a PostgreSQL role and databases (example for a local install):

```bash
sudo -u postgres psql -c "create role edmn login password 'edmn' createdb;"
sudo -u postgres psql -c "create database edmn_dev owner edmn;"
sudo -u postgres psql -c "create database edmn_test owner edmn;"
sudo -u postgres psql -c "create database edmn_e2e owner edmn;"   # only for E2E
# pg_trgm must be creatable by the owner (PostgreSQL 13+ marks it trusted).
```

## Environment configuration

```bash
cp .env.example .env.local
# generate the two secrets:
openssl rand -base64 48   # → paste as SESSION_SECRET in .env.local
openssl rand -base64 32   # → paste as DATA_ENCRYPTION_KEY in .env.local (32 random bytes, base64)
npm run env:check
```

Every variable is documented in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md). Business configuration
(commissions, payment destinations, settlement rules, templates, legal texts…) lives **in the
database** and is edited by authorized admins with an audit trail — not in environment files.

## Migrations and seed

```bash
npm run db:migrate        # apply SQL migrations (idempotent)
npm run db:seed           # reference data only: governorates, categories + benchmark commissions,
                          # attributes, roles/permissions, policy rules, legal DRAFT placeholders
npm run db:seed:demo      # reference data + DEVELOPMENT demo data (refuses to run in production)
npm run db:setup          # migrate + demo seed
npm run db:reset          # DEV ONLY: drop & recreate the schema (refuses non-local hosts)
```

The demo seed drives the **real domain services** (onboarding → approval → products → moderation →
checkout → payment verification → shipping → receipt → withdrawals) so balances and the ledger are
genuine.

## Run

```bash
npm run dev               # http://localhost:3000
npm run worker            # background worker: outbound email/SMS, order expiry, settlements, follow-ups
```

Default development URLs: storefront `http://localhost:3000`, Seller Center
`http://localhost:3000/seller`, Admin `http://localhost:3000/admin`, health `http://localhost:3000/api/health`,
readiness `http://localhost:3000/api/ready`.

## Development admin setup

After `npm run db:seed:demo`:

| Account | Password | Notes |
|---|---|---|
| `admin@edmn.local` | `Admin@Edmn#2026` | Super admin (2FA required) |
| `ops@`, `payments@`, `checker@`, `finance@`, `support@`, `catalog@` `edmn.local` | same | role-scoped staff |
| `techzone@demo.edmn.local`, `anaqa@…`, `used@…`, `homestyle@…` | `Demo@12345` | approved demo sellers |
| `newseller@demo.edmn.local` | `Demo@12345` | seller pending review |
| `ahmed@demo.edmn.local`, `mona@…`, `omar@…` | `Demo@12345` | customers |

Admin login always requires TOTP. The demo staff share a development TOTP secret; print the current
code with:

```bash
npm run admin:totp
```

To bootstrap the first real super admin (interactive; the password is never echoed; prints the
TOTP enrollment URI once — add it to an authenticator app immediately):

```bash
npm run admin:create
```

Further staff accounts and their roles are then managed from **Admin → الأدوار والصلاحيات**.

These demo credentials exist only in development seed data and are never created by the production
seed. **Never** use them outside a local machine.

## Tests

```bash
npm run typecheck         # next typegen + tsc --noEmit
npm run lint              # eslint
npm test                  # unit + integration (Vitest, uses TEST_DATABASE_URL, resets it)
npm run test:e2e          # Playwright: builds, resets+seeds E2E_DATABASE_URL, runs on :3100
E2E_SKIP_BUILD=1 npm run test:e2e   # reuse an existing .next build
npm run ledger:check      # reconcile every ledger account against its journal lines
npm run test:all          # typecheck + lint + unit/integration + E2E
```

See [docs/TESTING.md](docs/TESTING.md) for coverage, including the 20 critical edge cases.

## Build

```bash
npm run build
npm start                 # production server on :3000 (requires production-safe env, HTTPS APP_URL)
```

Deployment, worker/cron, reverse proxy, backups: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Logo

The official EDMN logo is **not** included. A neutral, clearly labeled placeholder is rendered by
`src/ui/logo.tsx`. Set `NEXT_PUBLIC_LOGO_URL` (or replace that component's asset) when the official
file is provided — no redesign is needed.

## What is intentionally NOT configured

Real bank/InstaPay/Vodafone Cash destinations, SMTP/SMS credentials, hosting, lawyer-approved legal
texts and any card/PSP gateway are external inputs. The features exist around configurable,
clearly marked placeholders; see “Remaining External Configuration” in
[docs/FINAL_IMPLEMENTATION_REPORT.md](docs/FINAL_IMPLEMENTATION_REPORT.md).
