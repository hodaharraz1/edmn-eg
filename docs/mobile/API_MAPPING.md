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

## Not yet exposed to mobile (needed for the remaining phases)

Protected Deal (create, invitation, terms, accept, pay, evidence, delivery OTP, confirm), disputes/returns
(list, replies, evidence), customer wallet/ledger, notifications, support tickets, seller center (onboarding,
store, products/images/variants/stock, shipping rates, orders + shipment proof, finance with `finance.view` +
store scope around `sellerFundsPosition`, withdrawals incl. `TRANSFER_UNCERTAIN`). Domain services exist for these on
the web; each needs thin, tested mobile routes before its screens.
