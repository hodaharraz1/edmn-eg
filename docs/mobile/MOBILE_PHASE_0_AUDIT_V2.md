# EDMN Mobile Ecosystem: Phase 0 Audit v2 (Marketplace branch)

| | |
|---|---|
| **Status** | Phase 0 v2. **Read-only.** Supersedes `MOBILE_PHASE_0_AUDIT.md` (v1), which audited the marketing-site `main` branch by mistake. |
| **Source of truth** | `hodaharraz1/edmn-eg` · branch `claude/great-tesla-nor0wt` · baseline `48ae40c` (2026-10-19), "Security gate fixes …" |
| **Legacy System A** | `api.edmneg.com/adminDashboard`. Out of scope here and **not a blocker**. It is a separate future migration and integration track. |
| **Companions** | [`MOBILE_API_EXTRACTION_PLAN.md`](./MOBILE_API_EXTRACTION_PLAN.md) · [`MOBILE_API_GAP_MATRIX_V2.md`](./MOBILE_API_GAP_MATRIX_V2.md) · [`MOBILE_SCREEN_MAP_V2.md`](./MOBILE_SCREEN_MAP_V2.md) · [`MOBILE_BACKLOG_V2.md`](./MOBILE_BACKLOG_V2.md) |
| **Real money** | OFF, and currently impossible to enable. See §4.11. |

---

## 0. Executive summary

The Marketplace branch is a real, mature platform: Next.js 16, PostgreSQL 16, Drizzle, 132 tables and 20 migrations.

- **Domain logic is correctly separated from transport.** All business rules live in Actor-based services under `src/server/**`, and the web's 173 Server Actions are thin wrappers.
- **Financial integrity is enforced at the database level.**
  - Balanced journals.
  - Append-only journal, audit, status history, evidence and approvals.
  - An operation-specific approval is required for every journal entry.
  - Approved amount must equal posted debits.
  - Two-person rule for every money movement.
- **Tests.** The unit and integration suite was **executed in this audit** against a throwaway local PostgreSQL: **617 of 618 passed.** The one failure is an artifact of the audit environment (it calls `git check-ignore` on an exported, non-git copy).

There is **no API that a mobile app can call today.**

- The web uses cookie sessions and Server Actions.
- Many read models and their authorization live in page components.
- Lifecycle "allowed actions" are derived in the UI.

The mobile work is therefore **transport and read-model extraction over the existing services**. It is not a rebuild.

### Answers to the owner's questions

| # | Question | Answer |
|---|---|---|
| 1 | Verified backend reuse | **74.7 %** of the 293 mobile-required operations can call an existing service **unchanged**. **96.9 %** reuse existing domain logic, unchanged or after extraction or refactor. **2.7 %** are genuinely missing. |
| 2 | Domain capabilities reusable unchanged | **219** (READY_SERVICE) |
| 3 | Requiring refactor before API exposure | **65** (SERVICE_NEEDS_REFACTOR), plus **1** SECURITY_BLOCKER (deal risk-flag resolution) |
| 4 | Genuinely missing | **8** operations (MISSING_DOMAIN_CAPABILITY), plus **8 cross-cutting platform capabilities** (§0.1) |
| 5 | Required Customer API endpoints | **116** (incl. 18 public/auth) |
| 6 | Required Seller API endpoints | **56** |
| 7 | Required Admin API endpoints | **76** |
| 8 | Required Finance API endpoints | **45** |
| 9 | P0 blockers | **7** (§0.2) |
| 10 | Financial integrity findings | **0 critical, 0 high**, 4 medium, 4 low/informational (§4.12). Core ledger invariants verified in code **and** by passing tests |
| 11 | Security findings | **1 high** (at mobile exposure), 6 medium, 5 low (§6) |
| 12 | Protected Deal gaps | **8** (§5.4). There is no deal/offer expiry, and return of goods is not modelled. The others concern labels and UX contract |
| 13 | Recommended Phase 1 scope | Sprints S1 and S2: bearer auth and device sessions, the adapter, OpenAPI, the S-H1 fix, session revoke, idempotency and rate tiers, read-model extraction wave 1, public catalog endpoints, and the Flutter foundations. **No money-moving or admin endpoints, no business screens** (§9) |

### 0.1 Cross-cutting capabilities missing for any mobile client

1. **Bearer authentication.** This means device-bound mobile session scopes, access and refresh tokens with rotation, and a device registry. Today sessions are cookie-only and DB CHECK `sessions_scope_chk` allows only `WEB` and `ADMIN`. This is security blocker **SB-1**.
2. **The `/api/v1` adapter layer** with problem+json error mapping, plus a lint rule that forbids DB access in handlers.
3. **An OpenAPI 3.1 contract** generated from DTO zod schemas.
4. **A server-side allowed-actions and deadlines projection** for orders, seller orders, deals, returns, disputes and withdrawals. Today these are derived in React pages.
5. **A generic `Idempotency-Key`** for non-money creates. The `idempotency_keys` table exists but is unused.
6. **Session and device management with remote revocation.** `revokeAllSessions()` exists but has zero callers.
7. **FCM/APNs push.** Only Web Push (VAPID) exists.
8. **Audit channel attribution** (web vs mobile, device), and **mobile-tolerant rate limits** that do not penalise carrier-grade NAT.

### 0.2 P0 blockers

None of these is a defect in today's web product. Each blocks safe mobile exposure.

| # | Blocker | Evidence |
|---|---|---|
| P0-1 | No bearer-token or device-session auth (SB-1) | `src/server/web/session.ts` reads cookies only. `sessions_scope_chk` |
| P0-2 | Read authorization lives in pages for most admin and many customer reads | 92/162 pages run direct DB reads. Admin queries such as `withdrawalQueue`, `refundQueue`, `reconQueue`, `recentApprovals`, `openMovementRequests`, `pendingClosures`, `ticketQueue` and `getAllSettings` take **no `Actor`** |
| P0-3 | Allowed actions are not a server projection, so mobile would have to re-implement state machines | Page components under `src/app/(shop)/account/**`, `src/app/seller/**` and `src/app/admin/**` |
| P0-4 | Deal risk-flag resolution: no conflict-of-interest check, and the audit write is outside the transaction | `src/app/_actions/admin.ts` `riskFlagAction` (S-H1) |
| P0-5 | No remote session revocation for lost devices (customer, seller, staff) | `revokeAllSessions` unused. The security page is read-only |
| P0-6 | The platform branch is not merged. `main` is the marketing site | `git merge-base main claude/great-tesla-nor0wt` = `f70d40b` (marketing `main`). D-1 |
| P0-7 | No OpenAPI contract, so typed Flutter models are impossible | No spec in the repo |

