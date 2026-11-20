# Mobile completeness matrix: buyer, seller, admin

**Date:** 19 Nov 2026 · **Branch:** `claude/mobile-completion` (from `claude/security-integration` 023804b)

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

No row is graded on a physical device: none was attached. Native iOS is not built: no Mac was attached (see the end of this file).

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
| Orders, tracking, delivery confirmation, cancel | COMPLETE | `orders`, `seller-orders/*` + tests. Not driven in the UI yet |
| Protected Deal (create, offer, pay, ship, delivery code, receipt, cancel) | PARTIAL | API and screens complete with backend tests. **Gaps:** <br>• the creation wizard now selects up to six photos and uploads them via `POST /deals/{id}/photos`; widget coverage includes retry; <br>• the full UI → API → database journey remains unverified; <br>• local Playwright servers generate an ephemeral `DELIVERY_OTP_KEY` per run; deployed staging still needs separately provisioned key material |
| Wallet, history, payout request, receiving accounts | COMPLETE | Request only; no money movement from mobile |
| Chat (buyer and seller) and notifications | COMPLETE ✓UI | `e2e-flow.mjs`: the conversation is opened from the order page, a message is sent and persisted; notifications marked read |
| Returns, refunds, disputes | COMPLETE | Phase 5 integration tests; refunds stay staff-only. Not driven in the UI yet |
| Support tickets, ratings, reviews | COMPLETE ✓UI (ticket) | Ticket created through the UI and the row checked |
| Account deletion (C30) | MISSING | No deletion API on the server. Needs an owner and legal decision on data retention |
| Deposits, wallet top-up, transfer (D28–D31, D34) | BLOCKED | Business decisions (no deposit service) |
| Device push (FCM/APNs), deep links | BLOCKED | Needs signing and store configuration (owner) |

## Seller (inside the Customer App)

| Feature | Grade | Evidence / gap |
|---|---|---|
| Registration, KYC, store, documents, submit, status | COMPLETE | `seller-setup` flow tests |
| Dashboard (`/seller/home`) | COMPLETE | Rendered in the UI (`e2e-flow.mjs`); data assertions not automated in the UI |
| Products: create, images, details, variants, pricing, stock, visibility, submit | COMPLETE | Backend flow tests |
| Shipping governorates and rates, return policy | COMPLETE | `seller/shipping-rates` |
| Order management, shipment + waybill | COMPLETE | `seller/orders/*` |
| Delivery confirmation | COMPLETE | Buyer confirms; staff confirm-on-behalf is web-only |
| Returns and disputes (seller side) | COMPLETE | `seller/returns/*`, `seller/disputes/*` |
| Earnings, statement, payout requests | COMPLETE | Request only. Approval is two-person in the web admin console |
| Customer messages | COMPLETE | `seller/conversations/*` |
| Store banner | PARTIAL | Logo on mobile; banner upload is web-only |

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
| Decisions from the Admin App (approve seller/KYC, resolve dispute) | NOT STARTED (deliberate) | Needs an owner decision: document images on a phone and step-up per decision. The web console remains the decision point |

## Native builds and runtime

| Target | Result | Evidence |
|---|---|---|
| Android customer debug / release APK | **Built** | `flutter build apk`, Flutter 3.47.8, SDK 36. Release is signed with the debug key (no production key requested) |
| Android admin debug / release APK | **Built** | Same |
| Android merged manifests (release) | **Verified** (`aapt2`) | `allowBackup=false`, `fullBackupContent=false`, `dataExtractionRules` set, no `usesCleartextTraffic`, not debuggable. Permissions: `INTERNET` plus the AndroidX-internal `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` |
| Android debug manifest | Verified | Customer: cleartext only in debug (for the local server), debuggable |
| Android emulator / device runtime | **Not run** | No KVM or emulator in this environment, and no device attached |
| iOS simulator / device build | **Not run: BLOCKED** | No Mac attached to this session (`list_computer_folders`: none). The Flutter.framework codesign issue can only be investigated on a Mac |
| UI → API → DB journeys (Flutter web build, local server, Real Money OFF) | **Run: 56/56 PASS** | checkout 9/9, e2e 13/13, wishlist 9/9, admin 25/25 (batch 2) |
