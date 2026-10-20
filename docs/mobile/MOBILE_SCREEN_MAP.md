# EDMN Mobile: Screen Map

Companion to `MOBILE_PHASE_0_AUDIT.md` (Phase 0G and 0H). This is a planning artifact only. **No screen is implemented.**

API IDs refer to `MOBILE_API_GAP_MATRIX.md` §3. **All of those APIs are currently MISSING.**

---

## 0. Shared state patterns

Rows reference these codes so the tables stay readable. Every screen implements its referenced patterns exactly.

| Code | Pattern |
|---|---|
| **L1** | Skeleton matching the final layout. Pull-to-refresh on lists |
| **L2** | Inline button spinner. The button is disabled and the idempotency key is reused on retry |
| **L3** | Blocking progress sheet with a "don't close the app" hint. Used only for money and agreement actions |
| **E1** | Empty illustration, one-line reason, primary CTA |
| **E2** | Empty-filter state with a "clear filters" action |
| **R1** | Network error: inline banner with retry. Cached data stays visible, marked "last updated hh:mm" |
| **R2** | problem+json error: localized message from `code`, plus "Contact support" pre-filled with `trace_id` |
| **R3** | `409`/`412` conflict: "This item changed" sheet that refetches and shows the new state. Never auto-retries a mutation |
| **R4** | `401 step_up_required`: step-up flow, then retry with the same idempotency key |
| **R5** | `403`: "You don't have access" with no data leak, logged |
| **O0** | Online only. Offline shows a full-screen "No connection" with retry |
| **O1** | Read from the Drift cache with a staleness label. Writes are disabled offline |
| **O2** | Draft saved locally (Drift). Submit is disabled until online |
| **X1** | Screenshot and app-switcher protection on this screen |
| **X2** | Biometric gate before showing the screen |
| **X3** | No disk caching of the screen's data |

Additional global rules:

- **RTL.** Arabic RTL is the default. English is LTR.
- **Server-driven actions.** All action buttons come from the server's `allowed_actions`. They are never inferred locally.
- **Money.** Amounts are display-only values from the server (piastres, EGP).

---

## 1. Customer App: navigation hierarchy

```
Launch ─► Splash (APP-01) ─► [force-update gate] ─► Onboarding (AUTH-01, first run)
                                                   └► Auth stack (AUTH-02..05)
Root (signed-in or guest browse) — bottom tabs:
 ├─ Home tab:        HOME-01 ─► CAT-01 ─► CAT-02 (list) ─► PRD-01 ─► STR-01
 │                   SRCH-01 ─► SRCH-02
 ├─ Deals tab:       DEAL-01 (list) ─► DEAL-02 (create) ─► DEAL-03 (share invite)
 │                                  └► DEAL-04 (detail) ─► DEAL-05 (offer review) ─► DEAL-06 (agreement)
 │                                                     └► PAY-01..03 ─► PT-01 (tracking) ─► PT-02 (OTP) ─► PT-03 (confirm)
 ├─ Cart tab:        CART-01 ─► CHK-01 (address/governorate) ─► CHK-02 (review per seller) ─► PAY-01..03 ─► CHK-03 (result)
 ├─ Orders tab:      ORD-01 ─► ORD-02 (detail = PT view) ─► PT-01/02/03, RET-01..03, DSP-01..03
 └─ Account tab:     ACC-01 ─► ACC-02..08, WAL-01..02, NTF-01..02, SUP-01..03, LEG-01
                     └► "Seller Center" entry ─► SC-* (separate stack, role-gated)
Deep links: /i/{token} ─► INV-01 ; /deal/{id} ─► DEAL-04 ; /order/{id} ─► ORD-02 ; /pt/{id} ─► PT-01
```

Guests can browse HOME, CAT, PRD, STR and SRCH. Any action that writes (adding to the cart, creating a deal, accepting an invitation) goes through the Auth stack and then returns to the original screen.

---

## 2. Buyer screens