**P1 blockers** (needed for launch, not for the start of Phase 1):

1. FCM/APNs push.
2. A decision on in-app display of the Delivery OTP. It is SMS-only in production.
3. Protected Deals refuse to run without an SMS provider (`assertDealsAvailable`).
4. Step-up is session-wide rather than action-scoped (S-M1).
5. Reconciliation decisions are made by one person (S-M4).
6. Marketplace `REPLACEMENT` dispute decision has no effect (F-3).
7. No English locale. The platform is Arabic-only.
8. Store distribution decisions.

---

## 1. Scope, method, evidence

1. **Located the code.** `git fetch origin` found the previously unseen remote branch. Everything was read from a `git archive 48ae40c` export in the scratchpad. **No checkout, merge or commit was made on that branch.**
2. **Read the code** in `src/server/**`, all 20 migrations, `src/domain/machines.ts`, all 17 `src/app/_actions/*.ts`, the 16 route handlers, and selected pages and layouts. Documentation in `docs/**` was used only to locate code. Every claim below cites code.
3. **Executed the tests.**

   ```
   npm ci --ignore-scripts   (in scratchpad copy)
   PostgreSQL 16 throwaway cluster on 127.0.0.1:55432 (scratchpad)
   TEST_DATABASE_URL=… npx vitest run
   → Test Files 39 passed, 1 failed (40) · Tests 617 passed, 1 failed (618) · 212 s
   failed: tests/integration/self-hosted.test.ts › ".env.production.example is not ignored by git"
           — spawnSync('git','check-ignore',…) returned 128 because the export is not a git checkout (environmental).
   ```

   The test inventory: 75 unit, 530 integration and 126 Playwright E2E cases (11 conditionally skipped when fixtures are absent). **E2E was not run.** It needs a built app, browsers and seeded demo data.
4. **Nothing else was touched.** No staging, production, Vercel, Neon or System A access was made.

---

## 2. Platform architecture (as built)

```
Browser ──► Next.js 16 App Router (src/proxy.ts: host routing, nonce CSP)
              ├─ pages (Server Components) ── read models (partly in pages)
              ├─ Server Actions src/app/_actions/*.ts (173) ──► runAction() → DomainError → ActionState
              └─ route handlers src/app/api/** (16): health, ready, cron tick, files, live, push, webhooks, admin export
                                      │
                                      ▼
        src/server/modules/** (Actor-based services) · src/server/auth · src/server/rbac · src/domain/machines.ts
                                      │  drizzle-orm (node-postgres), explicit transactions, FOR UPDATE, advisory locks
                                      ▼
        PostgreSQL: 132 tables, triggers (append-only, approvals, two-person, immutability), CHECK constraints
                                      ▲
        Worker (scripts/worker.ts): 17 leased schedules (orders, deals, settlement, outbox, alerts, ledger.health, files.scan …)
```

---

## 3. Domain audit

The status columns verify the implementation from code and tests.

**Legend.** ✅ implemented and tested · ◐ implemented with a gap · ✗ missing. "Mobile" is what the mobile API needs.

