# Final Pre-Production Security Gate

**Baseline:** `bddd529`. The product code is feature-frozen; only proven-necessary security fixes were made, each with a regression test.

## Reported items

### 1. Malware scanning (`MALWARE_SCAN_REQUIRED`) — APPLICATION DEFECT, FIXED

* **Private files were already fail-closed.**
  - In PRODUCTION `scanRequired()` is always true.
  - New private uploads start as QUARANTINED and are served only when CLEAN.
  - Without a scanner they stay unavailable, and the go-live gate blocks real money while `MALWARE_SCANNER_URL` is absent.
* **The defect:** public uploads in PRODUCTION without a scanner got `UNSCANNED`, and `servable()` served any PUBLIC UNSCANNED file. That fails open (mitigated, not justified, by the sharp re-encode).
* **Fix** (`src/server/storage/scanning.ts`, `publicScanRequired()`):
  - In PRODUCTION, new public uploads start QUARANTINED.
  - A public file is served only when CLEAN, through `servable()`, which `/media` uses.
  - Outside production nothing changes: staging and dev public images still show unscanned.
* **Staging:** `MALWARE_SCAN_REQUIRED` only gates private files outside production. Its value on staging is environment configuration, not a defect. Production behaviour no longer depends on it.
* **Regression test:** `used-commerce.test.ts` › "production fails closed for PUBLIC uploads too".

### 2. Session rotation on re-login — HARDENED

* **Fixation is not possible.** Every successful login issues a new random 256-bit token (`createSession`). A session is resolved only through `sha256(token)` stored server-side, so a client-chosen id can never become authenticated. There is no pre-login server session.
* **The weakness:** when a user signed in again on a browser that still held a valid session (for example the sign-in form open in two tabs), the replaced token stayed valid server-side until it expired.
* **Fix:** `revokePresentedSession()` revokes the presented WEB or ADMIN session after a successful login and before the new cookie is set. It covers buyer and seller login, registration, and admin login.
* **Regression test:** E2E `security.spec.ts` › "re-login revokes the previously presented session token". It fails without the fix and passes with it.

### 3. Automatic withdrawal requests — COMPLIANT, NO CODE CHANGE

* The hourly `settlement.scheduled` job (`runScheduledSettlement`) runs in HYBRID/SCHEDULED mode on the configured Cairo days. For `autoSettlement` sellers it calls `requestWithdrawal` as SYSTEM.
* That creates a `REQUESTED` withdrawal with `source = SCHEDULED`. It posts **no journal entry**, reserves nothing and pays nothing, and it is idempotent per day.
* Reservation (AVAILABLE → WITHDRAWAL_RESERVED) happens only in `approveWithdrawal`. That is invoked only from an authenticated admin action that requires `withdrawals.approve` and a fresh 2FA.
* Payment requires a payer different from the approver (maker/checker).
* **Regression test:** `security-gate-final.test.ts`. It checks that the request is REQUESTED with `reservedAt` null, no journal entry is posted, the available balance is unchanged, a re-run is idempotent, and an unauthorized approval is refused.

### 4. Migration 0019 — PASS

* **Additive only.** The preflight destructive scan returns `[]`. The only DROP is the `files_purpose_chk` CHECK constraint, which is immediately re-added with a wider list.
* **Forward migration was exercised** on a populated pre-0004 database: 16 migrations including 0019 applied in about 1 s, with existing users, files and deals intact.
* **Rollback:** code can roll back to `4fbb34b` against the 0019 schema. The new tables are unused by the old code, and `external_deals.category_id` is nullable. The schema is forward-only (Drizzle has no down migrations).
* **Triggers**, all tested:
  - `condition_snapshots`: content is immutable, there is no delete, and only forward status moves are allowed.
  - `product_passport_events` and `used_inspections`: append-only.
  - `used_condition_reports`: LOCKED is final.
  - `used_condition_evidence`: frozen while the report is LOCKED.
  - A LOCKED report cannot be deleted because foreign keys from snapshots and passports reference it.
* **Concurrency:**
  - Offer, accept and amendment run under the deal row lock.
  - Declaration and evidence run under the report row lock.
  - Unique indexes cover passport per report, snapshot per (deal, version) and snapshot per (order, report, version).
  - A double accept produces exactly one ACCEPTED snapshot (tested).

### 5. Used Commerce attack surface

| Area | Result |
|---|---|
| Encrypted IMEI | PASS: AES-GCM, never in answers, snapshots, analytics, audit or HTML (tested). |
| Masking | PASS: masked everywhere. The fingerprint is a keyed HMAC, so there is no dictionary attack. |
| Product Passport | PASS: public only for a LIVE listing with a declared report. Deal passports are visible to parties and staff only (tested). |
| Condition evidence | PASS: deal and identifier photos are private CONDITION_EVIDENCE. Access goes to the seller side, the buyer and review staff (tested). |
| Evidence replacement or deletion | **FIXED**: a seller could unlink and soft-delete a photo already frozen in a buyer's purchase snapshot (marketplace path). Frozen evidence is now only unlinked, never deleted, and the parties of the agreement keep access. Test: "a seller cannot destroy evidence frozen in a buyer's purchase". |
| Snapshot hash chain and tampering | PASS: DB-immutable, `snapshotIntact` recomputes the hash, terms reference the hash, and agreement refuses a mismatch. |
| Safety Score manipulation | PASS: computed server-side. Weights need `settings.manage` plus a fresh 2FA. The score is information only. Its "inspected" factor now follows the server-computed level. |
| Protection-level escalation and fake inspection | **FIXED**: an old inspection kept «مفحوص» after the seller changed and re-declared the condition. An inspection now counts only if it was recorded after the latest declaration. Test: "«مفحوص» never survives a later change". Inspections themselves require staff, a fresh 2FA, a report file, and a non-party non-author reviewer. |
| Admin verification | PASS: RBAC per path, fresh 2FA, never by the author or a party, no self-dealing. Any later edit voids the verification. |
| Duplicate IMEI | PASS: HIGH risk flag across different sellers, no PII in the flag. |
| External-deal source URL | PASS: rendered as text only, never as a link. |
| Invitation flow | PASS: unchanged, existing replay and binding tests pass. |
| Inspection period | PASS: within the policy range. OTP proves receipt only. Acceptance creates entitlement only. Release requires maker and checker (tested). |
| Used disputes | PASS: party-only, structured reasons, existing hold, comparison against the frozen snapshot. |

## Other gate checks

* **Dependencies:**
  - Production dependencies: `npm audit --omit=dev` reports **0** vulnerabilities.
  - Dev-only tooling (drizzle-kit, eslint-config-next, esbuild/braces) reports 9; none of it ships.
* **Secrets:**
  - The working tree has 0 findings.
  - The 3 findings in git history are synthetic test fixtures (generated `rnd()` values and a log-redaction test string), not real credentials.
* **Staging headers:**
  - Nonce CSP with `'strict-dynamic'` and no unsafe-inline scripts.
  - HSTS with preload, `X-Frame-Options: DENY`, `nosniff`, COOP, Permissions-Policy and Referrer-Policy.
* Isolation, admin RBAC, cookies/CSRF, uploads, rate limits and fund invariants were re-verified by the existing suites, which all pass.
