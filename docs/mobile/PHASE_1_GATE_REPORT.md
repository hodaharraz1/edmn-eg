# Phase 1 acceptance gate report — S1 + S2 foundations

Branch `claude/awesome-davinci-ojxuul` (Marketplace baseline `48ae40c` + Phase 0 docs `9ad58d0` + Phase 1 commits).
**Phase 2 has not been started.** Production was not touched, nothing was deployed (staging included), and Real Money
is unchanged (OFF).

## 1. Scope delivered (approved priority order)

| # | Item | Status | Where |
|---|---|---|---|
| 1 | Safe dev branch from the Marketplace baseline | done | `9ad58d0` merge; remote recovery branch `backup/marketplace-baseline-48ae40c` |
| 2 | Preserve and verify baseline tests | done | baseline 40 files / 618 tests green on a pristine worktree before any change |
| 3 | OpenAPI 3.1 contract structure | done | `src/server/api/openapi.ts`, `scripts/openapi.ts`, `openapi/mobile.v1.json`, `openapi/admin.v1.json` |
| 4 | Mobile/device auth architecture | done | `src/server/auth/mobile.ts`, `mobile_devices`, `mobile_refresh_tokens` |
| 5 | Device sessions + remote revocation | done | self-service (`/me/sessions…`) and staff (`/admin/users/{id}/sessions/revoke`) |
| 6 | API auth middleware | done | `src/server/api/authenticate.ts`, `src/server/api/http.ts` |
| 7 | Authorization into reusable service boundaries | done for the 9 actor-less admin queries + risk flags | `requireAnyPermission`, `withdrawalQueue(actor…)`, `refundQueue`, `refundDetail`, `reconQueue`, `recentApprovals`, `openMovementRequests`, `pendingClosures`, `ticketQueue`, `adminSettingsView` |
| 8 | S-H1 delivery-dispute conflict of interest | fixed | `src/server/modules/risk/service.ts`; `riskFlagAction` now delegates |
| 9 | Server-side `allowed_actions` | done (module + exhaustive tests) | `src/server/modules/allowed-actions.ts` |
| 10 | Generic idempotency | done | `src/server/api/idempotency.ts` + `idempotency.prune` worker job |
| 11 | Mobile-safe rate limiting | done | `src/server/api/rate-limit.ts` |
| 12 | OTP key separation | done | `src/server/core/keys.ts`, OTP hash v2, buyer sealed copy |
| 13 | First read-only public catalog endpoints | done | 8 public endpoints |
| 14 | Flutter Customer App foundation | done | `apps/customer_mobile` |
| 15 | Flutter Admin App foundation | done | `apps/admin_mobile` |
| 16 | Shared localization, design, API generation | done | `packages/edmn_design`, `packages/edmn_api`, `packages/edmn_core`, `scripts/generate-dart-api.ts` |

## 2. Architecture decisions

- **One session model, two transports.** A mobile session is an ordinary `sessions` row with scope `MOBILE` (Customer
  App) or `ADMIN_MOBILE` (Admin App), created by the same `login()` / `register()` as the web. So lockout, enumeration
  safety, password-change invalidation, the staff-only admin scope, mandatory MFA and the staff idle timeout apply
  unchanged. `resolveSessionById` runs the same checks on every API request, which makes revocation immediate.
- **Access token.** `em1.<payload>.<HMAC>`, signed with an HKDF key derived from `MOBILE_TOKEN_KEY` (never
  `SESSION_SECRET`). It lives 10 minutes and carries only the session id, scope, user id and device id.
- **Refresh token.** Opaque, 256-bit; only its SHA-256 is stored. Each token works once and is rotated on use.
  - Re-presenting a used token revokes the whole session and is audited as theft.
  - Presenting it from another installation also revokes the session.
  - Refresh endpoints are bound to their audience (`expectedScope`).
- **Device binding.** `mobile_devices` holds one row per (user, app, installation). Logging in again on the same
  installation replaces that installation's previous session. Every audit row now records `channel` and `device_id`.
- **Route definitions are data.** One definition drives the Next.js handler, auth mode, rate tier, idempotency, zod
  validation, response allow-list and the OpenAPI document. An ESLint rule and a test forbid database imports in API
  routes, so authorization stays in services.
- **Errors.** RFC 9457 problem+json with stable snake_case `code` values (17 codes). `detail` is only an Arabic
  fallback; internal errors return a support `reference` and never a stack trace.
