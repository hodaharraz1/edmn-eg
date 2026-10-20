# Financial Forensic Comparison (P0)

**Legacy financial code and data: NOT INSPECTED.** System B is fully specified in
`docs/FINANCIAL_LEDGER.md`. This document states exact B semantics, lists the questions that must be
answered from legacy evidence, and evaluates migration-accounting options without choosing one that
depends on unverified assumptions.

## 1. Concept inventory

| Concept | System B (verified) | Legacy (reported / claimed) | Same? |
|---|---|---|---|
| Money-in | Manual transfer to EDMN accounts (bank / InstaPay / Vodafone Cash), staff verification, exactly-once confirmation | Top-ups and guarantee deposits (mechanism UNKNOWN; marketing names Banque Misr, Fawry, ValU as partners — unverified) | **Not established** |
| Customer wallet | Does not exist | Reported | No |
| Seller balance | Ledger accounts SELLER_PENDING / AVAILABLE / RESERVED per seller | Not reported | No — **must not be equated with wallet** |
| Escrow holding | DEAL_FUNDS_HELD (deals); SELLER_PENDING + COMMISSION_DEFERRED (orders) | Guarantee funds held until buyer confirms (claimed) | Conceptually similar, mechanics unknown |
| Fees | Deal protection fee `deals.feeBps` (default 0) + payer setting; marketplace commission per category (benchmarks 4–15%) | 5% individuals / 3% merchants (claimed) | **Conflict** in values and model |
| Withdrawals | **Seller** payouts from SELLER_AVAILABLE; checker/operator; dual control; 48 business-hour SLA | **Customer** wallet withdrawals (reported) | **Different domains** |
| Refunds | CUSTOMER_REFUNDS_PAYABLE liability, paid by finance with reference | Refund policy exists (claimed) | UNKNOWN |
| Transactions | Journal entries + lines (double-entry), payments | "Transactions" (reported) — could be wallet movements, guarantee records, or payment rows | UNKNOWN |
| Adjustments | Maker/checker ledger adjustments | UNKNOWN | — |
| Reconciliation | Projection vs journal + trial balance (UI, CLI) | UNKNOWN | — |

## 2. Questions that must be answered from legacy code/data (blocking)

1. Is a wallet balance a **mutable column**, or derived from a transaction table? Can admins edit it
   directly?
2. Is there **any** double-entry structure, or single-entry transaction rows?
3. Do top-ups credit the wallet only after admin approval? Is approval idempotent?
4. Do withdrawals **reserve** funds at request time? What prevents two withdrawals spending the same
   balance? Are rejected withdrawals returned?
5. Guarantee money flow: does the buyer pay from wallet, by top-up, or by direct transfer? When is the
   fee deducted (deposit, release)? Who pays (buyer/seller/split)? Is the seller credited to wallet
   on release, or paid out directly?
6. Money types and rounding (decimal vs float), currency, time zones.
7. Current totals (for a baseline): Σ wallet balances; Σ pending/approved/paid withdrawals; Σ guarantee
   funds held by status; Σ fees collected; Σ top-ups by status.

Until answered, the relationship between any legacy money concept and any B ledger account is
**UNDECIDED**.

## 3. System B journal sources (verified)

| Event | Entry | Effect |
|---|---|---|
| Manual order payment confirmed | ORDER_PAYMENT | Cash ↑; seller pending ↑ (net); commission deferred ↑ |
| Buyer confirms receipt | SELLER_RELEASE | pending → available; deferred → earned commission |
| Refund approved / paid | REFUND / REFUND_PAID | seller share + commission reversed → refunds payable → cash ↓ |
| Withdrawal requested / rejected / paid | WITHDRAWAL_RESERVE / _REVERSAL / _PAID | available ↔ reserved; reserved → cash ↓ |
| Adjustment approved | ADJUSTMENT | expense ↔ seller available |
| Deal payment confirmed | DEAL_PAYMENT | cash ↑; deal funds held ↑ |
| Deal settled / refunded / payout paid | DEAL_SETTLEMENT / DEAL_REFUND / DEAL_PAYOUT_PAID | held → payable/fee revenue/refunds; payable → cash ↓ |

Verification: integration tests (exactly-once, concurrent withdrawals, balanced commit, immutability)
and E2E ledger checks pass. Double-entry is applied correctly for all B flows.

## 4. Migration accounting strategies for legacy history (evaluation only — do not execute)

**Never automatically convert legacy transactions into new journal entries.**

