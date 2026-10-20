# Payments

## V1 model: manual payments verified by EDMN

Supported methods (table `payment_methods`, enabled/disabled and instructed by admins):

1. **Bank transfer** (`BANK_TRANSFER`)
2. **InstaPay** (`INSTAPAY`)
3. **Vodafone Cash** (`VODAFONE_CASH`)

Customers transfer to EDMN's **official collection accounts** (`payment_destinations`), which are
configured at runtime by staff with `payments.destinations.manage` + a fresh 2FA step-up (audited,
reason required). The demo seed contains clearly labeled **fake, disabled-for-production** destinations
("EDMN DEMO — NOT REAL"); real account numbers are an external input and must never be committed.

> No payment is ever considered successful because a customer uploaded a screenshot. Money exists in
> the system only after an authorized staff member verifies it against the real account statement.

## Customer flow

1. **Checkout** (`placeOrder`, `src/server/modules/commerce/orders.ts`): server re-prices the cart,
   validates stock/seller/shipping, reserves inventory, creates the parent order, one seller order per
   seller, order items with snapshots, and one `payments` row (`AWAITING_PAYMENT`) with
   `due_at = now + payments.paymentWindowHours` (default 48 h) and a **snapshot of the destinations**
   shown to the customer. Idempotent per checkout key.
2. **Pay page** (`/account/orders/[id]/pay`): exact amount, destination details with copy buttons,
   warnings ("never transfer to a seller's personal account"), and the proof form.
3. **Submit proof** (`submitProof`): image/PDF proof (magic-byte checked, images re-encoded, stored
   **privately**), claimed amount, reference, payer name, notes. Payment → `PAYMENT_SUBMITTED`, order →
   `PAYMENT_UNDER_REVIEW`. Idempotent per client key; a different second proof while one is pending
   is refused (EDGE 2). Uploading proof never marks anything paid.
4. **Expiry:** the worker expires unpaid payments past `due_at`, cancels the order and releases the
   reserved stock.

## Admin verification center (`/admin/payments`)

- Queue of submitted/under-review payments; detail page shows the proof (private, authorized
  streaming), the claimed vs. expected amount (mismatch highlighted), reference, payer, destination
  snapshot and submission history.
- Actions (permission `payments.verify`):
  - **Start review** → `UNDER_REVIEW` (signals ownership to colleagues).
  - **Confirm** (explicit confirmation dialog) → payment `CONFIRMED`, submission `ACCEPTED`, order and
    seller orders `PAID`, stock reservations committed, ledger `ORDER_PAYMENT` per seller order,
    customer and sellers notified.
  - **Reject** with a reason shown to the customer, or **request a new proof** → customer can upload
    again; the flow then resumes (EDGE 20).
- **Exactly once:** the payment row is locked `FOR UPDATE`; a second confirmation (double-click, retry,
  two admins) returns "already confirmed" and posts nothing (EDGE 3/4). Ledger keys are unique too.
- Every decision is audit-logged with the staff member, time, IP and note.

## External Protected Deals

Deal payments reuse the same tables and verification center (`payments.deal_id`), with the ledger
entry `DEAL_PAYMENT` crediting `DEAL_FUNDS_HELD` instead of seller balances.

## Refunds and payouts

Refunds (to customers) and deal payouts (to external sellers) are **liabilities** in the ledger until
finance records the actual transfer with a reference (and optional proof) — see
[FINANCIAL_LEDGER.md](FINANCIAL_LEDGER.md). Full payout destinations are revealed only to transfer
operators after step-up, and each reveal is audited.

## Adding a payment gateway later

`src/server/modules/payments/providers.ts` defines a `PaymentProvider` interface (`initiate`,
`parseWebhook`). A licensed PSP (cards, Fawry, wallets) can be added by implementing it and calling
the same `confirmPaymentInternal()` used by manual verification, so orders, inventory, commissions and
the ledger do not change. Webhooks must verify signatures and be idempotent on the provider reference.
**No gateway is simulated** in this codebase.

## Configuration summary

| What | Where | Who |
|---|---|---|
| Enable/disable methods, customer instructions, order | Admin → إعدادات الدفع | `payments.destinations.manage` + step-up |
| Collection accounts (bank / IPA / wallet) | Admin → إعدادات الدفع | same |
| Payment window (hours) | Admin → إعدادات النظام (`payments.paymentWindowHours`) | `settings.manage` |
