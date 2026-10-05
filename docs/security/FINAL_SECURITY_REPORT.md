# EDMN Marketplace — Final Security Report

- **Date:** 2026-10-05
- **Commit:** see the latest commit on branch `claude/great-tesla-nor0wt` (Delivery OTP added after `f0a2936`)
- **Staging:** https://edmn-staging.vercel.app (Vercel + Neon, `EDMN_ENVIRONMENT=staging`)

## 1. Executive Summary

The marketplace, Seller Center, Admin console and the external protected-deal flow were audited by tracing the code, by adversarial integration tests and E2E tests, and by non-destructive probes against staging.

**Open findings:** P0 0 · P1 0 · P2 2 · P3 4. None of the open items allows loss of money or a cross-account data breach.

| Gate | Result | Reason |
|---|---|---|
| Security gate | **PASS** | |
| Real-seller pilot | **SAFE** | Test money only, with the conditions in §29 |
| Real-money production | **NOT SAFE yet** | Operational and credential blockers listed in §28, not code defects |

## 2. Scope

**In scope:**
- the EDMN repository;
- the EDMN staging deployment;
- the Neon staging database (read-only checks plus isolated E2E fixtures).

**Not touched:**
- the legacy EDMN system;
- `api.edmneg.com`;
- the official production domain or DNS.

Real money was not enabled. No denial-of-service tests were run, no real customer credentials were used, and no financial records were deleted.

## 3. Threat Model Summary

See `THREAT_MODEL.md`. It covers 12 threats (T1–T12): spoofing, brute force, privilege escalation, IDOR, tampering, double-spend, repudiation, PII disclosure, ledger corruption, destination swap, XSS/injection and secret exposure. Each threat maps to a control and a test.

## 4. Attack Surface

See `ATTACK_SURFACE.md`:
- 7 route handlers;
- 109 server actions grouped by surface (public auth, customer, seller, admin);
- id-addressed pages;
- the upload pipeline;
- background jobs.

New in this round: the invitation-first deal actions, `/deal/invite/[token]`, and the invitation expiry job.

## 5. Authentication

| Control | Detail |
|---|---|
| Password hashing | scrypt (≤ 256 chars) |
| Lockout | Atomic failed-login counter with lockout; a generic error that does not reveal the lock state (AUTH-01) |
| Rate limits | DB-backed, per IP and per identifier: login 30/15 min per IP and 10 per id; reset 3/h per id; change-password limited |
| Client IP | Taken from the trusted proxy header only (AUTH-02) |
| One-time codes | HMAC-hashed, older codes retired, redacted from the outbox |
| Redirects | `next` / `back` are same-origin only (AUTH-06) |

Tests: auth suite, SEC-AU-1…6.

## 6. Admin Security

| Control | Detail |
|---|---|
| Session | Separate admin cookie and session kind; password + TOTP; TOTP replay guard; admin session refused on a non-admin host (`ENFORCE_HOSTS`) |
| Step-up | Within 10 minutes for: payment confirmation, destination and settings changes (including the real-money switch), commissions, roles, withdrawal rejection in PROCESSING, on-behalf receipt |
| KYC files | Step-up within 60 minutes |
| Open item | First TOTP enrollment is trust-on-first-use (AUTH-03, P2) |

## 7. Authorization

RBAC per action in the service layer, per-member seller permissions, and separation of duties (no self-dealing on payments, withdrawals, moderation, seller decisions, payout verification or refunds). See `AUTHORIZATION_MATRIX.md`.

## 8. IDOR

Every object read or write is scoped to its owner or party, or gated by a permission. Pages return a uniform not-found view. Tests: EDGE 16/18, privacy-idor, e2e security ("customers/sellers cannot open other … orders"), and the deal stranger tests.

## 9. Input Security

- zod allow-lists on every action;
- parameterized SQL only;
- React escaping (a reflected-XSS probe on staging was escaped);
- CMS links reject `javascript:` and `data:` (SEC-IN-1);
- CSV injection quoting;
- `x-request-id` validated;
- invitation tokens format-checked before any DB access.

## 10. File Security

- Magic-byte sniffing and an allow-list;
- sharp re-encoding (strips EXIF/GPS);
- pixel limit;
- random keys;
- default-deny per-purpose access rules.

Path-traversal probes on staging returned 404. See `FILE_AND_PRIVACY_AUDIT.md`.

## 11. Privacy

**Encrypted at rest (AES-256-GCM):**
- national ID;
- payout details;
- TOTP secrets;
- **deal locations**.

**Deal locations:**
- GPS is captured once, only after the user clicks and grants permission;
- it is never put in URLs or logs;
- the counterparty sees it only after payment confirmation;
- the invitation page shows no buyer name, phone, address or coordinates;
- before payment, the seller sees only the buyer's first name.

