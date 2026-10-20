# EDMN Mobile: API & Backend Gap Matrix

> **⚠️ SUPERSEDED (2026-10-20).** This v1 document audited the marketing-site `main` branch and wrongly concluded that no EDMN backend exists. The EDMN Marketplace platform lives on branch `claude/great-tesla-nor0wt` (baseline `48ae40c`). Use [`MOBILE_API_GAP_MATRIX_V2.md`](./MOBILE_API_GAP_MATRIX_V2.md) and [`MOBILE_API_EXTRACTION_PLAN.md`](./MOBILE_API_EXTRACTION_PLAN.md). This file is kept unchanged below for audit history.

Companion to `MOBILE_PHASE_0_AUDIT.md`. Phase 0, read-only. **Nothing in this document is implemented.**

**Key finding.** The audited repositories (`edmn-eg`, `edmn-eg-nextjs`) contain no backend for any transactional feature. Unless D-01 locates an existing backend, every feature below is **MISSING**. In that case the "Required work" column describes greenfield backend work in the canonical platform.

**Legend.**
- **Status:** `EXISTS` · `PARTIAL` · `MISSING` · `NEEDS REFACTOR` · `UNSAFE FOR MOBILE EXPOSURE`
- **Mobile readiness:** 🔴 not ready · 🟡 partial · 🟢 ready
- **Class:** PUBLIC · CUSTOMER (buyer, or any signed-in user) · SELLER (approved store member) · ADMIN (staff, RBAC) · FINANCE (staff with finance permissions) · INTERNAL (system-to-system)

---

## 1. Feature reuse matrix (Phase 0A)

All database models in this table are **proposed** (see audit §5.1), because none exist.

### 1.1 Buyer

| # | Feature | Status | Existing implementation | Relevant files | DB models (proposed) | API availability | Authorization | Readiness | Security concerns | Required work |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | Registration / Login / OTP | MISSING | Lead form only, no account | `edmn-eg-nextjs/src/app/[locale]/register/*` | users, user_phones, auth_otp_challenges, sessions, refresh_tokens, devices | None | Public → customer | 🔴 | SMS pumping, OTP brute force, SIM swap, enumeration | API-AUTH-01..09 with strict fail-closed rate limits |
| B2 | Home | MISSING | Marketing home (web) | `src/app/[locale]/page.tsx` | cms_banners, categories | None | Public | 🔴 | — | API-CAT-01, API-CMS-01 |
| B3 | Categories | MISSING | — | — | categories | None | Public | 🔴 | — | API-CAT-01..02 |
| B4 | Search | MISSING | — | — | products (FTS index) | None | Public | 🔴 | Query abuse | API-CAT-03 with rate limit |
| B5 | Product details | MISSING | — | — | products, variants, media | None | Public | 🔴 | — | API-CAT-04 |
| B6 | Store pages | MISSING | — | — | stores | None | Public | 🔴 | Seller PII leakage | API-CAT-05..06, public projection only |
| B7 | Cart | MISSING | — | — | carts, cart_items | None | Customer (owner) | 🔴 | Price tampering | API-CART-01..05, server pricing |
| B8 | Multi-seller checkout | MISSING | — | — | checkouts, checkout_seller_groups, inventory_reservations | None | Customer | 🔴 | Double charge, oversell | API-CHK-01..03, idempotent, reservation TTL |
| B9 | Orders | MISSING | — | — | orders, order_items, shipments | None | Customer (owner) | 🔴 | IDOR | API-ORD-01..03 |
| B10 | Payments | MISSING | Copy mentions Fawry/ValU | `components/sections/Partners.tsx` | payment_intents, payment_attempts, psp_webhook_events | None | Customer + PSP webhook | 🔴 | Webhook forgery, amount mismatch, replay | API-PAY-01..04, API-INT-01, D-03 |
| B11 | Protected Deals (create/list/detail) | MISSING | Copy only | `locales/*.json → howItWorks` | deals, deal_events | None | Customer | 🔴 | IDOR | API-DEAL-01..05 |
| B12 | Seller invitation links | MISSING | — | — | deal_invitations (hashed token) | None | Token holder → seller | 🔴 | Token leakage, guessing, reuse | API-DEAL-06..08, single-use 128-bit tokens |
| B13 | Offer approval / modification | MISSING | — | — | deal_offers | None | Buyer of deal | 🔴 | Stale-offer acceptance | API-DEAL-09..11, If-Match offer version |
| B14 | Frozen agreement | MISSING | — | — | deal_agreements | None | Parties | 🔴 | Post-acceptance tampering | API-DEAL-12, immutable plus hash |
| B15 | Delivery tracking | MISSING | — | — | shipments, pt_state_history | None | Parties | 🔴 | — | API-PT-01..02 |
| B16 | Delivery OTP (buyer view) | MISSING | — | — | delivery_otps | None | Buyer only | 🔴 | Exposure in logs, push or screenshots | API-PT-03..04 |
| B17 | Receipt confirmation | MISSING | — | — | protected_transactions | None | Buyer | 🔴 | Accidental confirm, which releases funds | API-PT-05, confirmation sheet |
| B18 | Returns | MISSING | Policy text | `refund-policy/page.tsx` | returns | None | Buyer | 🔴 | — | API-RET-01..03 |
| B19 | Replacements | MISSING | — | — | replacements | None | Buyer | 🔴 | — | API-RET-04..05 |
| B20 | Disputes | MISSING | Terms text (48 h evidence) | `terms/page.tsx` | disputes, dispute_evidence | None | Parties | 🔴 | Evidence privacy, malware uploads | API-DSP-01..05 |
| B21 | Wallet / transaction history | MISSING | Hero mock-up only | `components/sections/Hero.tsx` | account_balances (projection), journal_lines | None | Owner | 🔴 | Client-side balance computation | API-WAL-01..02, read-only projection |
| B22 | Notifications | MISSING | — | — | notifications, push_tokens, notification_preferences | None | Owner | 🔴 | Lock-screen PII | API-NTF-01..05 |
| B23 | Support | PARTIAL | Web contact form → Formspree | `src/app/api/contact/route.ts` (both repos) | support_tickets, ticket_messages | Web only, no ticket IDs | Public / customer | 🔴 | PII in a third party | API-SUP-01..05 (replaces the contact route) |
| B24 | Account / profile / addresses | MISSING | — | — | users, addresses | None | Owner | 🔴 | — | API-ACC-01..06 |
| B25 | Security / sessions | MISSING | — | — | sessions, devices | None | Owner | 🔴 | Session theft | API-AUTH-06..08 |
| B26 | Legal / FAQ / content | PARTIAL | Static web pages | `src/app/[locale]/{terms,privacy-policy,refund-policy,faq}` | cms_pages | Web only | Public | 🟡 | Claims accuracy (S-02) | API-CMS-02 |

