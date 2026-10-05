# Security Findings Register

**Scope.** The EDMN repository and the EDMN staging deployment only. No legacy EDMN system, no `api.edmneg.com` and no production domain was tested.

**Method.** Code tracing of every route handler, server action and service. Adversarial integration tests run against a real PostgreSQL database. E2E runs against a production build. Non-destructive HTTP probes were made against staging.

**Severity scale:**
- **P0:** exploitable loss of money or a mass data breach.
- **P1:** a realistic financial or authorization abuse.
- **P2:** defence-in-depth or narrow abuse.
- **P3:** hardening or hygiene.

**Status values:**
- **FIXED:** code changed, with a regression test.
- **MITIGATED:** risk reduced; the residual risk is accepted and documented.
- **OPEN:** not fixed; tracked.

## Summary

| Severity | Found | Fixed | Mitigated | Open |
|---|---|---|---|---|
| P0 | 1 | 1 | 0 | **0** |
| P1 | 6 | 5 | 1 | **0** |
| P2 | 13 | 10 | 1 | **2** |
| P3 | 18 | 14 | 0 | **4** |

## P0

| ID | Finding | Status | Fix / evidence |
|---|---|---|---|
| FIN-P0-1 | **Test-money cut-over.** `payments.realMoneyEnabled` could be switched on while TEST payments, withdrawals, refunds, deal payouts or test-derived seller / held balances were still open. Fake "test" money would then become withdrawable real money, and TEST payment destinations would keep being offered. | FIXED | `settings.ts` refuses the switch while anything test-derived is open or any seller / `DEAL_FUNDS_HELD` balance ≠ 0. Staging can never enable it. Only destinations whose `isTest` matches the mode are offered. TEST withdrawals / refunds / payouts cannot be paid in real-money mode. Tests: pilot-safety ("go-live refused…", "test mode offers only TEST destinations"). |

## P1

| ID | Finding | Status | Fix / evidence |
|---|---|---|---|
| FIN-P1-1 | Refund after release could leave a seller with a negative available balance that was still paid out (seller debt). | FIXED + MITIGATED | Payout is refused while `SELLER_AVAILABLE < 0`, the seller is suspended, or a payout hold is active. The dispute window is enforced. Residual: funds release before the voluntary return window ends is a **business decision** (documented). Test: SEC-WD-3, SEC-WD-5. |
| FIN-P1-2 | Payment confirmation accepted any proof amount and did not require a fresh 2FA. | FIXED | Claimed amount must equal the amount due; step-up required. Tests: SEC-PAY-1, SEC-PAY-4. |
| FIN-P1-3 | Separation of duties: staff who own or are members of a store could confirm payments to it, approve or pay its withdrawals, moderate its products, decide their own seller application, or verify their own payout method. | FIXED | `finance/self-dealing.ts` is applied to all of these. Tests: SEC-PAY-3, SEC-WD-6, SEC-WD-7. |
| FIN-P1-4 | Dual control above the threshold could be bypassed by splitting withdrawals. | FIXED | Rolling 24h total per seller. Test: SEC-WD-2. |
| AUTH-01 | Login lockout counter was not atomic, so parallel wrong passwords evaded the lock. Lock state was distinguishable from a wrong password. | FIXED | Atomic `failed_login_count + 1` with lock at the limit; generic error. Test: SEC-AU-2. |
| AUTH-02 | Rate-limit / audit IP came from the left-most `X-Forwarded-For` (spoofable). | FIXED | `client-ip.ts` uses only the trusted proxy header. Test: SEC-AU-1. |

## P2

