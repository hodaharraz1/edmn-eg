# Mobile completeness matrix: buyer, seller, admin

**Date:** 20 Nov 2026 (batch 5) · **Branch:** `claude/mobile-completion` (from `claude/security-integration` 023804b)

**Baseline check:** `claude/security-integration` contains every commit of `claude/mobile-unified-integration`, `claude/security-policy-v1`, `claude/mobile-phase6-notifications`, `codex/mobile-audit-fixes`, `claude/edmn-mobile-integration` and the older `claude/*` / `backup/*` branches (0 missing commits each).

## How a feature is graded

A screen existing is not enough.

| Grade | Needs |
|---|---|
| **COMPLETE** | Route + typed API + server-side authorization/ownership + persistence + loading/error states + automated tests (backend integration through the real route handlers, plus widget tests) |
| **COMPLETE ✓UI** | COMPLETE, and also driven through the real UI against a real local server, with each step checked in the database (`docs/mobile/journeys/*.mjs`) |
| **PARTIAL** | Something specific is missing; the gap is stated |
| **MISSING** | No implementation |
| **BLOCKED** | Waiting on an owner decision or on external setup |

No row is graded on a physical device. Native iOS simulator evidence is limited to the partial journey described below.

## Buyer (Customer App)

| Feature | Grade | Evidence / gap |
|---|---|---|
| Sign in, register, OTP, forgot/reset password | COMPLETE ✓UI (sign-in) | `mobile-api-auth.test.ts`, `mobile-notifications-reset.test.ts`, widget tests. Sign-in driven in 3 journeys |
| Profile, addresses, sessions/devices | COMPLETE | `me`, `me/addresses`, `me/sessions` + tests |
| KYC (national ID) | COMPLETE | `GET/POST /me/identity`, encrypted fields, independent reviewer; device photo capture not verified |
| Home, categories, search, filters | COMPLETE | catalog API + widget tests |
| Product details, seller store | COMPLETE ✓UI | product page and add to cart driven in a journey |
| Wishlist | COMPLETE ✓UI | `wl-flow.mjs` 9/9 |
| Cart and price-change acknowledgement | COMPLETE ✓UI | `checkout-flow.mjs`, `e2e-flow.mjs` |
| **Checkout → order** | **COMPLETE ✓UI** | `checkout-flow.mjs`: 4 steps; `POST /orders` 201; one order row, `PENDING_PAYMENT`; server total in piastres; cart emptied |
| **Payment instructions + receipt upload** | **COMPLETE ✓UI** | `POST /payments/{id}/proof` 201; one submission; `PAYMENT_SUBMITTED`; file stored PRIVATE. Verification is staff-only (web) |
| Orders, tracking, delivery confirmation, cancel | **COMPLETE ✓UI** (batch 5) | `batch5-flow.mjs`: **BA** order created and found in «طلباتي» and its details; **BC1** unpaid order cancelled by the buyer (reservation released, no money); **BC2** paid order not yet confirmed → the buyer's request cancels it, refund `REQUESTED` for EDMN; **BC3** seller already confirmed → request `PENDING`, the seller accepts in the app, refund `REQUESTED` (nothing paid from the app); **BB** tracking shows carrier and waybill number, buyer confirms delivery (no `SELLER_RELEASE`) |
| Protected Deal (create, offer, pay, ship, delivery code, receipt, cancel) | COMPLETE ✓UI | The full Flutter UI journey passes in CI: [`protected-deal-mobile-journey` on `10b5f6b`](https://github.com/hodaharraz1/edmn-eg/actions/runs/45601438653). Earlier evidence: [Flutter web → API → isolated PostgreSQL](https://github.com/hodaharraz1/edmn-eg/actions/runs/44757775978) passed creation, photo upload (up to six photos per request), invitation and claim, offer/change/acceptance, test payment proof, shipment, wrong and correct delivery codes, buyer receipt, invalid image rejection and correction, invalid invitation rejection, and cancellation of a separate draft. Authorized staff performed payment review and two-person test settlement in the web console; the resulting database states and settlement entry were checked. Remaining: safe rollout and independent verification of local-disk upload orphan reconciliation. PostgreSQL-backed uploads participate in the metadata transaction. Local Playwright generates an ephemeral `DELIVERY_OTP_KEY`; staging needs separately provisioned key material. |
| Wallet, history, payout request, receiving accounts | COMPLETE | Request only; no money movement from mobile |
| Chat (buyer and seller) and notifications | COMPLETE ✓UI | `e2e-flow.mjs`: the conversation is opened from the order page, a message is sent and persisted; notifications marked read. Batch 5 **G**: double-tapped send stores one message; the store's reply reaches the buyer (`MESSAGE_RECEIVED` both ways) |
| Returns, refunds, disputes | **COMPLETE ✓UI** (batch 5) | **BD** return requested from the order with PRIVATE evidence; **BE** the seller rejects with a reason, the buyer is notified, sees it and escalates → one OPEN dispute, no refund record. Refund approval and payment stay staff-only (web, Maker/Checker) |
| Support tickets, ratings, reviews | COMPLETE ✓UI (ticket) | Ticket created through the UI and the row checked |
| Account deletion (C30) | MISSING | No deletion API on the server. Needs an owner and legal decision on data retention |
| Deposits, wallet top-up, transfer (D28–D31, D34) | BLOCKED | Business decisions (no deposit service) |
| Device push (FCM/APNs), deep links | BLOCKED | Needs signing and store configuration (owner) |

## Seller (inside the Customer App)

| Feature | Grade | Evidence / gap |
|---|---|---|
| Registration → phone OTP → KYC → application (owner, store + logo, ID documents, payout account) → submit → approval → Seller Center | **COMPLETE ✓UI** (batch 4) | Journey **A 16/16** (`seller-flow.mjs`): a brand-new account; ID images and seller documents stored PRIVATE, national ID encrypted; staff approvals through the console services (`staff-step.ts`); `SELLER_APPROVED` notification |
| Application form: governorate | **COMPLETE ✓UI** (batch 5) | Searchable picker fed by `GET /governorates` (active rows only; Arabic search ignores أ/إ/آ, ة/ه, ى/ي; English names in English), loading / empty / error-with-retry states; the id is sent. Journey A: «اسكندر» finds «الإسكندرية», `sellers.governorate_id` = its id; the store return governorate is stored the same way. Server: unknown or deactivated ids → 422 (were a 500 foreign-key error) — `mobile-seller-batch5.test.ts`; widget tests in `seller_batch5_test.dart` |
| Dashboard (`/seller/home`) | COMPLETE | Rendered in journeys A and C |
| Products: create, photo, description, price/variants, stock, return policy, submit, approval, live | **COMPLETE ✓UI** (batch 4) | Journey **B 13/13**: draft, photo (PUBLIC `PRODUCT_IMAGE`), price 79,900 piastres, stock 10, policy confirmed, submitted, staff approval → LIVE and public |
| Stop sales (out of stock) and archive | **COMPLETE ✓UI** (batch 4, new) | `POST /seller/products/{id}/out-of-stock` and `/archive` (console rules reused). Journey B: stock = reserved units; archived product returns 404 to buyers. Backend: cross-seller and buyer refusals; archive refused while unpaid orders reserve stock |
| Shipping governorates and rates, return policy | **COMPLETE ✓UI** (batch 5) | Journey **F**: governorates by name, each switch named; add (Aswan 85 EGP, 3–6 days) and modify (92.50 EGP = 9250 piastres) persisted; min > max refused on the device with no request; a dropped save shows an error and stores nothing; values survive leaving and reopening; another seller and a buyer cannot read or change them. Defects fixed: a second save reverted the first; Save hidden until a switch was toggled; no decimal key / clipped fee. Server: active governorates only |
| Order management: view (product, quantity, address), confirm, prepare, ready, shipment (carrier, waybill number, waybill file), shipped | **COMPLETE ✓UI** (batch 4; labels batch 5) | Journey **C 20/20**: every step persisted; waybill PRIVATE `SHIPPING_WAYBILL`; `ORDER_SHIPPED` sent to the buyer. Backend: unpaid orders cannot be advanced; another seller is refused |
| Seller order status labels | **COMPLETE ✓UI** (batch 5) | One distinct label per server state (12 states, AR and EN; PROCESSING «قيد التجهيز» ≠ READY_TO_SHIP «جاهز للشحن»; DELIVERED reads «استلمه المشتري – المستحقات قيد المراجعة», never completed) plus a next-step hint. Widget test asserts uniqueness for every state; journey **BB** checks each label after each step |
| Delivery confirmation | **COMPLETE ✓UI** | Buyer confirms in the app (`receipt_confirmed_by` = buyer); seller gets `BUYER_RECEIPT_CONFIRMED`; no `SELLER_RELEASE` without Maker/Checker; ledger balanced |
| Returns and disputes (seller side) | **COMPLETE ✓UI** (batch 4) | Journey **D**: return «arrived damaged» with PRIVATE `RETURN_EVIDENCE`, seller notified, rejects with a reason, buyer escalates → one OPEN dispute linked to the return, seller notified and sees it, no refund record (financial decision stays with EDMN) |
| Earnings, statement, payout requests | **COMPLETE ✓UI** (batch 4) | Journey **E 7/7**: funds on screen = ledger account = journal sum; delivered order in the statement; double-tapped payout request → one `REQUESTED` row, no journal entry, balance unchanged |
| Customer messages (store inbox) | **COMPLETE ✓UI** (batch 5) | Journey **G**: the buyer writes from the order; the seller is notified, sees the conversation with an unread count in «رسائل المتجر», opens it (read position recorded, unread 0), replies; the buyer sees the reply. Another seller and another buyer get 404 (API check). Attach / send buttons now named for screen readers |
| Store logo and banner | **COMPLETE** (batch 4, was PARTIAL) | `POST /seller/store/media` reuses the secure upload path (`STORE_LOGO`/`STORE_BANNER`); widget test; backend: type, size, buyer and idempotency checks. Logo driven in journey A |

## Admin App

| Feature | Grade | Evidence / gap |
|---|---|---|
| Sign in, mandatory TOTP, step-up, sessions, remote revocation | COMPLETE | `mobile-api-auth.test.ts`, widget tests |
| Privacy shield (app switcher), `FLAG_SECURE` | COMPLETE (code) | Lifecycle test; device check pending |
| Server-driven permissions (UI hides what the server refuses) | COMPLETE | Entries gated by `Profile.permissions`; the server still enforces every call |
| **Operational dashboard (KPIs and queues)** | **COMPLETE** (batch 1) | `GET /api/v1/admin/dashboard`: the same service and permission (`dashboard.view`) as the web `/admin` page; read-only. Tests: 5 route + 4 widget |
| **Seller applications queue** | **COMPLETE** (batch 2, read-only) | `GET /api/v1/admin/sellers/applications` (`sellers.review`); masked applicant |
| **KYC (national ID) review queue** | **COMPLETE** (batch 2, read-only) | `GET /api/v1/admin/identity/reviews` (`identity.view`). Shows the masked name and whether both document sides exist; no number, no images. **Approve/reject stays on the web** (documents, reviewer separation, fresh 2FA) |
| **Orders and shipping monitor** | **COMPLETE** (batch 2, read-only) | `GET /api/v1/admin/orders` (`orders.view`): all orders (status filter, number/name search, paging) + shipped-without-receipt follow-up tab |
| **Protected deals monitor** | **COMPLETE** (batch 2, read-only) | `GET /api/v1/admin/deals` (`deals.view`): active / disputed / finished |
| **Disputes and complaints monitor** | **COMPLETE** (batch 2, read-only) | `GET /api/v1/admin/disputes` (`disputes.manage`): open / assigned to me / closed. Resolution stays on the web (ledger workflows) |
| Financial approvals, reconciliation | BLOCKED by design | No financial mutation in the Admin App: approvals stay in the web console (two-person rule). Visibility via dashboard queues |
| **Audit log** | **COMPLETE** (batch 2, read-only) | `GET /api/v1/admin/audit` (`audit.view`): newest first, keyset paging, actor/action/entity filters; no before/after values, IP or user agent |
| **Detail views** (batch 3) | **COMPLETE** (read-only) | `GET /admin/sellers/{id}` (checklist, document metadata only with `sellers.documents.view`, history) · `identity/reviews/{id}` (status, review trail; no number/images) · `orders/{id}` (seller orders, items, shipment, tracking events, status history) · `deals/{id}` (money, payment/payout status, linked disputes, timeline; no locations/OTP) · `disputes/{id}` (messages incl. internal notes, evidence metadata, assignee, history) |
| **Dispute: assign + internal note** (batch 3) | **COMPLETE** | `POST /admin/disputes/{id}/assign` (assignee must be active staff with `disputes.manage`; open disputes only; audited old→new) · `POST /admin/disputes/{id}/notes` (always internal, no notification) · `GET /admin/disputes/assignees`. Idempotent, rate-limited. UI journey: assignment and note verified in the DB, audit on channel `ADMIN_MOBILE` |
| **Search and filters** (batch 3) | **COMPLETE** | Orders: number / customer-name search (server). Audit: actor-type filter + action search, keyset paging |
| Decisions from the Admin App (approve seller/KYC, resolve dispute, confirm payment, refunds, payouts, releases) | EXCLUDED (deliberate) | Kept in the web console (documents, Maker/Checker, step-up, ledger workflows). Enforced by the contract guard: the only admin writes on mobile are `ADMIN_SAFE_WRITES` |

## Native builds and runtime

| Target | Result | Evidence |
|---|---|---|
| Android customer debug / release APK | **Built** | `flutter build apk`, Flutter 3.47.8, SDK 36. Release is signed with the debug key (no production key requested) |
| Android admin debug / release APK | **Built** | Same |
| Android merged manifests (release) | **Verified** (`aapt2`) | `allowBackup=false`, `fullBackupContent=false`, `dataExtractionRules` set, no `usesCleartextTraffic`, not debuggable. Permissions: `INTERNET` plus the AndroidX-internal `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` |
| Android debug manifest | Verified | Customer: cleartext only in debug (for the local server), debuggable |
| Android emulator / device runtime | **Not run** | No KVM or emulator in this environment, and no device attached |
| iOS simulator | **Partial native journey verified** | On a Mac, an iPhone 17 Pro simulator connected to an isolated localhost PostgreSQL-backed test server. A native Flutter integration test signed in and created a DRAFT, verified in the test database; the rest of the native journey remains untested. A temporary copy outside Documents was used because the original location triggered a Flutter.framework codesign/provenance issue. No physical device was used. |
| UI → API → DB journeys (Flutter web build, local server, Real Money OFF) | **Batch 5 runs: 185/185 PASS** | **batch 5 `batch5-flow.mjs` 82/82** (F shipping rates, BA order, BC cancel ×3, BB tracking + delivery, G seller inbox, BD/BE return → escalation) · `seller-flow.mjs` 73/73 re-run (A now uses the governorate picker) · checkout 9/9 · e2e 12/12 · wishlist 9/9. Admin journey (39/39) last run in batch 3; the Admin App did not change since |