| Option | Description | Pros | Cons | When appropriate |
|---|---|---|---|---|
| A. Opening balances | At cut-over date, post one source-referenced opening entry per legacy balance (e.g. future wallet liability per user vs a `LEGACY_MIGRATION_CLEARING` account) | Simple; B ledger starts correct; history untouched in legacy | Pre-cut-over history not in B ledger | **Recommended baseline** once balances are verified |
| B. Imported historical journals | Re-express each legacy movement as B journal entries | Full history in one ledger | High risk of misrepresenting history if legacy semantics are single-entry or inconsistent; rewrites meaning | Only if legacy is already double-entry and reconciles perfectly |
| C. Parallel historical ledger | Keep legacy transaction tables (read-only) as the historical ledger; B ledger for new activity | Zero rewriting; auditable | Two places to look for history | **Recommended for history**, combined with A |
| D. Source-referenced migration journals | Like B but every entry tagged `source=legacy`, `legacy_id`, imported in a reversible batch with a clearing account | Traceable, reversible | Still requires full semantic mapping | Later, per domain, after owner approval |

**Recommendation (provisional):** C + A — legacy history stays untouched and queryable; at a
cut-over date verified balances enter B through source-referenced opening entries against a
clearing account that must net to zero after reconciliation. Choice is **UNDECIDED** until §2 is
answered.

## 5. Guarantees vs External Protected Deals

| Aspect | Legacy guarantee (claimed / unknown) | B External Protected Deal (verified) |
|---|---|---|
| Initiation | "Buyer and seller agree on deal details inside the app" — both are app users; initiator unknown | Buyer creates via 5-step wizard; seller may be **outside** EDMN and joins via a single-use invitation link |
| Participants | Two registered users; KYC possibly required | Buyer (registered) + invited seller (registers/logs in to accept); no KYC |
| Scope | Goods **and services** (design, programming, rentals) | Physical goods (title, condition, quantity, delivery method) |
| Payment | Deposit to EDMN escrow (method UNKNOWN; wallet?) | Manual transfer + proof + staff verification |
| Fees | 5% individuals / 3% merchants (claimed) | Configurable bps, default 0, payer SELLER or BUYER |
| Statuses | UNKNOWN | DRAFT → INVITED → ACCEPTED → PAYMENT_PENDING → PAYMENT_UNDER_REVIEW → ACTIVE → DELIVERED → (BUYER_CONFIRMATION_PENDING) → COMPLETED; DISPUTED; CANCELLED; REFUNDED |
| Evidence | UNKNOWN | product photos, delivery proof (private files) |
| Disputes | Support reviews evidence; funds held (claimed) | Structured dispute with decisions (full/partial refund, release, reject) posted to ledger |
| Completion | "Instant" transfer to seller after confirmation (claimed) — into wallet? | Seller payout becomes a payable; finance pays with reference |
| Cancellation | UNKNOWN | Before payment only |
| Accounting | UNKNOWN | DEAL_FUNDS_HELD → DEAL_PAYOUTS_PAYABLE / DEAL_FEE_REVENUE / refunds |

**Recommendation:** **A now (preserve both as separate products)**, with **B (shared guarantee/deal
engine) as the long-term target** once legacy statuses and money flow are known. Reasons: different
participants (in-app counterparty vs external invitee), different scope (services), different fee
model and likely wallet-based settlement in legacy; replacing guarantees with external deals would
remove legacy capabilities (`MUST_PRESERVE`). Option C (one as subtype of the other) is plausible —
an external deal could become a guarantee whose counterparty is invited — but requires the legacy
model first. **UNDECIDED** pending evidence.

## 6. Withdrawals: customer wallet vs seller payout

| Aspect | Customer wallet withdrawal (legacy, reported) | Seller payout (B, verified) |
|---|---|---|
| Payee | Any user with wallet balance | Approved marketplace seller |
| Source of funds | Wallet balance (top-ups, released guarantees?) | SELLER_AVAILABLE (released order earnings) |
| Preconditions | UNKNOWN | seller APPROVED/RESTRICTED, active verified payout method, no payout-change hold, ≥ minimum |
| Approval | UNKNOWN | checker approves; operator pays with reference; dual control above threshold |
| Ledger | UNKNOWN | reserve → paid / reversal entries |
| SLA | UNKNOWN | 48 business hours (configurable) |

**They are different domain objects.** They may later share **infrastructure** — approval queue UI,
maker/checker engine, payout execution and proof recording, audit, payout-destination model with
encryption — while keeping **separate tables, ledgers accounts, permissions and statuses**
(`wallet_withdrawal` vs `seller_payout`). They must never share a balance.