| ID | Finding | Status | Fix / evidence |
|---|---|---|---|
| FIN-P2-1 | A withdrawal in PROCESSING could be rejected (funds returned) by the same person who started the transfer, without re-authentication. | FIXED | Step-up plus a different person. SEC-WD-4. |
| FIN-P2-2 | Suspended sellers could still be paid an approved withdrawal. | FIXED | SEC-WD-5. |
| FIN-P2-3 | Refund "mark paid" had no maker/checker and could be done by the beneficiary. | FIXED | Threshold maker/checker; payee ≠ actor. |
| FIN-P2-4 | Deal payout could be marked paid from a non-PENDING state, or by the payee. | FIXED | Status guard; payee ≠ actor. |
| FIN-P2-5 | Ledger adjustments can be self-approved when the threshold is configured above 0. | MITIGATED | The default threshold (0) forces a second person. Documented as a configuration risk. |
| AUTH-03 | First TOTP enrollment is trust-on-first-use: whoever first holds the admin password can enroll. | **OPEN** | Admin accounts are created by an existing admin; production onboarding must enrol in person. Fix planned: enrollment link bound to the inviting admin. |
| AUTH-04 | Password-reset / OTP codes were plain `sha256` (offline-guessable 6 digits). Older codes were not retired. | FIXED | Keyed HMAC; previous codes retired. SEC-AU-4. |
| AUTH-05 | One-time codes stayed readable in `outbound_messages`. | FIXED | Redacted after a real send and when expired (> 1h). SEC-AU-6. |
| AUTH-06 | Open redirect through `next` / `back` parameters. | FIXED | `safe-next.ts`. SEC-AU-3. |
| AZ-F1 | A seller could re-activate an admin-suspended listing. | FIXED | SEC-AZ-1. |
| AZ-F2 | A buyer could purchase from their own store (self-dealing / fake sales), including via a merged guest cart. | FIXED | SEC-AZ-2. |
| DEAL-01 | The deal invitation was a bearer link that sent the buyer-typed seller phone an SMS with buyer-controlled text (an abuse / phishing relay), and acceptance was immediate. | FIXED | Invitation-first flow: EDMN sends nothing to buyer-typed contacts. The link is CSPRNG, hashed and expiring. It binds to ONE account; opening is read-only; terms must be explicitly agreed per version. `deal-invitation-returns.test.ts`. |
| FP-F5 | Encrypted payloads carry no AAD / key id, which complicates key rotation. | **OPEN** | Rotation procedure documented in `SECRET_EXPOSURE_REGISTER.md`. Fix planned: versioned envelope. |

## P3

| ID | Finding | Status |
|---|---|---|
| AUTH-07 | Password length unbounded (hashing DoS) | FIXED (≤ 256) |
| AUTH-08 | Password-reset per-identifier limit | FIXED (3/h) |
| AUTH-09 | Change-password not rate-limited | FIXED |
| AUTH-10 | Admin session accepted on a non-admin host | FIXED (`ENFORCE_HOSTS`) |
| AUTH-11 | `x-request-id` reflected unvalidated into logs | FIXED |
| AZ-F4 | `customerStatusAction` could target staff accounts | FIXED |
| AZ-F5 | Seller staff added without the invitee's consent | **OPEN** |
| AZ-F6 | Admin `dealGraph` without a permission check | FIXED (`deals.view`) |
| AZ-F7 | Seller finance pages visible to members without `finance.view` | FIXED |
| AZ-F8 | Commission rules editable without step-up | FIXED |
| AZ-F9 | Review photos public; admin CSV export without step-up | **OPEN** (by design / low) |
| FP-F2 | KYC document reads by staff without recent 2FA | FIXED (60 min step-up, audited) |
| FP-F6 | Logger PII redaction list incomplete | FIXED |
| FP-F7 | Image decompression bomb | FIXED (`limitInputPixels` 25M) |
| FP-F11 | Orphan uploaded files not garbage-collected | **OPEN** |
| FP-F12 | CSP allows `'unsafe-inline'` scripts (Next.js inline runtime) | **OPEN** (nonce-based CSP planned) |
| FP-F13 | CSV injection / `\r` in exports | FIXED |
| IN-1 | CMS links accepted `javascript:` / `data:` | FIXED (SEC-IN-1) |

## New feature review: invitation-first deals, locations, return policy

| ID | Check | Result |
|---|---|---|
| DEAL-02 | Token entropy / storage | 32 random bytes (base64url); only sha256 stored; format-validated before any DB access |
| DEAL-03 | Enumeration | Unknown / malformed tokens give an identical "invalid link" page; claim on an unknown token fails |
| DEAL-04 | Replay / multi-binding | Bound once (`bound_user_id`); same account is idempotent; any other account is refused; refreshed/revoked/expired tokens are dead |
| DEAL-05 | Token leakage | Never in the buyer's URL (15-min httpOnly, path-scoped cookie), `Referrer-Policy: no-referrer` on invite/deal pages, `robots` disallow |
| DEAL-06 | Opening is non-financial | Only `opened_at` + audit; no status change |
| DEAL-07 | Location privacy | Encrypted at rest; rounded to 5 dp; never in URLs or logs; counterparty only from ACTIVE; `Permissions-Policy: geolocation=(self)`; one-shot, user-initiated |
| DEAL-08 | Terms integrity | Each offer/change is a new version; DB triggers make versions append-only and agreed terms immutable; ACCEPT must name the exact PROPOSED version (stale version refused) |
| RP-01 | Return policy cannot remove protections | "No voluntary returns" only limits change-of-mind returns; protected reasons use the dispute window; disputes unaffected (tests) |
