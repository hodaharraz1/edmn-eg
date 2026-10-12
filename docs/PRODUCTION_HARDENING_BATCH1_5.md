# Production Hardening — Batch 1.5

Identity / KYC · Buyer money-receiving details · Refund safety · Universal Maker/Checker · Unified seller
financial view · Protected Deal timers · Message privacy · Support operations · Proactive alerts.

Baseline: `b189a03` (deployed `dpl_CBLXscDcZiv8sb3k6QhJijArsJDb`), local docs commit `848db3f`, 14 migrations,
ledger 97,939,400 = 97,939,400 (drift 0), pricing MARKETPLACE v1 / PROTECTED_DEAL v1 PUBLISHED, real money OFF,
database marked STAGING, A-100016 identical to the original baseline.

## Phase 0 — implementation map

| Domain | State before | Decision |
|---|---|---|
| Users | EXISTS (`users`, phone/email verification, 2FA for staff) | REUSE |
| Identity / KYC | PARTIAL — seller-only (`sellers.legal_name`, `national_id_enc`, `seller_documents` NATIONAL_ID_FRONT/BACK reviewed inside the seller decision). Buyers and Protected Deal sellers have none | NEW user-level domain `user_identity_verifications` + `identity_review_events` (ADDITIVE MIGRATION). Seller application stays a separate domain |
| Legacy seller KYC | Seller approval reviewed the whole application (store + documents) in one decision — NOT the same semantics as an identity decision | MIGRATION MAPPING: existing documents are LINKED (not copied) into a `PENDING_REVIEW` identity case; never auto-approved (OWNER RULE) |
| Protected Deal participants | EXISTS (`external_deals.seller_user_id`, seller-entered details); no store needed | REUSE; identity guard added at commitment points |
| Payout destinations (sellers) | EXISTS + Batch 1 C3 verification | REUSE |
| Buyer receiving destinations | MISSING | NEW `receiving_destinations` + review events (NO wallet, NO balance) |
| Refund destination | Batch 1 C4 (original payment, frozen at approval, exceptional override) | EXTEND: fallback only to an APPROVED receiving destination of the same customer, versioned snapshot |
| Refund reversal | MISSING (approved refund could not be undone) | NEW revoke-before-execution (Maker/Checker, compensating journal) |
| Seller debt after refund | PARTIAL (SELLER_AVAILABLE can go negative; payout blocked) | EXPLICIT liability projection + withdrawal block; no collection policy invented |
| Stranded balances | PARTIAL | NEW attribution invariant (every minor unit of a closed order explained) |
| Ledger | EXISTS (double entry, approvals trigger, idempotency) | REUSE — no journal rewrite |
| Maker/Checker | PARTIAL — `financial_approvals.dual_control` + CHECK approver ≠ requester, but threshold-based and single-person for releases/refund approval | UNIVERSAL: every movement action needs a distinct Maker (DB trigger on new approvals) via `financial_movement_requests` or a natural recorded maker |
| Seller balances | Marketplace: per-seller sub-ledger. Protected Deal: platform accounts + `deal_payouts` per deal | UNIFIED VIEW = derived projection with source attribution (no merged ledger, no historical rewrite) |
| Withdrawals | Marketplace sub-ledger only; Protected Deal payouts are paid per deal | Source recorded on every withdrawal (MARKETPLACE); cross-source withdrawal not offered — each source pays out through its own controlled channel (attribution can never be lost) |
| 2FA / RBAC | EXISTS | REUSE + new permissions |
| Disputes | EXISTS (Batch 1 C1) | REUSE |
| Support | EXISTS (tickets, messages, assignee, statuses; CLOSED terminal) | EXTEND: categories, SLA cycles, owner/specialist, links, reopen (RESOLVED & CLOSED), rating, QA |
| Messaging (staff view) | EXISTS — permission + audit, no purpose | EXTEND: mandatory purpose + case link, privileged-access log |
| Notifications / jobs | EXISTS (notifications, outbox, deliveries, push; scheduler driven by traffic + daily cron) | NEW central alert engine on top (rules + alert state with dedupe/cooldown) |
| Inventory | EXISTS (`low_stock_threshold` per variant) | REUSE for alerts |
| Deal deadlines | EXISTS (`delivery_deadline`, `buyer_response_due_at`) | REUSE for timers (no new state machine) |
| File storage | EXISTS (private files, business-derived access, sensitive views audited) | REUSE + IDENTITY_DOCUMENT purpose |
| Infrastructure dependencies | SMTP/SMS not configured; no malware scanning; jobs traffic-driven on Hobby | Reported, not faked |

## Implementation (what was built)

### Schema — migration `0014_batch15_identity_finance_support` (ADDITIVE ONLY)
New tables: `user_identity_verifications`, `receiving_destinations`, `review_events`, `financial_movement_requests`,
`privileged_message_access`, `support_sla_cycles`, `alert_states`. New nullable / defaulted columns on `refunds`,
`withdrawal_requests` (`source_type` default `MARKETPLACE`) and `support_tickets`. Three CHECK constraints widened
(file purpose `IDENTITY_DOCUMENT`, ticket types, financial action `REFUND_REVOCATION`). No column dropped, no
row rewritten, no journal touched. Custom SQL (database-enforced):

