# EDMN — Final Pre-Acceptance Audit

| Item | Value |
|---|---|
| Date | 2026-10-05 |
| Branch | `claude/great-tesla-nor0wt` |
| Baseline | `b21d790` (Delivery OTP) |
| Scope | Feature freeze. The audit reviewed the actual code against the approved requirements and fixed verified gaps only. No new features were added, the legacy system and `api.edmneg.com` were not touched, real money stayed off, and the staging database was not reset or deleted. |

## Method

1. **Five independent read-only reviews of the code**, each instructed to report only verified gaps with file and line evidence:
   - customer marketplace;
   - Seller Center;
   - Admin (every module);
   - finance, privacy and staging/production safety;
   - protected deal end to end (negotiation, return policy, location, Delivery OTP, receipt).
2. **Triage.**
   - Every reported item was checked again against the code.
   - Items that break an approved requirement, or that are unsafe, were fixed with regression tests.
   - Polish items and improvements beyond the requirements were recorded, not implemented.
3. **Full regression run:** lint, typecheck, integration/unit tests, local E2E, deployed staging E2E, production build (Vercel), and a read-only ledger reconciliation on staging.

## Verdicts

| Area | Result | Notes |
|---|---|---|
| CUSTOMER MARKETPLACE | **PASS** (after fixes) | Mobile delivery-governorate picker added; cart no longer blocks checkout on a browsing-governorate mismatch; tracking stepper shows PROCESSING/COMPLETED; SKU-only variant picker; Arabic labels for IN_PROGRESS/WITHDRAWN/REVOKED; closed tickets refuse replies. Arabic search normalization, multi-seller cart, server-authoritative totals and the order flow verified. |
| SELLER CENTER | **PASS** (after fixes) | Separate shell confirmed. Fixed: price edits on approved multi-option products, internal risk notes shown to the seller, per-member permissions on orders/finance/analytics, evidence access for store staff, the seller dispute thread, the shipping-coverage requirement before submission. Seller A ↔ Seller B isolation verified. |
| ADMIN | **PASS** (after fixes) | All modules are real (no placeholders); every form posts to a guarded action. Fixed: RBAC self-escalation, outbox code exposure, dashboard counting cancelled orders, unresolvable deal flags (new risk queue), seller ledger statement, live legal text editable, returns under dispute, refund default, payout-method verification, step-up return paths. |
| MARKETPLACE ORDER | **PASS** | Traced end to end:<br>product → reservation → cart → checkout (server pricing, per-seller sub-orders, commission + return-policy snapshots) → proof → admin confirmation (amount = due, step-up, no self-dealing) → seller processing → waybill → buyer receipt (the only release) → completion job (no money). |
| PROTECTED DEAL | **PASS** (after fixes) | Fixed: stuck states after a return/replace decision, an expiring bound invitation, an elapsed payment window, the legacy no-handover state, and buyer hints shown as the seller in admin. |
| NEGOTIATION | **PASS** (after fix) | The seller offer now sets final price, shipping fee, **delivery method**, processing time and the **expected delivery window**; the buyer's wizard values are non-binding preferences. Versions are append-only. The agreed snapshot is immutable and now also freezes the parties, delivery info (governorates + location fingerprints) and agreement timestamps. |
| RETURN POLICY | **PASS** | Required per listing; shown on PDP, checkout, order, return request, admin and deal review; snapshotted. "No voluntary returns" never blocks defect/wrong/damaged/not-as-described claims; the view now says so explicitly. |
| LOCATION | **PASS** | One-shot, on click, manual fallback with all fields, encrypted, never in URLs, counterparty only after payment, `geolocation=(self)`. |
| DELIVERY OTP | **PASS** (after fixes) | CSPRNG 6 digits, HMAC bound to deal + code, 72 h, 5 attempts, rate limits (now counted only after authorization), single use, regeneration invalidates the old code, audited. Fixed: the SMS body was readable in the admin outbox → it is now redacted right after hand-off and masked in the UI. The staging buyer display is disabled whenever `EDMN_ENVIRONMENT=production`, and a production build now **requires** `EDMN_ENVIRONMENT`. |
| RECEIPT | **PASS** | OTP ≠ release. Only the buyer's explicit «استلمت والمنتج مطابق» releases, and only with confirmed payment, no dispute, no hold and no hold flag — exactly once. A problem opens a dispute; not-received after OTP opens `DELIVERY_CONFLICT`. There is no seller bypass. |
| PAYMENTS | **PASS** | Exactly-once confirmation; amount = due; step-up; TEST flag now also on deal payment destinations. |
| SELLER BALANCE | **PASS** (after fixes) | The money-release paths a staff member can trigger (on-behalf receipt, hold release, dispute decision, ledger adjustment) now refuse staff who belong to the store, and require step-up where they move money. |
| WITHDRAWALS | **PASS** with documented P2 | State machine, ≤ available, concurrency, reservation, encrypted destinations, audited changes, TEST guard. Maker/checker applies at or above the configured threshold (default 50,000 EGP rolling 24 h) — see P2-3. |
| LEDGER | **PASS** | Append-only triggers, balanced entries, unique idempotency keys, reversal/adjustment corrections. Reconciliation difference **0** (below). |
| SECURITY | **PASS** | Previous Security Gate re-confirmed. New fixes: RBAC escalation, separation of duties on every release path, OTP leakage, rate-limit ordering. |
| PRIVACY | **PASS** | National ID, documents, payout details and locations are encrypted or private. Risk notes are no longer shown to sellers. Secret outbox bodies are masked. |
| MOBILE | **PASS** | 7 widths × all three surfaces (E2E responsive suite) including deal pages; the mobile governorate gap is fixed. |
| ACCESSIBILITY | **PASS** | No serious/critical axe violations on the audited pages (E2E). New inputs have labels (reasons, OTP, governorate). |
| STAGING SAFETY | **PASS** (after fixes) | Banner, noindex, robots, TEST destinations, real money impossible on staging. Production now requires `EDMN_ENVIRONMENT` plus real SMS/SMTP drivers. The demo seed refuses non-local databases unless staging/development. |

