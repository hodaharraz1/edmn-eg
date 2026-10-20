# Proposed Non-Destructive Migration Plan, Backups & Reconciliation (design only — NOT executed)

Tailored to the current findings: System B holds no production data; System A holds all production
data; System A internals are not yet inspected. Therefore the plan starts with **evidence**, keeps
legacy as the system of record for its domains, and integrates through **links and adapters**, not
data moves.

## 1. Stages

| Stage | Name | What happens | Exit criteria |
|---|---|---|---|
| 0 | Evidence & snapshots | Obtain legacy artifacts; complete this audit; full backups (§2) with tested restore | Audit has no `NOT INSPECTED` for P0 domains; restore drill passed |
| 1 | Additive schema | Add **new** tables only (e.g. `identity_links`, `legacy_refs`, namespaced settings) — no change to existing legacy tables | Migrations are additive and reversible; legacy untouched |
| 2 | Identity mapping | Verified linking of people present in both systems (OTP / admin review); duplicate report | Zero auto-merges; every link has evidence |
| 3 | Compatibility / adapter layer | Read-only adapters: B reads legacy KYC status, user profile, files (by URI) without copying | Adapters covered by contract tests |
| 4 | Read-path integration | Unified ops center shows legacy data (wallets, guarantees, top-ups, withdrawals, tickets) read-only beside B data | Legacy admin still fully operational |
| 5 | Write-path integration (per domain, owner-approved) | e.g. shared verification engine for top-ups and order payments; shared maker/checker for both withdrawal types — each domain keeps its own records | Exactly-once & concurrency tests per domain |
| 6 | Financial reconciliation | Legacy baselines vs integrated views (§4); opening-balance entries only if a unified ledger is approved | Every mismatch explained and signed off |
| 7 | Unified admin UI | "EDMN Unified Operations & Control Center" over both back ends | Feature preservation matrix fully ticked |
| 8 | Legacy compatibility period | Legacy APIs/admin remain available; mobile app unchanged | Owner-defined duration |
| 9 | Optional retirement (explicit owner approval only) | Retire obsolete legacy **code paths**; **historical data remains preserved and queryable** | Signed approval per feature |

## 2. Backups required before Stage 1

- Full legacy DB dump (logical, e.g. `mysqldump --single-transaction` / `pg_dump -Fc`) + schema-only dump.
- Point-in-time recovery / binary logs enabled for the migration window.
- Full file/document backup (KYC, evidence, proofs) + **SHA-256 manifest** (path, size, checksum).
- Repository tags for legacy, marketplace and marketing site at the exact deployed commits.
- Environment/config inventory (**names only**, values in the secret manager).
- Deployment snapshot (server image / container image IDs, DNS records export).
- B database dump (once it has data).
- **Rollback requirement:** a restore of DB + files into a staging environment must be executed and
  verified (counts and financial totals match §4) before any production step. No restore drill =
  no migration.

## 3. Rollback rules

- Every stage is reversible without touching legacy data: additive tables can be dropped, adapters
  switched off, links removed (with audit).
- Any financial import is a tagged batch with reversing entries; never edits or deletes.
- DNS changes keep the previous records exported and TTLs lowered in advance.

## 4. Reconciliation checks (run before and after every stage; store results)

Counts (by status where applicable): users, users with verified phone, KYC records by status, KYC
documents, guarantees by status, guarantee parties, guarantee evidence files, top-ups by status,
customer withdrawals by status, transactions by type, tickets and ticket messages, notifications,
admins, roles, permissions, activity log rows, uploaded files (DB rows vs storage objects vs
manifest).

Financial totals (minor units, by currency, by day and status):
- Σ wallet balances vs Σ(credits − debits) of wallet movements (must match; explain drift).
- Σ top-ups approved; Σ pending top-ups.
- Σ pending, approved, paid, rejected customer withdrawals.
- Σ guarantee funds held (by status), Σ released, Σ refunded, Σ fees collected.
- Σ fees by period vs fee settings in force at the time.
- For B: trial balance, projection-vs-journal drift (`npm run ledger:check`), Σ seller pending /
  available / reserved, Σ refunds payable, Σ deal funds held.
- After any opening-balance import: clearing account nets to **zero**.

Rules: record counts alone are never sufficient; every mismatch gets a written explanation and an
owner sign-off; checks are scripted and re-runnable; results are kept as evidence.
