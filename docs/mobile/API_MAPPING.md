# Mobile API mapping (Customer App)

Contract: `openapi/mobile.v1.json` (generated from `src/server/api/routes/*`, checked by `scripts/openapi.ts --check`).
Dart models/paths: `packages/edmn_api/lib/src/generated/mobile_api.dart` (generated). Typed calls: `MobileApi`.
Identity always comes from the session; no route accepts a user/seller id. Money is integer piastres.

| Screen | Endpoint(s) | Auth | Idempotency |
|---|---|---|---|
| Boot / version gate / TEST banner | `GET /app/config` | none | — |
| Sign in / register / refresh / sign out | `POST /auth/login`, `/auth/register`, `/auth/token/refresh`, `/auth/logout` | none / customer | refresh rotates |
| Forgot / reset password | `POST /auth/password/forgot`, `/auth/password/reset` | none | — |
| Profile, verification | `GET /me`, `PATCH /me`, `POST /me/verification/send`, `/me/verification/confirm` | customer | — |
| Change password | `POST /me/password` (signs out other devices, new tokens for this one) | customer | — |
| Devices | `GET /me/sessions`, `DELETE /me/sessions/{id}`, `POST /me/sessions/revoke-others` | customer | required |
| Home / categories / search / store products | `GET /catalog/categories`, `GET /catalog/products?q&categoryId&storeSlug&sort&condition&page` | none | — |
| Product, reviews, store | `GET /catalog/products/{slug}`, `/catalog/products/{slug}/reviews`, `/stores/{slug}` | none | — |
| Governorates, legal | `GET /governorates`, `GET /content/legal/{slug}` | none | — |
| Addresses | `GET/POST /me/addresses`, `PUT/DELETE /me/addresses/{id}` | customer | POST/DELETE required |
| Cart | `GET /cart?governorateId`, `POST /cart/items`, `PUT /cart/items/{variantId}`, `POST /cart/acknowledge-prices` | customer | POST items required |
| Checkout | `GET /checkout?addressId`, `POST /orders` (checkoutKey + expected total) | customer | checkoutKey |
| Orders | `GET /orders`, `GET /orders/{id}`, `POST /orders/{id}/cancel` | customer | cancel required |
| Shipment actions | `POST /seller-orders/{id}/confirm-receipt`, `/cancellation-request`, `/problem` | customer | required |
| Payment | `GET /payments/{id}`, `POST /payments/{id}/proof` (multipart; clientKey) | customer | clientKey |
| Private files | `GET /files/{id}` (binary; uniform 404) | customer | — |

## Seller Center (auth `seller`: the store is the session user's membership)

| Screen | Endpoint | Store permission |
|---|---|---|
| Role switch | `GET /me/seller` (auth customer) | — |
| Dashboard | `GET /seller/home` | any member; sales figures only with finance.view |
| Orders | `GET /seller/orders?status&page`, `GET /seller/orders/{id}` | orders.manage (paid orders only) |
| Fulfilment | `POST /seller/orders/{id}/steps` {CONFIRM_ORDER, START_PROCESSING, MARK_READY_TO_SHIP, MARK_SHIPPED, ACCEPT_CANCELLATION} — only if in allowedActions | orders.manage |
| Shipment proof | `POST /seller/orders/{id}/shipment` (multipart, optional waybill) | orders.manage |
| Products & stock | `GET /seller/products`, `PUT /seller/variants/{id}/stock` | products.manage / inventory.manage |
| Funds (read only) | `GET /seller/funds` — sellerBalances + sellerFundsPosition + sendBlockReason | finance.view |

## Added in this phase (backend, additive, no schema change)

* `GET /orders` items: `itemCount`, `thumbnails` (≤3) — from the order's own snapshots (board "طلباتي").
* `GET /orders/{id}` items: `variantId`, `productSlug` — for "اطلب تاني" (server re-prices on add) and product links.
* `GET /catalog/products?storeSlug=` — public store page products; unknown/hidden store → empty page.
* Dart generator: optional request fields are omitted when unset (the API rejects explicit `null`) — fixed a real
  login failure found by the end-to-end screenshot run.

## Protected Deal (Phase 2, auth `customer`; role from the session)

