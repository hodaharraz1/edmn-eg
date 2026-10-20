# EDMN Mobile: Screen Map v2

| | |
|---|---|
| **Status** | Phase 0 v2 planning. **Supersedes** `MOBILE_SCREEN_MAP.md` (v1). No screen is implemented. |
| **Source of truth** | `hodaharraz1/edmn-eg` · `claude/great-tesla-nor0wt` · `48ae40c`. Statuses and permissions below are the **real** ones from `src/domain/machines.ts` and `src/server/rbac/permissions.ts` |
| **Endpoint IDs** | Refer to [`MOBILE_API_EXTRACTION_PLAN.md`](./MOBILE_API_EXTRACTION_PLAN.md) §7 |

## 0. Shared rules and state patterns

**Rules:**

- **Server-driven actions.** Every action button comes from the server's `allowedActions` (X-4); none is inferred from the status enum.
- **Labels.** Status labels come from the server label map, exported from `src/lib/i18n/labels.ts`. They are never derived from enum names, because `DELIVERED` on a deal means *shipped* and `COMPLETED` means *settled, not paid out* (PD-5).
- **Money.** Display only. Values arrive as integer piastres and are formatted like `formatEGP()` (`12,999 ج.م`).
- **Test mode.** Whenever `isTest` is true on a payment or withdrawal, or `realMoneyEnabled=false`, a persistent **"TEST MODE – no real money"** banner shows.
- **Direction.** Arabic RTL is primary. English LTR is new (D-9).

| Code | Pattern |
|---|---|
| L1 | Skeleton matching the layout; pull to refresh |
| L2 | Button spinner; same `Idempotency-Key` or domain key reused on retry |
| L3 | Blocking progress sheet; used for money, agreement and OTP actions |
| E1 | Empty state with reason and primary CTA |
| E2 | Empty filter state with "clear filters" |
| R1 | Network error banner; cached data stays visible with "updated hh:mm" |
| R2 | problem+json → localized message by `code`; support link carries the `reference` |
| R3 | 409 `INVALID_STATE` / `CONFLICT` → "this changed" sheet; refetch; show new values (price, fee, offer version); explicit re-confirm |
| R4 | 401 `STEP_UP_REQUIRED` → biometric + TOTP/OTP step-up → retry with the same key |
| R5 | 403 → no-access screen (no data) |
| R6 | 429 → countdown from `Retry-After` |
| O0 | Online only |
| O1 | Drift cache read-only with staleness label; writes disabled |
| O2 | Local draft; submit when online |
| X1 | `FLAG_SECURE` / iOS screenshot guard |
| X2 | Biometric gate to open |
| X3 | Never cached to disk |

---

## 1. Customer App: navigation

```
Splash APP-01 ─► (min-version gate) ─► Auth AUTH-01..06 (or guest browse)
Tabs:
 Home      HOME-01 ─► CAT-01 ─► CAT-02 ─► PRD-01 ─► STR-01 · SRCH-01/02 · PASS-01 (passport)
 Deals     DEAL-01 ─► DEAL-02 wizard (5 steps) ─► DEAL-03 invite ─► DEAL-04 detail ─► DEAL-05 offer review ─► DEAL-06 agreement
                    ─► PAY-01..03 ─► DEAL-07 handover code ─► DEAL-08 receipt / problem
           INV-01 invitation (deep link /deal/invite/{token}) ─► DSL-01 offer composer ─► DSL-02 ship ─► DSL-03 enter OTP
 Cart      CART-01 ─► CHK-01 address/governorate ─► CHK-02 review ─► PAY-01..03 ─► CHK-03 result
 Orders    ORD-01 ─► ORD-02 (per seller sub-order) ─► RET-01..03 · DSP-01..03 · SO problem/cancel
 Account   ACC-01 ─► KYC-01 · RCV-01 · ERN-01..02 · NTF-01/02 · MSG-01/02 · SUP-01..03 · SEC-01 · ACC-02..05 · LEG-01
           └► Seller Center SC-* (role-gated by sellerContextForUser)
```

