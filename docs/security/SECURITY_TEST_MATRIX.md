# Security Test Matrix

Every security control is backed by an automated test that runs in CI (`npm test` against PostgreSQL; `npx playwright test` against a production build). The latest results are in `FINAL_SECURITY_REPORT.md`.

## Suites

| Suite | Kind | Focus |
|---|---|---|
| `tests/integration/security-gate.test.ts` | Integration (26) | Payment, withdrawal, authorization, ledger, auth and input gates (SEC-*) |
| `tests/integration/deal-invitation-returns.test.ts` | Integration (23) | Invitation tokens, binding, location privacy, terms versions, return policy |
| `tests/integration/privacy-idor.test.ts` | Integration | Private files, IDOR, encryption at rest |
| `tests/integration/pilot-safety.test.ts` | Integration | TEST money, real-money switch |
| `tests/integration/auth.test.ts` | Integration | Login, lockout, sessions, TOTP, reset |
| `tests/integration/fulfilment-finance.test.ts` | Integration | Release, refunds, withdrawals, ledger |
| `tests/integration/postpurchase-deals-authz.test.ts` | Integration | Returns, disputes, deal end-to-end, authorization edges |
| `tests/e2e/security.spec.ts` | E2E | Admin isolation, private files, cross-account orders, headers |
| `tests/e2e/protected-deal.spec.ts` | E2E | Full invitation-first deal on a real browser (geolocation granted/denied) |

## Threat → test mapping

| Threat / control | Tests |
|---|---|
| Amount mismatch on payment confirmation | SEC-PAY-1 |
| Non-positive declared amounts | SEC-PAY-2 |
| Insider confirming a payment to their own store | SEC-PAY-3 |
| Step-up required to confirm | SEC-PAY-4 |
| Replay / concurrent confirmation → exactly once | SEC-PAY-5 |
| Concurrent withdrawals double-spend | SEC-WD-1 |
| Dual control split bypass | SEC-WD-2 |
| Payout to an indebted seller | SEC-WD-3 |
| PROCESSING reject by the same person | SEC-WD-4 |
| Payout to a suspended seller | SEC-WD-5 |
| Insider approving their own store's withdrawal | SEC-WD-6 |
| Seller paying / approving their own withdrawal | SEC-WD-7 |
| Seller lifting an admin suspension | SEC-AZ-1 |
| Self-purchase (incl. guest-cart merge) | SEC-AZ-2 |
| Ledger append-only | SEC-LG-1 |
| Unbalanced / duplicate posting | SEC-LG-2 |
| Books balance, zero drift | SEC-LG-3 |
| XFF spoofing | SEC-AU-1 |
| Parallel brute force / lock oracle | SEC-AU-2 |
| Open redirect | SEC-AU-3 |
| OTP storage / retirement | SEC-AU-4 |
| TOTP replay | SEC-AU-5 |
| OTP redaction in outbox | SEC-AU-6 |
| CMS `javascript:` / `data:` links | SEC-IN-1 |
| Private KYC / proofs / waybills | privacy-idor (3 tests), e2e security "private files are not public" |
| Cross-account orders | EDGE 16, privacy-idor, e2e security |
| Encryption at rest (national ID, payout) | privacy-idor |
| Real-money switch / TEST destinations | pilot-safety (5 tests) |
| **Invitation token CSPRNG + hash-only storage** | deal-invitation-returns: "link is CSPRNG, only its hash is stored"; e2e protected-deal step 1 |
| **Invitation anti-enumeration** | "anti-enumeration: malformed / unknown tokens return nothing" |
| **Opening is read-only; no buyer PII on the invite page** | "opening the link is read-only…"; e2e step 2 (page content checks) |
| **Single binding / anti-replay** | "binding: the buyer cannot claim; first seller binds; …"; e2e "another account cannot use the bound link" |
| **Expiry / revoke / refresh** | "expired links cannot be claimed…", "refresh replaces the link…" |
| **Audit: CREATED / OPENED / BOUND / ACCEPTED / REVOKED / EXPIRED** | assertions inside the tests above + "request change → … versions never overwritten" |
| **Stranger cannot act on a deal** | "a stranger cannot act on a deal" |
| **Verified phone before offering** | "seller must have a verified phone…"; e2e step 4 |
| **Location encrypted; counterparty only after payment** | "coordinates are encrypted at rest…"; e2e steps 1, 4, 6, 7 |
| **GPS validation / manual fallback** | "location schema: GPS optional and range-checked…"; e2e (granted + denied) |
| **No payment before agreement** | "no payment is possible before both sides agree…" |
| **Stale version cannot be accepted** | "request change → new version…" |
| **Agreed terms / versions immutable (DB)** | "agreed terms and term versions are immutable…" |
| **"No voluntary returns" never blocks disputes / protected returns** | "\"no voluntary returns\" never blocks a defect dispute…", "order items snapshot the policy…" |
| **Return policy required at listing submission** | "a product cannot be submitted before its return policy is set" |
| **Order snapshot unaffected by later changes** | "order items snapshot the policy; later store changes do not alter history…" |

## Manual checks on staging (non-destructive)

| Check | Method |
|---|---|
| Security headers (CSP, HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy incl. `geolocation=(self)`) | `curl -I` |
| No CORS on API routes | `Origin:` probe |
| Error responses leak no stack / SQL | malformed ids, bad JSON |
| Path traversal on `/api/files` | `..%2f` probes → 404 |
| Reflected XSS in search | `<script>` payload → escaped |
| Invite page with random / malformed token | same "invalid link" response; no timing-visible DB difference for malformed |
