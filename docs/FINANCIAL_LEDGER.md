# Financial Ledger, Commissions, Balances and Withdrawals

## Principles

1. **Integer money.** Amounts are `bigint` piasters; rates are basis points. `applyBps()` uses BigInt
   with half-up rounding; proportional shares use largest-remainder so parts always sum to the whole.
   No floating point is used in any money path (`src/server/core/money.ts`).
2. **Double entry.** Every movement is a `journal_entries` row with ≥ 2 `journal_lines`; Σdebit =
   Σcredit is enforced by a `DEFERRABLE INITIALLY DEFERRED` constraint trigger at COMMIT — an
   unbalanced entry cannot be committed even by buggy code (tested).
3. **Append-only.** Journal entries/lines (and audit/status history) cannot be updated, deleted or
   truncated (database triggers). Corrections are new entries (reversals or approved adjustments).
4. **Idempotent.** Each entry carries a unique `idempotency_key` derived from the business event
   (e.g. `release:<sellerOrderId>`); a retry returns the existing entry and moves no money twice.
5. **Projections under lock.** `ledger_accounts.balance` is a projection updated in the same
   transaction as the lines, with the involved account rows locked `FOR UPDATE` in sorted-id order
   (no deadlocks). Guards (e.g. `SELLER_AVAILABLE ≥ 0`) are checked under that lock, which is what
   makes two concurrent withdrawals unable to spend the same balance (EDGE 12).
6. **Reconcilable.** `reconcile()` re-derives every balance from its lines and checks the trial
   balance. Run `npm run ledger:check`, or see Admin → دفتر القيود.

All postings go through `postEntry()` in `src/server/modules/finance/ledger.ts`; nothing else writes
journal tables or balances.

## Chart of accounts

| Code | Type | Scope | Meaning |
|---|---|---|---|
| `PLATFORM_CASH` | Asset | platform | money actually held in EDMN's collection accounts |
| `COMMISSION_DEFERRED` | Liability | platform | commission on paid orders not yet earned (buyer has not confirmed receipt) |
| `COMMISSION_REVENUE` | Revenue | platform | earned commission |
| `CUSTOMER_REFUNDS_PAYABLE` | Liability | platform | refunds approved but not yet transferred |
| `DEAL_FUNDS_HELD` | Liability | platform | external-deal money held until completion |
| `DEAL_PAYOUTS_PAYABLE` | Liability | platform | amounts owed to external-deal sellers |
| `DEAL_FEE_REVENUE` | Revenue | platform | protection fees on external deals |
| `ADJUSTMENTS_EXPENSE` | Expense | platform | approved manual adjustments (compensation/corrections) |
| `SELLER_PENDING` | Liability | per seller | seller earnings awaiting buyer confirmation |
| `SELLER_AVAILABLE` | Liability | per seller | withdrawable seller balance |
| `SELLER_WITHDRAWAL_RESERVED` | Liability | per seller | amounts reserved by open withdrawal requests |

## Posting templates

| Event | Entry type | Lines (Dr / Cr) | Key |
|---|---|---|---|
| Admin confirms an order payment (per seller order) | `ORDER_PAYMENT` | Dr PLATFORM_CASH gross · Cr SELLER_PENDING net · Cr COMMISSION_DEFERRED commission | `payment:<payment>:so:<sellerOrder>` |
| Buyer confirms receipt (or admin on-behalf with evidence), no hold/dispute | `SELLER_RELEASE` | Dr SELLER_PENDING · Cr SELLER_AVAILABLE; Dr COMMISSION_DEFERRED · Cr COMMISSION_REVENUE | `release:<sellerOrder>` |
| Refund approved (cancellation, return, dispute) | `REFUND` | Dr SELLER_PENDING or SELLER_AVAILABLE (seller share) · Dr COMMISSION_DEFERRED or COMMISSION_REVENUE (commission reversal) · Cr CUSTOMER_REFUNDS_PAYABLE | `refund:<refund>` |
| Refund transferred to the customer | `REFUND_PAID` | Dr CUSTOMER_REFUNDS_PAYABLE · Cr PLATFORM_CASH | `refund-paid:<refund>` |
| Seller requests a withdrawal | `WITHDRAWAL_RESERVE` | Dr SELLER_AVAILABLE · Cr SELLER_WITHDRAWAL_RESERVED (guard: available ≥ 0) | `wd:<withdrawal>` |
| Withdrawal rejected / cancelled | `WITHDRAWAL_REVERSAL` | Dr SELLER_WITHDRAWAL_RESERVED · Cr SELLER_AVAILABLE | `wd-reverse:<withdrawal>` |
| Withdrawal transferred | `WITHDRAWAL_PAID` | Dr SELLER_WITHDRAWAL_RESERVED · Cr PLATFORM_CASH | `wd-paid:<withdrawal>` |
| Approved manual adjustment (+) / (−) | `ADJUSTMENT` | Dr ADJUSTMENTS_EXPENSE · Cr SELLER_AVAILABLE (or the reverse) | `adj:<adjustment>` |
| External deal payment confirmed | `DEAL_PAYMENT` | Dr PLATFORM_CASH · Cr DEAL_FUNDS_HELD | `payment:<payment>:deal:<deal>` |
| Deal completed / decided | `DEAL_SETTLEMENT` | Dr DEAL_FUNDS_HELD · Cr DEAL_PAYOUTS_PAYABLE (seller) · Cr DEAL_FEE_REVENUE (fee) · Cr CUSTOMER_REFUNDS_PAYABLE (partial refund, if any) | `deal-settle:<deal>` |
| Deal fully refunded | `DEAL_REFUND` | Dr DEAL_FUNDS_HELD · Cr CUSTOMER_REFUNDS_PAYABLE | `deal-refund:<deal>` |
| Deal payout transferred | `DEAL_PAYOUT_PAID` | Dr DEAL_PAYOUTS_PAYABLE · Cr PLATFORM_CASH | `deal-payout-paid:<payout>` |