## Open findings

There is **no open P0 or P1.**

**Open P2 (4):**
1. **AUTH-03:** first admin TOTP enrollment is trust-on-first-use (operational control: in-person enrollment).
2. **FP-F5:** the encryption envelope has no key id (rotation tooling).
3. **Withdrawal maker/checker** only applies at or above the configured threshold (default 50,000 EGP rolling 24 h). Recommendation for the real-money launch: set the threshold to 0 (configuration, no code change).
4. **Deal payouts** are paid by one finance operator (step-up + payee ≠ operator; no second approver).

**Open P3 (18), recorded and not fixed:**
- **Customer:**
  - the account dashboard counts only 3 deals;
  - the cart quantity / cancel-unpaid actions drop error messages;
  - the wishlist toggle with an invalid id can raise an error page;
  - the header search box doesn't keep the query.
- **Seller:**
  - some actions drop error messages;
  - the support list shows colleagues' tickets the member cannot open;
  - a few pages use non-null assertions instead of `requireSellerActor`;
  - seller logout lands on the marketplace when hosts are not separated;
  - the commercial register number is optional for Business sellers (the document is required);
  - the store default return policy is not explicitly confirmed.
- **Admin:**
  - the returns page still shows buttons for disputed returns (the server refuses them);
  - nav badge and label inconsistencies;
  - malformed date filters → error page;
  - TEST markers missing in exports;
  - the hard-coded "1.0 approved" text on the legal page;
  - raw codes in the deal audit timeline.
- **Deal:**
  - the OPENED audit also fires on the buyer's own view;
  - revoked or expired links still show the summary.
- **Finance:**
  - the completion job marks held orders COMPLETED (money stays held);
  - the payout reveal has no self-dealing check;
  - the sellers CSV export includes contacts without step-up;
  - Vercel preview builds run migrations against their configured database.

## Test results

| Check | Result |
|---|---|
| Lint | 0 problems |
| Typecheck | 0 errors |
| Integration + unit (PostgreSQL) | **177 / 177** (16 files), incl. 26 security-gate, 24 delivery-OTP, 24 deal/return-policy and 12 pre-acceptance regression tests |
| Local E2E (production build) | **34 / 34** (clean run, after scoping one storefront locator that matched the new hidden mobile-drawer link) |
| Deployed staging E2E | **34 / 34** on https://edmn-staging.vercel.app (final run on deployment `4c1929e`, 13.0 min) |
| Production build | Vercel deployments `a751cbc` and `4c1929e` **READY** (staging banner, `/api/health` 200) |
| Ledger reconciliation (staging, read-only) | 41 accounts, **0 projection mismatches**, 88 entries / 215 lines, debits **496,844.00 EGP** = credits **496,844.00 EGP**, **difference 0**, 0 unbalanced entries, real money **off** |