| Operation | Route | Service |
|---|---|---|
| listDeals / getDeal | GET /api/v1/deals, /deals/{dealId} | dealsForUser, dealGraph + dealAllowedActions |
| createDeal / saveDealStep / addDealPhotos | POST /deals, PUT /deals/{id}/steps/{step}, POST /deals/{id}/photos | createDeal, saveDealStep, addDealPhotos |
| inviteDealSeller / refresh / revoke | POST /deals/{id}/invitation(/refresh, /revoke) | inviteSeller, refreshInvitation, revokeInvitation |
| claimDealInvitation / declineDealInvitation | POST /deal-invitations/claim, /deals/{id}/decline | claimInvitation, rejectInvitation |
| submitDealOffer / respondDealOffer / respondDealChangeRequest | POST /deals/{id}/offer, /offer-response, /change-response | submitSellerOffer, respondToOffer, respondToChangeRequest |
| cancelDeal | POST /deals/{id}/cancel | cancelDeal |
| startDealPayment | POST /deals/{id}/payment → shared /payments/{id} proof | startDealPayment |
| markDealShipped | POST /deals/{id}/shipped | markDealDelivered |
| delivery code (buyer) / regenerate / verify (seller) | GET /deals/{id}/delivery-code, POST …/regenerate, …/verify | revealDeliveryOtpForBuyer, regenerateDeliveryOtp, verifyDeliveryOtp |
| confirmDealReceipt / reportDealNotReceived | POST /deals/{id}/confirm-receipt, /not-received | confirmDealReceipt, reportNotReceived |

Not exposed, by design: release, refund, settlement, payout of deals (staff only).

## Messaging & support (Phase 3)

| Operation | Route (auth) | Service |
|---|---|---|
| inbox / unread / thread | GET /conversations, /conversations/unread, /conversations/{id} (customer); same under /seller/conversations (seller, orders.communicate) | listForUser / listForSeller, unreadForUser / unreadForSeller, participantThread |
| send / seen / report | POST …/{id}/messages (multipart, clientKey), …/{id}/seen, …/messages/{messageId}/report | sendMessage, markRead, reportMessage |
| open from context | POST /seller-orders/{id}/conversation (customer), /seller/orders/{id}/conversation (seller), /deals/{id}/conversation (customer) | openSellerOrderConversation, openDealConversation |
| tickets | GET/POST /support/tickets, GET /support/tickets/{id}, POST …/replies, …/reopen, …/rating | myTickets, openTicket, ticketThread, replyToTicket, reopenTicket, rateTicket |
| help pages | GET /content/pages/{slug} (public) | cms pageBySlug |

See `CHAT_ARCHITECTURE.md`.

## Wallet (Phase 4)

| Operation | Route (auth) | Service |
|---|---|---|
| wallet view | GET /wallet (customer) | sellerFinancialView, activePayoutMethod, receiving destinations, identityStatus |
| activity | GET /wallet/activity?kind&q (customer) | payments, refunds, accountWithdrawals |
| payout requests | GET/POST /wallet/payout-requests, POST …/preview, POST …/{id}/cancel (customer) | accountWithdrawals, requestAccountWithdrawal, previewAccountWithdrawal, cancelWithdrawal |
| receiving accounts | GET/POST /wallet/receiving-accounts, POST …/{id}/archive (customer) | myReceivingDestinations, submitReceivingDestination, archiveReceivingDestination |
| store statement / payout account | GET /seller/statement, /seller/payout-account (seller, finance.view) | sellerStatement, activePayoutMethod |

Not exposed, by design: approval, reservation, transfer, uncertain resolution, top-up, wallet-to-wallet transfer. See
`WALLET_FINANCIAL_STATES.md`.

## Returns, disputes, reviews (Phase 5)

| Operation | Route (auth) | Service |
|---|---|---|
| return options / create / list / view | GET /seller-orders/{id}/return-options, POST /returns, GET /returns, /returns/{id} (customer) | returnWindow, openReturnedQty, requestReturn, returnGraph |
| ship back / escalate | POST /returns/{id}/ship-back, /escalate (customer) | customerShipsReturn, escalateReturn |
| store returns | GET /seller/returns, /seller/returns/{id}, POST …/steps, …/escalate (seller, returns.manage) | approveReturn, rejectReturn, markReturnReceived, startInspection, acceptReturnRefund (refund REQUEST) |
| disputes | POST/GET /disputes, GET /disputes/{id}, POST …/messages (customer); GET /seller/disputes(/{id}), POST …/messages (seller, orders.manage or returns.manage) | openDispute, disputeGraph, addDisputeMessage |
| reviews | GET /seller-orders/{id}/review-options, POST /reviews/products, /reviews/sellers (customer) | createProductReview, createSellerReview |

Not exposed, by design: dispute decision (resolveDispute), refund approval and payout, review moderation.

## Not yet exposed to mobile (needed for the remaining phases)

Protected Deal (create, invitation, terms, accept, pay, evidence, delivery OTP, confirm), disputes/returns
(list, replies, evidence), customer wallet/ledger, notifications, support tickets, seller center (onboarding,
store, products/images/variants/stock, shipping rates, orders + shipment proof, finance with `finance.view` +
store scope around `sellerFundsPosition`, withdrawals incl. `TRANSFER_UNCERTAIN`). Domain services exist for these on
the web; each needs thin, tested mobile routes before its screens.