### 1.2 Seller Center

| # | Feature | Status | Existing implementation | Relevant files | DB models (proposed) | API availability | Authorization | Readiness | Security concerns | Required work |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | Seller application | MISSING | "merchant" lead type | `RegisterForm.tsx` | seller_profiles | None | Customer | 🔴 | — | API-SEL-01..02 |
| S2 | Seller KYC | MISSING | Privacy policy mentions KYC | `privacy-policy/page.tsx` | kyc_cases, kyc_documents | None | Applicant | 🔴 | National ID images, retention | API-KYC-01..04, private bucket |
| S3 | Store profile | MISSING | — | — | stores, store_members | None | Store owner | 🔴 | — | API-SEL-03..05 |
| S4 | Seller dashboard | MISSING | — | — | read models | None | Store member | 🔴 | — | API-SEL-06 |
| S5 | Add/edit products (new/used) | MISSING | — | — | products, variants, media, product_condition | None | Store member (catalog perm) | 🔴 | Prohibited items, media abuse | API-SPR-01..06 |
| S6 | Inventory | MISSING | — | — | inventory_levels | None | Store member | 🔴 | Lost updates | API-SPR-07, If-Match |
| S7 | Seller orders | MISSING | — | — | orders | None | Store member | 🔴 | IDOR across stores | API-SOR-01..03 |
| S8 | Shipping rates per governorate | MISSING | — | — | governorates, seller_shipping_rates | None | Store owner | 🔴 | — | API-SHP-01..03 |
| S9 | Delivery duration | MISSING | — | — | seller_shipping_rates.min/max_days | None | Store owner | 🔴 | — | Part of API-SHP-02 |
| S10 | Shipping evidence | MISSING | — | — | shipment_evidence | None | Store member | 🔴 | Fake evidence, EXIF/GPS leakage | API-SOR-04..05, API-UPL-01 |
| S11 | Delivery OTP entry | MISSING | — | — | delivery_otps | None | Store member | 🔴 | Brute force | API-SOR-06, attempt and rate limit |
| S12 | Returns / replacements (seller) | MISSING | — | — | returns, replacements | None | Store member | 🔴 | — | API-SOR-07..09 |
| S13 | Seller balance | MISSING | — | — | account_balances (projection) | None | Store owner | 🔴 | Client-calculated balance | API-SBAL-01..02 |
| S14 | Withdrawal requests | MISSING | — | — | withdrawal_requests, payout_accounts | None | Store owner + step-up | 🔴 | Account takeover leading to payout redirection | API-SBAL-03..06, cooling-off on payout account change |
| S15 | Protected Deal requests (seller side) | MISSING | — | — | deals, deal_invitations | None | Invited seller | 🔴 | — | API-SDEAL-01..02 |
| S16 | Seller offers | MISSING | — | — | deal_offers | None | Invited seller | 🔴 | Offer version races | API-SDEAL-03..05 |
| S17 | Seller notifications | MISSING | — | — | notifications | None | Owner | 🔴 | — | Shared API-NTF-* |
| S18 | Seller support | MISSING | — | — | support_tickets | None | Owner | 🔴 | — | Shared API-SUP-* |

### 1.3 Admin

