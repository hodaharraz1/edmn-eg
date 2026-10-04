# Operations Runbook

How EDMN staff run the marketplace day to day from the Admin Operations Center (`/admin`). Every
action below is permission-checked server-side and written to the audit log.

## Daily queues (dashboard badges)

| Queue | Where | Permission | Target |
|---|---|---|---|
| Seller applications | التحقق من البائعين | `sellers.review` | review within 1–2 business days |
| Product moderation | مراجعة المنتجات | `products.moderate` | same day |
| Payment verification | التحقق من المدفوعات | `payments.verify` | within business hours; before the payment window (48 h) expires |
| Withdrawals | السحوبات | `withdrawals.approve` / `withdrawals.pay` | paid within 48 business hours (SLA shown, overdue in red) |
| Refunds & deal payouts | المستردات والمستحقات | `refunds.pay` / `deals.payout` | promptly after decisions |
| Disputes | النزاعات | `disputes.manage` | first response within 1 business day |
| Support tickets | الدعم الفني | `support.manage` | by priority |
| Unconfirmed deliveries | dashboard alert | `orders.manage` | follow up with buyer/seller |

## Seller approval

Seller 360 (`/admin/sellers/[id]`) shows identity, store, documents (private viewer), payout method
(masked), checklist, orders, finance and risk flags. Decide: approve, request more information (reason
shown to the seller), reject (reason), later restrict/suspend/reactivate. The national ID is masked;
revealing it requires step-up and is logged — do it only when needed.

## Product moderation

Check category, title/description accuracy, images (no stock photos for used items — the seller must
mark actual-item photos), price sanity, prohibited/restricted items (policy rules flag keywords and
restricted categories). Decisions: approve & publish, request changes (reason code + note), reject,
suspend a live listing. Edits to live listings arrive as revisions; the live version stays until the
revision is approved.

## Payment verification

1. Open the payment; compare the proof with the **bank/wallet statement** (not just the screenshot):
   amount, date, reference, sender.
2. If it matches: **Confirm** (dialog asks to confirm the money is actually in the account).
3. If not: **Reject** with a customer-visible reason, or **request a new proof**.
4. Mismatch between claimed and expected amounts is highlighted; never confirm a partial amount.

## Shipping evidence and receipt

Use the Shipping Evidence Center to audit waybills. If a buyer does not confirm a delivered order,
contact them; confirm on their behalf **only** with evidence (courier delivery confirmation, call log)
and write the reason. Freeze seller funds (financial hold) when fraud is suspected.

## Returns and disputes

Returns follow the store policy plus the statutory window (`returns.statutoryWindowDays`, subject to
legal review). Disputes: gather evidence through messages (internal notes are invisible to parties),
set status (under review / awaiting information), then issue a decision with a reason code and a
written justification. Financial outcomes (refunds, releases) are executed by the decision itself
through the ledger; the actual transfer to the customer is then recorded under Refunds.

## Withdrawals (maker/checker)

- **Checker** (`FINANCE_CHECKER`): review the seller (status, holds, recent payout-method changes,
  risk flags), then **approve** or **reject** (reserved amount returns to the seller).
- **Operator** (`FINANCE_OPERATOR`): click **عرض بيانات التحويل كاملة** (step-up + audited) to see the
  full destination, execute the transfer in the bank/wallet, then **record payment** with the
  transfer reference and proof. Above the dual-control threshold the operator must be a different
  person from the approver.
- Scheduled settlements are created automatically on configured days; they appear in the same queue.

## Ledger and reconciliation

Admin → دفتر القيود shows the trial balance, projection-vs-journal drift (must be 0), platform
accounts, the journal and manual adjustments (two-person rule). If drift is ever non-zero: **stop
payouts**, run `npm run ledger:check`, investigate the listed accounts, and escalate.

Monthly: reconcile `PLATFORM_CASH` against the real bank/wallet statements; `COMMISSION_REVENUE` and
`DEAL_FEE_REVENUE` against invoices.

## Content, legal and notifications

- CMS (home blocks, banners, static pages) — validated JSON per block type.
- Legal documents are versioned; publish a version only after counsel approval and tick the
  counsel-approval box truthfully. Seeded texts are drafts.
- Notification templates can override default texts per channel; the outbox shows delivery status
  and errors.

## Settings and roles

System settings are typed and validated; sensitive ones (thresholds, settlement, payout hold, deal
fees) require step-up and a reason. Assign the least-privileged role; keep maker and checker
separate; review staff accounts and 2FA status monthly.

## Incidents

| Symptom | First steps |
|---|---|
| Customers report paid but order unpaid | check the payment queue; verify statement; confirm |
| Seller cannot withdraw | payout hold after a payout-method change? suspended? available < minimum? |
| Emails/SMS not arriving | Admin → الإشعارات → outbox errors; provider credentials; worker running? |
| `/api/ready` failing | database connectivity, migrations, storage mount |
| Ledger drift | stop payouts, `npm run ledger:check`, escalate to engineering |

## Data requests

Exports (Admin → التقارير) are CSV, permission-gated, audited and exclude national IDs. Account
deletion requests: disable the account (Customer 360); transactional records are retained for legal
and accounting purposes per the (lawyer-approved) privacy policy.
