# System B — New EDMN Marketplace: Inventory

Repository `hodaharraz1/edmn-eg`, branch `claude/great-tesla-nor0wt` (inspected at the commit that
contains this file). Deeper detail lives in `docs/ARCHITECTURE.md`, `DATABASE.md`,
`STATE_MACHINES.md`, `SECURITY.md`, `FINANCIAL_LEDGER.md`, `API_CONTRACTS.md`.

**Deployment status:** not deployed anywhere; **holds no production data**. Only development/demo
seed data exists locally. This matters: any integration moves *legacy* data into or alongside B,
never the reverse.

## 1. Technology

| Concern | Implementation |
|---|---|
| Language / runtime | TypeScript (strict), Node.js 22 |
| Framework | Next.js 16.3 App Router, React 19, Server Components, **Server Actions** (no public REST API) |
| UI | Tailwind CSS v4, IBM Plex Sans Arabic, RTL-first; 110 pages |
| Database | PostgreSQL 16 + Drizzle ORM 0.45; 79 tables; 3 SQL migrations (`drizzle/0000…0002`) |
| Jobs | PostgreSQL `jobs` table + `npm run worker` (`SKIP LOCKED`), 7 scheduled tasks |
| Storage | `StorageDriver` interface, local-disk driver; `public/` and `private/` roots |
| Notifications | in-app + email/SMS outbox (`log`/SMTP, `log`/generic HTTP SMS) |
| Tests | Vitest unit+integration (79), Playwright E2E (26) |
| Deployment | Not deployed. Designed for `next start` + worker + PostgreSQL behind TLS proxy; hosts `edmneg.com`, `seller.edmneg.com`, `admin.edmneg.com` |

## 2. Surfaces and routes (by domain)

Pages are listed by path (route groups removed). Write operations are Server Actions in
`src/app/_actions/*` (103 exported actions) that call domain services in `src/server/modules/*`.