| # | Feature | Status | Relevant files | DB models (proposed) | API availability | Authorization | Readiness | Security concerns | Required work |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Admin auth + mandatory 2FA | MISSING | — | staff_users, staff_mfa_factors, staff_sessions | None | Staff | 🔴 | Phishing, credential stuffing | API-ADM-AUTH-01..07 |
| A2 | Fresh auth (step-up) | MISSING | — | step_up_grants | None | Staff | 🔴 | Replay of step-up tokens | API-ADM-AUTH-05 |
| A3 | Dashboard / KPIs | MISSING | — | read models | None | admin.dashboard.read | 🔴 | Aggregate leakage | API-ADM-01 |
| A4 | Approval queues | MISSING | — | approval_requests, queues view | None | Per queue | 🔴 | — | API-ADM-02 |
| A5 | User management / User 360 | MISSING | — | users, sessions | None | users.read / users.manage | 🔴 | PII over-exposure | API-ADM-USR-01..05 |
| A6 | KYC review | MISSING | — | kyc_cases | None | kyc.review | 🔴 | Document leakage | API-ADM-KYC-01..04 |
| A7 | Seller approvals / Seller 360 | MISSING | — | seller_profiles | None | sellers.review | 🔴 | — | API-ADM-SEL-01..04 |
| A8 | Product moderation | MISSING | — | product_moderation | None | catalog.moderate | 🔴 | — | API-ADM-PRD-01..03 |
| A9 | Orders / Order 360 | MISSING | — | orders, PT | None | orders.read | 🔴 | — | API-ADM-ORD-01..02 |
| A10 | Protected Deals / Deal 360 | MISSING | — | deals, PT | None | deals.read / deals.intervene | 🔴 | Unauthorised state forcing | API-ADM-PT-01..05 |
| A11 | Payment verification | MISSING | — | payment_verifications | None | finance.payments.verify (M/C) | 🔴 | False "funded" | API-FIN-01..03 |
| A12 | Delivery evidence | MISSING | — | shipment_evidence | None | deals.read | 🔴 | Evidence privacy | API-ADM-PT-02 |
| A13 | Disputes / returns / replacements | MISSING | — | disputes, returns | None | disputes.decide (M/C above threshold) | 🔴 | Biased or self-dealing decisions | API-ADM-DSP-01..05 |
| A14 | Finance dashboard | MISSING | — | ledger projections | None | finance.read | 🔴 | — | API-FIN-04 |
| A15 | Ledger explorer / journal details | MISSING | — | journals, journal_lines | None | finance.ledger.read | 🔴 | — | API-FIN-05..07 |
| A16 | Settlements | MISSING | — | settlement_batches | None | finance.settlement (M/C) | 🔴 | Double settlement | API-FIN-08..10 |
| A17 | Withdrawals | MISSING | — | withdrawal_requests, payouts | None | finance.payouts (M/C) | 🔴 | Self-approval, redirection | API-FIN-11..13 |
| A18 | Maker / Checker | MISSING | — | approval_requests | None | Per action | 🔴 | Maker = checker | API-ADM-02, API-FIN-* |
| A19 | Reconciliation | MISSING | — | recon_* | None | finance.recon | 🔴 | Unresolved breaks | API-FIN-14..16 |
| A20 | Fees and commissions | MISSING | (copy: 5 %/3 %) | fee_schedules | None | finance.fees (M/C) | 🔴 | Retroactive fee change | API-FIN-17 |
| A21 | Chargebacks / adjustments | MISSING | — | chargebacks, financial_adjustments | None | finance.adjust (M/C) | 🔴 | Ledger bypass | API-FIN-18 |
| A22 | Support tickets | MISSING | — | support_tickets | None | support.* | 🔴 | — | API-ADM-SUP-01..03 |
| A23 | Notifications (broadcast) | MISSING | — | notifications | None | notifications.send | 🔴 | Spam, phishing via the official channel | API-ADM-NTF-01 |
| A24 | CMS / content | MISSING (web static) | `src/app/[locale]/*` | cms_pages, cms_banners | None | content.edit | 🔴 | Stored XSS in web views | API-ADM-CMS-01..02 |
| A25 | Staff accounts / roles / permissions | MISSING | — | staff_users, roles, permissions | None | staff.manage (M/C + step-up) | 🔴 | Privilege escalation | API-ADM-STF-01..05 |
| A26 | Audit trail | MISSING | — | audit_events | None | audit.read | 🔴 | Tampering | API-ADM-AUD-01..02 |
| A27 | Reports | MISSING | — | read models | None | reports.read | 🔴 | Bulk PII export | API-ADM-RPT-01..02 |
| A28 | Platform settings (incl. real-money switch) | MISSING | — | platform_settings | None | settings.manage (M/C + step-up) | 🔴 | Accidental real-money ON | API-ADM-SET-01..03 |
| A29 | System health | PARTIAL (web health) | `edmn-eg-nextjs/src/app/api/health/route.ts` | — | Web only, public | ops.read | 🔴 | Config disclosure (S-08) | API-ADM-SYS-01 |

**Totals: 73 features (26 buyer + 18 seller + 29 admin).** EXISTS 0 · PARTIAL 3 (B23, B26, A29) · MISSING 70.

---

## 2. Existing endpoint inventory (Phase 0B)

| ID | Repo | Method | Route | Class | Status for mobile |
|---|---|---|---|---|---|
| E1 | edmn-eg | POST | `/api/contact` | PUBLIC | **UNSAFE FOR MOBILE EXPOSURE.** No idempotency, an ineffective rate limit, and a third-party relay. Replace with API-SUP-01 |
| E2 | edmn-eg-nextjs | POST | `/api/contact` | PUBLIC | **NEEDS REFACTOR** into API-SUP-01 (pattern reuse: zod plus Upstash rate limit) |
| E3 | edmn-eg-nextjs | GET | `/api/health` | PUBLIC (should be INTERNAL) | **UNSAFE FOR MOBILE EXPOSURE.** Discloses config and makes outbound calls per request. Replace with API-ADM-SYS-01 and a shallow public liveness check |

Full per-endpoint detail is in `MOBILE_PHASE_0_AUDIT.md` §4.1.

**Usable as-is: 0 · Needs modification: 1 (E2 → API-SUP-01) · Unsafe or retire: 2.**

---

## 3. Required API catalogue (all missing)

### 3.1 Conventions

These apply to every endpoint.

- **Base paths.** `/v1/…` is served on `api.<domain>` (customer audience). `/admin/v1/…` is served on `admin-api.<domain>` (staff audience).
- **Errors.** `application/problem+json` with `code` and `trace_id`.
- **Pagination.** Cursor-based (`?cursor=&limit=`).
- **Money.** Integer `*_piastres` plus `currency: "EGP"`.
- **Idem.** `✔` means the client must send `Idempotency-Key`. The server stores the request hash and replays the original response.
- **Ver.** `✔` means `If-Match` with the aggregate version is required (optimistic concurrency).
- **RL** (rate-limit tier):
  - **S** strict: auth, OTP, invitation accept, money
  - **M** medium: writes
  - **L** loose: reads
- **Audit.** `✔` writes an `audit_events` row with actor, IP, device, before/after hash, `trace_id`.
- **Step-up.** `✔` requires a fresh, action-scoped step-up token: TOTP or passkey for staff, SMS/OTP plus biometric for customers.
- **M/C.** `✔` means maker/checker. The call creates or approves an `approval_request`. A maker can never be the checker (DB CHECK).

### 3.2 PUBLIC (18)

