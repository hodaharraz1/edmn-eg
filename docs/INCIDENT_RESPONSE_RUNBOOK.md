# Incident Response Runbook (financial)

## Severity
- **SEV1** — money may leave incorrectly (wrong payout, duplicate payout, ledger imbalance, unapproved journal, secret leak).
- **SEV2** — money stuck or controls degraded (release/refund blocked by a bug, reconciliation mismatch, failed jobs).
- **SEV3** — single-order issue with a workaround.

## First 15 minutes (SEV1)
1. Engage the relevant **kill switch** at `/admin/finance-control` (payments, seller release, refunds, withdrawals,
   payouts, deal release, adjustments). Switches stop NEW actions only and fail closed; history is untouched.
2. Snapshot evidence: finance-control invariants, affected approvals (`/admin/approvals`), audit log, runtime logs.
3. Revoke any not-yet-executed approval involved (`revokeApproval`, audited).
4. Notify owner + finance lead. Do not delete or edit any record.

## Investigation
Drill down from the failing invariant sample to the source event (journal entry → approval → actor → audit trail →
request/session). Check reconciliation for external movements.

## Correction
Only via new balanced entries under a new MANUAL_ADJUSTMENT approval (maker/checker), or the normal refund/withdrawal
reversal paths. Re-run invariants; close the day with the incident reference.

## Recovery
Release kill switches one at a time with a reason; monitor runtime logs for 5xx and the operations queues.

## Post-incident
Root cause, timeline, regression test, and an update to FAILURE_MODE_MATRIX.md.