- **Rate limits (CGNAT-safe).** Signed-in traffic is counted per user. Anonymous traffic is counted per app
  installation, with a generous per-IP ceiling. The per-identifier login lockout is unchanged.
- **Idempotency.** Scope is caller + METHOD + path. The request hash detects reuse (422). `IN_PROGRESS` returns 409,
  and expired leases can be taken over. Results are replayed for 24 hours with `Idempotent-Replayed: true`. Failed
  attempts release the key. Endpoints that return credentials are never cached.
- **Delivery OTP (decision 2).**
  - New codes are HMAC'd with `DELIVERY_OTP_KEY` (hash version 2). Version 1 codes still verify until they expire.
  - A buyer-bound copy is sealed with AES-256-GCM under a separate HKDF key, with (deal, OTP id) as AAD.
  - A database trigger forbids replacing that copy and erases it when the code is used or invalidated.
  - `revealDeliveryOtpForBuyer` refuses sellers and staff, is rate limited, and audits the reveal without the code.
- **Flutter.** Riverpod (DI and state), go_router (guards), Dio (refresh-and-retry interceptors), flutter_secure_storage
  (Keychain/Keystore) and SDK localization. Models are generated in-repo from the contract, with no build_runner.
  Money is integer piastres and is formatted exactly like the web. Arabic RTL is the default and English LTR is
  secondary. Error codes are localized in one place, and telemetry redacts sensitive data. Rationale for each
  dependency is in `apps/README.md`.

## 3. OpenAPI coverage

27 operations, all generated from code, committed, and diff-tested in `tests/unit/openapi-contract.test.ts`. The same
test checks that the Dart models are in sync.

| Contract | Operations | Named schemas |
|---|---|---|
| `openapi/mobile.v1.json` (Customer App) | 16 | AppConfig, Category, DeviceInfo, DeviceSession, ErrorCode, LegalDocument, Ok, Problem, ProductCard, ProductDetail, Profile, Review, SessionResult, Store, TokenPair |
| `openapi/admin.v1.json` (Admin App) | 11 | DeviceInfo, DeviceSession, ErrorCode, Ok, Problem, Profile, SessionResult, TokenPair |

Every operation documents the following:
- auth mode (`x-auth-mode`)
- rate tier (`x-rate-limit`)
- idempotency (`x-idempotency` + required `Idempotency-Key` header)
- each error status with its stable codes (`x-error-codes`)
- the `Retry-After` header on 429

## 4. Implemented endpoints

**Public, read-only (Customer App):**
- `GET /api/v1/app/config`
- `GET /api/v1/catalog/categories`
- `GET /api/v1/governorates`
- `GET /api/v1/catalog/products`
- `GET /api/v1/catalog/products/{slug}`
- `GET /api/v1/catalog/products/{slug}/reviews`
- `GET /api/v1/stores/{slug}`
- `GET /api/v1/content/legal/{slug}`

**Customer auth and sessions:**
- `POST /api/v1/auth/register`, `/auth/login`, `/auth/token/refresh`, `/auth/logout`
- `GET /api/v1/me`
- `GET /api/v1/me/sessions`
- `DELETE /api/v1/me/sessions/{sessionId}` *(idempotent)*
- `POST /api/v1/me/sessions/revoke-others` *(idempotent)*

**Admin App:**
- `POST /api/v1/admin/auth/login`, `/admin/auth/token/refresh`, `/admin/auth/mfa/enroll`, `/admin/auth/mfa/verify`, `/admin/auth/step-up`, `/admin/auth/logout`
- `GET /api/v1/admin/me`
- `GET /api/v1/admin/me/sessions`
- `DELETE /api/v1/admin/me/sessions/{sessionId}` *(idempotent)*
- `POST /api/v1/admin/me/sessions/revoke-others` *(idempotent)*
- `POST /api/v1/admin/users/{userId}/sessions/revoke` *(idempotent; customers.manage / roles.manage + step-up + reason)*

No endpoint moves money. There are no withdrawal, settlement, refund, release, ledger or Real Money operations; a
contract test enforces this.

## 5. Tests

### Backend (Vitest, real PostgreSQL 16)

