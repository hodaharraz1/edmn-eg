# End-to-End Trust & Fraud Gap Audit — EDMN / اضمن

**Type:** read-only gap analysis. No application code, tests, migrations, data, staging or production were changed.
**Baseline:** `claude/great-tesla-nor0wt` @ `48ae40ce38ab8793667dd65899d1e4d1881d3f86` (clean worktree, equals `origin`).
**Method:**
- Static inspection of the server modules, the Drizzle schema, every SQL migration `0000`–`0019`, server actions, UI copy, seed/CMS content and the existing tests.
- Each control is classified only on its backend/DB enforcement path. A UI, enum or column alone never counts as `EXISTS`.
- No tests were run for this audit. The figures from the last gate (618/618 unit/integration, 144+1 E2E) are not re-verified here.

Classification legend:

| Code | Meaning |
|---|---|
| **EXISTS** | Enforced server-side or in the DB, with no known bypass |
| **PARTIAL** | Partly enforced, convention-only, or bypassable |
| **MISSING** | Not found |
| **CONFLICTING** | The code contradicts the requirement or its own stated intent |
| **N/A** | Not applicable |

---

## 1. Executive Summary

EDMN's **financial core is genuinely strong**, and most of it is enforced in the database:
- **Ledger:** append-only, double-entry, and every journal entry requires a consumed, amount-exact approval.
- **Two-person rule:** maker ≠ checker on all release, refund, payout and adjustment movements.
- **Delivery OTP:** strictly handover evidence.
- **No automatic movement:** no automatic release or payout path exists, and no AI is involved anywhere.
- **Protected-deal release:** fully serialized against disputes by a row lock.

These systems should be **preserved and extended, not rebuilt**.

The gaps sit at the **edges**: fail-open corners in the financial guards, the post-release dispute window, return-fraud verification, used-commerce governance (it is not default-deny), evidence immutability outside the used module, seller risk and exposure limits, and anti-circumvention. Some customer-facing trust wording also overstates what the controls support.

- **P0: 6.** Financial-integrity gaps that block protected Real Money.
- **P1: 14.** Block public marketplace and Used Commerce launch.
- **P2: 22.**
- **P3: 12.**

`48ae40c` remains a sound **infrastructure / pre-DNS validation candidate** with Real Money OFF and not public. It is **not** the public-launch candidate.

---

## B1 status update — P0 #1–#4 (B1 commit, pending final gate)

| P0 | Status | Fix | Proof |
|---|---|---|---|
| P0-1 ledger health fails open | **FIXED_PENDING_FINAL_GATE** | `ledgerHealthBlock` / `assertLedgerHealthy` (`finance/ledger-health.ts`): a missing, stale (>120 min), future-dated, CRITICAL, unknown or unreadable latest snapshot blocks every money movement | `tests/integration/b1-financial-fail-closed.test.ts` › "B1 P0#1 …" (6 tests); fails on 48ae40c, passes on B1 |
| P0-2 malformed kill switch reads as unpaused | **FIXED_PENDING_FINAL_GATE** | `killSwitchEngaged` (`finance/controls.ts`): only a stored JSON boolean `false` means running; missing/malformed/unreadable = PAUSED. Migration 0020 stores explicit `false` for every switch that has no row (existing rows are never overwritten) | "B1 P0#2 …" (6 tests) |
| P0-3 FAILED refund re-payable, no uncertain state | **FIXED_PENDING_FINAL_GATE** | New refund status `TRANSFER_UNCERTAIN` (migration 0020). `FAILED`/`TRANSFER_UNCERTAIN` are not payable; `resolveRefundTransferNotSent` (refunds.approve + fresh 2FA + evidence + a person other than the one who recorded the attempt) returns the refund to `APPROVED`; an uncertain transfer that went out is recorded once via `recordRefundPayout` | "B1 P0#3 …" (8 tests: repeat, concurrent duplicates, worker ticks, resolution paths, separation of duties) |
| P0-4 PARTIAL_REFUND amount ignored on a disputed return | **FIXED_PENDING_FINAL_GATE** | `acceptReturnRefundTx({ authorizedAmount })` + `applyOrderDecision`: the refund request equals the decided amount exactly (principal only, capped by the returned units, explicit `shippingAmount: 0`); any mismatch aborts | "B1 P0#4 …" (5 tests incl. ledger: CUSTOMER_REFUNDS_PAYABLE credit/debit = decided amount) |
| P0-5, P0-6 | OPEN | Not part of B1 | — |

These are **not closed**. They close only after the later final security/fraud gate on a new candidate SHA.

---

## 2. Repository / Baseline Confirmation

| Item | Value |
|---|---|
| Branch | `claude/great-tesla-nor0wt` |
| HEAD | `48ae40ce38ab8793667dd65899d1e4d1881d3f86` (= remote tip) |
| Worktree | clean before this report. The only new file is this report (uncommitted) |
| Gate report | `docs/security/FINAL_PREPRODUCTION_SECURITY_GATE.md` present |
| Migrations | `drizzle/0000_init.sql` … `0019_used_trusted_commerce.sql` (20) |
| COD | **Not found.** No COD code, states or wording. Payment methods are `BANK_TRANSFER`, `INSTAPAY` and `VODAFONE_CASH` only (`deals/service.ts:715`, `schema/controls.ts:74`) |
| AI/LLM | **Not found** in `src`, `scripts` or `package.json` |
| A-100016 | Code only *excludes* it (`alerts/rules.ts:57,83,93`). Tests assert it is untouched (`tests/e2e/realtime.spec.ts:24-28` and others). No script mutates it. `scripts/reset-db.ts:7-20` refuses STAGING/PRODUCTION databases |

---

## 3. Current Architecture Discovered

All paths are under `src/server/modules/` unless they start with another top-level folder.

| Domain | Location |
|---|---|
| Catalog / taxonomy | `catalog/products.ts`, `catalog/taxonomy.ts`, `catalog/search.ts`. Category flags: `isActive`, `isRestricted`, `isProhibited` (`schema/catalog.ts:48-49`) |
| Orders / fulfilment | `commerce/orders.ts`, `commerce/fulfilment.ts`. Seller-fulfilled (`shippingPayee: 'SELLER_FULFILMENT'`) |
| Protected deals | `deals/service.ts`, `deals/delivery-otp.ts` |
| Used commerce | `used/{policies,reports,snapshots,signals,views,analytics}.ts`, `src/domain/used.ts`, `schema/used.ts`, migration 0019 |
| Post-purchase | `postpurchase/returns.ts`, `postpurchase/disputes.ts` |
| Finance | `finance/{ledger,postings,approvals,movements,controls,ledger-health,reconciliation,refunds,withdrawals,withdrawal-allocation,self-dealing,seller-wallet}.ts` |
| Payments | `payments/{providers,service,webhooks}.ts`. Provider registry = MANUAL only; webhooks are evidence only |
| Identity / KYC | `identity/service.ts`, `identity/receiving.ts` |
| RBAC | `src/server/rbac/permissions.ts`, `src/server/rbac/staff.ts`, `src/server/core/actor.ts` |
| Risk / alerts | `risk_flags` (`schema/sellers.ts:235`), `alerts/{engine,rules}.ts` (ops/SLA), `used/signals.ts` (display only) |
| Jobs | `src/server/jobs/worker.ts:31-53`. No job posts journal entries or grants approvals |
| State machines | `src/domain/machines.ts`: order, seller_order, payment, shipment, return, refund, deal, dispute, withdrawal |