| Domain | Customer storefront / account | Seller Center | Admin |
|---|---|---|---|
| AUTH | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/account/security` | (shares customer login) | `/admin/login`, `/admin/2fa`, `/admin/step-up` |
| USERS | `/account`, `/account/profile`, `/account/addresses` | `/seller/settings` (staff) | `/admin/customers`, `/admin/customers/[id]` (Customer 360) |
| SELLERS / KYB | `/sell` | `/seller/onboarding`, `/seller/store`, `/seller/health` | `/admin/seller-verification`, `/admin/sellers`, `/admin/sellers/[id]` |
| MARKETPLACE / PRODUCTS | `/`, `/categories`, `/category/[slug]`, `/brand/[slug]`, `/search`, `/deals`, `/best-sellers`, `/stores`, `/store/[slug]`, `/product/[slug]`, `/account/wishlist` | `/seller/products`, `/seller/products/new`, `/seller/products/[id]` | `/admin/products`, `/admin/products/[id]`, `/admin/moderation`, `/admin/categories`, `/admin/brands`, `/admin/attributes`, `/admin/policy` |
| INVENTORY | — | `/seller/inventory` | `/admin/inventory` |
| ORDERS | `/cart`, `/checkout`, `/account/orders`, `/account/orders/[id]` | `/seller/orders`, `/seller/orders/[id]` | `/admin/orders`, `/admin/orders/[id]` |
| PAYMENTS | `/account/orders/[id]/pay`, `/account/payments` | — | `/admin/payments`, `/admin/payments/[id]`, `/admin/payment-settings` |
| SHIPPING | (order tracking on order page) | `/seller/shipping`, order page shipment form | `/admin/shipping` |
| RETURNS / REFUNDS | `/account/returns`, `/new`, `/[id]` | `/seller/returns`, `/[id]` | `/admin/returns`, `/[id]`, `/admin/refunds` |
| DISPUTES | `/account/disputes`, `/new`, `/[id]` | (respond on order page) | `/admin/disputes`, `/[id]` |
| EXTERNAL DEALS | `/protected-deal`, `/account/deals`, `/new`, `/[id]`, `/deal-invite/[token]` | — | `/admin/deals`, `/[id]` |
| REVIEWS | `/account/reviews`, PDP | `/seller/reviews` | `/admin/reviews` |
| SELLER FINANCE | — | `/seller/finance`, `/seller/balance`, `/seller/withdrawals`, `/seller/analytics` | `/admin/balances`, `/admin/withdrawals`, `/[id]`, `/admin/commissions` |
| LEDGER / RECONCILIATION | — | statement inside `/seller/finance` | `/admin/ledger` (journal, trial balance, drift, adjustments) |
| SUPPORT | `/account/support`, `/new`, `/[id]` | `/seller/support` | `/admin/support`, `/[id]` |
| NOTIFICATIONS | `/account/notifications` | (header bell) | `/admin/notifications` (templates, outbox) |
| CMS / LEGAL | `/legal`, `/legal/[slug]`, `/pages/[slug]` | — | `/admin/cms`, `/admin/legal` |
| ADMINS / ROLES / PERMISSIONS | — | seller staff in `/seller/settings` | `/admin/roles` |
| AUDIT | — | — | `/admin/audit` |
| SETTINGS | — | `/seller/settings` | `/admin/settings` |
| REPORTS | — | `/seller/analytics` | `/admin` dashboard, `/admin/reports` (+ CSV export) |

HTTP route handlers: `/api/health`, `/api/ready`, `/api/files/[id]` (authorized private files),
`/api/admin/export` (CSV), `/api/products/cards`, `/media/[...key]` (public media).

**There is no REST/JSON API for a mobile app.** System B cannot serve the existing mobile app.

## 3. Data model (79 tables)

| Context | Tables |
|---|---|
| Identity & platform | users, sessions, auth_tokens, rate_limits, roles, role_permissions, user_roles, governorates, addresses, audit_logs, status_history, system_settings, idempotency_keys |
| Files | files |
| Sellers | sellers, seller_members, seller_documents, seller_payout_methods, stores, seller_shipping_rates, risk_flags |
| Catalog | categories, brands, attributes, attribute_options, category_attributes, products, product_variants, product_images, product_attribute_values, product_revisions, product_moderation_events, listing_policy_rules, inventory_reservations, inventory_movements, wishlist_items |
| Commerce | carts, cart_items, commission_rules, orders, seller_orders, order_items, payment_methods, payment_destinations, payments, payment_submissions, shipments, shipment_documents, tracking_events, refunds |
| External deals | external_deals, deal_invitations, deal_evidence, deal_payouts |
| Post-purchase | returns, return_items, return_evidence, disputes, dispute_messages, dispute_evidence, product_reviews, seller_reviews, review_reports |
| Finance | ledger_accounts, journal_entries, journal_lines, settlements, withdrawal_requests, ledger_adjustments |
| Operations | notifications, outbound_messages, notification_templates, jobs, support_tickets, support_messages, cms_blocks, cms_pages, legal_documents, legal_acceptances |

Identifiers: `uuid` PKs; human numbers from sequences `order_number_seq` (orders, start 100000) and
`doc_number_seq` (payments, deals, withdrawals, settlements, adjustments, tickets, returns,
disputes, refunds — start 500000). `users.email` and `users.phone` (E.164 `+20…`) are each unique.

## 4. Identity, authentication, authorization

- One `users` table for customers, sellers (via `sellers.owner_user_id` / `seller_members`) and
  staff (`is_staff = true`).
- Passwords: **scrypt** (`N=32768`), format includes parameters and salt.
- Sessions: DB-backed, SHA-256 token ids; cookies `edmn_sid` (scope WEB) and `edmn_admin_sid`
  (scope ADMIN). No JWT, no mobile tokens.
- Admin: mandatory TOTP (single-use), step-up (10 min) for high-risk actions.
- RBAC: **43 staff permissions** (`dashboard.view` … `settings.manage`), 9 default staff roles
  (SUPER_ADMIN, OPERATIONS_MANAGER, SELLER_REVIEWER, CATALOG_REVIEWER, PAYMENT_REVIEWER,
  FINANCE_OPERATOR, FINANCE_CHECKER, DISPUTE_OFFICER, CUSTOMER_SUPPORT); **11 seller permissions**
  (store.manage, products.manage, inventory.manage, orders.manage, returns.manage, reviews.respond,
  support.use, finance.view, finance.withdraw, payout.manage, staff.manage) in 6 seller roles.

## 5. Financial logic

- Integer piasters, bps rates; double-entry ledger with 11 account codes and 12 posting types,
  DB-enforced balance and immutability, idempotency keys, row locks (see `FINANCIAL_LEDGER.md`).
- Money-in: **manual** bank transfer / InstaPay / Vodafone Cash verified by staff (orders and deals).
- Seller balances: pending → available on **buyer receipt**; reserved for withdrawals.
- Seller withdrawals: on request + scheduled settlement; checker/operator; 48 business-hour SLA.
- Commissions: versioned per category (benchmark seed values); deal protection fee setting
  `deals.feeBps` defaults to **0**.
- **No customer wallet, no top-ups, no customer withdrawals** — refunds are liabilities paid out by
  finance with a reference.

## 6. KYC / KYB

Seller onboarding only: national ID (encrypted, last-4 shown), ID front/back images, commercial
registration and tax card for businesses, payout method, agreement acceptance; admin decision.
**No customer KYC.** External-deal sellers are ordinary users (no KYC) with encrypted payout details.

## 7. Files

`files` table + storage keys; purposes: PRODUCT_IMAGE, STORE_LOGO, STORE_BANNER, CATEGORY_IMAGE,
BRAND_LOGO, CMS_IMAGE, REVIEW_PHOTO (public) and SELLER_DOCUMENT, PAYMENT_PROOF, SHIPPING_WAYBILL,
RETURN_EVIDENCE, DISPUTE_EVIDENCE, DEAL_EVIDENCE, WITHDRAWAL_PROOF, etc. (private, authorized
streaming via `/api/files/[id]`).

## 8. Jobs / schedules

outbound.flush (1 min), orders.expire_overdue (5 min), orders.flag_unconfirmed, orders.complete_delivered,
deals.flag_unconfirmed, settlement.scheduled (hourly), rate_limits.prune (6 h).

## 9. Integrations / environment dependencies

PostgreSQL; optional SMTP; optional HTTP SMS; no payment gateway; no courier API; no analytics; no
push notifications. Env vars listed in `docs/ENVIRONMENT.md`.

## 10. Self-audit notes relevant to integration (System B gaps)

| Gap | Impact on integration |
|---|---|
| No JSON API / token auth for mobile clients | Legacy mobile app cannot be pointed at B; legacy APIs must stay up |
| No customer wallet / top-up / customer withdrawal domain | Legacy wallet features would be lost if B replaced A |
| No customer KYC | Legacy KYC records have no home in B |
| External deals are buyer-initiated only, fee default 0% | Legacy guarantee flows (both parties in-app; 5%/3% fees per marketing) are not equivalent |
| Single scrypt hash format | Legacy hashes (algorithm unknown) need algorithm-tagged verification + rehash-on-login |
| No push notification channel | Legacy app notifications (if push) have no equivalent |
| Not deployed; English UI not translated | Operational readiness, not data risk |