| Area | Status | Implementation (key files) | Test evidence (integration unless noted) | Mobile notes |
|---|---|---|---|---|
| Authentication | ✅ web / ✗ mobile | `auth/service.ts`: register, login (lockout, enumeration-safe), reset, change password, verification codes (HMAC). `password.ts`, `totp.ts` (replay-safe) | `auth.test.ts`, `security-gate*.test.ts` (SEC-AU-2 parallel lockout) | Bearer, refresh and device sessions are missing (SB-1) |
| Customer accounts | ✅ | `customers/addresses.ts`, `customers/closure.ts` (closure with blockers and advisory lock), profile (logic in an action) | `batch15*.test.ts`, `final-audit.test.ts` | Profile and wishlist need extraction (T-3, T-4) |
| Seller accounts | ✅ | `sellers/service.ts`: application wizard, store, staff invitations (migration 0017), seller RBAC (`SELLER_ROLE_PERMISSIONS`) | `sellers-catalog.test.ts`, `seller-invitations.test.ts` | Ready |
| Seller approval | ✅ | `decideSeller()` with `sellerMachine` | `sellers-catalog.test.ts` | Ready. Step-up is not required today (SU\*) |
| KYC | ✅ | User identity: `identity/service.ts` (`user_identity_verifications`, two-person review, `revealIdentityNumber` + step-up). Seller docs: `uploadSellerDocument`, `revealNationalId`. Files: `IDENTITY_DOCUMENT` purpose authorization | `batch15.test.ts` ("never self-review") | Identity is **required** for orders, deals, payments and withdrawals (`requireApprovedIdentity`) |
| Catalog | ✅ | `catalog/taxonomy.ts` (categories, brands, attributes, listing policy), `catalog/search.ts` | `sellers-catalog.test.ts` | Public reads ready |
| Products | ✅ | `catalog/products.ts` (draft, moderation, revisions, variants, images) | `sellers-catalog.test.ts` | Edits are last-write-wins; add `If-Match` |
| Used products | ✅ | `used/*` (condition policies, Product Passport, frozen condition snapshots), migration 0019 (lock triggers) | `used-commerce.test.ts`, unit `used-domain.test.ts` | Ready |
| Inventory | ✅ | `catalog/inventory.ts`: conditional reserve UPDATE, DB CHECK `0 ≤ reserved ≤ stock_on_hand`, reservations, movements | "two buyers race for the last unit: exactly one wins" | Ready |
| Shipping | ✅ | `seller_shipping_rates` (per governorate, fee ≥ 0, ETA CHECKs), `setShippingRates`, governorates seeded from DB | `governorate-delivery.test.ts` | Rates read is in a page (extract) |
| Cart | ✅ | `commerce/cart.ts` (`CartRef` = user or guest token, server pricing, price acknowledgement) | `checkout-payments.test.ts` | Ready |
| Checkout | ✅ | `commerce/orders.placeOrder()`: idempotent `checkoutKey`, per-customer advisory lock, `expectedTotal`, pricing-version lock, self-purchase guard, seller identity guard, one parent order plus one sub-order per seller | "checkout is idempotent on its key"; fee-engine race tests | Quote assembly is in the page (extract) |
| Orders | ✅ | `orders.ts`, `fulfilment.ts`, `sellerOrderMachine` (12 states), immutable deadlines (trigger), receipt basis | `fulfilment-finance.test.ts`, `hardening-delivery.test.ts` | Allowed actions projection needed |
| Protected Deals | ✅ ◐ | `deals/service.ts` (1,315 lines), `dealMachine` (19 states). See §5 | `deal-invitation-returns`, `delivery-otp`, `postpurchase-deals-authz`, `pre-acceptance-audit`, E2E `protected-deal.spec.ts` | Gaps in §5.4 |
| Seller invitations | ✅ | 256-bit token, hash only, TTL, bind-once, safe summary without buyer PII, expiry job | "binding: the buyer cannot claim; first seller binds …" | Ready. Add an API-tier rate limit on token preview |
| Seller offers | ✅ | Versioned `deal_terms_versions` (append-only trigger), counter offers, change requests | `deal-invitation-returns.test.ts` | Ready |
| Frozen agreements | ✅ | `finalizeTerms()`: frozen snapshot, fee snapshot, condition hash. DB trigger `edmn_agreed_terms_immutable`; pricing snapshot guard | "agreed terms and term versions are immutable at the database level"; "concurrent double-accept freezes exactly one snapshot" | Ready |
| Payment flow | ✅ (manual) | `payments/service.ts`: bank transfer, InstaPay or Vodafone Cash proof → staff verification. `providers.ts` has the PSP interface but only MANUAL is registered. Webhook route is evidence-only (503 until a secret is set) | "replayed and concurrent confirmations post the payment exactly once" | No PSP. By design for V1 |
| Delivery OTP | ✅ (deals only) | `deals/delivery-otp.ts`: `randomInt` 6 digits, HMAC-SHA256 with `timingSafeEqual`, TTL 72 h, 5 attempts per code, 30 lifetime guesses per deal, single use under row lock, SMS to buyer only, sealed outbox body redacted after 1 h. Trigger `edmn_delivery_otp_guard` | `delivery-otp.test.ts` ("concurrent submissions … verify exactly once") | Not used for marketplace orders. Buyer cannot view the code in-app in production |
| Receipt confirmation | ✅ | Deals: `confirmDealReceipt` (requires a verified OTP handover and a confirmed payment). Orders: `confirmReceipt` (buyer-only actor). Timeout entitlement jobs | EDGE 10 "confirms twice: entitlement once, no money moves" | Ready |
| Returns / replacements | ✅ ◐ | `postpurchase/returns.ts`, `returnMachine` (10 states), refund on receipt. Replacements: deals re-deliver via dispute decision. **No marketplace replacement entity** | `postpurchase-deals-authz.test.ts`, `pre-acceptance-audit.test.ts` | F-3 |
| Disputes | ✅ | `postpurchase/disputes.ts`: open dispute = hold. `resolveDispute` needs `disputes.manage` + step-up + no party / no self-dealing. Decisions create requests only; money moves on a separate approval | "#36 dispute vs release race" | Ready |
| Wallet projections | ✅ | `ledger_accounts.balance` projection updated in the posting transaction. `sellerBalances()`; `reconcile()` re-derives from lines; nightly `ledger.health`; drift check before withdrawal approval. **No customer stored-value wallet** (correct) | SEC-LG-3, "dr = cr, no drift, no stranded balance" | Read-only DTOs |
| Ledger | ✅ | `finance/ledger.ts` `postEntry()`. §4 | SEC-LG-1/2/3 | Never exposed for writes |
| Fees / commissions | ✅ | Versioned fee engine `pricing/*` (maker/checker publish, DB guards, snapshots on orders and deals) | `fee-engine.test.ts`, unit `fee-engine.test.ts` | Approve/publish on mobile; drafting on desktop |
| Settlements | ✅ | (a) **Release** of escrowed funds: `releaseSellerOrder`, `releaseDeal` (maker/checker). (b) **Scheduled payout batches**: `runScheduledSettlement` creates withdrawal requests (`settlement.mode`) | "seller release: no Maker → refused; same person → refused …" | T-5 (authorization in the action) |
| Withdrawals | ✅ | `finance/withdrawals.ts` (926 lines). Covers: request with `clientKey`; approval reserves under lock with allocation; payout two-person; uncertain / failed-before-transfer / returned paths; immutable amount and destination (trigger); payout-method change hold | SEC-WD-1, EDGE 11/12, "F — concurrent approvals … exactly one reserves" | Ready |
| Maker / Checker | ✅ | `finance/movements.ts` plus DB: `financial_approvals_two_person` (BEFORE INSERT; approvals are only ever inserted as APPROVED, verified: no UPDATE-to-APPROVED path), `*_checker_chk` CHECKs | "the database refuses a movement approval without a distinct maker" | Ready |
| Reconciliation | ✅ ◐ | `finance/reconciliation.ts` (CSV import, candidate matching, manual confirm, mismatch → risk flag), `reconcile()` ledger re-derivation, `financial_closes` daily close | "#78/#81 exact match … cannot be matched twice"; "#82 drift detected" | S-M4 |
| Notifications | ✅ ◐ | In-app `notifications`, email/SMS outbox (claim SKIP LOCKED, backoff, dead letters, sealed secrets), preferences, Web Push (VAPID) | "two concurrent flushers never send the same message twice" | FCM/APNs missing |
| Support | ✅ | `support/service.ts` (tickets, SLA cycles, escalation, QA, rating, reopen) | `batch15*.test.ts` | `ticketQueue` takes no Actor |
| Admin | ✅ web | 75 admin pages, 43 admin actions, 4 more admin action files | Many | §7 mapping |
| Roles / permissions | ✅ | 80+ permissions. Privileged-role guard (SUPER_ADMIN only for roles carrying money or `roles.manage`), never self-grant, last-super-admin guard, step-up on every RBAC change | "EDGE 17 maker/checker: low-privilege admins cannot approve/pay" | Ready |
| Audit trail | ✅ ◐ | `audit()` in the same transaction. `audit_logs` and `status_history` append-only, no TRUNCATE | "journal is append-only …" | Not hash-chained. Two action paths audit outside the transaction (T-1, T-2) |
| Settings | ✅ | `settings.ts`: zod-typed, sensitive keys need step-up, restricted keys only via dedicated screens, real-money gate | `pilot-safety.test.ts` | Ready |
| Background jobs | ✅ | `jobs/worker.ts` 17 schedules with leases (`job_leases`), queue `jobs` (SKIP LOCKED), schedule health | `batch2-infrastructure.test.ts` | Unchanged |
| Storage | ✅ | `storage/*`: local or DB driver, purpose-based private authorization, malware scan hook (fail-closed in production), EXIF/re-encode via sharp | `storage-database.test.ts`, `infra-adapters.test.ts` | Bearer access to `/api/files/{id}` needed |
| Tests | ✅ | Vitest 618 (executed: 617 pass). Playwright 126 | Run in this audit | Add API parity suites |
| Security controls | ✅ ◐ | Nonce CSP, host isolation, trusted-proxy IP logic, Postgres rate limits, secret fingerprints, production fixture guards (triggers), env validation | `security-gate*.test.ts` | §6 |