## 2. Buyer screens

| ID | Screen | Purpose | Actor | Entry | Data | API | Actions | Load | Empty | Error | Offline | Security |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| APP-01 | Splash | Config, force update, session restore | Any | Launch | app config | P-APP-01, C-AUTH-03 | — | logo | — | R1 | Cached config < 24 h | Tokens in Keychain/Keystore only |
| AUTH-01 | Welcome | Language, guest browse | Guest | First run | — | — | Continue | — | — | — | Yes | — |
| AUTH-02 | Login | Email or Egyptian mobile + password | Guest | CTA / protected action | — | C-AUTH-02 | Login, forgot | L2 | — | R2, R6 (lockout looks like a wrong password) | O0 | Enumeration-safe copy |
| AUTH-03 | Register | Name, email, mobile, password, accept terms | Guest | AUTH-02 | legal version | C-AUTH-01, P-CAT-09 | Register | L2 | — | R2 field errors | O0 | Password policy from server |
| AUTH-04 | Forgot / reset | Reset link flow (opens app via deep link) | Guest | AUTH-02 | — | C-AUTH-05/06 | Request, set password | L2 | — | R2 | O0 | Always shows "if the account exists…" |
| AUTH-05 | Verify phone/email | 6-digit code | User | ACC-01 / guards | — | C-AUTH-08/09 | Send, confirm | L2 | — | R2 ("SMS not available yet" when no provider) | O0 | Never logged |
| AUTH-06 | App lock | Biometric unlock opt-in | User | After login | — | — | Enable/skip | — | — | — | Yes | Local only |
| HOME-01 | Home | Blocks, categories, used, deals CTA | Any | Tab | home blocks | P-CAT-08, P-CAT-01 | Navigate | L1 | E1 | R1 | O1 | — |
| CAT-01/02 | Categories / listing | Tree; products with facets (condition NEW/USED, brand, price) | Any | Home | tree, page | P-CAT-01, P-CAT-02 | Filter, sort | L1 | E2 | R1 | O1 | — |
| SRCH-01/02 | Search | Query + results | Any | Header | results | P-CAT-02 | Search | L1 | E2 | R1 | O0 | Query length cap |
| PRD-01 | Product | Media, price, variants, condition / passport, store, shipping to my governorate, return policy | Any | Lists / deep link | detail | P-CAT-03, P-CAT-04, P-CAT-07 | Add to cart, wishlist | L1 | — | 404 "no longer available" | O1 (add disabled) | Price is indicative; server reprices |
| STR-01 | Store | Store profile, ratings, products | Any | PRD-01 | store page | P-CAT-05 | Browse | L1 | E1 | R1 | O1 | Public projection |
| PASS-01 | Product passport | Used-item condition record | Any | PRD-01 / link | passport | P-CAT-11 | — | L1 | — | R1 | O1 | Public data only |
| CART-01 | Cart | Lines grouped by seller, server totals, price-change acknowledgement | Buyer | Tab | cart | C-CART-01..04 | Qty, remove, checkout | L1 | E1 | R3 (price changed) | O1 read-only | No client totals |
| CHK-01 | Address | Choose/add address (governorate from DB) | Buyer | CART-01 | addresses | C-ADDR-01/02, P-CAT-07 | Select, add | L1 | E1 | R2 | O0 | — |
| CHK-02 | Review | Per-seller groups, shipping, buyer fee, total, payment method | Buyer | CHK-01 | quote | C-CHK-01 | Place order | L3 | — | R3 (total/fee/version changed → re-confirm), stock/identity errors | O0 | Sends `checkoutKey`, `expectedTotal`, `expectedPricingVersionId`; **identity must be APPROVED** (else route to KYC-01) |
| PAY-01 | Payment instructions | Destination details, amount due, due time | Buyer | CHK-02 / DEAL-06 | instructions | C-PAY-01, C-DEAL-12 | Copy details | L1 | — | R1 | O1 | TEST banner when `isTest` |
| PAY-02 | Upload proof | Amount, reference, payer name, image | Buyer | PAY-01 | — | C-PAY-02 | Submit | L3 | — | R2 (amount mismatch, window expired) | O2 | `clientKey`; EXIF stripped |
| PAY-03 | Payment status | AWAITING_PAYMENT → PAYMENT_SUBMITTED → UNDER_REVIEW → CONFIRMED / REJECTED (new proof) | Buyer | PAY-02 / push | payment | C-PAY-01 | Re-upload if rejected | L1 | — | R1 | O1 | App never decides "paid" |
| CHK-03 | Order placed | Order number, next step = pay | Buyer | CHK-02 | order | C-ORD-02 | Go to payment | — | — | — | O1 | — |
| ORD-01 | Orders | Parent orders with derived status | Buyer | Tab | list | C-ORD-01 | Open | L1 | E1 | R1 | O1 | — |
| ORD-02 | Order detail | Per seller sub-order: SHIPPED → AWAITING_BUYER_RESPONSE (24 h window) → DELIVERED (entitled, awaiting admin release) → COMPLETED; timeline; deadlines | Buyer | ORD-01 / deep link | detail + allowedActions | C-ORD-02, C-ORD-03, C-SO-01..03 | Confirm receipt, report problem, request cancellation, return, dispute | L1 | — | R3, R5 | O1 actions off | Confirm receipt = explicit sheet ("this lets EDMN release the seller's money") |
| RET-01 | Request return | Items, reason, evidence (within return window) | Buyer | ORD-02 | window | C-RET-01 | Submit | L2 | — | R2 | O2 | — |
| RET-02/03 | Return detail / ship back | Status (10 states), carrier + tracking | Buyer | ORD-02 | return | C-RET-02..05 | Ship, escalate | L1 | E1 | R3 | O1 | — |
| DSP-01..03 | Disputes | Open (hold), thread, evidence, decision | Party | ORD-02 / DEAL-08 | dispute | C-DSP-01..04 | Message, add evidence | L1/L2 | E1 | R3 | O2 messages | Explains: opening a dispute **holds** funds |
| DEAL-01 | My Protected Deals | Buyer and deal-seller deals | User | Tab | list | C-DEAL-07 | Create, open | L1 | E1 | R1 | O1 | — |
| DEAL-02 | Deal wizard | 1 product (NEW/USED, category) · 2 price · 3 delivery expectation (method, latest date, inspection days 1–14) · 4 custom terms · 5 buyer location + optional seller hints | Buyer | DEAL-01 | draft | C-DEAL-01..03 | Save step, photos | L2 | — | R2; "Protected Deals coming soon" when SMS unavailable (PD-4) | O2 | Location encrypted server-side |
| DEAL-03 | Invite seller | Accept terms → link shown **once** → share sheet; refresh / revoke | Buyer | DEAL-02 | — | C-DEAL-04..06 | Share, refresh, revoke | L2 | — | R2 (identity not approved → KYC-01) | O0 | Link never logged; no PII in URL |
| DEAL-04 | Deal detail | State, role, counterparty (PII filtered by stage), timeline, deadlines, payment, evidence, OTP status | Party | DEAL-01 / push | dealGraph + allowedActions | C-DEAL-08, C-DEAL-09 | Server actions only | L1 | — | R3, R5 | O1 | Seller sees the buyer's first name only before payment |
| DEAL-05 | Offer review | Seller offer vN: price, shipping, fee split, delivery days, disclosure, return policy, condition snapshot | Buyer | DEAL-04 | terms | C-DEAL-09, C-DEAL-10 | Accept / request change (return policy) / reject | L3 | — | R3 (newer version; **fee changed** → seller must resend) | O0 | Sends `version`; identity APPROVED for accept |
| DEAL-06 | Frozen agreement | Agreed snapshot, version, fee snapshot, condition hash | Party | After accept | agreedTerms | C-DEAL-08 | Pay (C-DEAL-12) | L1 | — | R1 | O1 | Read-only |
| DEAL-07 | Handover code | Buyer: code sent by **SMS** (production); status, expiry, attempts left, regenerate | Buyer | Push / DEAL-04 when `DELIVERED` | OTP status | C-DEAL-13, C-DEAL-14 | Regenerate | L2 | "No active code" | R2, R6 | O0 | **X1, X2, X3.** Code never in push, logs or analytics. In-app code display needs D-3 |
| DEAL-08 | Receipt / problem | After DELIVERY_HANDOVER_VERIFIED: confirm OK or report (not received → delivery conflict, or problem → dispute); countdown to timeout entitlement | Buyer | Push / DEAL-04 | deadlines | C-DEAL-15..17 | Confirm, report | L3 | — | R3 | O0 | Explains that confirming creates entitlement and EDMN still reviews the release |
| INV-01 | Invitation landing | Safe summary (no buyer PII); sign in → accept / decline | Invited user | Deep link | summary | C-INV-01..03 | Accept, decline | L1 | Expired / used / bound to another | R2, R6 | O0 | Buyer cannot claim own link |
| DSL-01 | Offer composer | First offer: name, verified phone, location, payout details, offer, return policy, terms; counter offers | Deal seller | DEAL-04 | — | C-DSL-01, C-DSL-02, C-USED-01/02 | Submit, accept/reject change | L3 | — | R2 (phone not verified, identity) | O2 | Payout details encrypted; X1 on payout fields |
| DSL-02 | Mark shipped | Note + up to 6 proofs → OTP sent to the buyer | Deal seller | DEAL-04 (`ACTIVE`) | — | C-DSL-03 | Submit | L3 | — | R3 | O2 | EXIF stripped |
| DSL-03 | Enter handover code | 6-digit code from the buyer; attempts left | Deal seller | DEAL-04 (`DELIVERED`) | — | C-DSL-04, C-DEAL-14, C-DEAL-17 | Verify, request new code, report exception | L3 | — | R2 (wrong / locked / expired), R6 | O0 | Input never logged; only the seller can submit |
| KYC-01 | Identity verification | Status; submit national ID front/back | User | Guards (order, deal, payment, withdrawal) | identity | C-KYC-01/02 | Submit | L2 | — | R2 | O2 (encrypted temp files) | X1; never saved to gallery |
| RCV-01 | Receiving destinations | Verified payout destinations (masked) for deal payouts and refunds | User | ACC-01 / ERN | list | C-RCV-01..03, C-RFD-01 | Add (review), archive, choose for refund | L1 | E1 | R4 | O0 | Step-up (SU\*); X1 |
| ERN-01/02 | Earnings / withdraw | Protected Deal payables, withdrawals; preview cost; request | User | ACC-01 | earnings | C-ERN-01..04 | Preview, request, cancel | L1/L3 | E1 | R2, R4 | O1 read-only | `clientKey`; step-up |
| NTF-01/02 | Notifications | Inbox + preferences + this device's push | User | Bell / push | — | C-NTF-01..06 | Read, prefs | L1 | E1 | R1 | O1 | Lock-screen-safe payloads |
| MSG-01/02 | Messages | Order and deal conversations | Party | DEAL-04 / ORD-02 | threads | C-MSG-01..05 | Send, report | L1 | E1 | R2 (locked) | O2 drafts | Attachments private |
| SUP-01..03 | Support | Tickets: open, thread, reopen, rate | User | ACC-01 / R2 | tickets | C-SUP-01..06 | Open, reply | L1 | E1 | R1 | O2 | Reference attached |
| SEC-01 | Security & sessions | Change password, sessions and devices, revoke others | User | ACC-01 | sessions | C-AUTH-07, C-AUTH-10..12 | Revoke | L1 | — | R4 | O0 | Step-up for revoke |
| ACC-01..05 | Account | Profile, addresses, store invitations, closure (store requirement), language | User | Tab | me | C-ACC-01..06, C-ADDR-* | Edit, close account | L1 | — | R2 (closure blockers) | O1 | Closure blocked while money is pending |
| LEG-01 | Legal | Versioned legal texts | Any | Footer / AUTH-03 | legal | P-CAT-09 | — | L1 | — | R1 | O1 | — |

