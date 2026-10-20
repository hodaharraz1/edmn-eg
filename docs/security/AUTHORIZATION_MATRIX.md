# Authorization Matrix

Scope: the EDMN marketplace repository and the EDMN staging deployment only.

All checks below are enforced **in the service layer** (`src/server/modules/**`). Server actions and pages only resolve the actor (`requireCustomer`, `requireSellerActor`, `adminWith(perm)`), so a forged form post that skips the UI still reaches the same check. Ownership failures throw `forbidden` / `notFound`, and pages turn both into a uniform 404.

Legend:
- **✔** allowed
- **own** only the actor's own object
- **perm** requires the named RBAC permission (ADMIN session with completed TOTP)
- **SU** additionally requires a TOTP step-up within the last 10 minutes
- **✖** refused (tested where a test is cited)

## 1. Actors

| Actor | How it is established |
|---|---|
| Guest | No session. Guest cart cookie only. |
| Customer (CUST) | Customer session cookie (`__Host-` on production hosts). |
| Seller member (SELLER) | Customer session plus an approved seller membership. Per-member seller permissions: `store.manage`, `products.manage`, `orders.manage`, `finance.view`, `finance.withdraw`, `payout.manage`, `staff.manage`. |
| Admin (ADMIN) | A separate admin cookie and session kind, password + TOTP. RBAC permissions per role. Admin sessions are rejected on non-admin hosts when `ENFORCE_HOSTS=true`. |
| Deal buyer / deal seller | A customer who is `external_deals.buyer_id` or the bound `seller_user_id`. |
| Invitation holder | Anyone holding a still-unbound invitation token (bearer, see §4). |

## 2. Marketplace

| Operation | Guest | Customer | Seller member | Admin | Notes / tests |
|---|---|---|---|---|---|
| Browse / search / PDP | ✔ | ✔ | ✔ | ✔ | Only LIVE listings from ACTIVE sellers |
| Cart | ✔ (cookie) | ✔ | ✔ | — | Prices are re-computed on the server |
| Place order | ✖ | ✔ | ✔ except own store | — | SEC-AZ-2 (also via a merged guest cart) |
| View order / pay page | ✖ | own | own sub-order (seller view) | `orders.view` | EDGE 16, privacy-idor |
| Submit payment proof | ✖ | own (payer) | ✖ | — | SEC-PAY-2 |
| Confirm payment | ✖ | ✖ | ✖ | `payments.verify` + SU; not the payer; not a payment to own store; amount must equal amount due | SEC-PAY-1, 3, 4, 5 |
| Confirm receipt | ✖ | own | ✖ | `orders.confirm_receipt_on_behalf` + SU | |
| Return request | ✖ | own, delivered, inside window (protected reasons: dispute window) | respond for own store | `returns.manage` | deal-invitation-returns suite |
| Dispute | ✖ | own order/deal | own store / bound deal seller | `disputes.manage` | Window = `disputes.windowDays` |
| Reviews | ✖ | verified purchase only | reply to own | `reviews.moderate` | |
| Product create/edit/submit | ✖ | ✖ | `products.manage`, own store; return policy required | `products.moderate` (approve/reject; not own store) | SEC-AZ-1 |
| Re-activate a suspended listing | ✖ | ✖ | ✖ (only from APPROVED/LIVE) | `products.moderate` | SEC-AZ-1 |
| Store settings / return policy | ✖ | ✖ | `store.manage` | view | |
| Seller finance pages | ✖ | ✖ | `finance.view` | `finance.view` | Seller pages render a forbidden notice without it |
| Request withdrawal | ✖ | ✖ | `finance.withdraw`; balance reserved under lock | — | SEC-WD-1 |
| Approve withdrawal | ✖ | ✖ | ✖ | `withdrawals.approve`; not own store; rolling-24h dual control | SEC-WD-2, 6, 7 |
| Pay withdrawal | ✖ | ✖ | ✖ | `withdrawals.pay`; not own store; seller not suspended / no payout hold / no debt; no TEST payout once real money is on | SEC-WD-3, 5 |
| Reject withdrawal in PROCESSING | ✖ | ✖ | ✖ | `withdrawals.pay` + SU + a different person from the one who started the transfer | SEC-WD-4 |
| Payout method change | ✖ | ✖ | `payout.manage` → review + hold | `sellers.payout.verify` (not the owner) | |
| Refund marked paid | ✖ | ✖ | ✖ | `refunds.pay`; maker ≠ checker above threshold; never to self | |
| Ledger adjustment | ✖ | ✖ | ✖ | `ledger.adjust.create` / `ledger.adjust.approve`, maker ≠ checker | |
| Seller application decision | ✖ | ✖ | ✖ | `sellers.review` / `sellers.suspend`, not own application | |
| National ID / payout reveal | ✖ | ✖ | ✖ | `sellers.documents.view` (audited); KYC file reads need a step-up within 60 min | |
| Settings (incl. `payments.realMoneyEnabled`) | ✖ | ✖ | ✖ | `settings.manage` + SU. The real-money switch is refused on staging and while any test money is open | pilot-safety |
| Payment destinations | ✖ | ✖ | ✖ | `payments.destinations.manage` + SU | |
| Roles / staff | ✖ | ✖ | ✖ | `roles.manage` + SU | |