---

## 4. Financial safety verification

Each control below was checked in the implementation and in the tests.

| # | Control | Implementation (code) | DB enforcement | Test evidence | Verdict |
|---|---|---|---|---|---|
| 4.1 | Balanced double entry | `postEntry()` rejects `dr ≠ cr`, fewer than 2 lines, negative or mixed lines | `journal_lines_balanced` deferred constraint trigger; `journal_lines_amount_chk` | SEC-LG-2, "an unbalanced entry is rejected by the database at commit" | ✅ |
| 4.2 | Immutable posted ledger | No update path in code | `journal_entries_append_only`, `journal_lines_append_only`, no-TRUNCATE triggers; `ledger_accounts_no_delete` | SEC-LG-1 | ✅. Corrections use reversal or compensating entries (`revokeRefund`, `recordWithdrawalReturned`, adjustments) |
| 4.3 | Approval per entry | `postEntry` requires `approvalId`; `grantApproval` needs ADMIN + step-up + rate limit | `edmn_journal_requires_approval` (exists, approved, type covered, consumed once per transaction); `edmn_journal_approval_amount` (Σ debits = approved amount); approvals immutable (`financial_approvals_guard`) | "every journal approved" assertions | ✅ |
| 4.4 | Wallet projection correctness | Projection updated in the same transaction under deterministic `FOR UPDATE` order. `reconcile()` re-derives. `sellerLedgerDrift()` blocks withdrawal approval on drift. `ledger.health` every 30 min | — | "24 — zero projection drift", SEC-LG-3 | ✅ (F-6: projection column itself is not trigger-guarded) |
| 4.5 | Idempotency | Unique `journal_entries.idempotency_key` (retry returns the original); approval `idempotencyKey`; `checkoutKey`; proof and withdrawal `clientKey` | UNIQUE constraints | EDGE 3/4, SEC-PAY-5, EDGE 11 | ✅ |
| 4.6 | Concurrent operations | Row locks on payments, deals, seller orders, withdrawals, approvals and requests; advisory locks per customer and account; conditional stock UPDATE; balance `guards` after posting | CHECK on reserved stock | SEC-WD-1, EDGE 1/12, "F — concurrent approvals", dispute vs release race | ✅ |
| 4.7 | Settlement | Release only from entitlement (BUYER_CONFIRMED / TIMEOUT_ENTITLEMENT / DISPUTE_DECISION). Blockers: hold, open dispute, open return, refund or cancellation, shipment problem, unconfirmed payment. `expectedAmount` check, kill switch, not-a-party check | `seller_orders_completion_chk`; release and receipt-basis immutability trigger | "seller release: … concurrent → exactly once"; "Protected Deal: no release is possible before entitlement" | ✅. **Never automatic**: `goLiveGate()` returns `automaticSellerRelease: false` |
| 4.8 | Withdrawals | Request moves nothing. Approval reserves with allocation under locks and guards. Payout by a different person. Uncertain / failed / returned paths | Amount and destination immutable; allocations guarded; no delete | SEC-WD-1, EDGE 11/12 | ✅ |
| 4.9 | Maker/checker and self-approval | `takeMovementRequest` refuses maker = checker. `grantApproval` refuses `dualControl.requestedBy === actor`. Adjustments: creator ≠ approver. Withdrawal payer ≠ approver. Refund payer ≠ approver. Approval revoker ≠ approver | `financial_approvals_two_person` (BEFORE INSERT; verified no UPDATE path to APPROVED), `financial_approvals_checker_chk`, `ledger_adjustments_checker_chk`, `financial_movement_requests_checker_chk`, `pricing_versions_maker_checker_chk` | "same person → refused", "DB refuses a movement approval without a distinct maker" | ✅ |
| 4.10 | Refunds | Request → approval (maker/checker, reversal journal) → payout (second person) → failed / retry, or revoke (compensating). Destination is the original payment; overrides need re-approval by another person | `refund_items_append_only`, `refunds_no_delete` | "#23 duplicate refund … not created twice", "mistakenly approved refund is revoked by a compensating entry" | ✅ |
| 4.11 | Real-money gate | `realMoneyEnabled()` is false on staging and needs threshold 0 plus `fees.ownerApproved`. `updateSetting` runs `goLiveGate()`, which includes **static** `KNOWN_PRODUCTION_BLOCKERS` (backup restore proof, on-call alert test, push device test) plus environment, secrets, pricing, legal, 2FA, invariants, scheduler and malware-scanner checks. Test payments cannot be confirmed after go-live | `payment_destinations_production_guard`, `users_production_fixture_guard` | `pilot-safety.test.ts` | ✅. Enabling is a single person once the gate passes (S-M2) |
| 4.12 | Dispute holds | Open dispute, `financialHold` and OPEN risk flags block release and timeout entitlement. Decisions never move money directly | — | Exact-deadline race test | ✅. One gap: risk-flag resolution path (S-H1) |
| 4.13 | Reconciliation | Statement import (≤ 5,000 rows, all-or-nothing). Matching is manual with a human note. Mismatch raises a HIGH risk flag. Ledger self-reconciliation and daily close | — | #78/#81, #82 | ◐ (S-M4: single person; unmatched or aged breaks do not pause payouts) |