**Buyer screens: 46 rows** (some rows group 2–3 closely related screens).

## 3. Seller Center screens

Seller Center runs inside the Customer App. Access is gated by `sellerContextForUser` and the seller permissions `store.manage`, `products.manage`, `inventory.manage`, `orders.manage`, `orders.communicate`, `returns.manage`, `finance.view`, `finance.withdraw`, `payout.manage`, `reviews.respond`, `support.use` and `staff.manage`.

| ID | Screen | Purpose | Seller perm | Data | API | Actions | Load | Empty | Error | Offline | Security |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SC-00 | Gate | Route by seller status (DRAFT, PENDING_REVIEW, MORE_INFO_REQUIRED, APPROVED, RESTRICTED, SUSPENDED, REJECTED) | — | context | S-CTX-01, S-ONB-07 | — | L1 | — | R1 | O0 | Server status is the authority |
| SC-01 | Application wizard | Type → identity → business → store → documents → submit | applicant | checklist | S-ONB-01..07 | Save steps, upload, submit | L2/L3 | — | R2 | O2 | Documents X1; EXIF stripped |
| SC-02 | Seller 2FA | Optional TOTP | owner | — | S-2FA-01/02 | Enroll, verify | L2 | — | R2 | O0 | Secret shown once |
| SC-10 | Dashboard | KPIs, health, to-do | any | dashboard | S-DSH-01 | Navigate | L1 | E1 | R1 | O1 | Server figures |
| SC-20 | Products | Statuses: DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, LIVE, REJECTED, SUSPENDED, ARCHIVED | products.manage | list | S-PRD-01 | Open, new | L1 | E1 | R1 | O1 | — |
| SC-21 | Product editor | Details, logistics, variants, images, used condition report, submit / withdraw | products.manage | product | S-PRD-02..09, S-USED-01 | Save, submit | L2 | — | R3 (If-Match) | O2 | Prohibited-item notice |
| SC-22 | Inventory | Stock per variant (available = on hand − reserved) | inventory.manage | variants | S-INV-01 | Set stock | L2 | — | R2 | O0 | — |
| SC-30 | Orders | PAID, SELLER_CONFIRMED, PROCESSING, READY_TO_SHIP, SHIPPED, AWAITING_BUYER_RESPONSE, DELIVERED, COMPLETED, DELIVERY_FAILED, CANCELLED | orders.manage | list | S-ORD-01 | Open | L1 | E2 | R1 | O1 | Scoped to store |
| SC-31 | Order detail | Items, buyer delivery info, deadlines (`sellerResponseDueAt`, `shipByDueAt`), allowedActions | orders.manage | detail | S-ORD-02..11 | Confirm, advance, shipment, ship, tracking, delivery evidence, cancel, cancellation decisions, exceptions | L1/L2 | — | R3 | O1 | A seller statement never proves delivery |
| SC-32 | Returns | Approve/reject, received, inspection, refund request | returns.manage | returns | S-RET-01..04 | Decide | L1 | E1 | R3 | O0 | — |
| SC-33 | Disputes & reviews | Respondent disputes, review responses | orders.manage / reviews.respond | list | S-DSP-01, S-REV-01, C-DSP-04 | Message, respond | L1 | E1 | R1 | O2 | — |
| SC-40 | Shipping rates | Governorates × {enabled, fee, ETA min/max} | store.manage | rates | S-SHP-01/02 | Save | L1/L2 | E1 | R2 | O2 | — |
| SC-41 | Store settings | Profile, logo, policies | store.manage | store | S-STR-01/02 | Save | L2 | — | R3 | O0 | — |
| SC-42 | Payout methods | Bank / InstaPay / wallet (masked); PENDING_VERIFICATION; change starts payout hold | payout.manage | methods | S-PAY-01/02 | Add | L2 | E1 | R4 | O0 | Step-up (SU\*); X1 |
| SC-50 | Balance | Pending / available / reserved (ledger projection) and holds | finance.view | balance | S-FIN-01/02 | Withdraw | L1 | E1 | R1 | O1 stale label | No client math |
| SC-51 | Withdraw | Preview transfer cost → request; list and cancel | finance.withdraw | quote | S-FIN-03..06 | Request, cancel | L3 | E1 | R2 (hold, min amount, identity), R4 | O0 | `clientKey`; step-up |
| SC-60 | Team | Invitations, members, roles | staff.manage | staff | S-STF-01..04 | Invite, revoke, remove | L2 | E1 | R4 | O0 | Step-up |
| SC-70 | Seller inbox / notifications / support | Conversations, notifications, tickets | orders.communicate / support.use | — | S-MSG-01, C-NTF-*, C-SUP-* | — | L1 | E1 | R1 | O2 | — |

