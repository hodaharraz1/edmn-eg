# Production Hardening Audit

Scope: the EDMN marketplace + protected deals on `claude/great-tesla-nor0wt`, staging only. Legacy EDMN untouched;
real money, production SMS/email/payouts OFF; staging data preserved (no reset, no deletes); test order A-100016 read-only.

## Findings (before) → fix (after)

| # | Finding (pre-hardening) | Severity | Fix |
|---|---|---|---|
| H1 | Buyer receipt confirmation released seller funds automatically (pending → available) | Critical | Receipt = entitlement only; explicit Admin `releaseSellerOrder` with SELLER_RELEASE approval; completion job removed |
| H2 | Automatic completion job released funds after N days | Critical | Removed; replaced by 24h buyer timeout → TIMEOUT_ENTITLEMENT (no money) |
| H3 | Journal entries could be posted by any code path without an Admin decision | Critical | `financial_approvals` + DB triggers (approval required, consumed once, amount = approved) |
| H4 | Withdrawal request reserved money immediately | High | Request reserves nothing; approval reserves atomically with destination snapshot |
| H5 | Admin could confirm receipt on the buyer's behalf | High | Retired; CUSTOMER actor only |
| H6 | Seller "shipped/delivered" path could lead to release without proof | High | Authoritative delivery event (Ops/carrier) + seller evidence ≤ 24h; failures → Ops exception |
| H7 | Cancellation after shipment possible for admin; paid cancellation looked like "refunded" | High | Before SHIPPED only (all roles), serialized with shipment; refund request (obligation) |
| H8 | Refunds: whole-order only, single step, no components | High | Refund engine: item/qty/components, destination snapshot, approval + separate payout |
| H9 | Fee borne by seller only, not shown, no snapshot of split | Medium | Shared fee Fb + Fs = F exactly, per-item snapshot, prospective config, missing config blocks |
| H10 | No kill switches | Medium | 7 fail-closed switches |
| H11 | No daily control / close, invariants partial | Medium | Finance control center, 16 invariants, daily close |
| H12 | No reconciliation workflow | Medium | Statement import, suggestion, human match, MISMATCH flags |
| H13 | No provider webhook architecture | Medium | HMAC/timestamp/replay-protected evidence-only endpoint (503 until connected) |
| H14 | Account closure not implemented / no lock | Medium | Closure request, blockers, account lock, pseudonymisation preserving records |
| H15 | Notification duplicates on retries | Low | `dedupe_key` unique per user |
| H16 | Deadlines/receipt basis/release timestamp mutable | Medium | DB immutability triggers |
| H17 | Records deletable at DB level | Medium | no-delete triggers on orders, sub-orders, payments, refunds, withdrawals, ledger accounts, approvals |
| H18 | Real-money switch guarded only by destinations | Medium | `goLiveGate()` fail-closed with known production blockers |
| H19 | Policies described automatic release | Medium | v1.1 drafts, LEGAL REVIEW REQUIRED |

## Migration 0008 (non-destructive)
Additive columns/tables, backfills (receipt basis from the historic confirmation source, withdrawal `reserved_at`
from existing reserve journals), triggers. Historic journals are not rewritten; the approval trigger applies to new
entries only. Legacy DELIVERED sub-orders with released funds keep their history (`LEGACY_*` receipt bases).

## Residual risks
Restore drill not performed; malware scanning unavailable; no payment provider; fee split and policies not approved;
staging maker/checker threshold 50,000 EGP (production must be 0). See REAL_MONEY_GO_LIVE_CHECKLIST.md.