| ID | Method | Route | Purpose | Idem | Ver | RL | Audit | Notes |
|---|---|---|---|---|---|---|---|---|
| API-AUTH-01 | POST | /v1/auth/otp/request | Send login/registration SMS OTP | ✔ | | S | ✔ | Per-phone, IP and device limits. Generic response to prevent enumeration. Fails closed |
| API-AUTH-02 | POST | /v1/auth/otp/verify | Verify OTP → tokens | ✔ | | S | ✔ | Max 5 attempts per challenge |
| API-AUTH-04 | POST | /v1/auth/token/refresh | Rotate refresh token | | | S | ✔ | Reuse detection revokes the whole family |
| API-CAT-01 | GET | /v1/categories | Category tree | | | L | | Cacheable (ETag) |
| API-CAT-02 | GET | /v1/categories/{id}/products | Products by category | | | L | | |
| API-CAT-03 | GET | /v1/search | Product and store search | | | M | | Query length cap |
| API-CAT-04 | GET | /v1/products/{id} | Product detail | | | L | | |
| API-CAT-05 | GET | /v1/stores/{id} | Store public profile | | | L | | Public projection only |
| API-CAT-06 | GET | /v1/stores/{id}/products | Store catalog | | | L | | |
| API-CAT-07 | GET | /v1/governorates | 27 Egyptian governorates | | | L | | Static, cacheable |
| API-CAT-08 | GET | /v1/products/{id}/shipping-quote?governorate= | Shipping price and ETA | | | L | | Server-computed |
| API-CMS-01 | GET | /v1/home | Home layout (banners, sections) | | | L | | |
| API-CMS-02 | GET | /v1/content/{slug} | Terms, privacy, refund, FAQ | | | L | | Versioned. Acceptance is recorded at signup |
| API-SUP-01 | POST | /v1/support/contact | Pre-auth contact → ticket | ✔ | | S | ✔ | Replaces E1/E2. Captcha or attestation |
| API-DEAL-06 | GET | /v1/invitations/{token} | Preview invitation (minimal info) | | | S | ✔ | Constant-time token hash lookup. No buyer PII before sign-in |
| API-APP-01 | GET | /v1/app/config | Min supported version, feature flags, `real_money_enabled` (read-only) | | | L | | Force-update gate |
| API-APP-02 | GET | /v1/health | Shallow liveness | | | L | | No dependency detail |
| API-INT-PUB-01 | GET | /.well-known/{apple-app-site-association,assetlinks.json} | Universal Links and App Links | | | L | | For invitation deep links |

### 3.3 CUSTOMER (67)