---

## 4. Requirements Matrix

| # | Requirement | Class | Key evidence (§5 has detail) |
|---|---|---|---|
| 1 | Used default-deny | **MISSING / CONFLICTING** | `catalog/products.ts:378-390`; `deals/service.ts:106-112`; `used/snapshots.ts:108-111` |
| 2 | Listing vs protection eligibility | **MISSING** | Only `isActive`/`isRestricted`/`isProhibited` and policy `enabled` exist |
| 3 | Category policy engine | **PARTIAL** | JSON policy `domain/used.ts:184-218`; missing ownership, video, shipping, return, limits and fee fields; no lifecycle |
| 3b | Revalidation on category change | **MISSING** | `products.ts:172,184,386-388`; one report per product (`used_reports_product_uq`) |
| 4 | Category generality | **PARTIAL** | Only `mobile-phones` seeded; IMEI/battery assumptions hardcoded (`domain/used.ts:391-396`, `used-section.tsx:143`) |
| 5 | Product Passport / condition | **EXISTS (deals) / PARTIAL (marketplace)** | 0019 triggers; marketplace reports never LOCK (`reports.ts:52-64`) |
| 6 | Trust-semantics separation | **PARTIAL** | Levels PROTECTED/VERIFIED/INSPECTED distinct in code; wording blurs them (§19) |
| 7 | Ownership / provenance / authenticity | **MISSING / PARTIAL** | No ownership fields; duplicate-IMEI flag only (`reports.ts:250-270`); prohibited flags not applied to deals |
| 8 | Guided evidence | **EXISTS (photos) / MISSING (video)** | `reports.ts:188-191`, `domain/used.ts:468-473` |
| 9 | Immutable snapshot | **PARTIAL** | `0005:47-67`, `0010:280-293`, `0019:159-211`; deal money columns and order items unguarded |
| 10 | External protected deal flow | **EXISTS** | `deals/service.ts:87-1170` |
| 11 | Delivery OTP = handover only | **EXISTS** | `deals/service.ts:901-907`; `0006:37-52`; tests `delivery-otp.test.ts:272,294,303,345` |
| 12 | Independent state machines | **PARTIAL** | Couplings: order DELIVERED = entitlement; deal REFUNDED at approval |
| 13 | Shipping responsibility | **EXISTS (representation) / PARTIAL (evidence)** | Seller-fulfilled; deals lack carrier and tracking |
| 14 | Chain of custody | **PARTIAL** | `status_history` append-only; shipments, tracking and deal evidence unguarded; no identity re-verification per leg |
| 15 | Return Passport | **PARTIAL / MISSING** | `postpurchase/returns.ts`; no identity, accessory or condition verification |
| 16 | Return-swap defenses | **MISSING** | §14 |
| 17 | Dispute engine | **PARTIAL** | `postpurchase/disputes.ts`; free-text reasons, no deadlines or appeal |
| 18 | Dispute vs release race | **EXISTS (pre-release) / MISSING (post-release)** | `fulfilment.ts:428-439`; `disputes.ts:60`; post-release funds are not frozen |
| 19 | Financial invariants | **EXISTS / PARTIAL** | `0001:16-47`, `0008:289-354`; fail-open health gate |
| 20 | Maker/Checker hardening | **PARTIAL** | `0014:197-209`; request has no destination/economic fingerprint |
| 21 | Insider / SoD | **PARTIAL** | Strong RBAC; SUPER_ADMIN invite-email gap; evidence tables lack triggers |
| 22 | Seller risk states | **PARTIAL** | Status gates exist; `riskLevel` never written |
| 23 | Seller exposure limits | **MISSING** | Only the global pilot cap (`ops/pilot.ts:11-17`) |
| 24 | Buyer abuse | **MISSING (mostly)** | No dispute/return counters or outcome model |
| 25 | Account re-creation | **PARTIAL** | Email and phone unique; national ID and payout destination not linked |
| 26 | Reviews / reputation | **PARTIAL** | Verified-purchase only; ranking = rating × count + sales |
| 27 | Collusion | **PARTIAL** | Own-store self-dealing prevented; second-account collusion uncontrolled |
| 28 | Anti-circumvention | **MISSING** | `messaging/service.ts:205-211` |
| 29 | Trust badges | **PARTIAL / CONFLICTING** | §19 |
| 30 | Policy versioning | **CONFLICTING** (used) / **EXISTS** (fee, legal) | `policies.ts:50,62-65` vs `policyById` |
| 31 | Central risk engine | **SCATTERED** | §18 |
| 32 | AI decision boundary | **EXISTS (no AI; approvals require ADMIN)** | `approvals.ts:73`; `0008:299` |
| 33 | Fail-closed | **PARTIAL / CONFLICTING** | `ledger-health.ts:51-55`; `settings.ts:207-211`; `refunds.ts:398` |
| 34 | Kill switches | **PARTIAL** | `finance/controls.ts:13-22`; no per-seller, per-category or new-protected-deal switch |
| 35 | Legal / expectation wording | **PARTIAL** | §19 |
| 36 | Security baseline | **EXISTS** | §23 |
| 37 | Stable systems identified | — | §11 |
| 38 | A-100016 integrity | **EXISTS** | §2 |

---

## 5. Exact Evidence (by area)

### 5.1 Used commerce governance

**Policy lookup** — `used/policies.ts:20-32` (`policyForCategory`):
- It walks up the category path, so a parent's policy applies to its children.
- A null category, or no enabled policy, returns `null`. The only lifecycle is `enabled` true/false.

**Marketplace products:**
- **Uncovered categories:** `catalog/products.ts:378-390` (`submissionProblems`). With no policy, a USED item needs only a grade, notes, a defects text and photos. A declared report is required only `if (await policyForCategory(...))` (`:386`).
- **Self-declared condition:** NEW/USED is the seller's choice (`createDraft :73`, `updateDetails :162`). The DB only checks that a USED non-draft product has a grade (`schema/catalog.ts:199`).
- **Approval paths:** auto-publish is possible when moderation is off (`submitForReview :406-436`). `moderateProduct` APPROVE does not re-run `submissionProblems` (`:449-483`).

**Live-report bypass:**
- `authorizeEdit` blocks only LOCKED reports (`reports.ts:52-64`), and marketplace reports never lock; only deals lock (`snapshots.ts:162`).
- An edit sets the report back to DRAFT (`reports.ts:95-117`), but the product stays LIVE.
- Checkout then silently skips non-DECLARED reports (`snapshots.ts:268`), so the buyer gets no frozen condition.

**External deals:**
- The category is optional (`deals/service.ts:61`).
- `usedStep1` checks only that the category exists (`:106-112`). It does not check `isActive`, `isProhibited` or the listing policy.
- When there is no policy, the deal takes the legacy path (`dealUsesPolicy`, `snapshots.ts:108-111`; `service.ts:407`).

**Category change:** `updateDetails` writes `categoryId` without revalidating (`products.ts:172,184`). `submissionProblems` never compares `report.policyId` with the destination policy (`:386-388`).