| Area | File | Tests |
|---|---|---|
| Auth / session (real route handlers) | `tests/integration/mobile-api-auth.test.ts` | 16 |
| OTP security, S-H1, admin query authorization, idempotency, rate limits, public catalog | `tests/integration/mobile-phase1-security.test.ts` | 19 |
| allowed_actions full status × role matrix | `tests/unit/allowed-actions.test.ts` | 13 |
| Key separation + environment policy | `tests/unit/key-separation.test.ts` | 5 |
| Contract (OpenAPI drift, route mounts, no DB imports, no money endpoints, Dart models in sync) | `tests/unit/openapi-contract.test.ts` | 10 |

**Auth / session coverage:**
- Login binds the device. Wrong password and unknown accounts get the same code.
- Register works; validation issues carry stable codes.
- Refresh rotates. Reuse revokes the whole session. Another installation revokes it too.
- Forged, expired and `SESSION_SECRET`-signed tokens are refused.
- A password change or a disabled account kills sessions.
- Remote revocation works by handle, never across users. Re-login replaces the installation's session.
- Audience separation works both ways.
- Admin APIs are refused before TOTP. TOTP replay is refused.
- Staff revocation needs the permission, step-up and a reason, is never self-targeted, and is audited with `channel`.

**OTP security coverage:**
- New codes use the v2 key; v1 codes still verify; the hash version is immutable.
- Only the buyer can reveal the code: sellers, staff and a staff session of the buyer are refused.
- The audit row holds no code.
- The sealed copy is bound to its deal and OTP, cannot be replaced, and is erased on use and on invalidation.
- Reveals are rate limited.

**Authorization and S-H1 coverage:**
- S-H1: staff who are the deal buyer, the deal seller or a store member cannot resolve the flag. An independent officer
  needs the permission, a fresh step-up and a reason; the update and the audit row commit atomically.
- The 9 admin queries refuse customers and under-privileged staff.

**Idempotency coverage:**
- Same key → replayed response. Same key with a different request → 422. Keys are per-caller.
- Concurrent attempts → 409. A failed attempt releases the key. Pruning keeps legacy keys.
- A request without a key is refused before any side effect.

**Rate-limit coverage:**
- 150 installations behind one carrier IP are all served.
- A flooding installation gets 429 with `Retry-After`.
- Signed-in users are unaffected by an exhausted IP bucket.

### Flutter (`flutter analyze`: no issues in all 5 projects; `flutter test`)

| Project | Tests | Covers |
|---|---|---|
| `packages/edmn_core` | 13 | money (matches web, integer only), error-code mapping, telemetry redaction, single-flight refresh + rotation, session end on refused refresh, HTTPS-only hosted builds, idempotency keys |
| `packages/edmn_api` | 2 | generated models parse the contract shape (nullable, recursive, piastres), paths from contract |
| `packages/edmn_design` | 4 | Arabic RTL default, English LTR, every error code localized, locale resolution |
| `apps/customer_mobile` | 8 (widget) | RTL + EGP list, language switch, TEST banner driven by server, server-side minimum version gate, localized errors, sign-in validation + error, devices + sign-out others, semver gate |
| `apps/admin_mobile` | 4 (widget) | nothing reachable before password + TOTP, enrolment flow, step-up on `step_up_required` with fresh idempotency key, permission-driven UI |

## 6. Complete backend regression

| Check | Result |
|---|---|
| `eslint .` | exit 0 |
| `next typegen && tsc --noEmit` | exit 0 |
| `vitest run` (all unit + integration) | **45 files / 681 tests, all passing** (618 baseline + 63 new) |
| Baseline before Phase 1 (pristine worktree) | 40 files / 618 tests, all passing |

Existing tests changed, all because of a new required secret or an approved decision (no assertion weakened):

| Test file | Change | Reason |
|---|---|---|
| `tests/integration/infra-adapters.test.ts` | adds the two new keys to the synthetic production environment | new required secrets |
| `tests/integration/pre-server.test.ts` | adds the two new keys to the synthetic production environment | new required secrets |
| `tests/integration/delivery-otp.test.ts` | production case renamed; now also asserts the buyer's sealed copy exists and that no TEST copy exists | decision 2 |

`.env.production.example` documents the two new secrets.

## 7. Migrations

`drizzle/0020_mobile_api_foundation.sql` (additive):
- two tables: `mobile_devices`, `mobile_refresh_tokens`
- `sessions` scope check widened
- `audit_logs` gains `channel` and `device_id`
- `idempotency_keys` gains request hash, status, response and expiry
- `deal_delivery_otps` gains `code_hash_version` (default 1) and `buyer_code_enc`
- the OTP guard trigger now also makes the hash version immutable and makes the sealed copy clear-only and
  auto-erased on use