| ID | Method | Route | Purpose | Idem | Ver | RL | Audit | Step-up |
|---|---|---|---|---|---|---|---|---|
| API-AUTH-03 | POST | /v1/auth/register | Complete profile and accept terms version | ✔ | | M | ✔ | |
| API-AUTH-05 | POST | /v1/auth/logout | Revoke the current session | ✔ | | M | ✔ | |
| API-AUTH-06 | GET | /v1/me/sessions | List sessions and devices | | | L | | |
| API-AUTH-07 | DELETE | /v1/me/sessions/{id} | Revoke a session | ✔ | | M | ✔ | |
| API-AUTH-08 | POST | /v1/me/sessions/revoke-all | Revoke all other sessions | ✔ | | M | ✔ | ✔ |
| API-AUTH-09 | POST | /v1/auth/step-up | Customer step-up (OTP + biometric) → scoped token | ✔ | | S | ✔ | |
| API-ACC-01 | GET | /v1/me | Profile, roles (buyer/seller), KYC status | | | L | | |
| API-ACC-02 | PATCH | /v1/me | Update profile | ✔ | ✔ | M | ✔ | |
| API-ACC-03 | POST | /v1/me/phone/change | Change phone (OTP to both numbers) | ✔ | | S | ✔ | ✔ |
| API-ACC-04 | GET | /v1/me/addresses | List addresses | | | L | | |
| API-ACC-05 | POST/PATCH/DELETE | /v1/me/addresses[/{id}] | Manage addresses | ✔ | ✔ | M | | |
| API-ACC-06 | POST | /v1/me/delete-request | Account deletion request (store requirement) | ✔ | | M | ✔ | ✔ |
| API-CART-01 | GET | /v1/cart | Cart with server pricing grouped by seller | | | L | | |
| API-CART-02 | POST | /v1/cart/items | Add item | ✔ | ✔ | M | | |
| API-CART-03 | PATCH | /v1/cart/items/{id} | Change quantity | ✔ | ✔ | M | | |
| API-CART-04 | DELETE | /v1/cart/items/{id} | Remove item | ✔ | ✔ | M | | |
| API-CART-05 | PUT | /v1/cart/shipping-address | Set governorate and address (re-prices shipping) | ✔ | ✔ | M | | |
| API-CHK-01 | POST | /v1/checkouts | Create checkout from the cart: reserve stock, freeze quote, split into seller groups | ✔ | ✔ | S | ✔ | |
| API-CHK-02 | GET | /v1/checkouts/{id} | Checkout summary and expiry | | | L | | |
| API-CHK-03 | POST | /v1/checkouts/{id}/cancel | Release reservations | ✔ | | M | ✔ | |
| API-PAY-01 | POST | /v1/payments/intents | Create a payment intent for a checkout or deal | ✔ | | S | ✔ | |
| API-PAY-02 | GET | /v1/payments/intents/{id} | Poll status (pending, verified, failed) | | | M | | |
| API-PAY-03 | GET | /v1/payments/methods | Available methods (sandbox only until D-11) | | | L | | |
| API-PAY-04 | POST | /v1/payments/intents/{id}/proof | Upload transfer proof (if manual methods are allowed by D-03) | ✔ | | S | ✔ | |
| API-ORD-01 | GET | /v1/orders | Buyer orders | | | L | | |
| API-ORD-02 | GET | /v1/orders/{id} | Order detail: PT state, `allowed_actions`, deadlines | | | L | | |
| API-ORD-03 | POST | /v1/orders/{id}/cancel | Cancel (only if allowed by state) | ✔ | ✔ | M | ✔ | |
| API-DEAL-01 | POST | /v1/deals | Create deal request (draft) | ✔ | | M | ✔ | |
| API-DEAL-02 | GET | /v1/deals | List my deals (buyer and seller views via `role=`) | | | L | | |
| API-DEAL-03 | GET | /v1/deals/{id} | Deal detail, `allowed_actions`, offers, agreement | | | L | | |
| API-DEAL-04 | PATCH | /v1/deals/{id} | Edit draft | ✔ | ✔ | M | ✔ | |
| API-DEAL-05 | POST | /v1/deals/{id}/submit | Submit and generate invitation | ✔ | ✔ | M | ✔ | |
| API-DEAL-07 | POST | /v1/deals/{id}/invitations | (Re)issue invitation link (invalidates the old one) | ✔ | ✔ | S | ✔ | |
| API-DEAL-08 | POST | /v1/invitations/{token}/accept | Seller (signed in) accepts the association | ✔ | | S | ✔ | |
| API-DEAL-09 | POST | /v1/deals/{id}/offers/{v}/accept | Accept the offer → frozen agreement | ✔ | ✔ | S | ✔ | |
| API-DEAL-10 | POST | /v1/deals/{id}/offers/{v}/request-changes | Request modification | ✔ | ✔ | M | ✔ | |
| API-DEAL-11 | POST | /v1/deals/{id}/reject | Reject or cancel before funding | ✔ | ✔ | M | ✔ | |
| API-DEAL-12 | GET | /v1/deals/{id}/agreement | Frozen agreement snapshot and hash (PDF optional) | | | L | ✔ | |
| API-PT-01 | GET | /v1/pt/{id} | Protected Transaction state, timeline, deadlines | | | L | | |
| API-PT-02 | GET | /v1/pt/{id}/shipment | Tracking and evidence thumbnails | | | L | | |
| API-PT-03 | POST | /v1/pt/{id}/delivery-otp/reveal | Buyer reveals the current OTP (rotates if already revealed, per policy) | ✔ | | S | ✔ | ✔ (biometric) |
| API-PT-04 | POST | /v1/pt/{id}/delivery-otp/reissue | Buyer re-issues an expired or locked OTP | ✔ | | S | ✔ | |
| API-PT-05 | POST | /v1/pt/{id}/confirm-receipt | Confirm receipt (triggers settlement path) | ✔ | ✔ | S | ✔ | |
| API-RET-01 | POST | /v1/pt/{id}/returns | Request a return | ✔ | ✔ | M | ✔ | |
| API-RET-02 | GET | /v1/returns/{id} | Return detail | | | L | | |
| API-RET-03 | POST | /v1/returns/{id}/ship | Buyer return-shipping evidence | ✔ | ✔ | M | ✔ | |
| API-RET-04 | POST | /v1/pt/{id}/replacements | Request a replacement | ✔ | ✔ | M | ✔ | |
| API-RET-05 | GET | /v1/replacements/{id} | Replacement detail | | | L | | |
| API-DSP-01 | POST | /v1/pt/{id}/disputes | Open a dispute (puts a hold on funds) | ✔ | ✔ | S | ✔ | |
| API-DSP-02 | GET | /v1/disputes/{id} | Dispute detail and deadlines | | | L | | |
| API-DSP-03 | POST | /v1/disputes/{id}/evidence | Add evidence (via API-UPL-01) | ✔ | | M | ✔ | |
| API-DSP-04 | POST | /v1/disputes/{id}/messages | Party message | ✔ | | M | ✔ | |
| API-DSP-05 | POST | /v1/disputes/{id}/withdraw | Opener withdraws | ✔ | ✔ | M | ✔ | |
| API-WAL-01 | GET | /v1/me/balances | Read-only projections (refunds due, held amounts) | | | L | | |
| API-WAL-02 | GET | /v1/me/transactions | User-facing transaction history (from ledger lines) | | | L | | |
| API-NTF-01 | GET | /v1/me/notifications | Inbox | | | L | | |
| API-NTF-02 | POST | /v1/me/notifications/read | Mark read | ✔ | | M | | |
| API-NTF-03 | PUT | /v1/me/push-tokens | Register FCM/APNs token | ✔ | | M | ✔ | |
| API-NTF-04 | DELETE | /v1/me/push-tokens/{id} | Unregister | ✔ | | M | | |
| API-NTF-05 | PUT | /v1/me/notification-preferences | Preferences | ✔ | ✔ | M | | |
| API-SUP-02 | POST | /v1/support/tickets | Create ticket (optionally linked to an order, deal or dispute) | ✔ | | M | ✔ | |
| API-SUP-03 | GET | /v1/support/tickets | My tickets | | | L | | |
| API-SUP-04 | GET | /v1/support/tickets/{id} | Ticket thread | | | L | | |
| API-SUP-05 | POST | /v1/support/tickets/{id}/messages | Reply | ✔ | | M | | |
| API-UPL-01 | POST | /v1/uploads | Get a signed upload URL (purpose-scoped: kyc, evidence, product_media) | ✔ | | M | ✔ | |
| API-SEL-01 | POST | /v1/seller/application | Apply to become a seller | ✔ | | M | ✔ | |
| API-SEL-02 | GET | /v1/seller/application | Application status | | | L | | |

> API-ACC-05 (one ID) covers three HTTP methods.

### 3.4 SELLER (38)

Requires an approved store membership, checked server-side per store.

