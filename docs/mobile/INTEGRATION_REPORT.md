# Unified integration build

Branch: `claude/mobile-unified-integration`, built from `claude/edmn-mobile-integration` at `3728827`. It is a
temporary integration branch for review: it is **not** merged into `main`, and nothing is deployed.

## What was merged

| Source | Head | Merge commit | What it brings |
|---|---|---|---|
| `claude/edmn-mobile-integration` (base) | `3728827` | — | Phases 0–5 (buyer, seller, Protected Deal, messaging & support, wallet, returns / disputes / reviews) |
| `codex/mobile-audit-fixes` (PR #1) | `8ce27af` | `39c5cb6` | Codex audit fixes: wallet, messaging, deals, seller statement totals, file access, CI mobile job, secret-scan fixtures |
| `claude/mobile-phase6-notifications` (PR #2) | `2d95d4e` | `15aaa91` | Phase 6: notification center (C27, C28), password reset (B08) |

Phase 5 was verified present in the base before merging (`540d860` and `3728827` are ancestors; all Phase 5 modules,
routes, mounts, screens and tests are present). Nothing is left out: every commit of the three branches is reachable
from the unified head, and no file of any branch is missing.

## Conflicts and how they were resolved

| File | Cause | Resolution |
|---|---|---|
| `packages/edmn_design/lib/l10n/app_ar.arb`, `app_en.arb` | Both sides added keys | Union of keys. No key was changed differently on both sides. Integration added `disputeClaimHint`; Codex added `previousPage`, `downloadPdf`, `activityMoneyModeUnknown`, `payoutNetAmount`; Phase 6 added 29 keys. |
| `packages/edmn_design/lib/src/l10n/*.dart` | Generated from the ARB files | Regenerated with `flutter gen-l10n` from the merged ARB files |
| `packages/edmn_api/lib/src/generated/mobile_api.dart`, `openapi/mobile.v1.json` | Generated from the route definitions | Regenerated with `scripts/openapi.ts` and `scripts/generate-dart-api.ts`; both `--check` modes pass |

No hand-written file conflicted.
- **Codex's code is unchanged.** Every hand-written Codex file in the unified branch is byte-identical to Codex's
  version, except three files that Phase 6 also changed:
  - `router.dart`
  - `customer_app_test.dart`
  - `mobile_client.dart`
- **Only intended removals in those three files.** Compared with Codex's version they contain only additions. The
  single intended replacements are the `/notifications` "not available yet" placeholder route and its widget test,
  which Phase 6 replaced with the real screen.

## Tests on the unified branch

| Check | Result |
|---|---|
| `npm run lint` (ESLint) | pass |
| `npm run typecheck` (TypeScript) | pass |
| `scripts/openapi.ts --check` | pass |
| `scripts/generate-dart-api.ts --check` | pass |
| `scripts/secret-scan.ts` and `--history` | pass |
| Vitest (unit + integration, isolated test DB) | **799/799**, 60 files |
| Flutter analyze | no issues in `edmn_core`, `edmn_api`, `edmn_design`, `customer_mobile`, `admin_mobile` |
| Flutter test | core 13, api 3, design 9, customer **38**, admin 4: all pass |
| Live HTTP smoke on the unified server (local isolated DB, demo accounts) | **50/50**: public, buyer, returns, reviews, deals, chat, support, disputes, wallet (incl. Codex's activity detail), notifications, seller (home, orders, products, funds, statement, payouts, shipping, store, returns, disputes, chat), plus refusals (stranger → 404, buyer on seller route → 403, no session → 401) |
| Visual smoke of the unified app (web build) | 16 screens across every area render: `docs/mobile/screenshots/unified/` |

### Functional areas and the tests covering them

| Area | Integration tests | Live smoke |
|---|---|---|
| Buyer (catalog, cart, checkout, orders, payment) | `mobile-buyer-api` (10), `mobile-api-auth` (16), `mobile-phase1-security` (19) | ✓ |
| Seller center (orders, products, setup, payouts) | `mobile-seller-api` (6), `mobile-seller-setup` (3) | ✓ |
| Protected Deal | `mobile-deals-api` (1 full flow) | ✓ |
| Wallet | `mobile-wallet-api` (5, incl. Codex's fixes and the Protected-Deal payout cancel) | ✓ |
| Chat and support | `mobile-messaging-api` (3), `messaging-realtime` (18) | ✓ |
| Returns, disputes, reviews | `mobile-postpurchase-api` (4, journeys 1–10) | ✓ |
| Notifications, password reset | `mobile-notifications-reset` (3) | ✓ |

## Not merged / pending
- Nothing was left unmerged.
- PR #1 (Codex) and PR #2 (Phase 6) stay open for review: this branch shows they integrate cleanly, but it does not
  approve them. Integration into `claude/edmn-mobile-integration` waits for Codex's review of PR #2.
- `main` is untouched. No deploy, Real Money OFF.

## What remains for the app (priority order)
1. **Physical-device testing.** No device or Mac is attached to this environment.
   - Run the app on real Android and iOS phones against a staging backend (after approval). Cover the flows A–H,
     RTL / LTR, small and large screens, large accessibility fonts, offline / timeout behaviour, and camera / file
     pickers for receipts and evidence.
2. **Push notifications.** Not built.
   - FCM / APNs device registration API, sending from the existing notification fan-out, a tap → typed target in the
     app, and permission prompts.
   - Needs: a Firebase project, an APNs key, `google-services.json` / `GoogleService-Info.plist` (owner approval;
     secrets created through a secure channel).
3. **Android / iOS release builds.**
   - Android: an earlier APK attempt here failed on Maven Central rate limits, so it needs a retry or CI.
   - iOS: needs macOS + Xcode.
   - Both need signing keys / certificates (owner approval). Store / TestFlight uploads need approval.
4. **Deep links** for `/reset-password` and the deal invitation (Android App Links / iOS Universal Links). Needs the
   app signing fingerprints and `assetlinks.json` / `apple-app-site-association` on the domain (owner approval).
5. **Business decisions:** deposits / top-up (D28–D31) and wallet-to-wallet transfer (D34); wishlist API (B22).
6. **HawkScan DAST:** not run (no `HAWK_API_KEY`).