Verification:
- **Fresh database:** all migrations applied by the test global setup.
- **Forward migration of the pristine baseline database:** preflight OK, applied in 172 ms; 1,081 users, 25 sessions
  and 49 existing OTPs (now version 1) preserved; scope constraint verified.

## 8. Staging

**Not run — not authorized.** Nothing was deployed. Before any staging deploy, `DELIVERY_OTP_KEY` and
`MOBILE_TOKEN_KEY` must be provisioned (see `MAINLINE_MIGRATION_PLAN.md`).

## 9. Financial invariant regression

All existing money tests pass unchanged in the full run. They cover:
- ledger balance and append-only journal triggers
- approvals required, maker/checker, two-person rule
- fee engine
- deal settlement and OTP-gated entitlement
- refund and withdrawal flows
- kill switches
- `ledger:check`-equivalent reconciliation

Phase 1 adds no journal entry type and no money movement. Resolving risk flags still only removes a *blocker*; the
release itself still requires `finance.release` plus maker/checker.

## 10. Real Money

**OFF.**
- `payments.realMoneyEnabled` is untouched. It is exposed read-only in `/api/v1/app/config`, and both apps show the
  TEST banner from that value.
- No activation path was added. The two-Senior-Admin / maker-checker / fresh-2FA activation design is deferred as
  instructed.

## 11. Deviations from the Phase 0 V2 architecture (and open items for Phase 2)

1. **`allowed_actions` is not yet on API responses.** Phase 1 exposes no deal or order endpoint. The module and its
   tests exist, and the first Phase 2 deal and order DTOs will embed it.
2. **No HTTP endpoint for the buyer delivery-code reveal.** The service exists and is tested; the endpoint arrives
   with the Phase 2 deal endpoints. SMS remains the fallback, and `app/config.deliveryOtp.sms` reports availability.
3. **`content/home` is deferred.** CMS rails need product-rail resolution; only the legal documents endpoint ships now.
4. **Product reviews are addressed by slug.** The path is `/catalog/products/{slug}/reviews`, not by id, because
   Next.js requires one dynamic segment name per path level.
5. **Decisions 3–6 are not implemented in Phase 1 (scope).** These are the server-side expiry settings and overdue
   exception, the returns state machine, the replacement workflow, and Real Money activation controls. They are
   Phase 2 backlog.
6. **Admin Mobile operational modules are not built yet (decision 10).** These include KPIs, reports, exports, fees,
   settings, content and system health. Phase 1 ships the secured shell (sign-in, TOTP, step-up, sessions,
   permission-driven UI) these modules plug into.
7. **Fonts are not bundled.** The theme falls back to platform Arabic fonts until IBM Plex Sans Arabic is added as an
   approved asset.
8. **Staging-only behaviour of the new keys.** On STAGING, missing `DELIVERY_OTP_KEY` / `MOBILE_TOKEN_KEY` is a boot
   *warning* (house policy for new rules), but using those features fails closed at runtime. On PRODUCTION it is a
   boot error.
9. **Recovery point is a branch, not a tag.** The tag push was refused by the git proxy.
10. **HawkScan DAST was not run.** `HAWK_API_KEY` is not configured in this environment and no app instance was
    deployed.

## 12. Files changed

See `git diff --name-status 9ad58d0..HEAD`. Summary:

| Area | Files |
|---|---|
| Backend sources | 32 new (`src/server/api/**`, `src/app/api/v1/**` (27 route files), `src/server/auth/mobile.ts`, `src/server/core/keys.ts`, `src/server/modules/{allowed-actions,risk/service,catalog/public-read,mobile/app-config}.ts`); 27 modified (schema, auth, OTP, deal service, finance/support/closure queries, settings, worker, runtime env, admin pages + actions, store page, eslint config) |
| Migrations | `drizzle/0020_mobile_api_foundation.sql` + meta |
| Contracts and generators | `openapi/*.v1.json`, `scripts/openapi.ts`, `scripts/generate-dart-api.ts` |
| Tests | 5 new, 3 updated |
| Mobile | `apps/customer_mobile`, `apps/admin_mobile`, `packages/edmn_core`, `packages/edmn_api`, `packages/edmn_design`, `apps/README.md` |
| Docs | this report, `docs/mobile/MAINLINE_MIGRATION_PLAN.md` |

**STOP — awaiting explicit approval before Phase 2.**