| Guard | Effect |
|---|---|
| `financial_approvals_two_person` (BEFORE INSERT) | a NEW approval for any movement action requires `dual_control`, a maker and a different approver. Historical rows are never re-validated. Exempt by design: PAYMENT_CONFIRMATION, DEAL_PAYMENT_CONFIRMATION (money already received), WITHDRAWAL_RESERVATION (locks the seller's own balance, nothing leaves) |
| `financial_movement_requests_guard` / `_no_delete` | maker, kind, entity, amount, reason immutable; a decided request is final; never deleted |
| `receiving_destinations_guard` / `_no_delete` | owner/type/details/fingerprint/holder/version immutable (a change = new version); archived never revived; never deleted |
| `review_events_append_only`, `privileged_message_access_append_only` | append-only history |
| `support_sla_cycles_no_delete`, `user_identity_verifications_no_delete` | history never deleted |
| CHECK `user_identity_verifications_approved_chk` | APPROVED requires reviewer, both images, encrypted NID and legal name |
| CHECK `financial_movement_requests_checker_chk` | decider ≠ maker |

### Legacy mapping
`scripts/seed.ts` (runs on every deploy) calls `mapLegacySellerIdentities()`: a seller application holding a legal
name, encrypted NID and current front/back scans gets ONE identity case in `PENDING_REVIEW`
(`source = LEGACY_SELLER_APPLICATION`) that LINKS the existing files. Never approved automatically; idempotent.
Staging pre-check (read-only): 34 sellers → 33 mappable (PENDING_REVIEW), 1 left INCOMPLETE.

### Universal Maker / Checker — every actual movement
| Movement | Maker | Checker (executes) |
|---|---|---|
| Marketplace seller release (SELLER_RELEASE) | `requestMovement(SELLER_RELEASE)` | `releaseSellerOrder` |
| Protected Deal release (DEAL_RELEASE) | `requestMovement(DEAL_RELEASE)` | `releaseDeal` |
| Refund approval (REFUND_APPROVAL / DEAL_REFUND) | `requestMovement(REFUND_APPROVAL)` | `approveRefund` |
| Refund execution (REFUND_PAYOUT) | the refund approver | `recordRefundPayout` by a different person |
| Refund revocation (REFUND_REVOCATION) | `requestMovement(REFUND_REVOCATION)` | `revokeRefund` (compensating REFUND_REVERSAL) |
| Withdrawal reservation release (reject / failed before transfer) | `requestMovement(WITHDRAWAL_REVERSAL, mode)` | `rejectWithdrawal` / `markWithdrawalFailedBeforeTransfer` |
| Withdrawal payout (WITHDRAWAL_PAYOUT) | the withdrawal approver | `markWithdrawalPaid` by a different person (no threshold) |
| Returned payout (WITHDRAWAL_PAYOUT_RETURN) | `requestMovement(WITHDRAWAL_RETURN)` | `recordWithdrawalReturned` |
| Protected Deal payout (DEAL_PAYOUT) | the deal release approver | `markDealPayoutPaid` by a different person |
| Manual adjustment (MANUAL_ADJUSTMENT) | creator | `decideAdjustment` by a different person (never self-posted) |

The application refuses first (`takeMovementRequest`, `grantApproval`), the database refuses second (trigger).
`withdrawals.dualControlThreshold` no longer exempts anything (`effectiveDualControlThreshold` → 0).

### Owner-visible behaviour changes in pre-existing tests (expectations updated, rules never weakened)
| Test | Before | Now (why) |
|---|---|---|
| security-gate SEC-WD-2 | dual control only above a rolling 24h threshold | every withdrawal is two-person (owner decisions #9/#10) |
| security-gate SEC-WD-3/5 | approver also recorded the payout | a different payer records it, the debt / suspension refusals still apply |
| pre-acceptance-audit "closed ticket reply" | customers could not reply to a CLOSED ticket | a reply reopens it with a new SLA cycle (owner decisions #16–#18) |
| messaging 24/33/37-41, messaging-realtime 11-13 | staff could open a thread with `messages.view` only | a recorded purpose (and case link for DISPUTE/SUPPORT) is required first |
| all release / refund-approval / reversal / return tests | one finance checker executed | a Maker request by a different person comes first |
| tests creating customers / sellers | no identity | identity submitted and approved through the real flow (factory `approveIdentity`) |
| fulfilment-finance "unbalanced entry", `testApproval` fixture | single-person synthetic approval | synthetic approvals record a distinct maker (DB trigger) |

### Residual risks (reported, not hidden)
* Protected Deal seller payout destination is entered by the seller on the offer and is NOT reviewed like a
  receiving destination; the deal payout is still two-person and audited. A review step is a follow-up.
* Malware scanning of uploads (incl. ID images) is not available (no scanning service) — MIME/size/re-encode only.
* Email/SMS providers are not configured on staging: alerts are delivered IN_APP (+ push where subscribed);
  email is queued to the outbox and sent only when SMTP is configured. No SMS alerts are sent or claimed.
* Alerts run from the job scheduler (traffic-driven + daily cron on Vercel Hobby): timing granularity depends on
  that cadence.
* SLA values are NOT invented: until an operator sets `support.sla`, no due dates and no SLA alerts exist.