| ID | Screen | Purpose | Actor | Entry point | Data required | API | Actions | Loading | Empty | Error | Offline | Security |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| APP-01 | Splash / bootstrap | Load config, force-update check, restore session | Any | Launch | min version, flags, `real_money_enabled` | API-APP-01, API-AUTH-04 | — | Logo | — | R1, then retry | Uses the cached config if it is under 24 h old. Otherwise O0 | Tokens read from secure storage only |
| AUTH-01 | Onboarding | Value proposition, language choice (ar/en) | Guest | First run | static | — | Choose language, continue | — | — | — | Works offline | — |
| AUTH-02 | Phone entry | Enter an Egyptian mobile number | Guest | CTA or protected action | — | API-AUTH-01 | Request OTP | L2 | — | R2. Rate-limited message shows a countdown | O0 | `+20` validation. Generic response |
| AUTH-03 | OTP verify | 6-digit SMS code | Guest | AUTH-02 | challenge ID | API-AUTH-02 | Verify, resend (cooldown) | L2 | — | R2. Attempts left | O0 | Autofill `oneTimeCode`. Never logged |
| AUTH-04 | Complete profile | Name, e-mail (optional), accept terms version | New user | AUTH-03 | terms version | API-AUTH-03, API-CMS-02 | Submit | L2 | — | R2 | O0 | Terms version recorded server-side |
| AUTH-05 | App lock setup | Opt-in biometric unlock | User | After signup | — | — | Enable or skip | — | — | — | Works offline | Biometric is local only. It is not a server credential |
| HOME-01 | Home | Banners, categories, featured products, "Start a Protected Deal" CTA | Any | Tab | layout, categories | API-CMS-01, API-CAT-01 | Navigate | L1 | E1 | R1 | O1 | — |
| CAT-01 | Categories | Category tree | Any | Home or tab | tree | API-CAT-01 | Drill down | L1 | E1 | R1 | O1 | — |
| CAT-02 | Product list | Products in a category, filters (new/used, price, governorate ships-to) | Any | CAT-01 | paged products | API-CAT-02 | Filter, sort, open product | L1 | E2 | R1 | O1 | — |
| SRCH-01 | Search | Query with recent searches | Any | Home | recents (local) | API-CAT-03 | Search | L1 | E1 | R1 | Recents work offline. Search needs O0 | Recents are stored locally and cleared on logout |
| SRCH-02 | Search results | Products and stores | Any | SRCH-01 | results | API-CAT-03 | Filter, open | L1 | E2 | R1 | O0 | — |
| PRD-01 | Product detail | Media, price, condition (new/used), seller, shipping quote to my governorate, protection badge | Any | Lists or deep link | product, quote | API-CAT-04, API-CAT-08 | Add to cart, choose variant, view store | L1 | — | R1. A 404 shows "No longer available" | O1 (price marked stale, add disabled) | Price shown is indicative. The server reprices at checkout |
| STR-01 | Store page | Store profile, rating, products, ships-to governorates | Any | PRD-01 or search | store, products | API-CAT-05, API-CAT-06 | Browse, start a Protected Deal with this store | L1 | E1 | R1 | O1 | Public projection only |
| CART-01 | Cart | Items grouped by seller, server-priced subtotals and shipping | Buyer | Tab | cart | API-CART-01..04 | Change quantity, remove, checkout | L1 | E1 | R1, R3 | O1 (read-only) | No client totals. All figures come from the server |
| CHK-01 | Address & governorate | Select or add an address. Shipping is re-quoted | Buyer | CART-01 | addresses | API-ACC-04..05, API-CART-05 | Select, add address | L1 | E1 (add address) | R2 | O0 | — |
| CHK-02 | Checkout review | Per-seller groups, ETA per seller, fees, total, protection explanation, expiry timer | Buyer | CHK-01 | checkout | API-CHK-01..02 | Pay, cancel | L3 | — | R2, R3 (price or stock changed) | O0 | Quote is frozen server-side. Confirmation sheet |
| PAY-01 | Payment method | Methods available (sandbox banner while real money is off) | Buyer | CHK-02 / DEAL-06 | methods | API-PAY-03, API-PAY-01 | Choose, pay | L3 | E1 (no methods) | R2 | O0 | **"TEST MODE – no real money" banner whenever `real_money_enabled=false`** |
| PAY-02 | PSP handoff | Hosted PSP page or SDK, or reference code (e.g. Fawry ref) | Buyer | PAY-01 | intent | API-PAY-01 | Complete or abandon | L3 | — | R2 | O0 | Hosted fields only. **The app never touches card data** |
| PAY-03 | Payment status | Poll until verified, failed or expired | Buyer | PAY-02 | intent status | API-PAY-02 | Retry or back | L1 (polling with backoff) | — | R1 | O0, resumes on reconnect | The app never decides "paid". It only shows the server status |
| CHK-03 | Checkout result | Orders created per seller | Buyer | PAY-03 | orders | API-ORD-01 | View orders | L1 | — | R1 | O1 | — |
| ORD-01 | Orders list | Orders and their PT state badges | Buyer | Tab | paged orders | API-ORD-01 | Open, filter | L1 | E1 | R1 | O1 | — |
| ORD-02 | Order detail | PT state, timeline, seller, items, `allowed_actions`, deadlines | Buyer | ORD-01 or deep link | order + PT | API-ORD-02, API-PT-01 | Server-provided actions only (cancel, confirm, dispute, return…) | L1 | — | R1, R5 | O1 (actions disabled) | Ownership is checked server-side (IDOR) |
| DEAL-01 | My Protected Deals | Buyer- and seller-side deals with state badges | Buyer | Tab | deals | API-DEAL-02 | Create, open | L1 | E1 ("Start your first Protected Deal") | R1 | O1 | — |
| DEAL-02 | Create deal request | Item or service description, type (delivery or payment guarantee), expected price, governorate, photos, counterparty (store or invite link) | Buyer | DEAL-01, STR-01 | — | API-DEAL-01, API-DEAL-04, API-UPL-01 | Save draft, submit | L2 | — | R2 | O2 | Uploads have EXIF and GPS stripped |
| DEAL-03 | Share invitation | Invite link and QR code, share sheet, expiry | Buyer | DEAL-02 submit | invitation | API-DEAL-05, API-DEAL-07 | Share, regenerate | L2 | — | R2 | O0 | Link shown once. Regenerating invalidates the old one. No PII in the URL |
| DEAL-04 | Deal detail | State, offers history, counterparty, deadlines, timeline | Buyer | DEAL-01 or deep link | deal | API-DEAL-03 | Server actions | L1 | — | R1, R5 | O1 | — |
| DEAL-05 | Offer review | Offer vN vs. request diff, price, fees, shipping, ETA, terms | Buyer | DEAL-04 | offer | API-DEAL-03, API-DEAL-09..11 | Accept, request changes, reject | L3 | — | R3 (newer offer exists) | O0 | Accept sends `If-Match` with the offer version. Confirmation sheet |
| DEAL-06 | Frozen agreement | Immutable snapshot, agreement hash, fee breakdown, deadlines. Proceed to pay | Buyer | DEAL-05 accept | agreement | API-DEAL-12 | Pay, download PDF | L1 | — | R1 | O1 | Read-only. Shows the hash |
| PT-01 | Delivery tracking | Shipment status, seller evidence, ETA | Buyer | ORD-02 / DEAL-04 | PT, shipment | API-PT-01..02 | View evidence | L1 | — | R1 | O1 | Evidence through signed URLs |
| PT-02 | Delivery OTP | Reveal the code to hand to the seller or courier at delivery. Expiry countdown | Buyer | Push, PT-01 | OTP (on reveal) | API-PT-03..04 | Reveal, re-issue | L2 | — | R2 (locked or expired → re-issue) | O0 | **X1, X2, X3.** Never in a push payload. Never logged. Hidden again after 60 s |
| PT-03 | Confirm receipt | Explains that confirming releases funds to the seller. Option to report a problem instead | Buyer | ORD-02 / PT-01 | PT | API-PT-05 | Confirm, open dispute, request return or replacement | L3 | — | R3 | O0 | Explicit confirmation (hold-to-confirm) |
| RET-01 | Request return / replacement | Reason, photos, choice of return or replacement | Buyer | ORD-02 | eligibility from `allowed_actions` | API-RET-01, API-RET-04, API-UPL-01 | Submit | L2 | — | R2 | O2 | — |
| RET-02 | Return / replacement detail | Status, deadlines, instructions | Buyer | ORD-02 | return | API-RET-02, API-RET-05 | Ship back (evidence) | L1 | — | R1 | O1 | — |
| RET-03 | Return shipping evidence | Tracking number and photo | Buyer | RET-02 | — | API-RET-03 | Submit | L2 | — | R2 | O2 | — |
| DSP-01 | Open dispute | Reason, description, evidence. Explains the hold and the 48 h evidence windows | Buyer | ORD-02 / PT-03 | — | API-DSP-01, API-UPL-01 | Submit | L3 | — | R2, R3 | O2 | — |
| DSP-02 | Dispute detail | Status, deadlines, messages, decision | Parties | DSP-01, NTF | dispute | API-DSP-02, API-DSP-04, API-DSP-05 | Message, withdraw | L1 | — | R1 | O1 | — |
| DSP-03 | Add evidence | Upload files | Parties | DSP-02 | — | API-DSP-03, API-UPL-01 | Upload | L2 | — | R2 | O2 | File type and size allow-list |
| INV-01 | Invitation landing | Seller sees a minimal deal preview, signs in or registers, then accepts | Invited seller | Deep link `/i/{token}` | preview | API-DEAL-06, API-DEAL-08 | Accept, decline | L1 | Invalid or expired token message | R2 | O0 | No buyer PII before acceptance. Token is single-use |
| WAL-01 | Balances | Read-only projections: held in protection, refunds due | Buyer | ACC-01 | balances | API-WAL-01 | — | L1 | E1 | R1 | O1 (stale label) | **Projection only.** Never computed client-side |
| WAL-02 | Transactions | History from ledger-derived lines | Buyer | WAL-01 | lines | API-WAL-02 | Filter, open the related order or deal | L1 | E1 | R1 | O1 | — |
| NTF-01 | Notifications inbox | Notifications | Any user | Bell or push | list | API-NTF-01..02 | Open, mark read | L1 | E1 | R1 | O1 | — |
| NTF-02 | Notification settings | Channel preferences | User | ACC-01 | prefs | API-NTF-05 | Toggle | L2 | — | R2 | O0 | — |
| SUP-01 | Support home | FAQ, my tickets, new ticket | User | ACC-01 | tickets | API-SUP-03, API-CMS-02 | Open, create | L1 | E1 | R1 | O1 | — |
| SUP-02 | New ticket | Category, linked order or deal, message, attachment | User | SUP-01, R2 | — | API-SUP-02, API-UPL-01 | Submit | L2 | — | R2 | O2 | `trace_id` attached |
| SUP-03 | Ticket thread | Messages | User | SUP-01 | thread | API-SUP-04..05 | Reply | L1 | — | R1 | O1 | — |
| ACC-01 | Account home | Profile summary, role switch to Seller Center, links | User | Tab | me | API-ACC-01 | Navigate | L1 | — | R1 | O1 | — |
| ACC-02 | Edit profile | Name, e-mail | User | ACC-01 | me | API-ACC-02 | Save | L2 | — | R2, R3 | O0 | — |
| ACC-03 | Addresses | List, add, edit addresses (governorate, city, details) | User | ACC-01 | addresses | API-ACC-04..05, API-CAT-07 | CRUD | L1 | E1 | R2 | O1 | — |
| ACC-04 | Change phone | OTP to the old and new numbers | User | ACC-01 | — | API-ACC-03 | Change | L2 | — | R2, R4 | O0 | Step-up |
| ACC-05 | Security & sessions | Devices and sessions, revoke one or all, app lock | User | ACC-01 | sessions | API-AUTH-06..08 | Revoke | L1 | — | R2, R4 | O0 | Revoke-all needs step-up |
| ACC-06 | Language | ar / en | User | ACC-01 | — | — | Switch | — | — | — | Works offline | — |
| ACC-07 | Delete account | Store-required deletion request | User | ACC-01 | blockers (open deals) | API-ACC-06 | Request | L2 | — | R2, R4 | O0 | Blocked while funds are held |
| ACC-08 | Logout | Wipe tokens, cache and Drift | User | ACC-01 | — | API-AUTH-05 | Logout | L2 | — | Wipes locally even if the API fails | Works offline (local wipe) | — |
| LEG-01 | Legal | Terms, privacy, refund policy (versioned) | Any | ACC-01, AUTH-04 | content | API-CMS-02 | Read | L1 | — | R1 | O1 | — |

