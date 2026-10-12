# Database Restore (isolated) + Post-Restore Financial Verification

## Rule
A restore **always** targets a NEW, ISOLATED database (provider branch or a local `edmn_restore_drill_*`). Never restore over staging or production. Never run the app with real messaging/payout drivers against a restored copy.

## Scripted drill (local / non-production) — `scripts/restore-drill.ts`
```
npx tsx scripts/restore-drill.ts --source postgresql://edmn:edmn@localhost:5432/edmn_e2e
```
pg_dump → new local DB `edmn_restore_drill_<ts>` (refuses non-local sources, existing targets, names without `restore_drill`) → verification → JSON evidence in `drills/` → drop (unless `--keep`).

## Provider drill (owner, before real money)
1. Neon: create a branch from a timestamp (e.g. 1 h ago). Never reset the live branch.
2. Point a throw-away deployment (EDMN_ENVIRONMENT=staging-like, log drivers) or run verification SQL directly.
3. Run the checklist below, record timings (actual RTO) and data gap (actual RPO), sign off, delete the branch.
4. Only then a reviewed change may remove `RESTORE_DRILL` / `BACKUP_VERIFIED` from `KNOWN_PRODUCTION_BLOCKERS`.

## Post-restore verification checklist (all must match the source at the restore point)
| Check | How |
|---|---|
| Schema / migrations | `count(*) from drizzle.__drizzle_migrations` = expected |
| Row counts | users, sellers, orders, seller_orders, payments, journal_entries, journal_lines, ledger_accounts, financial_approvals, financial_movement_requests, withdrawal_requests, withdrawal_allocations, refunds, deal_payouts, external_deals, user_identity_verifications, receiving_destinations, seller_payout_methods, files, stored_objects, pricing_*, audit_logs |
| Ledger debits / credits / difference | Σ debit = Σ credit, difference 0; `ledger_hash` identical |
| Drift | stored balances = Σ lines (projection_drift 0) |
| Duplicates | duplicate business events 0 |
| Approvals | financial_approvals count identical |
| Withdrawal allocations | Σ allocations = withdrawal amount for every allocated withdrawal |
| Refund snapshots | refunds count identical; refund fee snapshots intact |
| Seller source attribution | seller-scoped ledger accounts identical (MARKETPLACE / PROTECTED_DEAL attribution) |
| Identity metadata | identity cases + document references identical (documents stay encrypted/private) |
| Document references | every `files` row has its object (`scripts/storage-verify.ts`) with matching sha256 |
| Pricing snapshots | seller_orders / external_deals pricing snapshot hashes identical (history never rewritten) |
| Then | `runLedgerHealthCheck` on the restored copy = OK/WARNING |

## Latest drill evidence (local, Batch 2)
Isolated local restore of the E2E database: **PASS**, 0 diffs; debits = credits = 17,484,642; drift 0; duplicates 0; allocation mismatch 0; dump 2.1 s + restore 2.2 s. This proves the procedure and the verification, **not** production backups.