### 4.12 Financial integrity findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| F-1 | Medium | Reconciliation state changes (`IGNORED_WITH_REASON`, `UNMATCHED`, `MISMATCH`) and matches are one person, with no step-up. **No automatic payout pause** for unmatched or aged breaks. No alert rule references reconciliation | `finance/reconciliation.ts` `setReconState`, `confirmMatch`; `alerts/rules.ts` has no recon rule |
| F-2 | Medium | Real-money enablement is **one admin** (`settings.manage` + step-up) after `goLiveGate()` passes. It is not maker/checker. Mitigated today because static blockers make enablement impossible | `settings.ts` `updateSetting`; `finance/controls.ts` `KNOWN_PRODUCTION_BLOCKERS` |
| F-3 | Medium | A marketplace dispute decision `REPLACEMENT` has **no branch** in `applyOrderDecision`. The dispute closes and the hold lifts with no replacement obligation recorded. The seller order may later reach timeout entitlement and release. *Plausible, not reproduced by a test*: the only REPLACEMENT test covers deals | `postpurchase/disputes.ts` `applyOrderDecision`; `pre-acceptance-audit.test.ts` |
| F-4 | Medium | `runScheduledSettlement` has no `Actor`. Its permission, step-up and audit exist only in the Server Action (`runSettlementAction`). It is a scheduled job; exposing it needs the checks moved into the service (T-5) | `finance/withdrawals.ts`, `_actions/admin.ts` |
| F-5 | Low | A `journal_entries` row with **zero** lines would not trip the balance trigger, which fires per line. The approval-amount trigger catches it only when amount > 0. The app always posts ≥ 2 lines | `0001_integrity_triggers.sql`, `0008_production_hardening.sql` |
| F-6 | Low | `ledger_accounts.balance` (projection) has no trigger restricting writes to the posting path. Drift is detected by `ledger.health`, `reconcile()` and the pre-approval drift check, but not prevented | `finance/ledger.ts` |
| F-7 | Info | `postAdjustment(…, selfApproved)` can only be called with `false` (dead parameter). The DB would refuse a self-approved adjustment anyway | `finance/withdrawals.ts` |
| F-8 | Info | `confirmMatch` links evidence to a journal with `idempotency_key LIKE '%id%'`, so it may reference a related but different entry. Evidence only, no money effect | `finance/reconciliation.ts` |

**Previously reported "successful ledger reconciliation and extensive testing": confirmed.** The ledger-balance, zero-drift and every-journal-approved assertions are in the suite that passed in this audit.

---

## 5. Protected Deal: actual state machine

### 5.1 States

The 19 states come from `src/domain/machines.ts` `DEAL_STATUSES`. Every write goes through `moveDeal()` → `transition()`, which asserts against the machine and appends to `status_history`.

### 5.2 Transitions actually wired in code