| ID | Method | Route | Purpose | Idem | Ver | RL | Audit | Step-up |
|---|---|---|---|---|---|---|---|---|
| API-KYC-01 | POST | /v1/kyc/cases | Start KYC | ✔ | | M | ✔ | |
| API-KYC-02 | POST | /v1/kyc/cases/{id}/documents | Attach uploaded documents | ✔ | | M | ✔ | |
| API-KYC-03 | POST | /v1/kyc/cases/{id}/submit | Submit for review | ✔ | ✔ | M | ✔ | |
| API-KYC-04 | GET | /v1/kyc/cases/{id} | Status and rejection reasons (never document URLs after submit) | | | L | | |
| API-SEL-03 | GET | /v1/seller/stores/{id} | Store profile (private view) | | | L | | |
| API-SEL-04 | PATCH | /v1/seller/stores/{id} | Edit store profile | ✔ | ✔ | M | ✔ | |
| API-SEL-05 | POST/DELETE | /v1/seller/stores/{id}/members | Manage store staff (owner only) | ✔ | ✔ | M | ✔ | ✔ |
| API-SEL-06 | GET | /v1/seller/stores/{id}/dashboard | KPIs (server-computed) | | | L | | |
| API-SPR-01 | GET | /v1/seller/products | My products | | | L | | |
| API-SPR-02 | POST | /v1/seller/products | Create product (new or used, condition notes) | ✔ | | M | ✔ | |
| API-SPR-03 | GET | /v1/seller/products/{id} | Product (with moderation status) | | | L | | |
| API-SPR-04 | PATCH | /v1/seller/products/{id} | Edit (resubmits to moderation if material) | ✔ | ✔ | M | ✔ | |
| API-SPR-05 | POST | /v1/seller/products/{id}/publish | Publish or unpublish | ✔ | ✔ | M | ✔ | |
| API-SPR-06 | POST | /v1/seller/products/{id}/media | Attach media (via API-UPL-01) | ✔ | | M | | |
| API-SPR-07 | PUT | /v1/seller/products/{id}/inventory | Set stock | ✔ | ✔ | M | ✔ | |
| API-SHP-01 | GET | /v1/seller/stores/{id}/shipping-rates | Rates per governorate | | | L | | |
| API-SHP-02 | PUT | /v1/seller/stores/{id}/shipping-rates | Bulk set price and min/max days per governorate | ✔ | ✔ | M | ✔ | |
| API-SHP-03 | DELETE | /v1/seller/stores/{id}/shipping-rates/{gov} | Disable a governorate | ✔ | ✔ | M | ✔ | |
| API-SOR-01 | GET | /v1/seller/orders | Store orders | | | L | | |
| API-SOR-02 | GET | /v1/seller/orders/{id} | Order detail and `allowed_actions` | | | L | | |
| API-SOR-03 | POST | /v1/seller/orders/{id}/accept | Accept or acknowledge | ✔ | ✔ | M | ✔ | |
| API-SOR-04 | POST | /v1/seller/pt/{id}/ship | Mark shipped with evidence | ✔ | ✔ | M | ✔ | |
| API-SOR-05 | POST | /v1/seller/pt/{id}/out-for-delivery | Trigger OTP issue to the buyer | ✔ | ✔ | M | ✔ | |
| API-SOR-06 | POST | /v1/seller/pt/{id}/delivery-otp/verify | Enter the OTP from the buyer | ✔ | | S | ✔ | |
| API-SOR-07 | POST | /v1/seller/returns/{id}/respond | Accept or contest a return | ✔ | ✔ | M | ✔ | |
| API-SOR-08 | POST | /v1/seller/returns/{id}/received | Confirm the returned item was received | ✔ | ✔ | M | ✔ | |
| API-SOR-09 | POST | /v1/seller/replacements/{id}/ship | Ship replacement with evidence | ✔ | ✔ | M | ✔ | |
| API-SDEAL-01 | GET | /v1/seller/deals | Incoming deal requests | | | L | | |
| API-SDEAL-02 | POST | /v1/seller/deals/{id}/reject | Decline request | ✔ | ✔ | M | ✔ | |
| API-SDEAL-03 | POST | /v1/seller/deals/{id}/offers | Make an offer (v1) | ✔ | ✔ | M | ✔ | |
| API-SDEAL-04 | POST | /v1/seller/deals/{id}/offers/{v}/revise | Revised offer (v+1) | ✔ | ✔ | M | ✔ | |
| API-SDEAL-05 | POST | /v1/seller/deals/{id}/offers/{v}/withdraw | Withdraw a pending offer | ✔ | ✔ | M | ✔ | |
| API-SBAL-01 | GET | /v1/seller/balance | Available, pending and held amounts (projection) | | | L | | |
| API-SBAL-02 | GET | /v1/seller/balance/entries | Statement lines | | | L | | |
| API-SBAL-03 | GET/PUT | /v1/seller/payout-account | Payout account (masked; change → 24–72 h cooling-off, D-07) | ✔ | ✔ | S | ✔ | ✔ |
| API-SBAL-04 | POST | /v1/seller/withdrawals | Request withdrawal (server validates against the projection under lock) | ✔ | | S | ✔ | ✔ |
| API-SBAL-05 | GET | /v1/seller/withdrawals | Withdrawal list and status | | | L | | |
| API-SBAL-06 | POST | /v1/seller/withdrawals/{id}/cancel | Cancel while pending approval | ✔ | ✔ | M | ✔ | |

> KYC endpoints (API-KYC-01..04) are used by seller *applicants* before approval. Authorization is by applicant ownership, not store membership.

### 3.5 ADMIN (57)

These live on the `admin-api` host, use staff tokens and require mandatory MFA enrolled.

