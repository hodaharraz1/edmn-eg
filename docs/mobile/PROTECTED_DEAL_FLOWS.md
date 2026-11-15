# Protected Deal (أضمن صفقة) — mobile flows

The app is a thin client over the existing deals service (`src/server/modules/deals/service.ts`) through
`src/server/modules/mobile/deals.ts` and `src/server/api/routes/deals.ts`. The app never computes money and never
releases, refunds or pays out. Release and refund stay staff actions with Maker/Checker controls in the admin console.

## Roles

- **Buyer** creates the deal and invites the seller. The domain is buyer-initiated, so screen D03 "choose role" becomes
  two entries on the hub: «صفقة جديدة» (buyer) and «معايا رابط دعوة» (seller).
- **Seller** joins by claiming the invitation link (bearer secret), then makes offers.
- The role is decided by the server from the session (`dealGraph`). A staff (ADMIN) view is refused on the mobile API.
  Strangers get 403/404.

## Flow C — happy path (verified end-to-end in `tests/integration/mobile-deals-api.test.ts`)

| # | Actor | App | API | Resulting status |
|---|---|---|---|---|
| 1 | Buyer | /deals/new step 1 | `POST /deals` (idempotency key per intent) | DRAFT |
| 2 | Buyer | steps 2–4 | `PUT /deals/{id}/steps/{2..5}` | DRAFT (indicative quote) |
| 3 | Buyer | «دعوة البائع» (confirmation) | `POST /deals/{id}/invitation` | INVITED (link returned once) |
| 4 | Seller | /deals/join | `POST /deal-invitations/claim` | SELLER_JOINED |
| 5 | Seller | offer sheet | `POST /deals/{id}/offer` | OFFER_PENDING_BUYER |
| 6 | Buyer | accept / request change / reject (confirmation) | `POST /deals/{id}/offer-response` | ACCEPTED → PAYMENT_PENDING, or CHANGE_REQUESTED |
| 6a | Seller | accept / reject change | `POST /deals/{id}/change-response` | OFFER_PENDING_BUYER / … |
| 7 | Buyer | «ادفع الآن» → /payments/:id | `POST /deals/{id}/payment`, then the shared receipt upload | PAYMENT_UNDER_REVIEW |
| 8 | EDMN staff | admin console | (not mobile) | ACTIVE (funds held) |
| 9 | Seller | ship sheet (note + proof) | `POST /deals/{id}/shipped` (multipart) | DELIVERED |
| 10 | Buyer | delivery-code sheet | `GET /deals/{id}/delivery-code` (buyer only) | — |
| 11 | Seller | enter code | `POST /deals/{id}/delivery-code/verify` | DELIVERY_HANDOVER_VERIFIED |
| 12 | Buyer | confirm receipt (confirmation) | `POST /deals/{id}/confirm-receipt` | BUYER_CONFIRMED_RECEIPT → ENTITLED_AWAITING_RELEASE |
| 13 | EDMN staff | admin console | (not mobile) | COMPLETED / REFUNDED |

Side paths: `cancel` (both, reason required), `decline` (seller), `invitation/refresh` and `invitation/revoke` (buyer),
`delivery-code/regenerate`, `not-received` (buyer). Every button is shown only when the server lists it in `allowedActions`.

## Money shown (`money.basis`)

| Basis | When | Source |
|---|---|---|
| `INDICATIVE` | Before any offer | deal row's estimate (fees not yet split) |
| `OFFER` | A seller offer or change is `PROPOSED` | that terms version's frozen server price |
| `AGREED` | After both parties accept | deal row frozen at acceptance (split fees, pricing snapshot) |

`goodsTotal + shipping + buyerFee = buyerPays` and `goodsTotal + shipping − sellerFee = sellerReceives` are produced by the
server. The integration test asserts that the offer view matches the offer's price and that the payment due equals the
agreed `buyerPays`.

**Defect found and fixed during Phase 2:** the first deal view read only the deal row, which before agreement holds an
indicative quote without shipping and with fee columns at 0. A buyer looking at a pending offer saw «رسوم الخدمة 0 ج.م»
and 15,500 instead of the offer's 15,550 ج.م. The view now picks the basis above and labels it.

## Security notes

- **Invitation link is a bearer secret.** It is returned to the buyer only, shown once on screen, and never stored by the
  app. `invitation` and `invitation/refresh` are deliberately **not** idempotency-cached, because a cached replay would
  store the secret. The contract guard (`tests/unit/openapi-contract.test.ts`) now fails any token- or link-returning
  write that is idempotency-cached.
- **Delivery code** is revealed to the buyer only, read fresh each time the sheet opens (an `autoDispose` provider).
  Expiry, attempt limit and single use are enforced by `verifyDeliveryOtp`. The seller never sees the code.
- Addresses: the seller sees the buyer's location only after payment (privacy from `dealGraph`).
- No mobile route path or id contains release, refund, settle, ledger, payout or transfer for deals (the guard enforces it).

## Not done yet

- Photo picker in the wizard (D07): the API (`POST /deals/{id}/photos`, up to 8) exists, but the wizard has no picker yet.
- Full deal dispute UI (D20) is in Phase 5. Only «not received» is wired now.
- Screenshots exist up to the offer stage. Paid, shipped and code stages need an admin payment confirmation on the local
  `edmn_shots` DB, and are covered by the integration test only.
