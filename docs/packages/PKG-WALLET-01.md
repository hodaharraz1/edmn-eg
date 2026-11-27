# PKG-WALLET-01 — Customer wallet top-up (deposit) behind a kill switch

**Base:** `claude/instinct-integration` at the commit that adds this file. **Owner decisions (2026-11-26):**
- Customers can deposit into their wallet by **InstaPay or bank transfer (Banque Misr)** and upload the receipt.
- **Two different staff** review every deposit (maker requests credit, checker executes). No single person can credit.
- **No minimum**; **maximum 250,000 EGP per customer per day** (reuse `payments.dailyReceiptLimit`, already 25,000,000 piastres;
  deposits and order/deal receipts share the same daily cap).
- **No fee on deposit.** EDMN's normal commission/deal fee is charged when the balance is **spent** (exactly as when the
  customer pays by transfer today).
- The balance can pay **Protected Deals** and **marketplace orders** (phase 2 below), never be withdrawn as cash by a
  buyer except through the existing refund/payout rules (out of scope here: no buyer cash-out).
- **Legal:** a prepaid balance is stored value / e-money in Egypt (CBE licensing). The whole feature sits behind a new
  setting **`wallet.topUpEnabled` (default `false`)**. Staging turns it on for testing; production stays off until counsel
  confirms. With the flag off nothing changes for any user (the API answers `feature_disabled`, the app hides the button).
- Real Money stays OFF; nothing here touches `payments.realMoneyEnabled`.

## Phase 1 — deposit and credit (this package)

### Data
- Migration `0033_wallet_topups.sql`:
  - `wallet_topups` (`id`, `user_id` → users, `amount` piastres > 0, `method` `BANK_TRANSFER|INSTAPAY`, `proof_file_id` → files
    (purpose `PAYMENT_PROOF`, owner = user), `payer_reference` text null, `status` `PENDING_REVIEW|CREDITED|REJECTED|CANCELLED`,
    `reject_reason`, `journal_entry_id`, `created_at`, `decided_at`, `decided_by`). Status/amount CHECKs; a CREDITED row needs a
    journal entry and `decided_by`; DB trigger: CREDITED/REJECTED are final (no update back).
  - Per-user wallet sub-ledger like the seller sub-ledger: `customer_wallet_entries` (`id`, `user_id`, `journal_entry_id`,
    `amount` signed piastres, `kind` `TOPUP|SPEND|SPEND_REVERSAL`, `created_at`), append-only trigger (no UPDATE/DELETE).
- New platform ledger account `CUSTOMER_WALLETS` (LIABILITY, «أرصدة محافظ العملاء»). Invariant (add to
  `finance/controls.ts` and `ledger:check`): `CUSTOMER_WALLETS.balance = Σ customer_wallet_entries.amount`, and no user's
  sum is ever negative.

### Flow
1. Customer `POST /api/v1/wallet/topups` (mobile, auth, idempotency key): amount, method, proof upload (same upload
   rules/scan as payment proofs), optional payer reference. Refused when the flag is off, identity not required for v1,
   or when today's deposits + receipts would exceed the daily cap (Africa/Cairo day, same helper PAY-02 uses). Audit
   `wallet.topup_submitted`.
2. `GET /api/v1/wallet/topups` (mine, newest first) and the destination accounts to pay to: reuse the public payment
   settings (enabled methods only — today bank transfer + InstaPay; wallets disabled).
3. Staff review in the admin web (new page `/admin/wallet-topups`, permission `payments.verify` to see):
   - **Maker** (`finance.movement.request`) requests credit → `financial_movement_requests` kind **`WALLET_TOPUP_CREDIT`**
     (amount = the deposit). Add the action to `MOVEMENT_ACTIONS`, `CHECKER_PERMISSIONS` (checker needs
     `payments.verify`), and the DB trigger `edmn_movement_requires_two_people`.
   - **Checker** (different person, step-up) executes: ledger **Dr `PLATFORM_CASH` / Cr `CUSTOMER_WALLETS`**, one
     `customer_wallet_entries` row `+amount`, topup → CREDITED. Audit, notify the customer (in-app + push).
   - Reject (checker, reason ≥ 10 chars) → REJECTED, nothing posted, customer notified.
   - Customer may cancel while PENDING_REVIEW and no movement request exists.
4. `walletView` returns `topUp: { enabled, balancePiastres, pending: [...], dailyLimitPiastres, usedTodayPiastres }` and
   keeps the existing seller/deal balances unchanged. Drop the `topUpAvailable: false` constant in favour of the flag.

### Customer app (Flutter, `apps/customer_mobile`)
- Wallet tab (already a bottom tab): show **رصيد المحفظة** card and an **«إيداع»** button only when `topUp.enabled`.
- Deposit screen: amount (EGP, `formatEGP`), method choice (InstaPay / تحويل بنكي) showing EDMN's account details from the
  payment settings with copy buttons, proof photo/PDF picker, optional reference, submit. Shows remaining daily limit.
- Deposits list with status chips (قيد المراجعة / اتضاف لرصيدك / مرفوض + السبب / ملغي) and cancel on pending.
- Egyptian Arabic, brand «أضمن», EGP only, no human imagery (CLAUDE.md rules). Update `edmn_api` via the generators
  (`scripts/openapi.ts`, `scripts/generate-dart-api.ts`) — never hand-edit generated files.

### Tests (must fail before, pass after)
- Integration: flag off → `feature_disabled`; submit + daily cap (deposit + receipt together over 250k refused);
  maker cannot execute; same person cannot be checker (service + DB trigger); credit posts balanced entry and sub-ledger
  row; reject posts nothing; invariant holds; CREDITED/REJECTED immutable; cancel rules; idempotency replay.
- Flutter widget tests: button hidden when disabled; deposit form validation and submit; list statuses.
- `npm run typecheck`, eslint, regen drift clean, secret scan 0, full Vitest green.

## Phase 2 — spend the balance (separate package PKG-WALLET-02, after Phase 1 is merged)
- Pay a Protected Deal or a marketplace order from the wallet: Dr `CUSTOMER_WALLETS` / Cr the same accounts a confirmed
  transfer credits today (deal funds held / order funds), fee/commission exactly as for a transfer, sub-ledger `SPEND`
  row; refunds of wallet-paid orders return to the wallet (`SPEND_REVERSAL`). Never below zero (row lock + check).
- No staff review needed for spending (no outside money arrives); still audited.

## Out of scope
Card payments, automatic bank matching, buyer cash-out, enabling the flag in production.