**Policy versioning — CONFLICTING:**
- `savePolicy` overwrites `config` and bumps `version` (`policies.ts:62-65`).
- `policyById` always returns the current config (`:34-38`). This contradicts the intent stated at `:50`.
- Deal snapshots are content-frozen at proposal (`snapshots.ts:68-83`).
- Live listings and DRAFT/DECLARED reports are re-interpreted against the current policy.

**Policy editing:**
- Requires `catalog.manage` + fresh 2FA + a reason, and is audited (`_actions/used.ts:137-148`).
- There is no review, publish or maker/checker step.

### 5.2 Snapshots and deals

**Deal agreed terms** — `deals/service.ts:374-454, 527-587`:
- `edmn_agreed_terms_immutable` (`0005:47-55`); `deal_terms_versions` is append-only (`0005:58-67`).
- The pricing snapshot is immutable (`0010:280-293`).
- Condition snapshots are immutable and hash-chained (`0019:159-176`); test at `deal-invitation-returns.test.ts:336`.

**Unguarded money columns:** `buyer_pays`, `fee_amount`, `seller_receives`, `pending_buyer_refund` and `seller_payout_enc` on `external_deals` have no trigger. `releaseDeal` computes from these columns (`:1154-1155`). No rewrite path was found, so this is convention-only.

**Condition amendment** (`snapshots.ts:181-249`):
- It creates a new consented snapshot.
- `agreedTerms.condition` still points at the old snapshot, because the trigger forbids changing it.
- Disputes use the latest ACCEPTED snapshot (`:306-309`).

**Orders:**
- Frozen: `economicSnapshot`, `titleSnapshot`, `conditionSnapshot` and `returnPolicySnapshot` (`orders.ts:173-260`), and `seller_orders.pricing_snapshot` is DB-immutable (`0010:292`).
- Not guarded: `order_items` and `orders.economic_snapshot` have no immutability trigger.

### 5.3 Delivery OTP

On success, `deals/service.ts:901-907`:
- sets `usedAt`;
- moves the deal to `DELIVERY_HANDOVER_VERIFIED`;
- sets `buyerResponseDueAt`;
- writes the audit entry and a notification.

The consumers are listed in §16.1. None of them creates acceptance, entitlement or release.

### 5.4 Disputes, returns and the race

Dispute vs release race, by flow:

| Flow | Dispute side | Release side | Result |
|---|---|---|---|
| Marketplace order | `disputes.ts:60` locks `seller_orders FOR UPDATE` | `fulfilment.ts:428` locks the same row, then `releaseBlockers` (`:185-204`) re-reads hold, disputes, returns, refunds and shipment problems | Serialized. Test #36 at `hardening-matrix.test.ts:195-213` |
| Protected deal | `disputes.ts:74-84` locks `external_deals` | `releaseDeal` (`deals/service.ts:1144`) locks it, then runs `dealReleaseBlockers` (`:1121-1131`) | Serialized both ways. A dispute after COMPLETED is refused (`disputes.ts:80`) |

**Post-release gap (marketplace):**
- A dispute can still open after release (`disputes.ts:66`), and a return can be opened on COMPLETED (`returns.ts:72`).
- A hold cannot be placed after release (`fulfilment.ts:493`).
- Withdrawals check only `payoutHoldUntil`, a negative balance (`withdrawals.ts:132-137`), identity and kill switches. Open disputes are not checked.

**PARTIAL_REFUND bug:** on a disputed return, `disputes.ts:246` calls `acceptReturnRefundTx(..., { includeShipping, note })` without the decided amount. `returns.ts:208-218` then requests the **full** value of the returned units.

### 5.5 Finance

- **Journal:** immutable (`0001:16-30`); balanced at commit by a deferred trigger (`0001:34-47`).
- **Approvals:**
  - Every entry needs an unconsumed approval with exactly matching debits (`0008:289-329`).
  - Approvals are frozen (`0008:331-354`).
  - Two-person rule per movement kind (`0014:197-209`).
- **Idempotency:** unique indexes `journal_entries_idem_uq`, `financial_approvals_idem_uq`, `refunds_idem_uq`, `withdrawals_client_key_uq`, `provider_events_uq` and `financial_movement_requests_open_uq`.

Fail-open corners:
- **Ledger-health gate:** `ledger-health.ts:51-55` throws only if the latest row is `CRITICAL`. No row, or a stale row, lets the movement pass.
- **Kill-switch parsing:** `settings.ts:207-211` falls back to the schema default when a stored value fails to parse. Kill switches default to `false`, so they read as **unpaused**.
- **Refund re-pay:** `refunds.ts:398` accepts `FAILED` as payable again. There is no UNCERTAIN state for refunds.

Gate coverage gaps:
- These paths are not gated by the kill switch or ledger health: `rejectWithdrawal` reversal (`withdrawals.ts:555+`), `markWithdrawalFailedBeforeTransfer` (`:609`), `recordWithdrawalReturned` (`:641`) and `revokeRefund` (`refunds.ts:529`).
- `ledger_accounts.balance` is not UPDATE-guarded. Drift is only detected afterwards (`ledger.ts:194-211`, `controls.ts:179`).

Real-money flag:
- `realMoneyEnabled()` (`settings.ts:285-290`) does not re-run the full `goLiveGate` (`:231-247`, `controls.ts:489-499`).
- The default is `false`, and the gate has hard blockers.

### 5.6 Staff and identity

- **Staff invite:** `rbac/staff.ts:64-90` (`createStaffUser`) sends the password-setup link to an email the creator types. A SUPER_ADMIN can therefore operate a second staff account and satisfy the two-person trigger alone.
- **Unused risk field:** `sellers.riskLevel` (`schema/sellers.ts:55`) is never written.
- **RESTRICTED sellers:** they can still request, and be approved for, withdrawals (`withdrawals.ts:61,144,375,477`).
- **National ID:** stored encrypted with its last 4 digits (`identity/service.ts:123`). There is no hash or uniqueness check.
- **Payout fingerprint:** it is used only for tamper detection (`identity/receiving.ts:74-75,197-199`), not to detect one destination shared across accounts.
- **Review moderation:** `reviews/service.ts:131-137` has no self-dealing check.
- **Messaging:** `messaging/service.ts:205-211` (`cleanBody`) strips control characters only.

---

## 6. Fraud Attack Surface Map

Control types: **P** = Prevent, **D** = Detect, **L** = Limit, **R** = Review, **—** = not controlled.