**Staging run history (for transparency).** Earlier full staging runs in this audit had one failure each, and none was a functional regression:
1. A seller-page assertion and a buyer "accept offer" click ran before the page had hydrated on slow serverless cold starts. The deal spec now waits for network idle after every navigation.
2. One transient Vercel 502 on a legacy deal page. The same page returned 200 six times out of six when probed directly with the buyer's session.

The final full run passed 34/34.

## Test data cleanliness

- **Public listings.** E2E runs create isolated fixtures: e2e accounts (21 on staging, none public), deals, orders and payments. **No E2E product is publicly listed** on staging (0 of 21 LIVE products).
- **Presentation data.** Demo / pilot presentation data comes only from the staging seed, using env-provided credentials.
- **Nothing deleted.** No existing staging data was deleted or reset.
- **Recommendation.** If the owner wants a pristine staging for the acceptance test, approve a one-time archive of `@e2e.local` fixtures. This needs explicit approval and was **not done**.

## Fixes made during the audit

1. **Seller offer** now controls the final price, delivery method and expected delivery window. The agreed snapshot freezes the parties, delivery info and agreement timestamps.
2. **Deal lifecycle:**
   - a return/replace decision reopens a clean delivery and closes the review flags;
   - re-shipment resets the handover;
   - bound invitations don't expire;
   - an elapsed payment window reopens;
   - lock-order fix;
   - legacy no-handover deals go to Operations;
   - the deal list no longer says «تم الاستلام» for shipped deals.
3. **Separation of duties:** dispute decisions (step-up, no parties, no store insiders), on-behalf receipt, hold release (step-up), ledger adjustments (step-up, no insiders), revision moderation, payout-method verification (step-up, no insiders, reject reason).
4. **Delivery OTP confidentiality:** immediate redaction after hand-off; admin outbox masking; quota counting after authorization.
5. **RBAC:**
   - no self-escalation;
   - super-admin-only grants of SUPER_ADMIN or role management;
   - disabling via roles is limited to staff.
6. **Admin:**
   - risk-flag queue with gated resolve;
   - seller ledger statement;
   - the dashboard excludes cancelled orders and labels test money;
   - live legal versions are locked;
   - returns under dispute are decided only through the dispute;
   - refund default = full ceiling;
   - verified seller identity, hints and locations shown on the deal admin page;
   - step-up return paths.
7. **Seller Center:**
   - multi-option price edits work;
   - risk notes are hidden from sellers;
   - per-member permissions on orders, finance and analytics;
   - staff can open evidence;
   - the dispute thread is visible on the seller order page;
   - at least one shipping governorate is required before submission;
   - role labels in Arabic.
8. **Customer:**
   - mobile governorate picker and Used/Wishlist links;
   - cart shipping warning instead of a block;
   - stepper fix;
   - SKU variants;
   - status labels;
   - closed tickets;
   - dispute reasons «معيب» / «منتج مختلف».
9. **Environment safety:** `EDMN_ENVIRONMENT` required in production builds; production requires `SMS_DRIVER=http` and `MAIL_DRIVER=smtp`; demo seed guard inside `seedDemo()`.

## External blockers (not code)

- Official EDMN logo
- Real bank account, InstaPay and Vodafone Cash destinations
- SMTP provider and SMS provider (required for verification codes and the Delivery OTP in production)
- Lawyer-approved legal texts, including the mandatory-rights notice and the protected-deal terms
- Final commission and fee approval
- Production domain and DNS for `www.` / `seller.` / `admin.edmneg.com`, and the owner's approval to deploy
- Production database, storage and secrets (new keys; rotate the credentials pasted in chat during setup)
- In-person TOTP enrollment of production admins

## Post-V1 recommendations (not implemented — scope frozen)

- Second approver for deal payouts, and a maker/checker threshold of 0 for withdrawals at the real-money launch.
- Encryption key id and rotation tooling; nonce-based CSP.
- A Seller Center notifications inbox, plus support-reply attachments for sellers.
- Location-retention job after the dispute window; orphan-file cleanup.
- A seller withdraw/timeout path for open offers; a seller counter on inspection days.
- Session revocation UI for customers; showing review photos on product pages; a report-review UI.
- A TEST/LIVE split in reports and exports; a central notifications template editor preview.

## Ready for owner final acceptance test

**YES** — on staging, with TEST money only. Follow `docs/FINAL_ACCEPTANCE_TEST_PLAN.md`.

This is **not** a production-launch readiness statement. Production requires the external blockers above.
