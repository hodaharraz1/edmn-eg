# Legacy Artifacts Required to Complete the Audit

The legacy-specific portion of the audit is blocked. Provide the items below (read-only copies are
enough). **Never send production secrets**: redact `.env` values, API keys, tokens, passwords and
full password hashes. A copy of the production database is **not** needed — a schema-only dump
plus aggregate counts is sufficient for this phase.

## Priority 1 — needed to start

| # | Artifact | How to obtain (examples) | Why |
|---|---|---|---|
| 1 | Legacy source repository (backend + admin dashboard), read access for this session | Add the repo to GitHub under the account connected here, or share a zip | Inventory, routes, logic, security |
| 2 | **Schema-only** database dump | MySQL: `mysqldump --no-data --routines --triggers DB > schema.sql` · PostgreSQL: `pg_dump --schema-only` | Database comparison, collisions |
| 3 | Per-table row counts (aggregate, no rows) | `SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = 'DB';` (exact `COUNT(*)` for financial tables) | Preservation register, reconciliation baseline |
| 4 | Route/API list | e.g. `php artisan route:list --json`, or an exported OpenAPI/Postman collection used by the mobile app | API map, backward-compatibility list |
| 5 | Environment variable **names only** (values redacted) | copy `.env` and replace every value with `***` | Integrations, storage, providers |

## Priority 2 — needed for financial & identity analysis

| # | Artifact | Why |
|---|---|---|
| 6 | Code paths that change wallet balances, create top-ups, withdrawals, guarantees, fees | Ledger analysis (is balance a column or derived?) |
| 7 | List of status values for: guarantees, withdrawals, top-ups, transactions, KYC, tickets | State/enum collisions |
| 8 | Password hashing configuration + hash *prefix* (e.g. `$2y$10$`) | Identity preservation |
| 9 | Unique constraints on users (email? phone? national ID?) | Duplicate-identity risk |
| 10 | Aggregate financial totals: Σ wallet balances, Σ pending/completed withdrawals, Σ held guarantee funds, Σ fees collected (by status) | Reconciliation baseline |
| 11 | File storage configuration (local disk / S3 bucket, public or private) and folder structure | Files & documents |
| 12 | Roles and permissions seed data | RBAC comparison |

## Priority 3 — context

| # | Artifact | Why |
|---|---|---|
| 13 | Mobile app version(s) in use and which API endpoints they call | `BACKWARD_COMPATIBILITY_REQUIRED` marking |
| 14 | Payment gateways/providers in production (Fawry? Paymob? manual?) | Payment integration map |
| 15 | Push/SMS/email providers | Notification migration |
| 16 | Deployment description (hosting, DB host type, backups in place) — no secrets | Backup & rollback plan |
| 17 | Admin screenshots of each menu section | Admin comparison (UI level) |
| 18 | Legal/fee policy currently applied to guarantees (5% / 3%?) | Fees comparison |

Once items 1–5 are available, the audit can be re-run to replace every `NOT INSPECTED` / `UNKNOWN`
cell with evidence.