**Seller Center screens: 18 rows.** Protected Deal selling uses DEAL-*, INV-01 and DSL-*, because deals are user-level and need no store.

## 4. Admin App: navigation

```
Login ADM-01 ─► MFA ADM-02 (enroll ADM-03) ─► Home ADM-10
Sections (shown by permission; the server always enforces):
 Queues      ADM-11 Approvals (maker/checker) · ADM-12 Alerts/Operations
 People      ADM-20 Customers ─► ADM-21 360 · ADM-22 Identity ─► ADM-23 case · ADM-24 Sellers ─► ADM-25 360 · ADM-26 Seller verification · ADM-27 Receiving destinations · ADM-28 Closures
 Commerce    ADM-30 Moderation ─► ADM-31 product · ADM-32 Orders ─► ADM-33 360 · ADM-34 Shipping evidence · ADM-35 Returns
 Protection  ADM-40 Deals ─► ADM-41 Deal 360 · ADM-42 Disputes ─► ADM-43 360 · ADM-44 Risk flags · ADM-45 Messages reports
 Finance     ADM-50 Overview/controls · ADM-51 Payments ─► ADM-52 verify · ADM-53 Releases · ADM-54 Refunds · ADM-55 Withdrawals ─► ADM-56 detail · ADM-57 Ledger/adjustments · ADM-58 Reconciliation · ADM-59 Settlements · ADM-60 Pricing approvals · ADM-61 Payment destinations
 Service     ADM-70 Support ─► ADM-71 ticket · ADM-72 Reviews · ADM-73 Used passports
 Governance  ADM-80 Staff & roles · ADM-81 Audit · ADM-82 Settings (incl. real-money status) · ADM-83 System health · ADM-84 My sessions/devices
Step-up overlay ADM-SU on STEP_UP_REQUIRED
```

