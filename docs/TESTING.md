# Testing

| Layer | Tool | Location | Database |
|---|---|---|---|
| Unit | Vitest | `tests/unit/` | none |
| Integration | Vitest | `tests/integration/` | real PostgreSQL (`TEST_DATABASE_URL`), migrated + reference-seeded fresh in global setup |
| End-to-end | Playwright (Chromium) | `tests/e2e/` | dedicated DB (`E2E_DATABASE_URL`) reset + migrated + demo-seeded per run; app runs as a **production build** on port 3100 |

```bash
npm run typecheck        # next typegen + tsc --noEmit
npm run lint
npm test                 # unit + integration (files run sequentially; one shared test DB)
npm run test:unit
npm run test:integration
npm run test:e2e         # builds, then runs Playwright (E2E_SKIP_BUILD=1 to reuse .next)
npm run ledger:check     # reconciliation against the current DATABASE_URL
npm run test:all
```

Integration tests run the **real domain services** in real transactions (no mocks of the database,
ledger or state machines). Files are uploaded as real bytes (generated PNG/PDF) through the same
validation pipeline. E2E tests drive the UI in a browser and assert every state change in the
database.

## Unit coverage

- `money.test.ts` — EGP parsing (Arabic digits/separators), over-precision rejection, half-up bps,
  float-error avoidance, proportional shares, percent→bps, integer guards.
- `commission.test.ts` — flat rate, price-band tiers, minimum fee capped at line total, determinism.
- `state-machines.test.ts` — allowed/blocked transitions, terminal states for every machine.
- `text-crypto-auth.test.ts` — Arabic normalization, slugs, Egyptian mobile/national-ID validation,
  AES-GCM tamper detection, masking, scrypt, password policy, RFC 6238 test vector, permission
  checks, seller staff scoping, step-up window, maker/checker role separation, magic-byte sniffing,
  path-traversal keys, CSV formula injection, business-hour SLA (Fri/Sat skipped).

## Integration coverage (by area)

- **Sellers & catalog** (`sellers-catalog.test.ts`): complete application + agreement version + admin
  approval; low-privilege admins cannot approve; moderation (not live until approved, reasons
  visible); staged revisions for live listings; prohibited keywords/restricted categories; Arabic
  search with normalization and typos.
- **Checkout & payments** (`checkout-payments.test.ts`): multi-seller parent/sub-orders with
  server pricing and snapshots; checkout idempotency; proof never marks paid; reviewer-only
  confirmation; unpaid order expiry releases stock.
- **Fulfilment & finance** (`fulfilment-finance.test.ts`): shipping requires data + waybill; shipping
  never releases funds; seller cannot confirm on buyer's behalf; refunds on cancellation; withdrawal
  limits, rejection/cancellation return funds; payout-change hold; maker/checker adjustments; payout
  details reveal (permission + step-up + audit); journal append-only; unbalanced entry rejected at
  commit; projections match journal.
- **Post-purchase, deals, authorization** (`postpurchase-deals-authz.test.ts`): proportional partial
  returns; defect claims need evidence; disputes hold funds and decisions reverse/release them;
  verified-purchase reviews and rating recomputation; full external deal lifecycle; cross-account
  privacy.
- **Auth hardening** (`auth.test.ts`): single-use TOTP; admin sessions start without MFA and are not
  interchangeable with web sessions; fresh registration sessions are valid (regression for a clock
  race); password change keeps only the current device signed in; step-up required for high-risk
  admin operations.

## The 20 critical edge cases (spec §94)

| # | Case | Test |
|---|---|---|
| 1 | Two buyers race for the last unit | `checkout-payments` — "EDGE 1" (concurrent checkouts, exactly one wins, stock never negative) |
| 2 | Proof submitted twice | `checkout-payments` — "EDGE 2" (same key idempotent; different proof refused while pending) |
| 3 | Admin double-clicks confirmation | `checkout-payments` — "EDGE 3/4" (parallel confirmations post once) |
| 4 | Confirmation request retried | `checkout-payments` — "EDGE 3/4" (retry returns already-confirmed, one ledger entry) |
| 5 | Price changes while in cart | `checkout-payments` — "EDGE 5" (checkout refuses until customer reviews the new total) |
| 6 | Product inactive before checkout | `checkout-payments` — "EDGE 6" |
| 7 | Seller suspended with pending orders | `checkout-payments` — "EDGE 7" (new checkout blocked, paid orders intact) |
| 8 | One seller cancels in a multi-seller order | `fulfilment-finance` — "EDGE 8" (other sub-order unaffected, refund created) |
| 9 | One item of a multi-item order returned | `postpurchase-deals-authz` — "EDGE 9" (proportional refund and commission reversal) |
| 10 | Buyer confirms delivery twice | `fulfilment-finance` — "EDGE 10" (funds released once) |
| 11 | Withdrawal request retried | `fulfilment-finance` — "EDGE 11" |
| 12 | Two withdrawals for the same balance | `fulfilment-finance` — "EDGE 12" (concurrent; one succeeds; balance never negative) |
| 13 | Commission changed after old orders | `fulfilment-finance` — "EDGE 13" |
| 14 | Used product missing actual photos | `sellers-catalog` — "EDGE 14" |
| 15 | Seller accesses another seller's order | `fulfilment-finance` — "EDGE 15" + E2E `security.spec.ts` |
| 16 | Customer accesses another customer's order | `postpurchase-deals-authz` — "EDGE 16" + E2E `security.spec.ts` |
| 17 | Low-privilege admin attempts financial action | `fulfilment-finance` — "EDGE 17" (+ seller approval, payment confirmation, payout reveal tests) |
| 18 | Private document URL guessed | `postpurchase-deals-authz` — "EDGE 18" + E2E `security.spec.ts` |
| 19 | Invalid shipment file upload | `fulfilment-finance` — "EDGE 19" (type sniffing, not extension) |
| 20 | Proof rejected then resubmitted | `checkout-payments` — "EDGE 20" |

## End-to-end coverage

- `marketplace-flow.spec.ts` — **critical flow 1** entirely through the UI: seller registers →
  verifies mobile → onboarding (identity, store, private ID documents, payout) → cannot list before
  approval → admin approves → configures governorate shipping → creates a product (wizard) →
  not public before approval → admin approves → buyer finds it, cart, checkout, payment proof →
  admin confirms → seller confirms, processes, is refused shipping without a waybill, uploads the
  waybill and ships → buyer confirms receipt → balance available → withdrawal → checker approves
  (cannot pay) → operator records transfer → trial balance and every account projection verified.
- `protected-deal.spec.ts` — **critical flow 2**: buyer wizard → invitation (token stored hashed) →
  seller accepts with encrypted payout details → buyer pays (proof) → admin confirms → seller
  declares delivery → buyer confirms → payout payable → finance records payout.
- `security.spec.ts` — admin requires staff session; customer session ≠ admin; private files not
  public (anonymous and other customers); cross-customer and cross-seller order access; security
  headers.
- `storefront.spec.ts` — RTL/lang, no horizontal overflow on desktop and 360–390 px phones
  (storefront, account, Seller Center), Arabic typo-tolerant search, legal pages marked as drafts,
  used-product condition shown.

## Notes

- The test DB and E2E DB are destroyed and recreated; never point those variables at real data.
- Playwright looks for Chromium via `PLAYWRIGHT_CHROMIUM_PATH` or the default Playwright cache
  (`npx playwright install chromium`).
- Server logs during E2E may show `The destination stream closed early` when the browser navigates
  away while a streamed page is still rendering — expected, not an application error.
