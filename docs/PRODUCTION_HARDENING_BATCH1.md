# Production Hardening — Batch 1 (C1–C8 + operator wording)

Scope: the C1–C8 findings and the §AL wording issues of the accepted Production Readiness Audit
(baseline `ce4c2ba`). No infrastructure, provider, legal, tax, DNS or real-money work. Regression suite:
`tests/integration/batch1-hardening.test.ts`. Migration: `drizzle/0013_batch1_hardening.sql` (additive only).

## C1 — Dispute resolution and holds
- `OPEN | UNDER_REVIEW | AWAITING_INFORMATION` are the hold states. The ONLY exit is `resolveDispute`
  (`disputes.manage`, fresh 2FA, explicit outcome, reason ≥ 10 chars, party + store conflict checks, row lock,
  audited, second attempt refused).
- `RESOLVED` = formal decision with financial meaning. `CLOSED` = archival of an already RESOLVED dispute;
  no financial effect, idempotent, audited. `OPEN → CLOSED` was removed from the state machine.
- `setDisputeStatus` accepts only `UNDER_REVIEW` / `AWAITING_INFORMATION` (runtime-checked: the value comes from a form).
- `confirmReceipt` is refused while the buyer's dispute is open (fail closed: receipt is decided by the dispute).
- `setDealFinancialHold`: a party to the deal can neither place nor lift its hold.

## C2 — Staff roles
All role writes go through `src/server/rbac/staff.ts` (`roles.manage` + fresh 2FA). A *privileged* role
(SUPER_ADMIN or any role carrying `roles.manage`) can only be created, granted, revoked, edited or have its
holders disabled by an existing SUPER_ADMIN (checked in the DB), with explicit confirmation, a reason ≥ 10
chars, in one transaction, audited (`rbac.privileged_staff_created` …). The last active SUPER_ADMIN cannot be
removed. A test asserts no other module writes `user_roles` / `role_permissions`.

## C3 — Seller approved ≠ payout destination verified
Seller approval no longer touches payout methods. `verifyPayoutMethod` (`sellers.payout.verify`, fresh 2FA)
is the only path to `ACTIVE`; it records verifier, time, reason and a SHA-256 fingerprint of the exact
details (`verified_fingerprint`). Any new destination is `PENDING_VERIFICATION` (the legacy
`payout.changeRequiresReview=false` no longer bypasses this). Withdrawal approval and payout call
`assertVerifiedDestination` (ACTIVE, verified, fingerprint still matching).

## C4 — Refund destination
- Requested refunds (marketplace AND protected deal) carry the original payment as `destination_snapshot`.
- Approval freezes it in `approved_destination` (and in the immutable approval row).
- Exceptional change: `refunds.destination.override` (SUPER_ADMIN by default) + fresh 2FA + reason; after
  approval it sets `destination_reapproval_required` — a DIFFERENT `refunds.approve` holder must re-approve.
  The changer can neither approve, re-approve nor execute. Payout refuses unless the destination equals the
  approved one.
- `rejectRefund`: fresh 2FA, reason ≥ 5, audit with old/new state.

## C5 — Withdrawal transfer outcome
| From | To | Who / what | Money |
|---|---|---|---|
| REQUESTED/UNDER_REVIEW/APPROVED | REJECTED | checker (2FA if reserved) | reservation reversed |
| APPROVED | PROCESSING | executor, fresh 2FA | none |
| PROCESSING | TRANSFER_UNCERTAIN | executor, 2FA, reason | stays RESERVED |
| PROCESSING/TRANSFER_UNCERTAIN | FAILED_BEFORE_TRANSFER | checker ≠ executor, 2FA, evidence, reason | approved WITHDRAWAL_REVERSAL (once) |
| APPROVED/PROCESSING/TRANSFER_UNCERTAIN | PAID | executor (dual control) | WITHDRAWAL_PAID (once) |
| PAID | RETURNED | checker ≠ payer, 2FA, external ref, amount ≤ net | approved WITHDRAWAL_RETURNED: PLATFORM_CASH → SELLER_AVAILABLE (once); payout method back to PENDING_VERIFICATION |

`PROCESSING → REJECTED` no longer exists. Historical rows keep their meaning (no state was reinterpreted).

## C6 — Go-live gate
New blocker `FEES_OWNER_APPROVAL` (`fees.ownerApproved` true and `fees.buyerShareBps` set). `realMoneyEnabled()`
returns false unless the threshold is still exactly 0 and fees are owner-approved (drift fails closed);
`effectiveDualControlThreshold()` is 0 whenever real money is on. Raising the threshold through settings
while real money is on switches it off in the same transaction (`settings.real_money_gate_reclosed`).

## C7 — Logs and outbox
`logger` sanitizes Error objects before serialization (`sanitizeError`): Drizzle `params:` and pg `detail`
dropped, numbers/emails/tokens/URL credentials scrubbed, stack reduced to code locations, safe SQLSTATE /
constraint kept. Persisted errors use `safeErrorMessage`. More sensitive keys (`params`, `body`, `detail`,
`session`, `vapid`, `private_key`). Outbox: a secret message is redacted on final failure, and expiry
redaction also runs with every flush. **Remaining (Batch 2):** with the `log` driver, codes/reset links stay
readable in `outbound_messages` for up to 1 hour (needed for the staging outbox); encryption at rest of the
outbox is not in this batch.

## C8 — Production fail-closed against fixtures
- `deployment_environment` (one row) is written by `scripts/migrate.ts` from `EDMN_ENVIRONMENT`. PRODUCTION
  can never be re-marked/removed; a database that was STAGING/DEVELOPMENT or holds `.local` accounts can
  never be marked PRODUCTION; a deployment of another kind refuses a PRODUCTION database.
- DB triggers on a PRODUCTION database refuse `*.local` accounts (demo, E2E, test, demo staff) and TEST payment destinations.
- Demo seed refuses a PRODUCTION database, `NODE_ENV=production` outside staging, and public credentials on remote databases.
- Production boot refuses `STAGING_*` secrets, `SEED_DEMO=true`, and `EDMN_ENVIRONMENT=development` with `NODE_ENV=production`.
- In production: public fixture passwords and the repository TOTP secret are refused at login / 2FA / password policy; TEST destinations cannot be saved.

## Operator wording
Entity-aware status labels (`StatusChip kind=…`): refund APPROVED «تم اعتماد الاسترداد — لم يُحوَّل بعد»,
FAILED «تعذّر تحويل الاسترداد», withdrawal PROCESSING «جارٍ التحويل — لم يُصرف بعد», seller-order DELIVERED names
its basis (buyer confirmed / buyer timeout / dispute decision / delivery recorded); return REFUND_PENDING no
longer says the money was accepted/sent.
