# EDMN Mobile — handover (design system + buyer phase)

Repository `hodaharraz1/edmn-eg`, branch `claude/edmn-mobile-integration` (Vercel auto-deploy disabled for this
branch in `vercel.json`; CI runs only on pull requests / manual dispatch). Nothing was deployed, no production or
staging database was touched, Real Money stays OFF, no secrets/certificates were created, nothing was uploaded to
TestFlight or a store.

## What exists now

* `packages/edmn_design` — the locked design system (tokens, Cairo font, original-logo assets, 30+ components with
  their states). See DESIGN_SYSTEM.md.
* `apps/customer_mobile` — ONE app for buyer and (next) seller. Buyer journey complete against the real API:
  onboarding, sign in/up, verification, password reset, home, categories, search, product, public store page,
  multi-seller cart, 4-step checkout, order tracking, manual payment with receipt upload, orders, reorder, account,
  addresses, security, devices, language AR/EN, legal. See SCREEN_INVENTORY.md.
* Backend additions (additive, tested): buyer routes (previous commit), order list thumbnails/item count, order item
  variant + slug, `storeSlug` product filter; generator fix (optional fields omitted when unset).
* Evidence: tests in QA_REPORT.md; real screenshots in `docs/mobile/screenshots/buyer/`; board comparisons in
  `docs/mobile/screenshots/compare/`; deviations in VISUAL_AUDIT.md.

## Builds

| Target | Status |
|---|---|
| Android | `flutter build apk --debug` **FAILED for an environment reason**: Maven Central rate-limits this container (HTTP 429 earlier; now 404 with `retry-after: 1131` for `kotlin-stdlib-jdk8:1.8.0`). Not a code error. Retry: `cd apps/customer_mobile && flutter build apk --debug` (or on any machine with normal Maven access). A release APK/AAB needs a signing key — requires your approval. |
| iOS | NOT RUN — needs macOS + Xcode + CocoaPods. Share the Mac folder (Claude desktop app → Settings → Claude Code → Remote Control), then: `cd apps/customer_mobile && flutter pub get && cd ios && pod install && cd .. && flutter build ios --no-codesign --dart-define=EDMN_ENV=local`. Signing / TestFlight need your approval. |
| Web (evidence only) | Built from a temporary copy outside the repo (no `web/` platform is committed). |

## Remaining work, by priority

**P0 — needed before the app can be called complete**
1. **Seller center (same app, role-gated)** — mobile API over existing seller services: onboarding/approval status,
   store settings, products (create/edit, images, variants, stock, price, new/used, return policy), shipping rates
   by governorate, seller orders with state-machine actions, shipment + proof upload, returns/disputes. Then the
   screens (board "مركز البائع" + Figma). Role switch buyer ⇄ seller from the profile's seller membership.
2. **Seller finance** — balances, holds, debts/uncovered claims (never as withdrawable), withdrawals incl.
   `TRANSFER_UNCERTAIN` (never resent, never shown as failed/succeeded), ledger history. Every route using
   `sellerFundsPosition` behind `finance.view` + store scope. Maker/Checker stays on the admin side.
3. **Protected Deal** — create (role, counterparty, details, terms, review), invitation accept/reject/modify,
   payment instructions + receipt, evidence, delivery OTP (expiry, attempts, single use preserved), confirm/dispute,
   completion/release status. Clarify V-10 (board shows a flash-sale style screen).
4. **Disputes / returns** — list, detail, replies, evidence upload, refund tracking.

**P1**
5. Customer wallet (if the business keeps a buyer wallet; V-09/V-16), notifications (in-app list + push tokens),
   support tickets/FAQ, deep links.
6. Android APK/AAB and iOS builds (environment), physical-device QA (small/large phones, large fonts, slow network).
7. Per-page mapping of the 87-page Figma PDF once it is provided (not available in this session).

**P2**
8. Owner decisions in VISUAL_AUDIT V-01…V-15 (logo lockup, illustrations, wishlist, social login, coupons, COD/card).
9. HawkScan DAST once `HAWK_API_KEY` is configured through the environment's secure settings.

## Resume steps

```bash
git fetch origin && git checkout claude/edmn-mobile-integration
npm ci
# local Postgres for tests (see tests/helpers/setup-env.ts); then:
TEST_DATABASE_URL=postgresql://edmn:edmn@127.0.0.1:55432/edmn_test npx vitest run
npx tsc --noEmit && npx eslint . && npx tsx scripts/openapi.ts --check
# after changing API routes:
npx tsx scripts/openapi.ts && npx tsx scripts/generate-dart-api.ts
# Flutter (3.47+):
for d in packages/edmn_core packages/edmn_api packages/edmn_design apps/customer_mobile apps/admin_mobile; do (cd $d && flutter analyze && flutter test); done
```
