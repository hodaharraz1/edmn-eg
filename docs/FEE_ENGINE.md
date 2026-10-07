# EDMN Fee & Profitability Engine

Code: `src/server/modules/pricing/` (engine.ts pure math, validation.ts, service.ts, payout-costs.ts,
refund-policy.ts, profitability.ts). Migration `0010_fee_engine` (additive). Admin: `/admin/finance/pricing*`,
`/admin/finance/profitability`.

## Pricing model
- **Versioned**: `pricing_versions` (model MARKETPLACE | PROTECTED_DEAL) + `pricing_tiers` + (marketplace)
  `pricing_category_classes`. Lifecycle DRAFT → VALIDATED (maker submits) → APPROVED (checker ≠ maker, fresh 2FA,
  reason, margin guard) → PUBLISHED (publisher ≠ maker, fresh 2FA, reason; effective now or scheduled) → shown as
  ACTIVE / SCHEDULED / SUPERSEDED by effective time; CANCELLED. Published versions are immutable (DB triggers);
  a change is a new version. No deployment needed to change prices.
- **Progressive / marginal tiers** in basis points on the fee base (product value; **shipping excluded**).
  Boundary convention (piastres): tier k covers (lower, upper]; tier 1 starts at 0 (0 ≤ x ≤ 5,000.00).
- **Rounding** (BigInt, no floats): T = Σ slice×total_bps, B = Σ slice×buyer_bps; total = round_half_up(T/10000),
  buyer = round_half_up(B/10000), seller = total − buyer. Monotonic by construction (validated at ±1 piastre around
  every boundary before publication).
- **Minimum**: if total < min → total = min, buyer = round_half_up(min×B/T) (the split that would otherwise apply).
- **Marketplace fee unit** = seller sub-order. Lines are grouped by economic class (category → nearest mapped
  ancestor in the version); each class group is priced on its own subtotal; the minimum applies per sub-order;
  group fees are allocated to lines by value (largest remainder) — Σ lines = Σ groups = sub-order fee exactly.
- **Protected deal** = one fee unit on the agreed deal value; quote frozen at agreement (stale quote → re-offer).

## Owner-approved version 1 (seeded as DRAFT, activated on staging via Admin maker/checker)
| Class | 0–5,000 | 5,000–25,000 (marginal) | > 25,000 (marginal) |
|---|---|---|---|
| LOW_MARGIN | 2% + 6% = 8% | 2% + 4.5% = 6.5% | 1.5% + 3.5% = 5% |
| STANDARD | 3.5% + 8.5% = 12% | 3% + 7% = 10% | 2.5% + 5.5% = 8% |
| HIGH_MARGIN | 4% + 11% = 15% | 3.5% + 9% = 12.5% | 3% + 7% = 10% |
(buyer + seller = total). Minimum 25 EGP per seller sub-order. Initial class mapping: mobile phones, computers,
large appliances → LOW; fashion (incl. shoes, watches) → HIGH; every other top-level category → STANDARD.

Protected deal: 0–5,000 8%; 5,000–25,000 6%; 25,000–100,000 4%; > 100,000 3% (marginal), 50/50 per slice; minimum 80 EGP (40/40).

## Snapshots (never recalculated)
`seller_orders.pricing_snapshot` (+ `pricing_version_id`, `pricing_source = ENGINE`), `order_items.economic_class`
and per-line buyer/seller fee, `orders.economic_snapshot` (v2), `external_deals.pricing_snapshot` (+ buyer/seller
fee). Existing rows are `LEGACY_SNAPSHOT` and keep their stored values (A-100016 included). DB triggers forbid
changing a snapshot once set.

## Ledger
ORDER_PAYMENT shows the fee as two lines (buyer fee, seller fee) to COMMISSION_DEFERRED; recognition stays at the
explicit Admin release (unchanged deferred policy). Deal settlement shows buyer/seller guarantee fee lines.
Withdrawal payout: DR SELLER_WITHDRAWAL_RESERVED W / CR PLATFORM_CASH (W − seller transfer cost) / CR PLATFORM_CASH
(seller transfer cost paid to the provider); EDMN-borne cost: DR TRANSFER_COST_EXPENSE / CR PLATFORM_CASH. The
seller EDMN fee is never charged at withdrawal.

## Payout transfer costs & limits
`payout_channel_configs` (INSTAPAY, BANK_TRANSFER, MOBILE_WALLET, FUTURE_PSP, OTHER): bps + fixed, min/max, payer
policy (SELLER_PAYS initial), tax treatment field, per-transaction/day/month and recipient limits, warning threshold,
effective dates, source, review stamp. Versions (DB guard). Quote at request (shown before confirming), frozen at
approval (DB guard), actual recorded at payout (seller never pays more than quoted; excess = EDMN expense). Limits
enforced at request (per-transaction) and approval/payout (all); never split, never switch provider automatically.
Initial values are UNVERIFIED placeholders (InstaPay 0.1%, min 0.50, max 20.00; limits 70k/120k/400k).

## Refund fee policy & cost attribution
`refund_fee_policy_versions/rules`: lifecycle stage × reason × responsible party → buyer-fee refund %, seller-fee
reversal %, shipping (FULL/NONE/MANUAL), return-shipping payer, transfer-cost payer, manual review. Version 1 is a
DRAFT proposal — **LEGAL REVIEW REQUIRED**, cannot be published without recorded legal review (DB CHECK). Until then
refunds use the consumer-safe default: buyer fee on refunded units returned, seller fee reversed, shipping only by
explicit decision, EDMN bears transfer cost, manual review. Components always come from the original snapshot.

## Profitability
Per sub-order/deal: revenue = buyer fee + seller fee − fee reversals; ACTUAL costs (`transaction_costs`, EDMN-borne,
append-only) separated from ESTIMATES (reserves/provisions from snapshotted assumptions — never cash); net
contribution and margin (null when revenue is 0). Dashboard KPIs and breakdowns by model, class, tier, version,
seller and day; CSV export (formula-injection safe, no personal data).

## Governance
Internal target contribution margin 50% (not a customer promise). Expected margin = mean of per-sample margins over
the representative amounts; below target → approval blocked unless `pricing.override_margin_guard` + fresh 2FA +
reason (audited). Assumptions (estimates): collection 0, refund 0.5%, dispute 0.25%, operational 0.5%, fraud 0.25%
of GMV, tax provision 0% (UNRESOLVED).

## Fail closed
No published version in force, or a category without a class → no new financial commitment (user-safe message +
HIGH risk flag for Operations). Committed transactions keep their snapshots.

## Unresolved (owner / legal / accountant)
Tax treatment of fees (VAT inclusive/added/exempt); refund fee policy (legal review); verified transfer tariffs and
limits per channel; profitability assumptions; whether fashion sub-categories / other categories belong to other classes.