**Buyer screen count: 54.**

---

## 3. Seller Center screens

Seller Center runs inside the Customer App. Access is checked by role on the server for every call.

```
ACC-01 ─► SC-00 (gate: no application → SC-01; pending → SC-03; approved → SC-10)
SC-10 Dashboard ─┬─ Products: SC-20 ─► SC-21 (editor) ─► SC-22 (media) ─► SC-23 (inventory)
                 ├─ Orders:   SC-30 ─► SC-31 (detail) ─► SC-32 (ship evidence) ─► SC-33 (out for delivery) ─► SC-34 (OTP entry)
                 │                                     └► SC-35 (returns/replacements)
                 ├─ Deals:    SC-40 (requests) ─► SC-41 (request detail) ─► SC-42 (offer composer)
                 ├─ Money:    SC-50 (balance) ─► SC-51 (statement) ─► SC-52 (withdraw) ─► SC-53 (withdrawals) ; SC-54 (payout account)
                 ├─ Store:    SC-60 (profile) ; SC-61 (shipping rates by governorate) ; SC-62 (team)
                 └─ SC-70 notifications (shared NTF-01, seller filter) ; SC-71 support (shared SUP-*)
```

| ID | Screen | Purpose | Actor | Entry | Data required | API | Actions | Loading | Empty | Error | Offline | Security |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC-00 | Seller gate | Route by application, KYC and store status | User | ACC-01 | me, application | API-ACC-01, API-SEL-02 | — | L1 | — | R1 | O0 | Server status is the authority |
| SC-01 | Seller application | Individual or merchant, store name, category, governorate, commercial registry (merchant) | User | SC-00 | — | API-SEL-01 | Submit | L2 | — | R2 | O2 | — |
| SC-02 | KYC capture | National ID front and back, selfie, CR document (merchant). Guided capture | Applicant | SC-01 | requirements | API-KYC-01..03, API-UPL-01 | Capture, upload, submit | L2 / L3 | — | R2 | O2 (local temp files are encrypted and deleted after upload) | **X1.** EXIF stripped. Not saved to the gallery. Not readable back after submit |
| SC-03 | Application status | Pending, more info needed, or rejected with reasons | Applicant | SC-00 | case | API-KYC-04, API-SEL-02 | Fix and resubmit | L1 | — | R1 | O1 | Shows reasons only. No document URLs |
| SC-10 | Seller dashboard | Server KPIs: new orders, to ship, open disputes, available balance | Store member | SC-00 | dashboard | API-SEL-06 | Navigate | L1 | E1 | R1 | O1 | Figures come from the server |
| SC-20 | Products | List with moderation status | Member (catalog) | SC-10 | products | API-SPR-01 | New, edit, publish | L1 | E1 | R1 | O1 | — |
| SC-21 | Product editor | Title (ar/en), category, condition (new or used with notes), price, variants, description | Member (catalog) | SC-20 | product | API-SPR-02..05 | Save draft, submit or publish | L2 | — | R2, R3 | O2 | Prohibited-items notice |
| SC-22 | Product media | Photos and reorder | Member | SC-21 | media | API-SPR-06, API-UPL-01 | Upload, delete | L2 | E1 | R2 | O2 | Size and type limits |
| SC-23 | Inventory | Stock per variant | Member | SC-20 / SC-21 | levels | API-SPR-07 | Set stock | L2 | — | R3 | O0 | `If-Match` |
| SC-30 | Store orders | Tabs: new, to ship, in delivery, delivered, issues | Member (orders) | SC-10 | orders | API-SOR-01 | Open | L1 | E2 | R1 | O1 | Scoped to the store |
| SC-31 | Order detail | Buyer delivery info (shipping-necessary fields only), items, PT state, deadlines | Member | SC-30 | order | API-SOR-02 | Server actions | L1 | — | R1, R5 | O1 | Buyer PII minimized |
| SC-32 | Shipping evidence | Courier, tracking number, photos of the parcel | Member | SC-31 | — | API-SOR-04, API-UPL-01 | Submit | L2 | — | R2, R3 | O2 | EXIF stripped |
| SC-33 | Out for delivery | Trigger OTP issue to the buyer. Explains the buyer will receive the code | Member | SC-31 | — | API-SOR-05 | Confirm | L2 | — | R3 | O0 | **The seller never sees the OTP** |
| SC-34 | Enter delivery OTP | Enter the code the buyer gives at handover. Attempts remaining | Member | SC-31 | attempts left | API-SOR-06 | Verify | L2 | — | R2 (wrong, locked) | O0 | Rate-limited. Input never logged |
| SC-35 | Returns & replacements | Respond, confirm return receipt, ship replacement | Member | SC-31, NTF | return / replacement | API-SOR-07..09 | Accept, contest, received, ship | L2 | E1 | R2, R3 | O0 | — |
| SC-40 | Deal requests | Incoming Protected Deal requests and invitations accepted | Member (deals) | SC-10, INV-01 | deals | API-SDEAL-01 | Open | L1 | E1 | R1 | O1 | — |
| SC-41 | Request detail | Buyer request (no unnecessary PII), photos | Member | SC-40 | deal | API-DEAL-03 | Make offer, reject | L1 | — | R1 | O1 | — |
| SC-42 | Offer composer | Price, shipping governorate and fee, ETA, terms. Server returns a fee preview | Member | SC-41 | fee quote | API-SDEAL-03..05 | Send, revise, withdraw | L2 | — | R3 (buyer acted) | O2 | Fee preview comes from the server |
| SC-50 | Balance | Available, pending settlement and held amounts (projection), hold reasons | Owner | SC-10 | balance | API-SBAL-01 | Withdraw | L1 | E1 | R1 | O1 (stale label) | Projection only |
| SC-51 | Statement | Ledger-derived entries | Owner | SC-50 | entries | API-SBAL-02 | Filter | L1 | E1 | R1 | O1 | — |
| SC-52 | Withdraw | Amount (≤ available, enforced by the server), payout account (masked), confirm | Owner | SC-50 | balance, account | API-SBAL-04 | Request | L3 | — | R2, R3, R4 | O0 | Step-up. Idempotent. Confirmation sheet |
| SC-53 | Withdrawals | Status: requested, approved, paid, rejected | Owner | SC-50 | list | API-SBAL-05..06 | Cancel pending | L1 | E1 | R1 | O1 | — |
| SC-54 | Payout account | Bank IBAN or wallet number (masked). Change triggers a cooling-off period | Owner | SC-50 | account | API-SBAL-03 | Change | L2 | E1 | R2, R4 | O0 | Step-up. Cooling-off notice. **X1** |
| SC-60 | Store profile | Name, logo, description, policies | Owner | SC-10 | store | API-SEL-03..04 | Save | L2 | — | R3 | O0 | — |
| SC-61 | Shipping rates | 27 governorates × {enabled, price, min/max days}. Bulk edit | Owner | SC-10 | rates, governorates | API-SHP-01..03, API-CAT-07 | Save | L1 / L2 | E1 (none configured) | R2, R3 | O2 | — |
| SC-62 | Store team | Members and permissions (catalog, orders, deals) | Owner | SC-10 | members | API-SEL-05 | Invite, remove | L2 | E1 | R2, R4 | O0 | Step-up |
| SC-70 | Seller notifications | Filtered inbox | Member | SC-10 | — | API-NTF-01 | Open | L1 | E1 | R1 | O1 | — |
| SC-71 | Seller support | Shared support with seller context | Member | SC-10 | — | API-SUP-* | — | L1 | E1 | R1 | O1 | — |