## 3. Private files (`/api/files/[id]`)

| Purpose | Who may read (from `src/server/storage/access.ts`) |
|---|---|
| `SELLER_DOCUMENT` (KYC) | The owning seller; admins with `sellers.documents.view` **and** a step-up within 60 minutes (audited) |
| `PAYMENT_PROOF` | The submitter; admins with `payments.view` |
| `SHIPPING_WAYBILL` | The buyer, the seller owner or an active member of that store; admins with `shipping.view` |
| `RETURN_EVIDENCE` | The customer and the seller owner of that return; `returns.manage` / `disputes.manage` |
| `DISPUTE_EVIDENCE` | Claimant and respondent of that dispute; `disputes.manage` |
| `DEAL_EVIDENCE` | The buyer and the bound seller of that deal; `deals.view` |
| `WITHDRAWAL_PROOF` | The seller owner; `withdrawals.view` / `deals.payout` |
| `REFUND_PROOF` | The refunded customer; `refunds.pay` / `finance.view` |
| `SUPPORT_ATTACHMENT` | The ticket requester; `support.manage` |
| Any other purpose | Denied by default |
| Public purposes (product images, store logo/banner, review photos) | Anyone (served from the public bucket, not this route) |

Guessing an id gives a uniform 404 (EDGE 18). Sensitive reads are audited.

## 4. External protected deals (invitation-first)

| Operation | Buyer | Invitation holder (unbound) | Bound seller | Other customer | Admin |
|---|---|---|---|---|---|
| Create / edit draft (steps 1–5) | own, DRAFT only | ✖ | ✖ | ✖ | ✖ |
| Create / refresh / revoke the link | own, INVITED only | ✖ | ✖ | ✖ | ✖ |
| Open `/deal/invite/<token>` | ✔ (shows "your own invitation") | ✔ safe summary; **read-only** (only `openedAt` + audit) | ✔ → deal page | sees "bound to another account" once bound | — |
| Claim ("قبول ومتابعة") | ✖ | ✔ once → binds the token to this account | idempotent | ✖ once bound | ✖ |
| Reject the invitation | ✖ | ✔ (signed in) | ✔ (before agreement) | ✖ | — |
| Submit offer / counter-offer | ✖ | ✖ | ✔ (verified phone required for the first offer) | ✖ | ✖ |
| Accept / request change / reject an offer | ✔ (exact PROPOSED version only) | ✖ | ✖ | ✖ | ✖ |
| Accept / reject a change request | ✖ | ✖ | ✔ | ✖ | ✖ |
| Start payment | ✔ only after agreed terms (PAYMENT_PENDING) | ✖ | ✖ | ✖ | ✖ |
| View the deal page | ✔ | ✖ | ✔ | ✖ (404) | `deals.view` |
| See the counterparty's address / GPS | from ACTIVE (payment confirmed) | ✖ | from ACTIVE | ✖ | `deals.view` |
| Declare shipment (issues the buyer's handover code) | ✖ | ✖ | ✔ ACTIVE | ✖ | — |
| Read the handover code | ✔ own deal only (staging test display; production: SMS) | ✖ | **✖ never** | ✖ | ✖ (only issuance/attempt metadata, never the code) |
| Enter the handover code (verify) | ✖ | ✖ | ✔ DELIVERED; rate-limited; attempt-limited | ✖ | ✖ |
| Request a new code (sent to the buyer) | ✔ | ✖ | ✔ | ✖ | — |
| "Buyer received" without the buyer | — | — | **✖ no such action** | ✖ | dispute decision only |
| Confirm "received & as described" (release) | ✔ only after verified handover; no hold/flag/dispute | ✖ | ✖ | ✖ | — |
| Report problem / not received / exception | ✔ | ✖ | exception + dispute | ✖ | `disputes.manage` decides |
| Operations hold on a deal | ✖ | ✖ | ✖ | ✖ | `deals.manage` + SU |
| Mark deal payout paid | ✖ | ✖ | ✖ | ✖ | `deals.payout`, payout PENDING, payee ≠ actor |

Tests: `tests/integration/deal-invitation-returns.test.ts` (binding, enumeration, expiry, revoke, stranger, location visibility, version immutability) and `tests/e2e/protected-deal.spec.ts`.

## 5. Known authorization gaps (open, documented in SECURITY_FINDINGS.md)

- **AZ-F5 (P3).** Seller staff can be added by email without that user's consent. They get no access beyond the granted seller permissions.
- **AZ-F9 (P3).** Review photos are public by design. The admin CSV export does not require a step-up (it still needs the export permission and is audited).
