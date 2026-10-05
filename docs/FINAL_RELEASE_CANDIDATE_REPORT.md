# EDMN Marketplace — Final Release Candidate Report

Date: 2026-10-05 · Branch: `claude/great-tesla-nor0wt` · Deployed commit: `b685068` (Vercel production
deployment of the staging project).

**Verdict: FINAL RELEASE CANDIDATE — READY (staging / pilot).**
**Real money: DISABLED.**

- It cannot be enabled on staging.
- In production it needs an explicit admin switch, step-up 2FA, and a verified non-test payment
  destination.
- No legacy system, legacy database or DNS was touched.

## W. Deployed staging URLs

| Surface | URL | Production target (later, needs owner approval) |
|---|---|---|
| Customer Marketplace | https://edmn-staging.vercel.app/ | `www.edmneg.com` |
| Seller Center | https://edmn-staging.vercel.app/seller/login | `seller.edmneg.com` |
| Admin / Operations & Control Center | https://edmn-staging.vercel.app/admin/login | `admin.edmneg.com` |

**Domain mapping.** Production turns on `ENFORCE_HOSTS=true` with `SELLER_HOST` and `ADMIN_HOST`.

- `src/proxy.ts` rewrites `seller.*/x` to `/seller/x` and `admin.*/x` to `/admin/x`.
- It redirects `/seller` and `/admin` paths away from the customer host.
- Seller/admin links to marketplace pages use `marketHref()`, so they resolve to `APP_URL`.
- Session cookies are host-only, so each surface has its own session.
- No business logic changes are needed.

## A. Customer Marketplace

**READY.** The marketplace includes:

- homepage, search (typo-tolerant Arabic), categories, product pages
- seller stores, cart, checkout, orders, returns
- wishlist, reviews, notifications, account
- external protected deals

The customer header shows no seller or admin navigation. It has only a "بع على اضمن" marketing link.

**Homepage.** The default hierarchy is:

1. Hero
2. Top categories
3. Deals
4. Recommended
5. Best sellers
6. Used
7. Verified stores
8. External-deal CTA
9. Why EDMN
10. How we protect purchases
11. Footer

Product rails are **de-duplicated**: each product appears once per page.

**Product page.** Changes in this pass:

- a prominent **«منتج مستعمل USED»** banner for used items
- a full condition disclosure: grade, description, defects, accessories, usage, **warranty**, and the number of actual-item photos
- the "verified seller" line
- softened protection wording
- a clean empty-reviews state

## B. Seller Center

**READY.**

- **Entry pages.** A dedicated **`/seller/login`** and **`/seller/register`** shell labelled
  "EDMN Seller Center / مركز بائعي اضمن". It has no customer header, cart or admin navigation.
- **Self-service registration.** Anyone can register as Individual or Business, with no
  admin-created accounts.
- **Contact verification** is inside onboarding.
- **Navigation:**
  Dashboard · Products · Add Product · Inventory · Orders · Shipping · Returns · Reviews · Finance ·
  Balance · Withdrawals · Analytics · Store · Account Health · Support · Settings.
- **Bug fixed:** the Seller Center product list crashed with SQL "column reference id is ambiguous".
  It is now fixed and covered by E2E.

## C. Admin Control Center

**READY.** It is a separate shell, branded "EDMN Operations & Control Center". It has a dedicated
login, 2FA, step-up re-authentication, and rate limiting.

| Group | Pages |
|---|---|
| القيادة | Executive Dashboard |
| العملاء | Users & User 360° |
| السوق | Sellers, Seller Verification, Products, Product Moderation, Categories, Brands, Attributes, Inventory, Prohibited products, Orders, Shipping Evidence, Returns, Reviews |
| الصفقات المحمية | External Deals, Disputes |
| المالية | Manual Payment Verification, **Transactions** (new), Seller Balances, Withdrawals, **Settlements** (new), Refunds/payables, Commissions, Financial Ledger |
| العمليات | **Approval Center** (new), Notifications, Support, Reports |
| المخاطر والأمان | Audit Trail, **Risk Flags** (new, rule-based, read-only) |
| المحتوى | Homepage CMS, Banners, Featured Categories, Featured Products, Featured Sellers, Static Pages (CMS filtered by block type) |
| النظام | Admins, Roles & Permissions, Payment Methods, Legal Texts, Settings |

