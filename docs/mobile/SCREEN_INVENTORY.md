# Screen inventory — EDMN Market Customer App (buyer + seller in one app)

Status legend: **DONE** = implemented, wired to the real API, covered by tests and a real screenshot ·
**HONEST-STUB** = route exists and says plainly the service is not in the app yet (no fake data, no fake buttons) ·
**NOT STARTED**.

## Source note — the 87-page Figma PDF

`Untitled.pdf` (87 pages) was **not available** in this environment (not in the repository, not in the session's
files; no Mac folder is shared). The page-by-page table therefore uses the functional page ranges given in the
directive (§9). Each range is mapped to screens and status; a per-page table (1 → 87) must be completed once the PDF
is provided — that is listed as an open item in HANDOVER.

| Pages | Functional area | Screens / routes | Status |
|---|---|---|---|
| 1–8 | Splash & onboarding | `/splash`, `/onboarding` | DONE |
| 9–11 | Authentication & OTP | `/sign-in`, `/register`, `/forgot-password`, `/verify?channel=` | DONE (password-based login is the backend's; OTP = phone/email verification codes) |
| 12–13 | Home & profile completion | `/` home, `/account/profile` (+ verification prompts) | DONE |
| 14–20 | Guarantee creation & payment | Protected Deal | NOT STARTED (`/deals` HONEST-STUB) |
| 21–30 | Orders, details, edits & approval | Marketplace orders: `/orders`, `/orders/:id`; deal edits/approval → Protected Deal | Marketplace part DONE; deal part NOT STARTED |
| 31–36 | Contact center, chat, disputes & FAQ | report problem (DONE, opens a case server-side); disputes list/replies, support, FAQ | PARTIAL (`/support` HONEST-STUB) |
| 37–41 | Delivery verification & completion | confirm receipt (DONE); delivery OTP for deals | Marketplace DONE; deal OTP NOT STARTED |
| 42–50 | Wallet, deposit, withdrawal, payment methods | `/wallet` | HONEST-STUB; `/account/payment-methods` DONE (read-only, server methods) |
| 51–57 | Account, profile, settings, legal, notifications | `/account`, `/account/profile`, `/account/security`, `/account/devices`, `/account/addresses`, `/legal/:slug`, language | DONE except notifications (HONEST-STUB) |
| 58–69 | Alternative guarantee, approval, editing, rating | Protected Deal + ratings | NOT STARTED |
| 70–76 | Withdrawals, bank transfers, deposit confirmation | Wallet / seller earnings | NOT STARTED |
| 77–87 | Profile, cards, payment accounts, final states | Account (DONE); payout accounts (seller) | PARTIAL |

## Buyer screens (this phase)

| Screen | Route | API | UI states | Tests | Screenshot |
|---|---|---|---|---|---|
| Splash | `/splash` | token refresh | loading → route | widget (boot) | — |
| Onboarding | `/onboarding` | — | pages, skip | — | buyer/01 |
| Home | `/` (tab) | categories, products (recommended, newest) | skeleton, empty, error/retry, pull-to-refresh | widget | buyer/02, 03, 29 (EN) |
| Categories | `/categories` (tab) | categories | skeleton, filtered-empty, error | — | buyer/04 |
| Category products | `/categories/:id` | products?categoryId | sort, condition filter, pagination, empty | — | — |
| Search | `/search` | products?q | recent searches, sort/filter, pagination, no results | — | buyer/05 |
| Product | `/products/:slug` | product, reviews | gallery, variants, unavailable, error (404) | widget | buyer/06 |
| Public store page | `/stores/:slug` | store, products?storeSlug | products, policy, error | backend integration | buyer/07 |
| Sign in | `/sign-in` | login | validation, mapped errors, loading | widget | buyer/08 |
| Register | `/register` | register | validation (EG phone), errors | — | — |
| Forgot password | `/forgot-password` | password/forgot | sent state (no account disclosure) | — | — |
| Verify phone/email | `/verify` | verification send/confirm | cooldown, wrong/expired code | — | — |
| Cart | `/cart` | cart, set qty, acknowledge prices | signed-out, empty, per-seller groups, price-changed / stock / no-shipping issues, governorate pick, server totals | widget + backend | buyer/10, 11, 30 (EN) |
| Checkout | `/checkout` | checkout, addresses, place order | 4 steps, add address, method radio, TEST notice, total-changed refusal, one checkout key | widget + backend | buyer/12–15 |
| Order (tracking) | `/orders/:id` | order | placed notice, payment card, per-seller timeline, refunds (incl. TRANSFER_UNCERTAIN as "being verified"), server-allowed actions only | widget + backend | buyer/16, 17 |
| Payment / receipt | `/payments/:id` | payment, proof upload (multipart) | TEST notice, destinations + copy, submissions, upload validation, submitted = under review (never "paid") | widget + backend | buyer/18–20 |
| My orders | `/orders` (tab) | orders | search, status pills, pagination, empty, signed-out | widget | buyer/21 |
| Reorder | `/reorder` (tab) | orders, order, add to cart | empty, partial-availability message | — | buyer/22 |
| Account | `/account` | me | signed-out, verification prompt, sign-out confirm, language | widget | buyer/23, 28 (EN) |
| Addresses | `/account/addresses(/new|/:id)` | address CRUD, governorates | empty, validation, delete confirm | backend | buyer/24, 25 |
| Security | `/account/security` | change password | validation, success (others signed out) | backend | buyer/26 |
| Devices | `/account/devices` | sessions, revoke | remote sign-out | widget | — |
| Payment methods | `/account/payment-methods` | checkout (methods) | read-only | — | — |
| Legal / about | `/legal/:slug` | content/legal | error | — | — |
| Wallet, Protected Deal, Notifications, Support | `/wallet`, `/deals`, `/notifications`, `/support` | — | HONEST-STUB | widget (wallet: no fake balance) | buyer/27 |

**Buyer screens DONE: 22 · HONEST-STUB: 4 (wallet, Protected Deal, notifications, support).**

## Seller Center (same app, role-gated by the server membership)

| Screen | Route | API | Permission | UI states | Tests | Screenshot |
|---|---|---|---|---|---|---|
| Seller gate / dashboard (board "مركز البائع") | `/seller` | `GET /me/seller`, `GET /seller/home` | membership; sales only with finance.view | not-a-seller, application status (pending/rejected/suspended), dashboard | widget + backend | seller/s01 |
| Seller orders | `/seller/orders` | `GET /seller/orders?status` | orders.manage | status pills, empty, paid orders only | backend | seller/s02 |
| Seller order | `/seller/orders/:id` | `GET /seller/orders/{id}`, `POST …/steps`, `POST …/shipment` (multipart waybill) | orders.manage | ship-to, items, seller net (finance.view), cancellation request, only allowed steps, confirm dialogs | widget + backend | seller/s03, s04 |
| Products & stock | `/seller/products` | `GET /seller/products`, `PUT /seller/variants/{id}/stock` | products.manage / inventory.manage | stock / reserved / available, reserved floor validation | backend | seller/s05 |
| Earnings & balance | `/seller/funds` | `GET /seller/funds` (read only) | finance.view | withdrawable vs pending / held / reserved / debt / uncovered claims, block reason, open payouts | backend | seller/s06 |
| Public store page (buyers) | `/stores/:slug` | public | — | separate from the private dashboard | backend | buyer/07 |

**Seller screens DONE: 5.** Seller items still NOT STARTED in the app (web Seller Center only, stated in-app):
registration & documents, store settings, product create/edit + photos + prices, shipping rates by governorate,
returns/disputes handling, payout requests + history (needs an owner decision: the contract guard forbids any
`withdraw` route on the mobile API — see HANDOVER).