| Surface | Attack | Current control | Type |
|---|---|---|---|
| Buyer | False non-receipt (deal) | OTP handover; post-OTP "not received" → `DELIVERY_CONFLICT` flag + dispute (`deals/service.ts:968-1002`) | P/R |
| Buyer | False non-receipt (marketplace) | Carrier/Ops delivery event + evidence; dispute | R |
| Buyer | Abusive / repeated disputes | One open dispute per order; dispute window | — (no per-buyer history) |
| Buyer | Return swap / serial swap | None | — |
| Buyer | Post-receipt damage | Snapshot (used items only); manual dispute | R (partial) |
| Seller | Hide defects in a used listing | Policy fields + declaration (covered categories only); editable after LIVE | P (partial) |
| Seller | Category misclassification | Moderation; no revalidation | — |
| Seller | Stolen / counterfeit goods | Prohibited keywords (products only); duplicate-IMEI flag | D (partial) |
| Seller | Stolen images | None | — |
| Seller | False return-damage claim | Buyer can escalate a REJECTED return | R |
| Seller | Off-platform migration | None in messaging | — |
| Collusion | Wash trades via a second account | Own-store self-dealing only | — |
| Collusion | Fake reviews | Verified purchase only | P (weak) |
| Returns | Accessory or part removal | None | — |
| Insider | Support moves money | No permission | P |
| Insider | Dispute officer moves money | Decision → request only | P |
| Insider | SUPER_ADMIN two-account | Invite email chosen by creator | — |
| Insider | Erase dispute evidence | No code path; no DB trigger | P (convention) |
| Financial | Duplicate release/refund approval or journal | Unique idempotency keys + DB triggers | P |
| Financial | Re-pay a FAILED refund | Accepted | — |
| Financial | Ledger mismatch when no health row exists | Passes | — |
| Concurrency | Dispute vs release (before release) | Row lock + re-check | P |
| Concurrency | Dispute vs withdrawal (after release) | None | — |
| Reputation | Rating farming | Ranking uses rating × count | — |
| Re-creation | New email/phone, same national ID | Identity must be re-approved, but no ID linkage | R (manual) |

---

## 7. P0 Gaps

These block protected Real Money, because each can produce an incorrect or duplicate money movement or defeat the two-person rule.

**P0-1 · Ledger-health gate fails open** — `FIXED_PENDING_FINAL_GATE` (B1)
- **Problem:** `assertLedgerHealthy` (`ledger-health.ts:51-55`) blocks only on a CRITICAL latest snapshot. If the snapshot is missing (fresh DB, job down) or stale (job is every 30 min), all money movements proceed.
- **Why P0:** directly violates "ledger mismatch blocks unsafe movement" and fail-closed.

**P0-2 · Malformed kill-switch value reads as unpaused** — `FIXED_PENDING_FINAL_GATE` (B1)
- **Problem:** `getSetting` falls back to the default (`false`) on a parse failure (`settings.ts:207-211`).
- **Why P0:** a corrupted or tampered switch silently re-enables money movement. UNKNOWN becomes SUCCESS.

**P0-3 · Refund FAILED can be re-paid; no UNCERTAIN refund state** — `FIXED_PENDING_FINAL_GATE` (B1)
- **Problem:** `recordRefundPayout` accepts `FAILED` (`refunds.ts:398`). A transfer marked "failed" that actually landed can be paid a second time. Withdrawals have `TRANSFER_UNCERTAIN`; refunds do not.
- **Why P0:** duplicate refund execution.

**P0-4 · Dispute PARTIAL_REFUND on a disputed return refunds the full return value** — `FIXED_PENDING_FINAL_GATE` (B1)
- **Problem:** `disputes.ts:246` drops `decisionAmount`, and `returns.ts:208-218` requests the full refund of the returned units.
- **Why P0:** an over-refund contrary to the recorded decision. The checker approves a request computed from the wrong basis.

**P0-5 · No freeze of released seller funds when a dispute or return opens after release**
- **Problem:**
  - Disputes and returns can open after `COMPLETED` (`disputes.ts:66`, `returns.ts:72`), but holds are refused after release (`fulfilment.ts:493`).
  - Withdrawal approve and pay don't check open disputes or returns (`withdrawals.ts`, `withdrawal-allocation.ts`).
- **Effect:** the seller can withdraw while the refund is pending, and the platform absorbs the loss (a negative balance appears only afterwards).
- **Why P0:** the dispute/release race is closed before release but reopened by the withdrawal path.

**P0-6 · SUPER_ADMIN can operate a second staff identity and satisfy the two-person rule alone**
- **Problem:** `createStaffUser` (`rbac/staff.ts:64-90`) mails the setup link to a creator-chosen address. One person can hold both the maker and checker accounts.
- **Why P0:** the DB two-person trigger (`0014:197-209`) assumes distinct humans. Required before Real Money: privileged and finance role creation needs a second approver and out-of-band identity binding.

---

## 8. P1 Gaps

These block the relevant public marketplace or Used Commerce launch.

| ID | Gap | Evidence | Why it blocks |
|---|---|---|---|
| P1-1 | Used commerce is not default-deny: uncovered categories accept USED listings and deals; deals ignore `isProhibited`/`isActive`; no listing-vs-protection eligibility flags | §5.1 | Core Used Commerce requirement; opens a generic used escape route |
| P1-2 | A LIVE used listing's condition report is editable, and checkout then freezes **nothing** | `reports.ts:52-64,95-117`; `snapshots.ts:268` | The buyer purchases without a frozen condition; "silent change of agreed terms" |
| P1-3 | No revalidation on category change; a report declared under one policy satisfies another | `products.ts:172,184,386-388` | Category-policy bypass |
| P1-4 | Used policy versioning overwrites in place; old versions are lost and live reports are re-interpreted (**CONFLICTING** with `policies.ts:50`) | `policies.ts:34-38,62-65` | Accepted policy versions are not retained |
| P1-5 | Product page promises a multi-day inspection window (`policy.inspection.defaultDays`), but marketplace orders apply a fixed 24h window | `product/[slug]/page.tsx:155`; `fulfilment.ts:275,298` | Misrepresentation of buyer protection |
| P1-6 | Overstated trust wording (list in §19) | §19 | Consumer-expectation and legal risk |
| P1-7 | Store `isVerified` is never reset on RESTRICT/SUSPEND, so a restricted seller keeps «بائع موثّق» | `sellers/service.ts:426-452`; `search.ts:68` | False trust signal |
| P1-8 | Return lifecycle has no identity, accessory or condition verification; returns are not linked to the frozen snapshot; the seller records no inspection evidence; shipment and inspection steps can be skipped | `returns.ts`; `machines.ts:216,218`; `schema/postpurchase.ts:13-53` | Return-swap fraud is uncontrolled (§14) |
| P1-9 | Dispute, return, deal evidence, shipment and tracking tables have no append-only DB protection | `0000:859,868,923`; no triggers | Evidence can be rewritten via the DB or a future code path |
| P1-10 | Dispute decision and refund approval can be the same SUPER_ADMIN; `approveRefund` does not exclude `dispute.decidedBy` | `refunds.ts:209-252` | Separation of decision and execution |
| P1-11 | No seller exposure limits (value, open deals, exposure, velocity); `riskLevel` unused; RESTRICTED sellers still withdraw | §5.6; `ops/pilot.ts` | New sellers get unlimited high-value exposure |
| P1-12 | No account-re-creation linkage: national ID not hashed/unique; payout destination not cross-account | `identity/service.ts:123`; `receiving.ts:74` | Suspended actors re-enter trivially |
| P1-13 | No anti-circumvention in messaging (phones, links, payment instructions) | `messaging/service.ts:205-211` | Platform used to acquire victims for off-platform fraud |
| P1-14 | Brand pages claim originality («منتجات … الأصلية») with no authenticity control | `brand/[slug]/page.tsx:17` | Authenticity claim without evidence |

---

## 9. P2 Hardening