| ID | Method | Route | Purpose | Permission | Idem | Audit | Step-up | M/C |
|---|---|---|---|---|---|---|---|---|
| API-ADM-AUTH-01 | POST | /admin/v1/auth/login | Password + MFA challenge | — | ✔ | ✔ | | |
| API-ADM-AUTH-02 | POST | /admin/v1/auth/mfa/verify | TOTP / passkey verify → session | — | ✔ | ✔ | | |
| API-ADM-AUTH-03 | POST | /admin/v1/auth/mfa/enroll | First-login enrollment (mandatory) | self | ✔ | ✔ | | |
| API-ADM-AUTH-04 | POST | /admin/v1/auth/refresh | Rotate (short absolute session lifetime, e.g. 12 h) | self | | ✔ | | |
| API-ADM-AUTH-05 | POST | /admin/v1/auth/step-up | Fresh MFA → action-scoped token (≤ 5 min) | self | ✔ | ✔ | | |
| API-ADM-AUTH-06 | GET/DELETE | /admin/v1/me/sessions[/{id}] | Own sessions and devices, revoke | self | ✔ | ✔ | | |
| API-ADM-AUTH-07 | POST | /admin/v1/auth/logout | Logout | self | ✔ | ✔ | | |
| API-ADM-01 | GET | /admin/v1/dashboard | KPIs and queue counts | dashboard.read | | | | |
| API-ADM-02 | GET | /admin/v1/approvals?type= | Unified approval queue (KYC, seller, product, payout, adjustment…) | per type | | | | |
| API-ADM-03 | POST | /admin/v1/approvals/{id}/decide | Checker decision (approve or reject, binds to payload hash) | per type | ✔ | ✔ | ✔ | ✔ (checker ≠ maker) |
| API-ADM-USR-01 | GET | /admin/v1/users | Search users (masked PII) | users.read | | ✔ (search terms) | | |
| API-ADM-USR-02 | GET | /admin/v1/users/{id} | User 360 | users.read | | ✔ | | |
| API-ADM-USR-03 | POST | /admin/v1/users/{id}/suspend | Suspend or unsuspend | users.manage | ✔ | ✔ | ✔ | |
| API-ADM-USR-04 | POST | /admin/v1/users/{id}/sessions/revoke | Remote revoke | users.manage | ✔ | ✔ | ✔ | |
| API-ADM-USR-05 | POST | /admin/v1/users/{id}/reveal-pii | Unmask a field (reason required) | users.pii | ✔ | ✔ | ✔ | |
| API-ADM-KYC-01 | GET | /admin/v1/kyc/cases | KYC queue | kyc.review | | | | |
| API-ADM-KYC-02 | GET | /admin/v1/kyc/cases/{id} | Case detail | kyc.review | | ✔ | | |
| API-ADM-KYC-03 | POST | /admin/v1/kyc/cases/{id}/documents/{doc}/view-url | Signed view URL (≤ 5 min, watermarked) | kyc.review | | ✔ | ✔ | |
| API-ADM-KYC-04 | POST | /admin/v1/kyc/cases/{id}/decide | Approve, reject or request more info | kyc.review | ✔ | ✔ | ✔ | |
| API-ADM-SEL-01 | GET | /admin/v1/sellers | Seller list | sellers.read | | | | |
| API-ADM-SEL-02 | GET | /admin/v1/sellers/{id} | Seller 360 | sellers.read | | ✔ | | |
| API-ADM-SEL-03 | POST | /admin/v1/sellers/{id}/decide | Approve or reject application | sellers.review | ✔ | ✔ | ✔ | |
| API-ADM-SEL-04 | POST | /admin/v1/sellers/{id}/restrict | Suspend listings or payouts | sellers.manage | ✔ | ✔ | ✔ | |
| API-ADM-PRD-01 | GET | /admin/v1/moderation/products | Moderation queue | catalog.moderate | | | | |
| API-ADM-PRD-02 | POST | /admin/v1/moderation/products/{id}/decide | Approve, reject or request changes | catalog.moderate | ✔ | ✔ | | |
| API-ADM-PRD-03 | POST | /admin/v1/products/{id}/takedown | Emergency takedown | catalog.moderate | ✔ | ✔ | ✔ | |
| API-ADM-ORD-01 | GET | /admin/v1/orders | Orders search | orders.read | | | | |
| API-ADM-ORD-02 | GET | /admin/v1/orders/{id} | Order 360 (PT, payments, ledger refs, timeline) | orders.read | | ✔ | | |
| API-ADM-PT-01 | GET | /admin/v1/deals | Protected Deals search | deals.read | | | | |
| API-ADM-PT-02 | GET | /admin/v1/pt/{id} | Deal / PT 360 incl. delivery evidence (signed URLs) | deals.read | | ✔ | | |
| API-ADM-PT-03 | POST | /admin/v1/pt/{id}/hold | Place a hold (reason) | deals.intervene | ✔ | ✔ | ✔ | |
| API-ADM-PT-04 | POST | /admin/v1/pt/{id}/release-hold | Lift a hold | deals.intervene | ✔ | ✔ | ✔ | ✔ above threshold |
| API-ADM-PT-05 | POST | /admin/v1/pt/{id}/delivery-otp/force-reissue | Re-issue to the buyer (never reveals) | deals.intervene | ✔ | ✔ | ✔ | |
| API-ADM-DSP-01 | GET | /admin/v1/disputes | Dispute queue (SLA) | disputes.read | | | | |
| API-ADM-DSP-02 | GET | /admin/v1/disputes/{id} | Dispute 360 | disputes.read | | ✔ | | |
| API-ADM-DSP-03 | POST | /admin/v1/disputes/{id}/request-evidence | Request evidence (starts the 48 h clock) | disputes.handle | ✔ | ✔ | | |
| API-ADM-DSP-04 | POST | /admin/v1/disputes/{id}/propose-decision | Maker: refund, release or split (amounts server-validated ≤ held) | disputes.handle | ✔ | ✔ | ✔ | ✔ maker |
| API-ADM-DSP-05 | GET/POST | /admin/v1/returns, /admin/v1/replacements[/{id}/decide] | Returns and replacements queue and decisions | disputes.handle | ✔ | ✔ | ✔ | ✔ if refund |
| API-ADM-SUP-01..03 | GET/POST | /admin/v1/support/tickets[/{id}[/messages\|/assign\|/close]] | Support desk | support.* | ✔ | ✔ | | |
| API-ADM-NTF-01 | POST | /admin/v1/notifications/broadcast | Segment broadcast (template-only) | notifications.send | ✔ | ✔ | ✔ | ✔ |
| API-ADM-CMS-01..02 | GET/PUT | /admin/v1/content[/{slug}] | CMS pages and banners (versioned, sanitized) | content.edit | ✔ | ✔ | | |
| API-ADM-STF-01..05 | GET/POST/PATCH | /admin/v1/staff, /roles, /permissions, /staff/{id}/roles, /staff/{id}/disable | Staff, roles, permissions | staff.manage | ✔ | ✔ | ✔ | ✔ (role grants) |
| API-ADM-AUD-01..02 | GET | /admin/v1/audit-events[/{id}] | Audit trail search and verify hash chain | audit.read | | ✔ | | |
| API-ADM-RPT-01..02 | GET/POST | /admin/v1/reports[/{id}/export] | Reports; export is async, watermarked and audited | reports.read | ✔ | ✔ | ✔ (export) | |
| API-ADM-SET-01..03 | GET/POST | /admin/v1/settings[/{key}/propose] | Settings incl. `real_money_enabled`, limits, timeouts | settings.manage | ✔ | ✔ | ✔ | ✔ (2 distinct super-admins for real money) |
| API-ADM-SYS-01 | GET | /admin/v1/system/health | Deep health (DB, queue lag, PSP, outbox, recon status) | ops.read | | | | |