| From → To | Function | Actor | Guards (verified) | Financial effect | Deadline / timer |
|---|---|---|---|---|---|
| — → `DRAFT` | `createDeal` | Buyer | **SMS provider available** (`assertDealsAvailable`), 20 per 24 h per user | — | — |
| `DRAFT` → `INVITED` | `inviteSeller` | Buyer | Identity APPROVED, commerce gate open, pilot allow-list, wizard complete, terms accepted (legal version recorded) | — | Invitation TTL `deals.invitationTtlHours` (168 h); expiry job `deals.expire_invitations` |
| `INVITED` → `DRAFT` | `revokeInvitation` | Buyer | Only while INVITED | — | — |
| `INVITED` → `SELLER_JOINED` | `claimInvitation` | Any signed-in user (becomes deal seller) | Token valid, PENDING, unexpired; claimant ≠ buyer; binds once (replay by the same user is a no-op) | — | — |
| `INVITED` / `SELLER_JOINED` → `CANCELLED` | `rejectInvitation` (seller) / `cancelDeal` (buyer) | Seller / Buyer | Reason required; pre-funding states only | Cancels unpaid payment | — |
| `SELLER_JOINED` / `CHANGE_REQUESTED` → `OFFER_PENDING_BUYER` | `submitSellerOffer` | Deal seller | Identity APPROVED, **phone verified**, terms accepted, payout details encrypted, used-condition snapshot for covered categories; supersedes open versions | — | — (no offer expiry) |
| `OFFER_PENDING_BUYER` → `ACCEPTED` → `PAYMENT_PENDING` | `respondToOffer(ACCEPT)` → `finalizeTerms` | Buyer | Identity APPROVED; version = latest PROPOSED by seller; **fee still current** (else CONFLICT); condition hash matches; idempotent replay | **Agreement frozen** (DB-immutable), fee and pricing snapshot frozen | — |
| `OFFER_PENDING_BUYER` → `CHANGE_REQUESTED` | `respondToOffer(REQUEST_CHANGE)` | Buyer | Return-policy change and message → new version | — | — |
| `OFFER_PENDING_BUYER` → `CANCELLED` | `respondToOffer(REJECT)` | Buyer | — | — | — |
| `CHANGE_REQUESTED` → `ACCEPTED` → `PAYMENT_PENDING` | `respondToChangeRequest(ACCEPT)` | Deal seller | As above | Agreement frozen | — |
| `CHANGE_REQUESTED` → `OFFER_PENDING_BUYER` | `respondToChangeRequest(REJECT)` or counter via `submitSellerOffer` | Deal seller | Re-proposes the last seller version | — | — |
| `PAYMENT_PENDING` (payment record) | `startDealPayment` | Buyer | Identity APPROVED, gates, pilot amount cap; method enabled; destinations filtered by real-money flag; `isTest` stamped | Payment obligation | `payments.paymentWindowHours`; a lapsed window is **reopened** on demand (audited) |
| `PAYMENT_PENDING` → `PAYMENT_UNDER_REVIEW` | `submitProof` | Buyer | Identity APPROVED, `clientKey` idempotent, 10 per hour | — | — |
| `PAYMENT_UNDER_REVIEW` → `PAYMENT_PENDING` | `rejectPayment` | Staff `payments.verify` | Reason; window extended by 24 h | — | — |
| `PAYMENT_UNDER_REVIEW` → `ACTIVE` | `confirmPayment` → `confirmPaymentInternal` | Staff `payments.verify` + step-up | Payer ≠ staff, no self-dealing, kill switch, claimed amount = due, `expectedAmount`, test payment refused after go-live | **DEAL_PAYMENT**: Dr PLATFORM_CASH / Cr DEAL_FUNDS_HELD (approval DEAL_PAYMENT_CONFIRMATION) | — |
| `ACTIVE` → `DELIVERED` (meaning *shipped*) | `markDealDelivered` | Deal seller | ≤ 6 proof files; increments delivery attempt; **issues OTP** to the buyer by SMS | — | OTP TTL `deals.deliveryOtpTtlHours` (72 h); expiry job |
| `DELIVERED` → `DELIVERY_HANDOVER_VERIFIED` | `verifyDeliveryOtp` | **Deal seller only** | Rate limits 10/15 min per deal and 20/15 min per user; ≤ 5 attempts per code; 30 lifetime guesses; single use under lock | — | Buyer window = max(24 h, `inspectionDays`) from server time |
| `DELIVERY_HANDOVER_VERIFIED` / `BUYER_CONFIRMATION_PENDING` → `BUYER_CONFIRMED_RECEIPT` | `confirmDealReceipt` | Buyer | Handover verified, payment CONFIRMED, idempotent | **None** (entitlement `BUYER_CONFIRMED`) | — |
| `DELIVERY_HANDOVER_VERIFIED` → `ENTITLED_AWAITING_RELEASE` / `BUYER_CONFIRMATION_PENDING` | `flagDealsAwaitingConfirmation` (job, every 5 min) | System | Window elapsed (DB clock). Blockers → `BUYER_CONFIRMATION_PENDING` | **None** (entitlement `TIMEOUT_ENTITLEMENT`) | — |
| Paid states → `DISPUTED` | `openDispute` / `reportNotReceived` / `reportDeliveryException` | Buyer or seller | After a verified handover, "not received" becomes a DELIVERY_CONFLICT (risk flag + dispute) | **Hold** | Evidence and SLA in disputes |
| `BUYER_CONFIRMED_RECEIPT` / `ENTITLED_AWAITING_RELEASE` → `COMPLETED` | `releaseDeal` | Staff `finance.release` + step-up, **checker**; maker = `requestMovement(DEAL_RELEASE)` by another person | Not a party; receipt basis present; no hold, flag, open dispute or unconfirmed payment; `expectedPayout`; kill switch | **DEAL_SETTLEMENT**: Dr DEAL_FUNDS_HELD / Cr DEAL_PAYOUTS_PAYABLE + DEAL_FEE_REVENUE (+ CUSTOMER_REFUNDS_PAYABLE for partial refund) | — |
| `DISPUTED` → `REFUND_PENDING` → `REFUNDED` | `resolveDispute(FULL_REFUND)` → refund request → `approveRefund` (maker/checker) → `approveDealRefundTx` | Staff | Refund amount = held amount | **DEAL_REFUND**: Dr DEAL_FUNDS_HELD / Cr CUSTOMER_REFUNDS_PAYABLE; payout recorded separately (two-person) | — |
| `DISPUTED` → `ENTITLED_AWAITING_RELEASE` | `resolveDispute(PARTIAL_REFUND / RELEASE_TO_SELLER / REJECT_CLAIM)` | Staff | Partial: 0 < amount < held | None until release | — |
| `DISPUTED` → `ACTIVE` | `resolveDispute(RETURN_REQUIRED / REPLACEMENT)` | Staff | Closes OTP, clears the handover | None; re-delivery with a new OTP | — |
| (hold) | `setDealFinancialHold` | Staff `deals.manage` + step-up | **Not a party** | Blocks release | — |
| Seller payout | `requestAccountWithdrawal` → `approveWithdrawal` (allocation `PROTECTED_DEAL`) → `markWithdrawalPaid` | Deal seller → staff ×2 | Verified receiving destination (the direct `markDealPayoutPaid` path is closed) | Dr DEAL_PAYOUTS_PAYABLE → reserved → cash | — |

The machine also *permits* `PAYMENT_PENDING → ACTIVE`, `DISPUTED → COMPLETED` and `DISPUTED → REFUNDED`. No code path uses them; they are reserved for a PSP and for direct decisions.

### 5.3 Comparison with the intended flow

| Intended | Actual | Match |
|---|---|---|
| Buyer Request | `DRAFT` wizard (5 steps) | ✅ |
| Invitation | `INVITED` (token link shared by the buyer; EDMN sends nothing to buyer-typed contacts) | ✅ |
| Seller Review | `SELLER_JOINED` (bound) → offer. No separate "reviewing" state | ◐ (label only) |
| Offer | `OFFER_PENDING_BUYER` with versioned terms | ✅ |
| Buyer Approval | `respondToOffer(ACCEPT)` | ✅ |
| Frozen Agreement | `ACCEPTED` (snapshot + DB trigger) → auto `PAYMENT_PENDING` | ✅ |
| Payment | Manual proof → staff verification | ✅ (no PSP) |
| Funded | `ACTIVE` after DEAL_PAYMENT journal | ✅ |
| Delivery | `DELIVERED` = shipped / out for handover | ✅ (naming) |
| OTP | `DELIVERY_HANDOVER_VERIFIED` | ✅ |
| Receipt | `BUYER_CONFIRMED_RECEIPT` or timeout `ENTITLED_AWAITING_RELEASE` | ✅ |
| Settlement | Admin maker/checker release → `COMPLETED` | ✅ (never automatic) |
| Completed | `COMPLETED` = settled into seller payable. **Paid out only via a later withdrawal** | ◐ (UX must explain) |
| Reject | → `CANCELLED` (with reason) | ✅ |
| Modify | `CHANGE_REQUESTED` and counter offers | ✅ |
| Expire | Invitation, OTP and payment window only. **Deals do not expire** in `SELLER_JOINED`, `OFFER_PENDING_BUYER`, `CHANGE_REQUESTED` or `PAYMENT_PENDING`; alerts only (`alerts/rules.ts` `DEAL_OFFER_PENDING_BUYER`) | ✗ |
| Dispute | `DISPUTED` (hold) | ✅ |
| Return | `RETURN_REQUIRED` → back to `ACTIVE` for re-delivery. **No reverse-logistics tracking of goods to the seller** | ◐ |
| Replace | `REPLACEMENT` → re-delivery with a new OTP | ✅ |
| Refund | Full (`REFUND_PENDING` → `REFUNDED`) or partial (in release) | ✅ |