## 12. Secrets

No real secret has ever been committed to Git. Repository demo defaults are treated as compromised and refused on staging. Four provider tokens were pasted in chat during setup and **must be rotated**. See `SECRET_EXPOSURE_REGISTER.md`.

## 13. Financial Logic

- Integer piasters throughout;
- server-side pricing;
- no self-purchase;
- the real-money switch is refused while any test money is open and always on staging (FIN-P0-1).

See `FINANCIAL_SECURITY_AUDIT.md`.

## 14. Ledger

- Balanced, append-only double-entry ledger (DB triggers);
- an idempotency key per event;
- a projection check with `reconcile()`;
- SEC-LG-1…3.

The staging reconciliation is in §27.

## 15. Withdrawals

- Concurrent requests serialized under row locks (SEC-WD-1);
- dual control over a rolling 24h total (SEC-WD-2);
- no payout to an indebted, suspended or held seller (SEC-WD-3, 5);
- PROCESSING reject needs a different person plus step-up (SEC-WD-4);
- no self-approval or self-payment (SEC-WD-6, 7).

## 16. Payments

Payment confirmation requires:
- the declared amount to equal the amount due;
- a step-up;
- an approver who is neither the payer nor tied to the paid store.

It posts exactly once under replay or concurrency (SEC-PAY-1…5). Only destinations matching the money mode are offered.

## 17. External Deals

The flow is now invitation-first.

**Invitation link:**
- 32-byte CSPRNG token, stored as a hash only;
- 7-day expiry, revocable and refreshable;
- **bound to one account** (idempotent for that account; refused for any other);
- unknown or malformed tokens get an identical response;
- opening the link is read-only (`opened_at` plus audit only);
- audited events: CREATED, OPENED, BOUND, ACCEPTED, REVOKED, EXPIRED;
- the raw token is never put in a URL (it reaches the share screen in a 15-minute httpOnly path cookie).

**Before any offer:** the seller must have a verified phone.

**Negotiation:**
- every offer and change request is an append-only terms version;
- ACCEPT must name the current version;
- agreed terms are immutable at the DB level;
- payment is possible only after agreement.

**Return policy:** the seller's policy (voluntary / none) is part of the agreed terms. "No voluntary returns" never blocks a dispute or a defect claim.

**Delivery OTP (physical handover):**
- When the seller ships, a CSPRNG 6-digit code is issued to the **buyer**. Only an HMAC bound to the deal and the code id is stored.
- The code expires after 72h, allows 5 attempts, is rate-limited per deal and per user, and is single use under a row lock.
- Requesting a new code invalidates the previous one. A DB trigger prevents reactivating or deleting a code.
- The code is never visible to the seller, admins, audit logs, in-app notifications or server logs. On staging only, the authenticated buyer sees it labelled «رمز تجريبي — بيئة Staging»; production keeps no recoverable copy.
- Verifying the code only moves the deal to `DELIVERY_HANDOVER_VERIFIED`. Funds stay unavailable until the buyer explicitly chooses «استلمت والمنتج مطابق» (`BUYER_CONFIRMED_RECEIPT` → `COMPLETED`, exactly once). That also requires confirmed payment, no dispute, no Operations hold and no hold risk flag.
- A reported problem opens a dispute. "Not received" after a verified code is a `DELIVERY_CONFLICT` (dispute plus a HIGH risk flag). A failed code exchange goes to Operations review.
- The seller has no "buyer received" action.

Tests: 23 + 24 integration tests; 11 E2E steps covering two deals (local and staging).

## 18. Database

- Migrations are applied at build time.
- Check constraints exist on every status column.
- Append-only triggers cover the journal, audit log and terms versions; an immutability trigger covers agreed terms.
- Staging uses its own Neon database. Tests use dedicated `edmn_test` / `edmn_e2e` databases; the test harness refuses any non-test URL.

## 19. HTTP / Deployment

