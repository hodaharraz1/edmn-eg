# Go-live acceptance matrix (authoritative launch decision document)

Each stage is opened by the **owner**, in order, only when **every** gate of that stage and of all earlier stages shows evidence.

**Notation:**
- **E** = evidence artifact attached to the go-live log (acceptance output, screenshot, provider log).
- **C** = computed by the system (Ops / acceptance / `goLiveGate`).

**Production fact:** with real money OFF, production closes **new orders, Protected Deal invitations and deal payments** (`src/server/ops/commerce-gate.ts`). The pilots below therefore test **people, identity, onboarding, catalog and operations** on production. Purchases and deals with test money are exercised on **staging**.

## 1. PUBLIC WEBSITE GO-LIVE (browse, register, log in)

| Gate | Evidence |
|---|---|
| Server discovery + evaluator: not BLOCKED; owner + Kntabo approved the profile | E: `discovery.json`, evaluator output, approval |
| Legacy preflight PASS; `api.edmneg.com` config baseline recorded | E: preflight report |
| `check-production-env.ts` VALID (0 errors) | E: output (names only) |
| `deploy.sh first` SUCCESS (empty DB, PRODUCTION marker, migrations = journal, reference seed) | E: deploy log |
| `prod-acceptance --db-only --expect-pricing=none` PASS and `--http-only --local` PASS | E/C |
| First SUPER_ADMIN created; TOTP enrolled; a second staff account (checker) created with 2FA | E: roles page (2FA badges) |
| SMTP configured; a test password-reset mail received by an owner address (`SMTP` evidence) | E |
| watch.sh HEALTHY; timers enabled (watch, backup, tick) | C |
| First backup taken + `verify-backup` PASS + restore drill PASS (local key) | E |
| Reverse proxy installed (before/after diff = EDMN only); TLS valid for www, apex and admin | E |
| DNS cutover done per runbook; `api.edmneg.com`, MX and mail unchanged | E: dig before/after; mail test |
| `prod-acceptance --http-only` (public) PASS, incl. apex 301 without HSTS | E |
| Legal v1.0 texts visible (owner-approved); v1.1/v1.2 remain drafts | C |
| Real money OFF (acceptance `REAL_MONEY_OFF` PASS) | C |

## 2. BUYER PILOT (real people: accounts, identity, browsing, support; no purchases)

| Gate | Evidence |
|---|---|
| Everything in §1 | — |
| **Off-server backup** destination configured: `OFF-SERVER COPY UPLOADED` daily | E: status + object in destination |
| External uptime monitor on `/api/ready` alerting a human | E |
| Error tracking recommended (Sentry DSN, `ERROR_TRACKING` HEALTHY after a test error) | E |
| Malware scanner, **if** pilot users upload private documents (support/disputes) | E: EICAR → INFECTED |
| Pilot user list and support process owned by a named person | E |

## 3. SELLER PILOT (onboarding, mobile verification, KYC, catalog)

| Gate | Evidence |
|---|---|
| Everything in §2 | — |
| **SMS provider** live (`SMS_DRIVER=http`); OTP received on an owner phone | E |
| **Malware scanner** live: EICAR → INFECTED and unopenable; PDF/JPG → CLEAN; `MALWARE_SCANNER` HEALTHY | E |
| Identity reviewers (staff role) trained; review queue visible; Maker/Checker separation in place | E |
| Seller invitation and team flows checked by an owner-controlled test seller (then archived) | E |
| Email delivery webhook configured (recommended): `DELIVERED` evidence | E |

## 4. PROTECTED DEAL PILOT

| Gate | Evidence |
|---|---|
| **Production:** cannot open before REAL MONEY: deal invitations and payments are closed by design while real money is OFF | C |
| **Staging:** full Protected Deal flow with test money and delivery OTP (existing E2E + manual) | E (staging) |
| For production after §5: SMS live (delivery OTP), scanner live (evidence), all §3 gates | E |

## 5. REAL MONEY
**Only** via [REAL_MONEY_ACTIVATION_GATE.md](REAL_MONEY_ACTIVATION_GATE.md): 16 evidence rows, the code gate `goLiveGate()`, the owner's decision, and Maker/Checker with a fresh 2FA.

Never automatic. The default is OFF.

## 6. Remaining items — classification (nothing remains that can be done locally)

| Class | Item |
|---|---|
| **A — server access** | Run `server-discovery.sh` and the evaluator. |
| | Kntabo approval of the profile (A/B/C). |
| | Hardening `--apply` (Docker, `edmn` user, firewall/SSH where not cPanel/CSF-managed). |
| | Legacy preflight PASS (incl. an explicit nginx `default_server` if nginx fronts). |
| | Release image on the server. |
| | Local PostgreSQL volume or external DB connectivity. |
| | `deploy.sh first`; first SUPER_ADMIN; timers. |
| | First backup + restore drill on the server. |
| | Proxy install (before/after diffs). |
| | ClamAV capacity (≥ 6 GB RAM, or a separate host). |
| **B — DNS access** | Zone export + TTL lowering for www/apex/admin. |
| | A/AAAA for `admin`, `www` and the apex on cutover day. |
| | CAA check. |
| | Apex-vs-mail dependency check (MX/SPF `a`). |
| | Certificate issuance (needs DNS). |
| **C — owner secrets/credentials** | S7–S10 revocation. |
| | All production secrets in [PRODUCTION_SECRETS_MANIFEST.md](PRODUCTION_SECRETS_MANIFEST.md) generated on the server. |
| | Offline sealed copies of `DATA_ENCRYPTION_KEY` and the age private key. |
| | First SUPER_ADMIN password + TOTP. |
| | SSH keys; WHM/registrar access stays with the owner/Kntabo. |
| **D — external provider accounts** | SMTP sending provider (+ domain DKIM/SPF merge, delivery webhook). |
| | SMS provider. |
| | Off-server backup destination. |
| | Uptime + heartbeat monitors. |
| | Error tracking (Sentry). |
| | External PostgreSQL (only for profile C). |
| | Payment/payout provider (real money only). |
| **E — legal / accounting decisions** | Counsel approval of the v1.1/v1.2 terms and policies. |
| | Tax treatment of fees and the refund-fee policy. |
| | Commercial register / tax-card display: "NOT PROVIDED — DO NOT INVENT". |
| | Payout channel cost verification. |
| | Fee Engine publication (owner Maker/Checker). |
| | RPO/RTO and severity model confirmation. |