1. Ledger-health and kill-switch gating for reversal and return paths (`withdrawals.ts:555,609,641`; `refunds.ts:529`).
2. DB UPDATE guard on `ledger_accounts.balance`, or a trigger-maintained projection.
3. Maker request fingerprint: record beneficiary, destination, allocation and economic version on `financial_movement_requests`, and compare at execution (`movements.ts:79-89`).
4. Withdrawal **reservation** is single-person (`approvals.ts:28-31`). Consider dual control above a threshold.
5. Payment confirmation stores `requestedBy = approver` (`approvals.ts:107`). Record the payer explicitly (payer ≠ confirmer is currently code-only).
6. Seller payout methods with a null `verifiedFingerprint` skip the fingerprint check (`sellers/service.ts:345-348`).
7. DB guard on `refunds.approved_destination`.
8. Trigger protecting the `external_deals` money columns after agreement.
9. Immutability triggers on `order_items` snapshots and `orders.economic_snapshot`.
10. `TRANSFER_UNCERTAIN → PAID` needs only a reference string. Require a reconciliation match or evidence.
11. `realMoneyEnabled()` should re-evaluate the full go-live gate at runtime.
12. Per-seller, per-category and "new protected transactions" kill switches (maintenance mode is all-or-nothing).
13. Condition amendment leaves `agreedTerms.condition` pointing to the superseded snapshot. Add an explicit current-snapshot pointer or a terms version.
14. Policy `disputeReasons` are not enforced (the global list is used, `_actions/used.ts:103`).
15. Inspection tied to the report by timestamp, not version (`used_inspections` → `passport_id`). Add a `report_version`.
16. Order coupling: buyer `confirmReceipt` from SHIPPED writes a synthetic `DELIVERED` tracking event (`fulfilment.ts:221-238`). Record it as buyer acceptance, not as carrier evidence.
17. Deal `REFUNDED` is set at refund approval (`deals/service.ts:1249`). Separate approved from paid.
18. Deal PARTIAL_REFUND is inserted APPROVED under `finance.release` (`deals/service.ts:1072-1092`), bypassing `refunds.approve`.
19. Disputes: structured reason codes, claimed amount ≤ order value, seller response deadline, officer SLA, appeal/second review.
20. Review moderation self-dealing check; dispute-open rate limit.
21. Deals: carrier, tracking and return-leg fields; per-leg custody records.
22. Separate DB role for the app, so it cannot drop integrity triggers.

## 10. P3 Future Enhancements

1. Central risk/decision engine (ALLOW / ALLOW_WITH_LIMIT / STEP_UP / MANUAL_REVIEW / HOLD / BLOCK + reason codes).
2. Buyer abuse scoring (dispute/return rates, non-receipt history).
3. Privacy-preserving device/session linkage signals.
4. Review-farming and related-account detection; ranking that uses dispute and return rates.
5. Video evidence and ownership/provenance evidence types in policies.
6. Bundle/kit model for partial returns.
7. Authenticity evidence types (where authenticity is claimed).
8. Image reuse/stolen-photo detection.
9. AI-assisted evidence organization and anomaly detection (advisory only).
10. Category policy lifecycle UI (draft → review → approve → publish → retire) with diff view.
11. Seller-side return-inspection evidence capture app flow.
12. Bank-statement auto-matching before payout recording.

---

## 11. Existing Controls That Must NOT Be Rebuilt

| System | Why preserve |
|---|---|
| Double-entry ledger + approval triggers (`0001`, `0008`) | DB-enforced immutability, balance and amount-exact approvals |
| Maker/Checker (`financial_movement_requests`, `0014:197-209`) | Two-person rule in the DB. Extend it with a payload fingerprint, don't replace it |
| Delivery OTP (`deals/delivery-otp.ts`, `0006`) | Correct handover-only semantics, tested |
| Protected deals flow + agreed-terms immutability (`0005`, `0010`) | Complete flow, DB-frozen terms |
| Condition snapshots / passport / inspections (`0019`) | Hash-chained, append-only. Extend toward return verification and other categories |
| Fee engine + pricing snapshots (`0010`) | Versioned and frozen |
| Messaging (append-only messages, `0007`) | Extend with circumvention detection only |
| Notifications / outbox | Stable |
| Reconciliation + invariant checks (`controls.ts:173+`) | Extend gating, not structure |
| Release blockers under row lock (`fulfilment.ts:185-204`, `deals/service.ts:1121-1131`) | The correct race design. Extend it to withdrawals |
| Withdrawal `TRANSFER_UNCERTAIN` model | The template for refunds |
| Self-dealing guard (`self-dealing.ts`) | Extend to reviews and dispute→refund |

---

## 12. Used Commerce / Category Governance Findings

- **Data-driven, phone-centric:** the policy engine is data-driven JSON but phone-centric in practice. One seeded policy exists (`policies.ts:82-86`), and some IMEI/battery assumptions are hardcoded outside the policy data.
- **What a policy can define:** fields, a single identifier, photo slots, a declaration, defect rules, inspection days, levels and verification rules.
- **What a policy cannot define:** video, ownership/provenance, shipping/handover constraints, return rules/evidence, value/seller limits, fee rules, protection eligibility.
- **Not default-deny:** uncovered categories bypass policy entirely (P1-1).
- **No lifecycle:** saves are live immediately, there is no maker/checker on policy publish, and versioning is CONFLICTING (P1-4).
- **Extend, don't rebuild:**
  - add a policy-versions table (immutable rows) and make reports reference `(policy_id, version)`;
  - add a category eligibility triple: listing-new, listing-used, protected-allowed;
  - require a published policy for any USED listing or deal (default-deny);
  - add revalidation on category change.

## 13. Product Passport Findings

- **Strong for deals:**
  - LOCKED reports and evidence are DB-frozen.
  - Snapshots are hash-chained and append-only.
  - Levels are computed server-side.
  - A stale inspection never counts (`reports.ts:283-288`).
- **Weak for marketplace:**
  - Reports never lock while LIVE.
  - Checkout silently skips non-declared reports.
  - Inspections are linked by timestamp, not version.
- **Gaps:** no return-side passport linkage; the identifier hash (`identifierHash`) is not used on return.

## 14. Return Passport / Return Fraud Findings

**Lifecycle mapping:**

| Step | Status |
|---|---|
| Request | EXISTS |
| Authorization | EXISTS (seller) |
| Shipment | PARTIAL (free-text carrier and tracking; skippable) |
| Received | EXISTS, seller-declared, no evidence |
| Identity verification | **MISSING** |
| Accessories verification | **MISSING** |
| Condition comparison | **MISSING** (free-text note; inspection optional) |
| Decision | PARTIAL |
| Refund decision | EXISTS |
| Execution | EXISTS (M/C) |
| Confirmation | PARTIAL (operator reference only) |

**Invariants:**
- RETURN_RECEIVED ≠ REFUND: held, except that a dispute decision forces DISPUTED→APPROVED→RECEIVED without physical receipt (`disputes.ts:241-246`).
- REFUND_APPROVED ≠ REFUND_RECEIVED: held for refund records (`refunds.ts:389-451`).

**Fraud scenarios:**

| # | Scenario | Prevention | Detection | Evidence available | Decision path | Gap | Severity |
|---|---|---|---|---|---|---|---|
| A | Returns a different product | none | manual | buyer photos; snapshot (used items) | seller escalates → dispute officer | no identity check | High |
| B | Same model, different serial | none | none | masked identifier + hash (used items) | dispute | no received-identifier capture or hash compare | High |
| C | Accessories removed | none | none | snapshot accessory photos (used items) | dispute | no checklist or deduction outcome | Med-High |
| D | Internal parts removed | none | none | none | dispute | no technical inspection record | High |
| E | Damage after receipt | time window | none | delivery evidence; snapshot | dispute | no condition comparison | Medium |
| F | Partial bundle | per-unit quantity caps | none | order items | per-unit refund | no bundle model | Medium |
| G | Claim contradicts outbound evidence | `snapshotIntact` hash check | admin page | frozen snapshot | officer, manual | used items only; manual | Medium |
| H | Seller false damage claim | buyer can escalate a rejection | none | seller free text only | dispute | no seller evidence requirement | Med-High |

