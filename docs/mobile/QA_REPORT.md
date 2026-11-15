# QA report — design system + buyer phase

Branch `claude/edmn-mobile-integration`. Results below are from runs in this session; "NOT RUN" is never reported
as passed.

## Automated tests

| Suite | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | PASS |
| ESLint (whole repo) | `npx eslint .` | PASS |
| OpenAPI contract drift | `npx tsx scripts/openapi.ts --check` | PASS |
| Backend (Vitest, real Postgres) | `npx vitest run` | **772 / 772 PASS** (51 files) |
| — buyer API integration | `tests/integration/mobile-buyer-api.test.ts` | 10 / 10 PASS: anonymous refused on every buyer route; address isolation between buyers; multi-seller server pricing; checkoutKey idempotency (one order); client cannot set the total; price-change acknowledgment; stock limit; other buyer's address refused; receipt upload queued, single per clientKey, no ledger entry, order not paid; strangers and the seller cannot read the receipt (404); idempotent cancel releases stock; password change signs out other devices; store filter |
| — seller API integration | `tests/integration/mobile-seller-api.test.ts` | 6 / 6 PASS: buyer gets `seller_required`; owner membership; unpaid orders invisible; other store refused (read + step); confirm → processing → ready → shipment with waybill → shipped through allowedActions only, early step refused, no ledger entry; stock own/foreign/reserved floor; funds need finance.view (ORDER_MANAGER refused, no sales on dashboard), withdrawable = max(0, available − held) |
| — contract guard | `tests/unit/openapi-contract.test.ts` | PASS — every write route on a reviewed allow-list (buyer + seller); seller writes are `seller`-auth only; no money-moving path |
| Flutter `edmn_core` | `flutter test` | 13 / 13 PASS |
| Flutter `edmn_api` | `flutter test` | 3 / 3 PASS (incl. optional fields omitted when unset) |
| Flutter `edmn_design` | `flutter test` | 9 / 9 PASS (RTL/LTR money, error mapping, loading button blocks double tap, logo assets, error-state kinds, timeline, brand tokens) |
| Flutter Customer App | `flutter test` | **16 / 16 PASS** — not-a-seller state; seller menus follow the role (no funds for an order manager) and steps follow allowedActions with confirmation; RTL default + board navigation, TEST banner on/off from server, version gate, localized error codes, guest add → sign-in, protected routes, cart→checkout sends the server total with ONE checkout key, receipt → under review never "paid", confirm receipt only when allowed + confirmation dialog, no fake wallet balance, English LTR, devices |
| Flutter Admin App | `flutter test` | 4 / 4 PASS (unchanged app, shares the design package) |
| `flutter analyze` (all 5 packages/apps) | | PASS (no issues) |
| HawkScan DAST | post-commit hook | **NOT RUN** — `HAWK_API_KEY` is not available in this environment |

## End-to-end run against the real backend (screenshots)

Flutter web build of the Customer App (same Dart code) + local Next.js backend + isolated local Postgres
(`edmn_shots`, demo seed) + Chromium at 390×844. Journey: onboarding → home (guest) → categories → search →
product → public store → sign in → add 2 products from 2 sellers → cart → pick governorate → checkout 4 steps →
order placed → tracking → payment → upload receipt → "under review" → my orders → reorder → account → addresses →
security → wallet (honest stub) → English LTR. Evidence: `docs/mobile/screenshots/buyer/`. Bugs found and fixed by
this run: generated Dart sent `null` for optional fields (login 422), Arabic-Indic digits in dates, unreadable
payment destination layout, Material underline under the TEST banner, product card overflow with large fonts.

## Seller run against the real backend

Signed in as the demo store owner (local DB), one TEST payment confirmed through the admin payment-review service
on the isolated local DB only, then: Seller Center dashboard → orders (new) → order → accept (state machine) →
products & stock → earnings (ledger figures). Evidence: `docs/mobile/screenshots/seller/`, board comparison
`docs/mobile/screenshots/compare/seller.webp`.

## Platforms

