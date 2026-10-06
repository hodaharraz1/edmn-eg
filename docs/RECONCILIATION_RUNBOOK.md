# Reconciliation Runbook

Screen: `/admin/reconciliation` (permission `reconciliation.manage`; FINANCE_CHECKER, FINANCE_OPERATOR).

## States
`UNMATCHED` → `SUGGESTED_MATCH` (system proposal: amount, or reference + amount) → `MATCHED` (human-confirmed, audited)
| `MISMATCH` (amount/reference differs → HIGH risk flag) | `IGNORED_WITH_REASON` (reason required, audited).
The system **never** sets MATCHED automatically.

## Daily procedure (Africa/Cairo business day)
1. Export statements from each channel (bank, InstaPay, Vodafone Cash). Format CSV:
   `externalRef,direction,amount,occurredAt[,counterparty]` — direction IN/OUT, amount in EGP (e.g. `599.00`), ISO time.
2. Import per channel. One bad row fails the whole file (recorded as FAILED, nothing partial). Re-imported references are ignored.
3. Work the SUGGESTED_MATCH queue: confirm the right candidate (payment / withdrawal / refund / deal payout) or mark MISMATCH.
4. UNMATCHED IN money: find the order/proof; if none, keep UNMATCHED and escalate (never create a payment from a statement line).
5. UNMATCHED OUT money: must correspond to a recorded payout; otherwise incident (see INCIDENT_RESPONSE_RUNBOOK).
6. `/admin/finance-control`: check unreconciled counts, invariants = 0, then **close the day** (stores the control report).
7. Any MISMATCH stays open until explained; no journal is edited — corrections are new approved entries.

## Provider callbacks
`POST /api/webhooks/payments/[provider]` — HMAC-SHA256 over `timestamp.body`, ±5 min, unique (provider, event id),
raw body never stored. Not connected → 503. Callbacks are **evidence only**; confirmation still needs an Admin approval.