No existing admin functionality was removed.

## D. Surface separation

**DONE.** Each of the three surfaces has its own:

- layout
- navigation
- authentication entry point
- visual shell
- server-side authorization boundary (`requireSellerActor` / `requireAdmin` + RBAC)

## E. Real seller onboarding

**READY.** The flow is:

1. Register
2. Verify phone (and optionally e-mail)
3. Choose Individual / Business
4. Legal data (national ID encrypted)
5. Business data
6. Store and return address
7. Documents (private)
8. Payout method (encrypted, masked)
9. Accept the Seller Agreement
10. Submit, then wait for the admin decision (approve / more info / reject)

A phone verified after the application starts now also marks the application's mobile as verified.
Step-by-step script: `docs/REAL_SELLER_PILOT_TEST.md`.

## F–O. Business flows (unchanged logic, re-verified)

| Area | Status | Evidence |
|---|---|---|
| F. Product moderation | ✅ | Submitted, not public, admin approves, LIVE (E2E) |
| G. Orders | ✅ | Multi-seller split, idempotent checkout, last-unit race (integration + E2E) |
| H. Payments | ✅ | Manual proof never marks paid; admin confirmation required. New: `isTest` snapshot and TEST labels |
| I. Shipping | ✅ | Waybill required before SHIPPED; waybill ≠ balance available (E2E) |
| J. Returns / disputes | ✅ | Integration suite; holds block release |
| K. External deals | ✅ | Full E2E flow on the public URL |
| L. Commission | ✅ | Snapshot per order item, preserved (integration) |
| M. Ledger | ✅ | Double-entry, append-only triggers; reconciliation below |
| N. Seller balance | ✅ | PENDING → AVAILABLE only on buyer receipt confirmation, exactly once (E2E + integration) |
| O. Withdrawal | ✅ | Reserve on request, no overspend, maker/checker, PAID. New: TEST snapshot and labels |

### Ledger reconciliation (staging, after the public E2E run; read-only query)

| Check | Result |
|---|---|
| Journal entries | 26 |
| Debits | 199,704.00 EGP |
| Credits | 199,704.00 EGP |
| **Difference** | **0** |
| Unbalanced entries | 0 |
| Account projection drift | 0 |

## P. Security

| Check | Result |
|---|---|
| Authentication, RBAC, admin 2FA, step-up, rate limits, seller and customer isolation, idempotency, concurrency | ✅ existing integration + E2E suites |
| Security headers on the public URL (HSTS, CSP, X-Frame-Options DENY, nosniff) | ✅ |
| `/.env`, `/.git/config` | ✅ 404 |
| Source maps | ✅ none |
| `/api/cron/tick` without a token | ✅ 404 |
| Session cookie | ✅ `Secure`, `HttpOnly`, `SameSite=Lax` |
| Client bundles | ✅ contain none of the staging secrets, CRON secret or DB host |
| Git history | ✅ contains none of the staging secrets |
| Repository default credentials (`Demo@12345`, `Admin@Edmn#2026`, demo TOTP secret) | ✅ treated as **compromised**: staging refuses to seed with them, and the default admin password is rejected on the public URL |
| **Real-money guard** | ✅ `payments.realMoneyEnabled` defaults to off. It cannot be enabled on staging, and needs a verified non-test destination plus step-up. Tested in `tests/integration/pilot-safety.test.ts` |

## Q. Privacy

All of these are explicit IDOR tests in `tests/integration/privacy-idor.test.ts`, plus E2E:

- **Seller identity documents.** Only the owner and staff with `sellers.documents.view` can open
  them. Seller B, customers, support staff and anonymous users cannot. Admin viewing is audited.
