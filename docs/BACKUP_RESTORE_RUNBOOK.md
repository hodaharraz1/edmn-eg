# Backup and Restore Runbook

## Current state
- Database: Neon Postgres (staging). Neon point-in-time restore (branch from a past timestamp) is the backup mechanism.
- Private files: object storage configured per environment (staging uses the configured provider).
- **Restore drill: BLOCKED / NOT PERFORMED.** Reason: a restore drill needs an isolated target (new Neon branch +
  storage bucket copy) and owner sign-off; performing it from this task would create/alter infrastructure outside
  the agreed scope (no staging reset, no destructive operations). It is listed as go-live blocker `RESTORE_DRILL`.

## Proposed objectives (owner to approve)
| Item | Proposal |
|---|---|
| RPO (database) | ≤ 5 minutes (Neon WAL-based PITR) |
| RTO (database) | ≤ 2 hours |
| RPO (private files) | ≤ 24 hours (daily versioned copy) |
| RTO (full service) | ≤ 4 hours |
| PITR retention | ≥ 7 days (production: 30 days) |

## Drill procedure (to run before real money)
1. Create a Neon branch from a timestamp 1 hour in the past (never restore over the live branch).
2. Point a throw-away deployment at it (no real messaging/payout drivers).
3. Run `npm run ledger:check` and the finance-control invariants; compare row counts and Σ debits/credits with the source at that timestamp.
4. Restore a sample of private files (payment proofs, waybills) and verify checksums (`source_sha256`).
5. Record timings (RTO actual), data gap (RPO actual), sign-off; then delete the drill branch.
6. Remove `RESTORE_DRILL` from `KNOWN_PRODUCTION_BLOCKERS` only through a reviewed change citing the drill record.

## Never
Never restore over a live database, never truncate/reset staging, never delete ledger entries to "fix" a restore.