| Item | Status |
|---|---|
| Android debug APK | see HANDOVER (build attempted in this session; result recorded there) |
| iOS build | **NOT RUN** — needs macOS + Xcode; no Mac folder is shared with this session |
| Physical-device testing | NOT RUN |
| Small / large phone, large accessibility font | Partially: widget tests use the 1170×2532 @3x surface with the test font (larger glyphs) and caught 4 overflows (fixed); no device matrix yet |

## Security checks in this phase

Server-authoritative totals and allowed actions; identity from session only; idempotency keys per intent
(checkout, receipt, cancel, confirm, address); receipt upload never marks paid; private files 404 for non-owners;
refresh token in Keychain/Keystore, access token in memory only; no sensitive values logged; Real Money OFF banner.
No production access, no deploy, no real money, no secrets created (local screenshot env used throwaway local
values only, never written to the repository).

## Phase 2 — Protected Deal

| Check | Result |
|---|---|
| Backend `tsc`, `eslint`, `openapi --check` | pass |
| Vitest (unit + integration, isolated test DB) | 782/782 (rerun after the money-basis fix) |
| Flow C integration (`mobile-deals-api.test.ts`) | create → steps → invite → claim → offer → change → accept → pay (receipt) → staff confirm → ship → code → confirm; offer money = offer price; payment due = agreed buyerPays |
| Flutter customer widget tests | 20/20 (adds: accept needs confirmation and no release/refund button exists; invite link shown once and seller actions follow allowedActions, seller never sees the code; buyer code reveal shows expiry and attempts) |
| Real screenshots (local isolated backend `edmn_shots`) | `docs/mobile/screenshots/deals/` d01, d02, d03, d06, d08, d11, d12, d14, d15 |
| HawkScan | NOT RUN (no HAWK_API_KEY in this environment) |

Defects found by the screenshot pass and fixed: the offer money was read from a stale indicative quote (fee 0, wrong
total); the seller saw «عرض بانتظار ردك» on the buyer's turn; terms history showed a raw `PROPOSED` and «أنت البائع» to
the buyer; the delivery-code sheet rebuilt its provider on every frame (endless reload); a cached deal kept old actions
after navigating back.

## Phase 3: messaging and support

| Check | Result |
|---|---|
| Backend `tsc`, `eslint`, `openapi --check` | pass |
| Vitest | 785/785 |
| Flow D / Flow E integration (`mobile-messaging-api.test.ts`) | pass; see `CHAT_ARCHITECTURE.md` |
| Flutter customer widget tests | 24/24 |
| Real screenshots (local isolated backend) | `docs/mobile/screenshots/messaging/`: inbox, buyer and seller views of a deal conversation, report sheet, support home, new ticket prefilled from a deal, ticket with a staff reply |
| HawkScan | NOT RUN (no HAWK_API_KEY) |

Defects found and fixed: `EdmnSkeletonList` crashed when shown inside a scrolling page (an unbounded viewport) while a
list was loading; a failed send showed two error messages and hid the retry button; the chat composer was a fixed
4-line box (it now grows from one line).

## Phase 4: wallet and financial operations, and removal of the global TEST banner

| Check | Result |
|---|---|
| Backend `tsc`, `eslint`, `openapi --check` | pass |
| Vitest | 788/788 |
| Flow G integration (`mobile-wallet-api.test.ts`) | 3/3; see `WALLET_FINANCIAL_STATES.md` |
| Flutter customer widget tests | 27/27 |
| Real screenshots (local isolated backend) | `docs/mobile/screenshots/wallet/`: home without the banner, wallet, balance breakdown, payout request with server preview, store statement, store payouts, buyer wallet, activity, activity detail, receiving accounts, add account |
| HawkScan | NOT RUN (no HAWK_API_KEY) |

Defects found and fixed:
- the payout request status chip overflowed a 390-px row («جاري التحقق من التحويل · تجريبي»);
- order refs such as «#100002» rendered reversed inside Arabic titles (now wrapped in LTR isolates);
- a buyer without earnings saw a bare 0 with no explanation.