### 5.4 Protected Deal implementation gaps

| ID | Gap | Impact for mobile |
|---|---|---|
| PD-1 | No expiry of deals or offers after the seller joins, and no offer TTL | Stale deals accumulate. The mobile UI cannot show a countdown that the server enforces. Needs a product decision and a job |
| PD-2 | Return of goods to the seller is not modelled for deals. `FULL_REFUND` does not require goods back | Disputes UX and policy. Legal review |
| PD-3 | Delivery OTP is **SMS-only**. In production the buyer cannot see the code in-app (`deliveryOtpForBuyer` returns it only in test mode) | Mobile must choose: keep SMS, or add an in-app reveal (a new capability with step-up, a screenshot guard and no push payload) |
| PD-4 | Protected Deals are refused when no SMS provider is configured (`assertDealsAvailable`) | Launch dependency |
| PD-5 | Status names `DELIVERED` (= shipped) and `COMPLETED` (= settled, not paid out) are misleading | Mobile labels must come from a server-provided label map, never from enum names |
| PD-6 | No server-side `allowedActions` / `nextDeadline` projection | Required so that mobile does not invent the state machine (P0-3) |
| PD-7 | Delivery-review risk flags can be resolved by the generic risk-flag action without a party check | S-H1 |
| PD-8 | OTP HMAC key is `SESSION_SECRET` (domain-separated, shared key) | Rotating the session secret invalidates live codes. Prefer a dedicated key |

**Marketplace orders do not use the Delivery OTP.** Delivery is established by an authoritative carrier or operations event, followed by a 24 h buyer window. If the product requires an OTP for marketplace orders too, that is new domain work (D-6).

---

## 6. Security findings

| ID | Sev. | Finding | Evidence | Fix (not applied) |
|---|---|---|---|---|
| S-H1 | **High** (once exposed via API; Medium on web today) | `riskFlagAction` resolve: no conflict-of-interest check (a staff member who is a party to a deal could clear its DELIVERY_CONFLICT release blocker). Direct DB writes. Audit not atomic with the change | `_actions/admin.ts` lines 68–91, compared with `setDealFinancialHold` | Move into a service with a party check, step-up and one transaction (T-1) |
| S-M1 | Medium | Step-up is a **session-wide 10-minute window**: one TOTP unlocks every sensitive action on that session | `core/actor.ts` `requireStepUp`; `sessions.step_up_at` | Action-scoped step-up grants for Admin Mobile |
| S-M2 | Medium | Real-money enablement is one person after the gate | `settings.ts` | Two super-admins + checker |
| S-M3 | Medium | Rate limits per IP. Without `VERCEL` / `TRUSTED_PROXY` all clients share the `unknown` bucket (login 30/15 min **globally**). Egyptian mobile carriers use CGNAT, so per-IP limits throttle many legitimate users | `web/client-ip.ts`, `auth/service.ts` | Per-device and per-account limits for the mobile API; ensure the proxy configuration |
| S-M4 | Medium | Reconciliation decisions are one person with no step-up; breaks do not pause payouts | §4.12 F-1 | Step-up + two-person for IGNORE; aged-break payout pause |
| S-M5 | Medium | No remote session revocation or device management (customer, seller, staff); `revokeAllSessions` unused | `auth/service.ts`; security page | Required for mobile (lost device) |
| S-M6 | Medium | Read authorization is page-level for many admin and some customer reads (T-6). Naive API exposure would create IDOR / broken function-level authorization | `adminWith()` in pages; query functions without `Actor` | Query services with authorization inside |
| S-L1 | Low | `audit_logs` is append-only by trigger but not hash-chained or exported to WORM | `0001_integrity_triggers.sql` | Hash chain + daily export |
| S-L2 | Low | Logout is not audited. Profile update is not audited | `auth/service.logout`; `updateProfileAction` | Add audit |
| S-L3 | Low | Product, store and profile edits are last-write-wins (no version check) | `catalog/products.ts` | `If-Match` |
| S-L4 | Low | Staging shows ACCOUNT_SECURITY codes to admins, and the deal OTP test code to buyers (by design, gated by `EDMN_ENVIRONMENT`; verified `deliveryOtpTestMode()` returns false in production) | `admin/(console)/notifications/page.tsx`, `deals/delivery-otp.ts` | Keep the gate. Add a test that production never returns `testCode` |
| S-L5 | Low | OTP and verification-code HMAC keys derive from `SESSION_SECRET` | `delivery-otp.ts`, `auth/service.ts` | Dedicated keys |

**Verified positive controls:**

- Enumeration-safe login and reset.
- Atomic lockout.
- Replay-safe TOTP.
- Mandatory staff 2FA (go-live blocker if any active staff lacks it).
- Privileged-role guard.
- Private-file purpose authorization with uniform 404s.
- Malware-scan fail-closed in production.
- Sealed and redacted secrets in the outbox.
- Nonce CSP.
- Admin host isolation.
- Production refuses public fixture passwords and TOTP secrets (and DB triggers).
- Secret fingerprints.
- Idle timeout for staff sessions.

---

## 7. Admin Web → Admin Mobile mapping

The full per-page table is in `MOBILE_API_GAP_MATRIX_V2.md` §4. In summary, across 75 admin pages (incl. login, 2fa and step-up):