## 15. Dispute Findings

- **Exists:**
  - opening window; one open dispute per order/deal (`0000:1487-1488`);
  - buyer evidence (≤8 files) and message attachments;
  - officer decision with amount, reason code, note ≥10 chars, decider and timestamp;
  - party and store exclusion; fresh 2FA.
- **Missing:**
  - structured reason codes (free text);
  - validation of the claimed amount;
  - response deadlines and SLA;
  - appeal or second review (RESOLVED→CLOSED only);
  - partial hold amounts.
- **Decision vs execution:** separated, except P1-10 (SUPER_ADMIN) and P2-18 (deal partial refund).
- **Race:** correct before release; P0-5 after release.

## 16. Financial / Ledger / Maker-Checker Findings

### 16.1 What holds

- Every money movement needs an ADMIN approval (`approvals.ts:73`) with fresh 2FA (`actor.ts:49-55`) and an exact DB amount match.
- **No automatic movement:**
  - Buyer timeout → `TIMEOUT_ENTITLEMENT` only (`fulfilment.ts:741-745`; `deals/service.ts:1280-1281`).
  - Scheduled settlement creates REQUESTED withdrawals only (`withdrawals.ts:714-751`; test `security-gate-final.test.ts`).
  - Payment webhooks are evidence only.
  - OTP consumers (`confirmDealReceipt :1109`, `flagDealsAwaitingConfirmation :1270`, `reportNotReceived :997`, wallet display, alerts) never release.
- **Maker/Checker:** maker ≠ checker is enforced in the DB. The checker can execute only the maker's amount and cannot edit the request (it is frozen, `0014:211-224`).
- **Withdrawal destination:** frozen once set (`0008:384-396`) and re-verified at payout (`withdrawals.ts:276-289`).

### 16.2 What doesn't hold

- **P0 items:** P0-1 to P0-5.
- **Hardening items:** P2-1 to P2-11.
- **Maker request lacks a full fingerprint:** "material change after approval invalidates approval" is only partly met. The amount is compared, but beneficiary, allocation and economic version are recomputed rather than pinned (P2-3). Mitigations: most approvals are created and consumed in the same transaction, and withdrawal destinations are DB-frozen.

## 17. Insider Threat Findings

| Role | Money authority | Notes |
|---|---|---|
| CUSTOMER_SUPPORT | None | Can moderate reviews (no self-dealing check) |
| DISPUTE_OFFICER | Decision only → requests | Excluded when a party or store member |
| FINANCE_OPERATOR | Maker / payer | Cannot approve own movement (DB) |
| FINANCE_CHECKER | Approver / executor | Cannot be maker (DB) |
| SUPER_ADMIN | All permissions | Still bound by the two-person DB rule, but P0-6 two-account gap; P1-10 decide+approve |

Further findings:
- **Audit trail:** `audit_logs` and `status_history` are append-only in the DB.
- **Evidence tables:** dispute/return/deal evidence is not (P1-9).
- **DB role separation:** no separate DB role exists, so the app user could drop triggers (P2-22).
- **Staff management:** privileged role changes require SUPER_ADMIN + confirmation + reason. Self-grant is blocked, and the last SUPER_ADMIN cannot be removed.

## 18. Risk / Fraud Architecture Findings

**Classification: SCATTERED.**
- `risk_flags` are written ad hoc at `deals/service.ts:973`, `fulfilment.ts:382,798`, `pricing/service.ts:99`, `reconciliation.ts:136`, `used/reports.ts:262` and `_actions/admin.ts:86`.
- They block only deal release (`dealReleaseBlockers`).
- `alerts/*` covers ops/SLA. `used/signals.ts` and the safety score are display-only.
- Gating elsewhere is distributed:
  - self-dealing (`self-dealing.ts`);
  - identity (`requireApprovedIdentity`);
  - pilot caps (`ops/pilot.ts`);
  - kill switches;
  - rate limits.
- No component consumes signals to produce an outcome.
- **AI:** none present. Approvals require a named ADMIN at the DB level (`0008:299`), so no automated component can authorize money.

**Recommended direction (not now):** a `risk` module that reads existing signals and returns `{outcome, reasons[]}` at defined decision points (listing submit, deal offer, checkout, release, withdrawal). It should start as advisory (logging only) before it enforces.

## 19. Trust Badge / Customer Language Findings

| Wording | Location | Trigger | Assessment |
|---|---|---|---|
| «بائع موثّق» pill | `product/[slug]/page.tsx:127-129` | `stores.isVerified` (set on seller APPROVE after identity, `sellers/service.ts:451`) | Ambiguous next to the product; never reset on RESTRICT (P1-7) |
| «بائع موثّق — هويته ومستنداته اتراجعت» | `product/[slug]/page.tsx:214-215` | same | Accurate |
| «محمي من اضمن» | `domain/used.ts:72-80` | default level | Accurate (money, not product) |
| «موثّق من اضمن» | same | staff document review | **Overstates** (implies certification). The explainer says "not a technical inspection" |
| «مفحوص من اضمن» | same | real PASS inspection newer than the declaration | Supported; confirm who inspects |
| «حالة المنتج الموثّقة» | `product/[slug]/page.tsx:245` | any passport level | **Overstates** at PROTECTED (seller-declared) |
| «منتجات مستعملة بحالة موثّقة» | `search/page.tsx:18` | condition=USED | **Overstates** |
| «حالة موثّقة» | `_home/used.tsx:9`; `used/page.tsx:10` | unconditional | Ambiguous |
| «سوق المستعمل المضمون» | `used/page.tsx:9,40`; footer, menu, nav, passport | unconditional | Name implies guaranteed goods |
| «ضمان كامل للصفقات» | `_home/hero.tsx:69` | unconditional | **Overstates** |
| «سوق آمن لكل صفقاتك» | `site-header.tsx:39` | unconditional | Absolute claim |
| «سوق موثوق…» | `layout.tsx:20`; `hero.tsx:26` | unconditional | Generic trust claim |
| «تسوّق منتجات X الأصلية» | `brand/[slug]/page.tsx:17` | brand fallback text | **Authenticity claim without control** (P1-14) |
| «فلوسك محمية في كل الحالات» | `domain/used.ts:501` | safety-score disclaimer | Absolute |
| «فترة الفحص … أيام» | `product/[slug]/page.tsx:155` | policy days | **Mismatch** with the 24h order window (P1-5) |
| «… من حقك تفتح نزاع خلال فترة الفحص» | `_components/used.tsx:158`; passport page | — | May imply rights end with the window; statutory notice exists elsewhere (`return-policy.ts:42`, `legal-texts.ts:55,212`) |
| «شراء مؤكد» | product reviews | delivered purchase | Supported |
| Seller-fulfilled shipping copy | cart, product, seller center | — | Correct; EDMN is not presented as a carrier |