Shipping fees belong to the seller (sellers ship): they are part of the seller order gross and of the
seller net; commission is charged on merchandise only.

## Commissions

- Rules live in `commission_rules` (versioned, never edited in place): category (or the default
  rule), percentage in bps, optional price-band tiers `[{upTo, bps}]` chosen by **unit price**,
  optional minimum fee per line, `effective_from`, enabled flag, notes.
- Resolution (`resolveRule`): the most specific enabled rule along the category path (leaf → root),
  effective at checkout time; otherwise the default rule.
- Calculation (`computeLineCommission`): `applyBps(lineTotal, bps)`, raised to the minimum fee if
  configured but never above the line total. The rule id, bps and amount are **snapshotted on the
  order item**, so later rule changes never affect existing orders (EDGE 13).
- Admin → العمولات adds a new version or enables/disables a rule (reason required, audited).

### Seeded benchmark values (NOT approved prices)

The seed loads market-benchmark starting points that must be reviewed by EDMN before launch:

| Category | Rate | Category | Rate |
|---|---|---|---|
| Default (all others) | 10% | Electronics (parent) | 8% |
| Mobile phones | 4.5% | Computers & laptops, Tablets, Game consoles | 4% |
| TVs, Home entertainment, Large appliances | 5% | Cameras, Small appliances | 7% |
| Electronics accessories | 8% | Video games, Software | 10% |
| Fashion (men, women, kids, shoes) | 15% | Watches | 12% |
| Beauty, Skincare | 12% | Perfumes | 13% |
| Home & kitchen, Furniture, Décor, Kitchen | 13% | Toys | 13% |
| Baby | 9% | Books | 7% |
| Automotive | 12% | Pet supplies | 14% |

## Seller balances

- **Pending** (`SELLER_PENDING`): paid orders not yet confirmed by the buyer. Shipping alone never
  releases funds.
- **Available** (`SELLER_AVAILABLE`): released on buyer receipt confirmation, or by admin
  confirmation on the buyer's behalf with a mandatory reason (permission
  `orders.confirm_receipt_on_behalf`, audited). An open dispute or a financial hold blocks release.
- **Reserved** (`SELLER_WITHDRAWAL_RESERVED`): held by open withdrawal requests.

Sellers see these three figures plus a statement of every journal line on their accounts
(Seller Center → المالية / الرصيد).

## Withdrawals and settlement (hybrid)

- **On request:** seller requests an amount ≥ `withdrawals.minimumAmount` from the available balance
  to a verified payout method; idempotent per client key (EDGE 11); blocked during a payout-change
  hold (`payout.changeHoldHours`) or account suspension.
- **Scheduled:** on the configured days of the month (`settlement.daysOfMonth`, Cairo time), the
  worker creates withdrawal requests for sellers with auto-settlement enabled and available ≥
  `settlement.minimumAmount` — one settlement batch per day (idempotent).
- `settlement.mode`: `ON_REQUEST`, `SCHEDULED`, or `HYBRID` (default).
- **SLA:** `sla_due_at` = request time + 48 **business** hours (Sunday–Thursday, Cairo), configurable
  (`withdrawals.slaBusinessHours`). Overdue requests are highlighted in Admin → السحوبات.
- **Maker/checker:** a checker approves (`withdrawals.approve`); an operator records the transfer
  with a mandatory bank/wallet reference and optional proof (`withdrawals.pay` + step-up). At/above
  `withdrawals.dualControlThreshold` (default 50,000 EGP) the payer must be a different person from
  the approver. Rejection returns the reserved amount to available.
- Payout details are encrypted; staff see masked values; full details for transfer are revealed only
  with permission, step-up and audit.

## Manual adjustments

Created by a finance user with a reason code and explanation (`ledger.adjust.create`), approved or
rejected by a **different** user (`ledger.adjust.approve`, step-up). Only approval posts to the
ledger.

## Refunds

Refund records are created by cancellations, accepted returns and dispute decisions, capped at what
was paid for the affected items (plus shipping when applicable). The ledger moves the seller share and
reverses the proportional commission at creation; the transfer to the customer is recorded later by
finance (`refunds.pay` + step-up) with a reference.

## Verification

- Integration tests: double confirmation, retries, concurrent withdrawals, commission versioning,
  unbalanced-entry rejection, append-only enforcement, reconciliation (see TESTING.md).
- E2E: the full flow ends by asserting the trial balance and that every account projection equals the
  sum of its journal lines.
- `npm run ledger:check` exits non-zero on any drift — run it in monitoring/cron.