> Row ranges (`..02`, `..03`, `..05`) count as individual endpoint IDs.

### 3.6 FINANCE (18)

Staff with `finance.*` permissions. Every write posts **only** through the ledger service.

| ID | Method | Route | Purpose | Idem | Audit | Step-up | M/C |
|---|---|---|---|---|---|---|---|
| API-FIN-01 | GET | /admin/v1/finance/payments | Payment intents and attempts, verification queue | | | | |
| API-FIN-02 | POST | /admin/v1/finance/payments/{id}/verify | Maker: mark manual or unknown payment as verified | ✔ | ✔ | ✔ | ✔ maker |
| API-FIN-03 | POST | /admin/v1/finance/payments/{id}/reject | Reject proof, return to awaiting payment | ✔ | ✔ | ✔ | |
| API-FIN-04 | GET | /admin/v1/finance/overview | Held, payable, revenue, in-transit, suspense, recon status | | | | |
| API-FIN-05 | GET | /admin/v1/finance/accounts | Chart of accounts and balances | | | | |
| API-FIN-06 | GET | /admin/v1/finance/journals | Ledger explorer (filters: account, PT, date, posting_key) | | ✔ | | |
| API-FIN-07 | GET | /admin/v1/finance/journals/{id} | Journal detail, reversal links, source event | | ✔ | | |
| API-FIN-08 | GET | /admin/v1/finance/settlements | Settlement queue and batches | | | | |
| API-FIN-09 | POST | /admin/v1/finance/settlements/batches | Maker: propose batch (above auto-threshold) | ✔ | ✔ | ✔ | ✔ maker |
| API-FIN-10 | GET | /admin/v1/finance/settlements/batches/{id} | Batch detail | | | | |
| API-FIN-11 | GET | /admin/v1/finance/withdrawals | Withdrawal queue | | | | |
| API-FIN-12 | POST | /admin/v1/finance/withdrawals/{id}/propose | Maker: approve for payout | ✔ | ✔ | ✔ | ✔ maker |
| API-FIN-13 | POST | /admin/v1/finance/payouts/{id}/confirm | Record bank confirmation (posts in-transit → bank) | ✔ | ✔ | ✔ | ✔ |
| API-FIN-14 | POST | /admin/v1/finance/recon/statements | Upload PSP or bank statement (immutable) | ✔ | ✔ | ✔ | |
| API-FIN-15 | GET | /admin/v1/finance/recon/runs[/{id}] | Recon runs, matches, breaks | | | | |
| API-FIN-16 | POST | /admin/v1/finance/recon/breaks/{id}/resolve | Maker: resolve with a compensating journal | ✔ | ✔ | ✔ | ✔ |
| API-FIN-17 | GET/POST | /admin/v1/finance/fee-schedules[/propose] | Effective-dated fee schedule (never retroactive) | ✔ | ✔ | ✔ | ✔ |
| API-FIN-18 | POST | /admin/v1/finance/adjustments | Chargebacks and manual adjustments (reversal or compensating journal only) | ✔ | ✔ | ✔ | ✔ |

Checker decisions for API-FIN-02, 09, 12, 16, 17 and 18 all go through **API-ADM-03**. The approval binds to the payload hash, and the DB enforces `checker_id <> maker_id`.

### 3.7 INTERNAL (6)

| ID | Method | Route / mechanism | Purpose | Security |
|---|---|---|---|---|
| API-INT-01 | POST | /internal/psp/{provider}/webhook | PSP payment events | Signature verification, timestamp tolerance, dedup by provider event ID, raw body stored. Never trusts the amount without the provider API re-fetch |
| API-INT-02 | job | deadline-scheduler | Expire invitations, offers and payments; ship-by; auto-confirm receipt; dispute clocks | Idempotent transitions, row locks |
| API-INT-03 | job | settlement-runner | Auto-settle below the threshold when invariant I-7 holds | Posting key per PT |
| API-INT-04 | job | outbox-dispatcher | Push, SMS and e-mail fan-out | Exactly-once per outbox ID |
| API-INT-05 | job | recon-importer / matcher | Daily three-way match | Pauses payouts on aged breaks |
| API-INT-06 | job | projection-verifier | Recompute balances from lines and alert on drift | Read-only |

---

## 4. Counts

| Class | Missing endpoints |
|---|---|
| PUBLIC | 18 |
| CUSTOMER | 67 |
| SELLER | 38 |
| ADMIN | 57 |
| FINANCE | 18 |
| INTERNAL | 6 |
| **Total** | **204** endpoint IDs (211 method-level operations where one ID covers several HTTP methods) |

| Existing | Count |
|---|---|
| Existing endpoints | 3 |
| Usable unchanged | 0 |
| Need modification | 1 |
| Unsafe / retire | 2 |