Demo-seed text such as «مستعملة مفحوصة» (`seed/demo.ts:300`) conflicts with INSPECTED semantics. That is seed data, not code.

No «100%», no-fraud claims or COD wording were found.

## 20. Database / Migration Impact of Future Fixes

All changes are additive: no destructive migration and no change to A-100016.

| Fix | Migration impact |
|---|---|
| P0-3 | Add `TRANSFER_UNCERTAIN` (or similar) to the refund status CHECK; adjust the payable status list |
| P0-5 | No schema change needed; gate withdrawals by open disputes/returns. Optionally add a seller-level dispute exposure view |
| P0-6 | Optional `staff_invitations` table with a second approver |
| P1-1/P1-4 | New `used_category_policy_versions` (append-only); category eligibility columns (default false); report `policy_version` FK |
| P1-2 | Lock or require re-moderation of the report for LIVE products (status machine change; possibly a trigger) |
| P1-8 | New `return_inspections` (identifier hash compare, accessory checklist, condition evidence, append-only) linked to `condition_snapshots` |
| P1-9 | Append-only triggers on `dispute_evidence`, `dispute_messages`, `return_evidence`, `deal_evidence`, `tracking_events`, `shipments` (status columns via controlled transitions) |
| P1-11 | `seller_limits` (or settings + per-seller override); start writing `riskLevel` |
| P1-12 | `national_id_hash` (keyed HMAC, unique or flagged); destination fingerprint index |
| P2-3/8/9 | Request fingerprint columns; triggers on deal money columns and order snapshots |

## 21. UI Impact of Future Fixes

- Seller used-listing form: category eligibility messaging and the "category closed" state.
- Admin: policy versions, publish workflow, category eligibility toggles.
- Return inspection screens for seller and Ops: identifier capture, accessory checklist, photo comparison against the snapshot.
- Copy changes for §19 items (wording only).
- Admin risk panel: seller limits, risk level, linkage flags (no exposure to users).
- Messaging: soft warning when contact or payment details are detected.

## 22. Admin / Operations Impact

- New review queues: policy publish approvals, return inspections, linkage flags, circumvention flags.
- Staff onboarding needs second-approver binding (P0-6).
- Finance: the refund UNCERTAIN queue mirrors withdrawals; withdrawals blocked by post-release disputes need a clear "blocked by dispute" view.
- Ledger health: an operational requirement for a recent snapshot (P0-1). The worker must run before money moves.

## 23. Security Impact

| Control | Status | Evidence |
|---|---|---|
| RBAC | EXISTS | `core/actor.ts:33-47` |
| Admin 2FA | EXISTS | `session.ts:121-126`, TOTP replay protection |
| Fresh 2FA | EXISTS | `actor.ts:49-55` |
| Session rotation | EXISTS | `auth/service.ts:82`; `session.ts:45` |
| CSRF | EXISTS | SameSite=Lax; `sameOrigin` on JSON routes; server-action origin check |
| CORS | EXISTS (same-origin default) | no `Access-Control-Allow-*` headers |
| CSP | EXISTS | nonce + `strict-dynamic` (`proxy.ts:80-96`). Styles allow `unsafe-inline` |
| Private media | EXISTS | `storage/access.ts:23-131` |
| Malware scanning | EXISTS (fail-closed in production) | `storage/scanning.ts`. Requires `MALWARE_SCANNER_URL` |
| Rate limits | EXISTS | `auth/rate-limit.ts`. Dispute opening is not limited (P2-20) |
| IDOR/BOLA | EXISTS | per-service ownership checks |
| Secrets | EXISTS | `core/env.ts:27-71`; field encryption |
| Audit logs | EXISTS | append-only (`0001:10,23`). DB-role caveat (P2-22) |

None of the proposed fixes weakens these controls. P1-9 and P2-22 strengthen them.

---

## 24. Fraud Red-Team Test Matrix

These are future tests. None was run in this audit. Mode: **A** = automated (integration/E2E), **M** = manual.