Headers verified on staging:
- CSP (`default-src 'self'`, `frame-ancestors 'none'`);
- HSTS with preload;
- `X-Frame-Options: DENY`;
- `nosniff`;
- `Referrer-Policy` (`no-referrer` on invite and deal pages);
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(), usb=()`.

Other checks:
- no CORS headers on the API;
- `robots.txt` disallows everything on staging;
- error responses carry no stack trace or SQL;
- open item: the CSP still contains `'unsafe-inline'` (FP-F12, P3).

## 20. Dependency Findings

| Audit | Result |
|---|---|
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Full tree | 9 advisories (4 moderate, 5 high), all in dev-only tooling (eslint-config-next, drizzle-kit → esbuild). They are not shipped to production. Accepted. |

## 21. P0 Findings

| ID | Finding | Status |
|---|---|---|
| FIN-P0-1 | Test-money cut-over | **FIXED** |

**Open P0: 0.**

## 22. P1 Findings

| ID | Finding | Status |
|---|---|---|
| FIN-P1-1 | Seller debt after a post-release refund | Fixed + mitigated |
| FIN-P1-2 | Payment amount / step-up | **FIXED** |
| FIN-P1-3 | Separation of duties | **FIXED** |
| FIN-P1-4 | Dual-control split | **FIXED** |
| AUTH-01 | Atomic lockout | **FIXED** |
| AUTH-02 | XFF spoofing | **FIXED** |

**Open P1: 0.**

## 23. P2 Findings

13 found: 10 fixed, 1 mitigated (FIN-P2-5, configuration). **Open: AUTH-03** (TOTP first-enrollment TOFU) and **FP-F5** (no key id / AAD in the encryption envelope).

## 24. P3 Findings

18 found, 14 fixed. **Open:**
- AZ-F5 (staff added without consent);
- AZ-F9 (review photos public / export without step-up);
- FP-F11 (orphan files);
- FP-F12 (CSP `unsafe-inline`).

## 25. Fixed Findings

All fixed findings are listed with evidence in `SECURITY_FINDINGS.md`:
- P0: 1;
- P1: 5 fixed + 1 mitigated;
- P2: 10;
- P3: 14;
- new feature: DEAL-01…08, RP-01.

## 26. Residual Risks

| Risk | Note |
|---|---|
| Funds released before a long voluntary return window ends | Business decision; seller debt blocks payouts |
| Manual bank-transfer verification depends on staff reading statements | Operational |
| A future map provider must be added carefully | Abstraction only; no key configured |
| Location retention | Delete closed-deal locations after the dispute window (recommended) |
| Open P2/P3 items | See §23–24 |

## 27. Test Evidence

| Check | Result |
|---|---|
| Lint (`eslint .`) | 0 problems |
| Typecheck (`next typegen && tsc --noEmit`) | 0 errors |
| Integration + unit (`vitest`, PostgreSQL) | **164 / 164 passed** (15 files); 26 security-gate + 23 deal/return-policy + 24 delivery-OTP tests included |
| E2E local (production build) | **34 / 34 passed** |
| E2E on public staging URL | **34 / 34 passed** (11.9 min). Includes the full invitation-first deal with Delivery OTP: buyer A and seller B in separate browser contexts, satisfactory path released once, and a problem-after-OTP path held. Also includes security, responsive at 7 widths and axe |
| Build | Local `next build` OK; Vercel deployment `f0a2936` READY (migrations applied) |
| Staging ledger reconciliation (read-only, after the OTP runs) | 29 accounts, **0 projection mismatches**, 56 entries / 139 lines, debits **356,289.00 EGP** = credits **356,289.00 EGP**, diff **0**, 0 unbalanced entries; real money **off**; migration 0006 applied additively (existing deals preserved) |
| Staging probes | Headers OK; invalid / traversal / XSS invite tokens → identical "invalid link" page; legacy `/deal-invite/*` redirects; anonymous deal page → login; no CORS |

## 28. Production Security Blockers (real money)

1. **Rotate the credentials pasted in chat:** Vercel, Neon, Render, Hugging Face (S7–S10). Generate new production `SESSION_SECRET`, `DATA_ENCRYPTION_KEY` and `CRON_SECRET`.
2. **Admins:**
   - create production admin accounts fresh, with **in-person TOTP enrollment** (AUTH-03);
   - set `ENFORCE_HOSTS=true` with separate admin and seller hosts.
3. **Real payment rail:** a bank feed or payment gateway reconciliation (manual proof verification only for the pilot), with dual control kept at threshold 0 for adjustments.
4. **Legal counsel review** of:
   - the mandatory consumer-rights notice;
   - the protected-deal terms;
   - the return-policy wording (configurable texts; no unapproved legal claims hard-coded).
5. **Explicit owner approval** before any deployment to the official domain.
6. Recommended before scale (not blockers):
   - nonce-based CSP (FP-F12);
   - encryption key id (FP-F5);
   - a location-retention job;
   - orphan-file cleanup.

## 29. Recommendation

- **Security gate: PASS.** There are no open P0 or P1 findings.
- **Real-seller pilot: SAFE**, under these conditions:
  - staging / pilot environment;
  - TEST money only;
  - real money switched off, which the code enforces;
  - invited sellers;
  - operations staff trained on manual verification.
- **Real-money production: NOT SAFE** until every blocker in §28 is closed. No code-level P0 or P1 remains, but credential rotation, admin enrollment, a payment rail and legal review are prerequisites.