**Admin App global rules:**

- X1 and X3 on every screen.
- Auto-lock when backgrounded.
- Idle timeout equals the server `ADMIN_IDLE_TIMEOUT_MINUTES`.
- PII is masked by default.
- Reveals (national ID, payout or refund destination) are separate step-up, audited calls.

## 5. Admin screens

| ID | Screen | Permission(s) | Data | Actions | Sensitive | Fresh 2FA | Maker/Checker | Audit | API |
|---|---|---|---|---|---|---|---|---|---|
| ADM-01/02/03 | Login, MFA, enroll | staff | — | Login, TOTP | Credentials | n/a (is MFA) | — | ✔ | A-AUTH-01..03 |
| ADM-SU | Step-up | any | — | TOTP | — | **is step-up** | — | ✔ | A-AUTH-04 |
| ADM-10 | Dashboard | dashboard.view | KPIs, queue counts, SLA breaches | Navigate | — | — | — | — | A-DSH-01 |
| ADM-11 | Approvals | finance.movement.request; checker perms per kind | Open movement requests (maker, amount, entity) | Request (maker), reject (checker), cancel (own) | Money | ✔ | **Yes** (DB-enforced) | ✔ | A-APR-01, F-MOV-01..03 |
| ADM-12 | Alerts / operations | dashboard.view | Alerts, SLA queues | Open | — | — | — | — | A-OPS-01 |
| ADM-20/21 | Customers / 360 | customers.view / customers.manage | Masked profile, orders, deals, disputes, tickets, identity, sessions | Disable/enable, revoke sessions | Account access | ✔ (SU\*) | — | ✔ | A-CUS-01..04 |
| ADM-22/23 | Identity queue / case | identity.view, identity.review, identity.documents.view | Case, documents (watermarked), version | Approve/reject, reveal ID number | PII | ✔ | Never self-review | ✔ | A-IDN-01..04, C-FILE-01 |
| ADM-24/25/26 | Sellers / 360 / verification | sellers.view, sellers.review, sellers.suspend, sellers.documents.view, sellers.payout.verify | Application, documents, products, orders, balances, payout-method history | Approve / reject / more info, restrict / suspend / reinstate, verify payout method, reveal national ID | Payout destination, PII | ✔ (payout, reveal; SU\* decisions) | 2P on payout verification | ✔ | A-SEL-01..06 |
| ADM-27 | Receiving destinations | destinations.review, destinations.view_full | Queue, versions | Approve/reject, reveal | Payout destination | ✔ | Owner ≠ reviewer | ✔ | A-RCV-01..03 |
| ADM-28 | Closures | customers.view / customers.manage | Pending closures, blockers | Complete | Account deletion | ✔ | — | ✔ | A-CLS-01/02 |
| ADM-30/31 | Moderation / product | products.moderate | Queue, product, revision | Approve/reject/request changes, takedown | — | — | — | ✔ | A-PRD-01..03 |
| ADM-32/33 | Orders / 360 | orders.view, orders.manage, delivery.verify | Sub-orders, payments, shipments, evidence, ledger refs, timeline | Hold/lift, cancel, delivery event, exceptions, cancellation decisions | Money (hold lift) | ✔ (lift, delivery event) | — | ✔ | A-ORD-01..08 |
| ADM-34 | Shipping evidence | shipping.view, delivery.verify | Waybills, evidence | Establish delivery | — | ✔ | — | ✔ | A-ORD-05..07 |
| ADM-35 | Returns | returns.manage | Queue, detail | Approve/reject/refund request | — | — | — | ✔ | A-RET-01/02 |
| ADM-40/41 | Deals / Deal 360 | deals.view, deals.manage | Graph, terms history, OTP events (**never the code**), payment, evidence, flags | Hold / unhold | Money | ✔ | Not a party | ✔ | A-DEAL-01..03 |
| ADM-42/43 | Disputes / 360 | disputes.manage | Both parties' evidence, messages, held amount | Status, assign, message (internal), **resolve** (FULL_REFUND, PARTIAL_REFUND, RETURN_REQUIRED, REPLACEMENT, RELEASE_TO_SELLER, REJECT_CLAIM), close | Money outcome | ✔ (resolve) | Decision ≠ money; money needs maker/checker | ✔ | A-DSP-01..06 |
| ADM-44 | Risk flags | deals.manage / sellers.suspend | Open flags | Resolve | Release blocker | ✔ | **Blocked until T-1** | ✔ | A-RISK-01 |
| ADM-45 | Message reports / conversations | messages.view, messages.moderate | Reports, threads (access grant) | Grant access, hide, resolve, lock | Private communications | — | — | ✔ (privileged access) | A-MSG-01..03 |
| ADM-50 | Finance overview & controls | finance.view, finance.controls | Control balances, invariants, ledger health, kill switches, go-live gate | Kill switch, close day, run ledger health | Platform money | ✔ | — | ✔ | F-OVR-01..03, F-LED-03 |
| ADM-51/52 | Payments / verify | payments.view, payments.verify | Proofs, claimed vs due, history | Start review, confirm, reject / new proof | **Creates ledger liability** | ✔ | Approval (payer ≠ verifier) | ✔ | A-PAY-01..05 |
| ADM-53 | Releases | finance.release (+ finance.movement.request for maker) | Entitled sub-orders and deals, blockers, expected amount | Maker request; **checker release** | Money | ✔ | **Yes** | ✔ | F-REL-01..03, F-MOV-01 |
| ADM-54 | Refunds | refunds.approve, refunds.pay, refunds.destination.override | Queue, detail, destination | Approve (checker), reject, record payout, failed, revoke, destination override/re-approve/reveal | Money | ✔ | **Yes** | ✔ | F-RFD-01..08 |
| ADM-55/56 | Withdrawals / detail | withdrawals.view, withdrawals.approve, withdrawals.pay | Queue, allocations, destination snapshot, transfer quote | Review, approve (reserve), processing, paid, reject, uncertain, failed-before-transfer, returned, reveal | Money | ✔ | **Yes** (payer ≠ approver; reversal checker) | ✔ | F-WD-01..11 |
| ADM-57 | Ledger & adjustments | finance.view, ledger.adjust.create, ledger.adjust.approve | Journals (read-only), adjustments | Create adjustment (maker), decide (checker) | Money | ✔ | **Yes** | ✔ | F-LED-01/02, F-ADJ-01..03 |
| ADM-58 | Reconciliation | reconciliation.manage | Imports, external transactions, candidates | Import (Web preferred), match, set state | Evidence | ✔ (SU\*) | Recommended for IGNORE (S-M4) | ✔ | F-REC-01..04 |
| ADM-59 | Settlements | settlements.manage | Batches | Run now | Creates withdrawal requests | ✔ | Each payout is still two-person | ✔ | F-STL-01/02 |
| ADM-60 | Pricing approvals | pricing.view, pricing.approve, pricing.publish | Submitted versions (diff, simulation summary) | Approve, publish/schedule | Future fees | ✔ | **Yes** (approver ≠ submitter, DB CHECK) | ✔ | F-PRC-01/02 |
| ADM-61 | Payment destinations | payments.destinations.manage | Methods, destinations (test flag) | Enable/disable/edit | Where buyers send money | ✔ (SU\*) | — | ✔ | F-DST-01 |
| ADM-70/71 | Support | support.manage, support.escalate, support.qa | Queue (SLA), thread | Reply, update, escalate, reopen, QA | — | — | — | ✔ | A-SUP-01..03 |
| ADM-72 | Reviews | reviews.moderate | Reported reviews | Moderate | — | — | — | ✔ | A-REV-01 |
| ADM-73 | Used passports | products.moderate | Passports, inspections | Verify, record inspection | — | — | — | ✔ | A-USED-01 |
| ADM-80 | Staff & roles | roles.manage (privileged → SUPER_ADMIN) | Staff, roles, permission matrix | Create staff (invite), grant/revoke role, disable, edit role permissions | Privilege | ✔ | Privileged changes SUPER_ADMIN + reason; never self | ✔ | A-STF-01..05 |
| ADM-81 | Audit | audit.view | Events | Filter | — | — | — | (access audited) | A-AUD-01 |
| ADM-82 | Settings | settings.manage | All settings; real-money status and go-live blockers | Update (sensitive keys need step-up; real money behind the gate) | Platform | ✔ | Recommended two super-admins for real money (F-2) | ✔ | A-SET-01/02 |
| ADM-83 | System health | dashboard.view / finance.controls | DB, jobs, providers, outbox, dead letters, ledger health | Requeue dead letter | — | — | — | ✔ | A-OPS-01/02 |
| ADM-84 | My sessions / devices | self | Sessions | Revoke | — | ✔ | — | ✔ | A-AUTH-05..07 |

**Admin screens: 36 rows**, covering all 53 launch-critical Web Admin pages.

**Desktop-only, justified** (Web Admin): category, brand and attribute trees; CMS and legal authoring; fee-table drafting and simulator; profitability analytics; bulk exports; policy and score-rule tuning; notification templates. Their approve and publish steps are on mobile (ADM-60, A-CMS-01).