| Class | Pages | Meaning |
|---|---|---|
| MOBILE_READY | 8 | Every underlying read and write service already enforces authorization with an `Actor`; only the adapter is needed |
| API_REQUIRED | 50 | Services exist, but read models or authorization must be extracted, or bearer auth is needed |
| DESKTOP_ONLY_JUSTIFIED | 17 | Configuration authoring or analysis, none of it launch-critical operations: taxonomy (categories, brands, attributes), CMS and legal authoring, fee-table drafting and simulation, profitability analytics, bulk PII exports, policy and score-rule tuning, notification templates, legacy commissions. Their **approve and publish** steps stay mobile |
| MISSING | 4 capabilities | Own session/device management, revoke a user's sessions, push-based admin alerting, action-scoped step-up |

**Every launch-critical operation becomes possible from the Admin App** once the API_REQUIRED items are delivered. These cover:

- KYC and identity review
- seller approval
- moderation
- payment verification
- holds
- disputes
- returns
- releases (maker and checker)
- refunds
- withdrawals (approve, pay, uncertain, failed, returned)
- adjustments
- reconciliation matching
- kill switches
- support
- staff and roles
- audit
- settings

---

## 8. Mobile architecture decision (revised)

**Recommendation.** Mobile lives **in the platform repository**, next to the API it consumes, once D-1 makes the Marketplace branch the mainline.

```
edmn-eg (platform mainline = today's claude/great-tesla-nor0wt)
  src/…                       existing Next.js app (unchanged)
  src/app/api/v1/**           NEW thin adapter (Phase 1)
  src/server/api/**           NEW: bearer auth, DTO schemas, error mapping, allowed-actions queries
  openapi/mobile.v1.yaml, openapi/admin.v1.yaml   generated + committed, diffed in CI
  mobile/                     Flutter workspace (excluded from the Next/Vercel build)
    apps/customer_mobile/     Buyer + Seller Center (flavors dev/staging/prod)
    apps/admin_mobile/        separate bundle id, signing, Firebase/Sentry projects
    packages/design_system/   tokens from src/app/globals.css (brand-950 #061a3d … brand-50, accent #d7263d, deal #c2410c, IBM Plex Sans Arabic)
    packages/api_customer/    generated from mobile.v1 (Dio)
    packages/api_admin/       generated from admin.v1 (never a dependency of customer_mobile)
    packages/localization/    ARB ar (labels.ts export) + en (new)
    packages/security/        token store, step-up, biometric gate, FLAG_SECURE, redaction
    packages/observability/   Sentry with scrubbing
```

**Why.** A contract change, the server change and the regenerated clients land in one PR, and CI fails on drift.

**Alternative.** If the owner wants a separate `edmn-mobile` repo, it consumes the committed OpenAPI files as a versioned artifact (D-2).

**Package choices** (Riverpod, go_router, Dio, Drift for a non-authoritative cache only, flutter_secure_storage, FCM/APNs, Sentry, Fastlane, GitHub Actions) stand as evaluated in v1 §9.4. Two corrections:

- **Drift** must never cache admin PII, KYC or finance rows, nor the OTP.
- **Push payloads** must stay lock-screen safe, mirroring the outbox's `SECRET_EVENTS` policy.

---

## 9. Recommended Phase 1 scope

Phase 1 = `MOBILE_BACKLOG_V2.md` sprints S1 and S2. It runs on a **new branch cut from `claude/great-tesla-nor0wt`**, after approval.

1. **API-001 Bearer auth and device sessions.** Additive migration for `MOBILE` / `ADMIN_MOBILE` scopes, a device table and refresh tokens. Reuse `createSession`, `resolveSession`, `login`, the TOTP functions and the actor builders. Includes security tests.
2. **API-002 Adapter skeleton.** Covers:
   - problem+json mapping of `DomainError`
   - the lint rule "no DB in `src/app/api/v1/**`"
   - the parity-test harness against Server Actions
3. **API-003 OpenAPI 3.1 generation** with the CI diff check.
4. **Security before exposure:**
   - SEC-01 fixes S-H1 (risk-flag resolution)
   - SEC-02 adds session listing and remote revoke
   - SEC-03 adds audit channel attribution
   - SEC-04 adds mobile rate-limit tiers
   - SEC-05 adds generic idempotency on the existing `idempotency_keys` table
5. **RM-01 Read-model extraction wave 1** (me, customer orders, deal detail, seller orders, notifications) with authorization inside query services. Web pages switch to the same functions.
6. **API-C1** public catalog and content endpoints (READY services) with CT and PR tests.
7. **MOB-001..004, DS-001, L10N-01 Flutter foundations:**
   - the workspace
   - the two app identities
   - the security package
   - generated Dart clients
   - design tokens from `globals.css`
   - ARB export from `labels.ts`

**Excluded from Phase 1:**

- money-moving endpoints
- admin endpoints
- Flutter business screens
- PSP
- System A
- real money (stays OFF)

## 10. Decisions needed

| ID | Decision |
|---|---|
| D-1 | Make `claude/great-tesla-nor0wt` the platform mainline (merge to `main`, or rename) before Phase 1 work starts. The marketing site moves elsewhere or under a route |
| D-2 | Mobile in the platform repo (recommended) or a separate repo |
| D-3 | Delivery OTP in-app reveal (new capability) or SMS-only |
| D-4 | Deal and offer expiry policy (PD-1) |
| D-5 | Deal return-of-goods policy (PD-2) and marketplace replacement (F-3) |
| D-6 | Delivery OTP for **marketplace** orders: yes or no |
| D-7 | Admin Mobile step-up: action-scoped (recommended) or keep the 10-minute window |
| D-8 | Real-money enablement: require two super-admins (F-2) |
| D-9 | English locale scope for mobile v1 (the platform is Arabic-only today) |
| D-10 | Store accounts, bundle IDs, Admin App private distribution |

---

## 11. Change verification

**Nothing was modified on the Marketplace branch `claude/great-tesla-nor0wt` or in System A:**

- no source code, migrations or routes
- no Flutter projects
- no deployment, staging or production changes

The only repository change is on `claude/awesome-davinci-ojxuul`:

- the five v2 documents were added under `docs/mobile/`
- a "superseded" banner was added to the four v1 documents (kept for audit history)

The test run used a throwaway PostgreSQL cluster and an exported copy, both in the session scratchpad. The cluster was stopped after the run.