**Seller screen count: 28.** Customer App total: **82 screens.**

---

## 4. Admin App: navigation hierarchy

```
Launch ─► ADM-01 Login ─► ADM-02 MFA (mandatory; ADM-03 enrollment on first login) ─► ADM-10 Dashboard
Drawer / tabs (items hidden by permission — server still enforces):
 ├─ Queues:   ADM-11 Approvals hub ─► typed queues (KYC, sellers, products, payments, withdrawals, adjustments, disputes)
 ├─ People:   ADM-20 Users ─► ADM-21 User 360 ; ADM-22 KYC queue ─► ADM-23 KYC case ; ADM-24 Sellers ─► ADM-25 Seller 360
 ├─ Commerce: ADM-30 Moderation ─► ADM-31 Product review ; ADM-32 Orders ─► ADM-33 Order 360
 ├─ Protection: ADM-40 Deals ─► ADM-41 Deal/PT 360 ─► ADM-42 Evidence viewer ; ADM-43 Disputes ─► ADM-44 Dispute 360 ; ADM-45 Returns/Replacements
 ├─ Finance:  ADM-50 Finance dashboard ; ADM-51 Payment verification ; ADM-52 Ledger explorer ─► ADM-53 Journal ;
 │            ADM-54 Settlements ; ADM-55 Withdrawals ; ADM-56 Reconciliation ─► ADM-57 Break ; ADM-58 Fees ; ADM-59 Adjustments/Chargebacks
 ├─ Service:  ADM-60 Support tickets ─► ADM-61 Ticket ; ADM-62 Broadcast notifications ; ADM-63 CMS
 ├─ Governance: ADM-70 Staff ─► ADM-71 Staff detail ; ADM-72 Roles & permissions ; ADM-73 Audit trail ─► ADM-74 Audit event ; ADM-75 Reports
 └─ Platform: ADM-80 Settings (incl. Real Money switch) ; ADM-81 System health ; ADM-90 My sessions/devices ; ADM-91 My MFA
Step-up overlay: ADM-SU (biometric unlock → TOTP/passkey) invoked on any `step_up_required`
```