- **Payment proofs.** Only the payer and payments staff can open them. The seller and other
  customers cannot.
- **Waybills.** Only the buyer, the shipping seller and shipping staff can open them. Other sellers
  and customers cannot.
- **Orders.** They are not readable by other customers or other sellers.
- **Encryption.** The national ID and payout details are encrypted at rest. Only the last 4 digits
  and a masked label are kept in clear.
- **Logs.** The logger redacts sensitive keys.

## R. Responsive

✅ `tests/e2e/responsive-a11y.spec.ts` checks **22 pages across the three surfaces** at
**360 / 375 / 390 / 430 / 768 / 1024 / 1440 px**, with **no horizontal scrolling**. It passes on the
public URL.

- Admin and seller tables become labelled cards below 768 px instead of squeezed tables.

## S. Accessibility

✅ axe-core WCAG 2 A/AA: **0 serious or critical violations** on the same 22 pages at 390 and
1440 px. Fixed in this pass:

- contrast: used/actual-photo badges, admin navigation headings, red error text, logo placeholder
- missing select labels
- `aria-label` on a role-less span (now `role="img"`)
- keyboard-focusable scrollable stepper

## T. Test results

| Suite | Result |
|---|---|
| `npm run lint` | ✅ |
| `npm run typecheck` | ✅ |
| Unit + integration (`npm test`) | ✅ **91 / 91**, including the new pilot-safety and privacy/IDOR suites |
| Production build (`next build`) | ✅ (local E2E build and Vercel build) |
| E2E local | ✅ **27 / 27** |
| **E2E on the public staging URL** | ✅ **27 / 27** (10.2 min) |

The public E2E run covered:

- the full seller self-registration → payout flow, with the seller registering via `/seller/register`
- the external protected deal flow
- security and authorization
- storefront
- mobile layouts
- responsive + accessibility

## U. Remaining external blockers

| Blocker | Impact on staging |
|---|---|
| SMS provider | OTPs are not delivered; the admin reads them from the outbox |
| SMTP provider | E-mail is not delivered |
| Official company payment destinations | Admin enters them later without code changes |
| Official logo file | The slot is ready (`NEXT_PUBLIC_LOGO_URL`) |
| Counsel-approved legal texts | See `docs/LEGAL_WORDING_REVIEW.md` |
| Production domain / DNS decision | — |

## V. Production blockers

- All external items in U.
- Real money must stay disabled until counsel approves the payment-protection model and real
  destinations are verified.
- Production hosting with object storage and a long-running worker. Vercel Hobby is non-commercial,
  and its daily cron is a staging fallback only.
- Point-in-time recovery and backups.
- Separate production project with `EDMN_ENVIRONMENT` and `SEED_DEMO` unset.
- `ENFORCE_HOSTS=true` on the three domains.

## Known staging data notes (not code issues)

The staging database was **not** wiped. Dropping it was not permitted in this session, so these
staging rows predate this release:

- **Homepage layout.** It still uses the earlier default block order. The new order applies to
  fresh databases. An admin can reorder the blocks in **Content → Homepage CMS**.
- **Demo payment destinations.** The three destinations from the first staging seed contain clearly
  fake placeholders (`0000000000`, `010XXXXXXXX (DEMO)`). They are flagged TEST and every buyer sees
  **TEST PAYMENT DESTINATION — NOT FOR REAL MONEY**. Fresh seeds contain no numbers at all. An admin
  can edit them in **System → Payment Methods**.
- **Test fixtures.** Products created by automated tests are **archived**, and their sellers are
  **suspended** after every run. 0 test listings are public. Financial history is kept.

If the owner approves a staging database reset, the next deploy seeds everything fresh.

## Documents

- `docs/REAL_SELLER_PILOT_TEST.md` — owner's manual pilot script with the expected status at each
  step
- `docs/LEGAL_WORDING_REVIEW.md` — wording requiring counsel approval
- `docs/STAGING_DEPLOYMENT_REPORT.md`, `docs/ENVIRONMENT.md`, `docs/DEPLOYMENT.md`