| # | Precondition | Attack / failure | Expected safe result | Control tested | Mode | Sev |
|---|---|---|---|---|---|---|
| 1 | Buyer has a delivered deal (OTP verified) | Claims non-receipt | `DELIVERY_CONFLICT` flag + dispute; release blocked | OTP evidence, release blockers | A | High |
| 2 | Buyer has repeated disputes | Opens the Nth dispute rapidly | Rate limit / review flag | Buyer abuse limits | A | Med |
| 3 | Seller has a LIVE used listing | Edits the condition report, buyer checks out | Checkout refused or frozen snapshot of the agreed version | P1-2 | A | High |
| 4 | Category without a policy | Seller lists USED / buyer creates used deal | Refused (default-deny) | P1-1 | A | High |
| 5 | Report declared under policy X | Product moved to category Y | Revalidation required; cannot submit | P1-3 | A | High |
| 6 | Active order under policy v1 | Admin edits policy to v2 | Order and report keep v1 semantics | P1-4 | A | High |
| 7 | Seller with a prohibited category | Creates an external deal in it | Refused | P1-1 | A | High |
| 8 | Return received | Different product returned | Identity mismatch → hold + review; no refund | P1-8 | A+M | High |
| 9 | Used phone with identifier hash | Same model, different serial returned | Hash mismatch blocks the refund decision | P1-8 | A | High |
| 10 | Snapshot lists accessories | Return missing accessories | Checklist fails → partial/review | P1-8 | A | Med |
| 11 | — | Internal component removed | Inspection record required before decision | P1-8 | M | High |
| 12 | Delivered item | Post-receipt damage claim contradicting the snapshot | Snapshot shown; officer decision; no auto refund | Snapshot, dispute | A+M | Med |
| 13 | Return arrives fine | Seller claims damage without evidence | Seller evidence required; buyer can escalate | P1-8 | A | Med |
| 14 | Dispute with fabricated photos | Evidence later edited or deleted via DB | Trigger refuses | P1-9 | A | High |
| 15 | Two accounts by one person | Wash trade + review | Linkage flag; review not counted in ranking | P1-12, P3 | A+M | Med |
| 16 | Suspended seller | Registers new email/phone with the same national ID | ID-hash linkage → review/block | P1-12 | A | High |
| 17 | Buyer–seller chat | Phone, link or payment instructions sent | Warning + flag; delivery messages unaffected | P1-13 | A | Med |
| 18 | Sub-order awaiting release | Dispute opened concurrently with release | Exactly one wins; release sees the dispute or the dispute post-dates | Existing (test #36) | A | High |
| 19 | Sub-order released | Dispute opens, seller withdraws | Withdrawal blocked while the dispute is open | P0-5 | A | High |
| 20 | Release approved | Duplicate release request (retry) | Idempotent; one journal | Idempotency keys | A | High |
| 21 | Withdrawal paid | Duplicate payout | Refused (state + keys) | Withdrawal machine | A | High |
| 22 | Refund marked FAILED (actually landed) | Re-pay | Refused; requires an uncertainty resolution + M/C | P0-3 | A | High |
| 23 | Maker request for X | Checker executes with a different amount | Refused | `movements.ts:87` | A | High |
| 24 | Withdrawal approved | Beneficiary/destination changed | Payout refused | `0008:384-396`, `withdrawals.ts:276-289` | A | High |
| 25 | Refund approved | Amount changed | Refused (approval amount DB-enforced) | `0008:316-329` | A | High |
| 26 | Disputed return | PARTIAL_REFUND decision with amount Y | Refund request = Y | P0-4 | A | High |
| 27 | Worker job | Retried after a crash mid-run | No money movement; idempotent | Job leases | A | Med |
| 28 | DB connection drop mid-release | Transaction aborts | No partial journal (deferred triggers) | Txn atomicity | A | High |
| 29 | No ledger-health row / stale row | Money movement attempted | Refused | P0-1 | A | High |
| 30 | Kill-switch row malformed | Money movement attempted | Treated as paused | P0-2 | A | High |
| 31 | Payment provider timeout (future provider) | Ambiguous result | Payment stays UNKNOWN/review; never confirmed | Fail-closed | A | High |
| 32 | Ambiguous withdrawal transfer | Marked TRANSFER_UNCERTAIN | Funds stay reserved; PAID needs evidence | P2-10 | A | High |
| 33 | CUSTOMER_SUPPORT account | Calls refund/release/withdrawal actions | 403 | RBAC | A | High |
| 34 | DISPUTE_OFFICER | Decides then tries to approve the refund | Refused | RBAC, P1-10 | A | High |
| 35 | FINANCE_OPERATOR (maker) | Approves own request | Refused (DB) | `0014:197-209` | A | High |
| 36 | FINANCE_CHECKER | Approves a request for a store they belong to | Refused | `self-dealing.ts` | A | High |
| 37 | SUPER_ADMIN | Creates a staff account with own email, uses it as checker | Second approver required for privileged creation | P0-6 | A+M | High |
| 38 | Compromised SUPER_ADMIN session | Releases the global kill switch | Two-person release required | `controls.ts:108-131` | A | High |
| 39 | Any admin | Attempts to edit journal/audit rows via SQL | Trigger refuses | `0001` | A | High |
| 40 | Restricted seller | Requests withdrawal / keeps badge | Policy-defined limit; badge removed | P1-7, P1-11 | A | Med |
| 41 | New seller | Lists high-value item / many deals | Exposure limit enforced | P1-11 | A | Med |
| 42 | A-100016 | Every suite run | Row unchanged (hash compare before/after) | Baseline guard | A | High |

---

## 25. Proposed Implementation Batches

Each batch is small, additive, independently testable and reversible. They extend existing modules and never rewrite the ledger, Maker/Checker, OTP or deals.

| Batch | Scope | Depends on | Migration |
|---|---|---|---|
| **B1 — Financial fail-closed** | P0-1 (missing/stale health snapshot → block); P0-2 (unparseable kill switch → paused); P0-3 (refund UNCERTAIN state, FAILED not re-payable without evidence + M/C); P0-4 (pass decided amount); regression tests 22, 26, 29, 30 | — | Small (refund status CHECK) |
| **B2 — Post-release exposure** | P0-5: withdrawals blocked or reduced by open disputes/returns/pending refunds on released funds; tests 19, 18 | B1 | None |
| **B3 — Staff identity binding** | P0-6: second approver for privileged/finance role creation and grants; P1-10 (decider ≠ refund approver) | — | Optional table |
| **B4 — Evidence immutability** | P1-9 triggers; P2-8/P2-9 money/snapshot guards; test 14 | — | Triggers only |
| **B5 — Used default-deny + policy versions** | P1-1, P1-2, P1-3, P1-4; eligibility triple; deals honour `isProhibited`/`isActive`; tests 3–7 | B4 (optional) | Additive tables/columns |
| **B6 — Trust wording + badge truth** | P1-5, P1-6, P1-7, P1-14 (copy + `isVerified` reset/derivation) | — | None (copy) |
| **B7 — Return Passport** | P1-8: `return_inspections` linked to snapshots; identifier/accessory/condition checks; seller evidence; no skip of shipment/inspection; tests 8–13 | B4, B5 | Additive |
| **B8 — Seller risk & exposure** | P1-11, P1-12: limits, `riskLevel` usage, RESTRICTED withdrawal policy, national-ID hash linkage, destination reuse flag; tests 16, 40, 41 | B2 | Additive |
| **B9 — Anti-circumvention** | P1-13 messaging detection (warn + flag, not block); test 17 | — | Minor |
| **B10 — Hardening sweep** | P2 items | B1–B9 | Small |
| **B11 — Risk engine (advisory)** | P3-1 reading existing signals, log-only first | B8, B9 | Additive |

After any batch, `48ae40c` is superseded as a candidate. The new SHA must re-pass the full gate (lint/types, unit/integration, full local E2E, targeted staging, migration forward test, audit, secret scan, ledger balance, Real Money OFF).

---

## 26. Final Launch Assessment

**CURRENT 48ae40c SAFE TO DEPLOY AS INFRASTRUCTURE / PRE-DNS VALIDATION CANDIDATE?**
**YES.**
- Real Money is OFF.
- No public exposure before DNS.
- Money movement still requires named human approval with the DB-enforced two-person rule.
- The gaps are application-level and are not exploitable without public traffic and real funds.
- Not the final public candidate.

**CURRENT 48ae40c SAFE FOR PUBLIC MARKETPLACE LAUNCH?**
**NO.**
- Used commerce is not default-deny and live reports are editable (P1-1 to P1-4).
- Trust-wording overstatements and the inspection-window mismatch (P1-5 to P1-7, P1-14).
- Return-swap fraud is uncontrolled (P1-8).
- Evidence tables are mutable (P1-9).
- No exposure limits or re-creation linkage (P1-11, P1-12).
- No anti-circumvention (P1-13).

**CURRENT 48ae40c SAFE FOR PROTECTED REAL MONEY?**
**NO.**
- P0-1 to P0-6.
- All P1 items above.
- The external prerequisites remain: legal/regulatory review, an approved collection/provider arrangement, operational readiness and final security approval.

**USED COMMERCE SAFE FOR PUBLIC LAUNCH?**
**NO.** P1-1, P1-2, P1-3, P1-4, P1-8, plus the used-specific wording in P1-6.

**ANY P0 FINANCIAL-INTEGRITY GAP?**
**YES:**
- P0-1: ledger-health gate fails open.
- P0-2: malformed kill switch reads as unpaused.
- P0-3: a FAILED refund can be re-paid.
- P0-4: PARTIAL_REFUND amount is ignored on disputed returns.
- P0-5: no freeze of released funds when a dispute or return opens after release.
- P0-6: a SUPER_ADMIN's second identity defeats the two-person rule.

**ANY P1 MARKETPLACE-FRAUD GAP?**
**YES:** P1-1 to P1-14 (§8).

**RECOMMENDED FIRST IMPLEMENTATION BATCH:**
**B1 — Financial fail-closed:**
1. Block money movement when the latest ledger-health snapshot is missing, stale beyond a configured age, or CRITICAL.
2. Treat any unparseable kill-switch value as paused.
3. Add an uncertain refund-transfer state, and forbid re-paying `FAILED` without a recorded failed-before-transfer resolution under maker/checker.
4. Pass the dispute's decided amount through to the return refund request.

It ships with regression tests 22, 26, 29 and 30. It is additive (one refund status CHECK change), touches only `finance/ledger-health.ts`, `settings.ts`, `finance/refunds.ts` and `postpurchase/disputes.ts`/`returns.ts`, and leaves the ledger, Maker/Checker, OTP and deals untouched.