**Global Admin App rules.**
- Screenshot protection (X1) on all screens showing PII or finance data.
- No disk cache (X3).
- Auto-lock after 5 min in background.
- Session absolute lifetime ≤ 12 h.
- Every list view of PII shows masked values. Unmasking is a separate, audited, step-up action (API-ADM-USR-05).

### Suggested roles

Roles are configurable in ADM-72. These are the starting set:

| Role | Purpose |
|---|---|
| `SUPER_ADMIN` | Break-glass. 2 people minimum |
| `OPS_MANAGER` | Operations lead |
| `KYC_REVIEWER` | KYC decisions |
| `MODERATOR` | Catalog moderation |
| `DISPUTE_AGENT` | Disputes, maker |
| `DISPUTE_LEAD` | Disputes, checker |
| `FINANCE_MAKER` | Proposes finance actions |
| `FINANCE_CHECKER` | Approves finance actions |
| `FINANCE_VIEWER` | Read-only finance |
| `SUPPORT_AGENT` | Support desk |
| `CONTENT_EDITOR` | CMS |
| `AUDITOR` | Read-only, including audit trail |

| ID | Screen | Role required (any of) | Data | Actions | Sensitive actions | Fresh 2FA | Maker / Checker | Audit | API dependencies |
|---|---|---|---|---|---|---|---|---|---|
| ADM-01 | Login | — | — | Sign in | — | n/a | — | ✔ (success and failure) | API-ADM-AUTH-01 |
| ADM-02 | MFA challenge | — | — | Verify TOTP or passkey | — | n/a (this *is* MFA) | — | ✔ | API-ADM-AUTH-02 |
| ADM-03 | MFA enrollment | Any (first login) | QR or secret, recovery codes | Enroll | Recovery codes shown once | — | — | ✔ | API-ADM-AUTH-03 |
| ADM-SU | Step-up overlay | Any | — | Re-verify | — | **Yes** | — | ✔ | API-ADM-AUTH-05 |
| ADM-10 | Dashboard / KPIs | Any staff | GMV, held funds, open queues + SLA breaches, disputes, recon status, real-money status | Navigate | — | No | — | View not audited | API-ADM-01 |
| ADM-11 | Approvals hub | Per queue type | Pending approval_requests with maker, age, payload summary | Approve, reject (as checker) | Every decision | **Yes** | **Checker. Maker ≠ checker is enforced by the server** | ✔ | API-ADM-02, API-ADM-03 |
| ADM-20 | Users | OPS_MANAGER, SUPPORT_AGENT, AUDITOR | Masked list, search | Open | — | No | — | ✔ (search terms) | API-ADM-USR-01 |
| ADM-21 | User 360 | OPS_MANAGER, SUPPORT_AGENT, AUDITOR | Profile (masked), sessions, devices, orders, deals, disputes, tickets, balances, KYC status, audit excerpts | Suspend, revoke sessions, reveal PII | Suspend, revoke, reveal | **Yes** | — | ✔ | API-ADM-USR-02..05 |
| ADM-22 | KYC queue | KYC_REVIEWER | Cases with SLA | Claim, open | — | No | — | ✔ (claim) | API-ADM-KYC-01 |
| ADM-23 | KYC case | KYC_REVIEWER | Applicant data, document viewer (watermarked, signed URL) | Approve, reject, request info | View document, decide | **Yes** (view and decide) | Optional second review for merchants above a threshold (D-16) | ✔ (each document view) | API-ADM-KYC-02..04 |
| ADM-24 | Sellers | OPS_MANAGER, KYC_REVIEWER, AUDITOR | List and status | Open | — | No | — | — | API-ADM-SEL-01 |
| ADM-25 | Seller 360 | OPS_MANAGER, AUDITOR | Store, KYC, products, orders, disputes rate, balances (projection), withdrawals, payout-account change history | Approve application, restrict listings or payouts | Approve, restrict | **Yes** | Restrict-payouts lift: checker | ✔ | API-ADM-SEL-02..04 |
| ADM-30 | Moderation queue | MODERATOR | Pending products | Open | — | No | — | — | API-ADM-PRD-01 |
| ADM-31 | Product review | MODERATOR | Product, media, seller history | Approve, reject, request changes, takedown | Takedown | Takedown: **Yes** | — | ✔ | API-ADM-PRD-02..03 |
| ADM-32 | Orders | OPS_MANAGER, SUPPORT_AGENT, AUDITOR | Search | Open | — | No | — | — | API-ADM-ORD-01 |
| ADM-33 | Order 360 | OPS_MANAGER, SUPPORT_AGENT, AUDITOR, FINANCE_VIEWER | Order, PT timeline, payments, ledger references, shipments, OTP *status only* | Jump to PT 360 | — | No | — | ✔ | API-ADM-ORD-02 |
| ADM-40 | Protected Deals | OPS_MANAGER, DISPUTE_AGENT, AUDITOR | Search by state or deadline | Open | — | No | — | — | API-ADM-PT-01 |
| ADM-41 | Deal / PT 360 | OPS_MANAGER, DISPUTE_AGENT, AUDITOR | Request, offers, frozen agreement + hash, payment, state history, holds, OTP status (issued, attempts, consumed; **never the code**) | Hold, release hold, force OTP re-issue | All three | **Yes** | Release hold above threshold: **checker** | ✔ | API-ADM-PT-02..05 |
| ADM-42 | Evidence viewer | OPS_MANAGER, DISPUTE_AGENT | Signed URLs, watermark | View | View | No | — | ✔ (each view) | API-ADM-PT-02 |
| ADM-43 | Disputes queue | DISPUTE_AGENT, DISPUTE_LEAD | SLA, deadlines | Claim | — | No | — | ✔ | API-ADM-DSP-01 |
| ADM-44 | Dispute 360 | DISPUTE_AGENT, DISPUTE_LEAD | Both parties' evidence, messages, PT, held amount | Request evidence, propose decision (refund, release or split, server-validated amounts) | Propose | **Yes** | **Maker = agent, checker = lead** (≠ maker) | ✔ | API-ADM-DSP-02..04, API-ADM-03 |
| ADM-45 | Returns / replacements | DISPUTE_AGENT | Queue and detail | Decide | Decisions that cause a refund | **Yes** | Refund: maker/checker | ✔ | API-ADM-DSP-05 |
| ADM-50 | Finance dashboard | FINANCE_* , AUDITOR | Held (2010), seller payable (2020), refund payable, in-transit, suspense, revenue, recon status, aged breaks | Navigate | — | No | — | ✔ (view) | API-FIN-04 |
| ADM-51 | Payment verification | FINANCE_MAKER, FINANCE_CHECKER | Pending or unknown payments, PSP data, proof | Verify (maker), reject | Verify | **Yes** | **Yes** | ✔ | API-FIN-01..03, API-ADM-03 |
| ADM-52 | Ledger explorer | FINANCE_* , AUDITOR | Journals by account, PT or date (read-only) | Filter, open | — | No | — | ✔ (query) | API-FIN-05..06 |
| ADM-53 | Journal detail | FINANCE_* , AUDITOR | Lines (Dr/Cr), posting_key, source event, reversal links | — (immutable; no edit) | — | No | — | ✔ | API-FIN-07 |
| ADM-54 | Settlements | FINANCE_MAKER, FINANCE_CHECKER | Pending PTs, batches | Propose batch | Propose | **Yes** | **Yes** | ✔ | API-FIN-08..10, API-ADM-03 |
| ADM-55 | Withdrawals | FINANCE_MAKER, FINANCE_CHECKER | Queue, seller risk flags, payout-account age | Propose payout, confirm bank payout | Both | **Yes** | **Yes** | ✔ | API-FIN-11..13, API-ADM-03 |
| ADM-56 | Reconciliation | FINANCE_* | Runs, match rate, breaks | Upload statement, open break | Upload | **Yes** | — | ✔ | API-FIN-14..15 |
| ADM-57 | Recon break | FINANCE_MAKER, FINANCE_CHECKER | Break detail, candidate matches | Propose resolution journal | Resolve | **Yes** | **Yes** | ✔ | API-FIN-16, API-ADM-03 |
| ADM-58 | Fees & commissions | FINANCE_MAKER, FINANCE_CHECKER | Effective-dated schedules (5 %/3 % per D-05) | Propose new schedule (future-dated only) | Propose | **Yes** | **Yes** | ✔ | API-FIN-17, API-ADM-03 |
| ADM-59 | Adjustments & chargebacks | FINANCE_MAKER, FINANCE_CHECKER | Cases, proposed compensating journals | Propose | Propose | **Yes** | **Yes** | ✔ | API-FIN-18, API-ADM-03 |
| ADM-60 | Support tickets | SUPPORT_AGENT | Queue, SLA | Claim | — | No | — | ✔ | API-ADM-SUP-01 |
| ADM-61 | Ticket | SUPPORT_AGENT | Thread, linked entities (masked) | Reply, assign, close | — | No | — | ✔ | API-ADM-SUP-02..03 |
| ADM-62 | Broadcast notifications | OPS_MANAGER | Templates, segments, preview | Propose broadcast | Send | **Yes** | **Yes** | ✔ | API-ADM-NTF-01, API-ADM-03 |
| ADM-63 | CMS | CONTENT_EDITOR | Pages, banners, versions | Edit, publish | Publish legal pages | Legal pages: **Yes** | Legal pages: **Yes** | ✔ | API-ADM-CMS-01..02 |
| ADM-70 | Staff | SUPER_ADMIN, OPS_MANAGER | Staff list, MFA status, last login | Invite, disable | Disable | **Yes** | — | ✔ | API-ADM-STF-01..05 |
| ADM-71 | Staff detail | SUPER_ADMIN | Roles, sessions, audit | Grant or revoke role, revoke sessions, reset MFA | All | **Yes** | **Role grants and MFA reset: Yes** | ✔ | API-ADM-STF-*, API-ADM-03 |
| ADM-72 | Roles & permissions | SUPER_ADMIN | Role → permission matrix | Propose change | Propose | **Yes** | **Yes** | ✔ | API-ADM-STF-* |
| ADM-73 | Audit trail | AUDITOR, SUPER_ADMIN | Search events, hash-chain verification status | Filter, export | Export | Export: **Yes** | — | ✔ (access to audit is itself audited) | API-ADM-AUD-01..02 |
| ADM-74 | Audit event | AUDITOR, SUPER_ADMIN | Actor, before/after hash, `trace_id`, IP, device | — | — | No | — | ✔ | API-ADM-AUD-02 |
| ADM-75 | Reports | OPS_MANAGER, FINANCE_*, AUDITOR | Predefined reports | Generate, export (async, watermarked) | Export | **Yes** | — | ✔ | API-ADM-RPT-01..02 |
| ADM-80 | Platform settings | SUPER_ADMIN | Limits, timeouts (D-07), feature flags, **Real Money switch** | Propose change | All. Real Money needs **2 distinct super-admins plus a checker** | **Yes** | **Yes** | ✔ | API-ADM-SET-01..03, API-ADM-03 |
| ADM-81 | System health | OPS_MANAGER, SUPER_ADMIN | DB, queue lag, outbox backlog, PSP status, recon freshness, projection drift | — | — | No | — | — | API-ADM-SYS-01 |
| ADM-90 | My sessions | Self | Devices and sessions | Revoke | Revoke | No | — | ✔ | API-ADM-AUTH-06 |
| ADM-91 | My MFA | Self | Factors | Add passkey, regenerate recovery codes | Both | **Yes** | — | ✔ | API-ADM-AUTH-03, API-ADM-AUTH-05 |

**Admin screen count: 46** (including ADM-SU).

### Launch-critical operations that can be completed from mobile

Every operation below is covered by the screens above, so no computer is needed:

- KYC review
- Seller approval
- Product moderation
- Payment verification
- Settlement approval
- Withdrawal approval and payout confirmation
- Dispute decision (maker and checker)
- Holds
- OTP re-issue
- Support
- Staff, roles and MFA management
- Audit lookup
- Real-money switch

Bulk work (large CSV statement uploads for reconciliation, report exports) is supported on mobile, but the Web Admin is recommended for it.
