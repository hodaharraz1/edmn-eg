# EDMN mobile apps (Phase 1 foundation)

Two **independent binaries** live in the platform repository, next to the backend they call:

| | Customer App | Admin App |
|---|---|---|
| Folder | `apps/customer_mobile` (package `edmn_customer`) | `apps/admin_mobile` (package `edmn_admin`) |
| Android application id | `com.edmneg.edmn_customer` | `com.edmneg.admin.edmn_admin` |
| iOS bundle id | `com.edmneg.edmnCustomer` | `com.edmneg.admin.edmnAdmin` |
| API audience | `/api/v1/**` (session scope `MOBILE`) | `/api/v1/admin/**` (scope `ADMIN_MOBILE`, staff + TOTP) |
| Secure-storage namespace | `edmn.customer` | `edmn.admin` |

A token from one app is refused by the other (scope is signed into the token and checked on the session row; refresh
endpoints are audience-bound). Release pipelines are separate (one per folder); nothing is shared at runtime.

Shared code lives in three packages, each justified by real duplication:

| Package | Contents |
|---|---|
| `packages/edmn_core` | build environment, HTTP client (device headers, single-flight token refresh), stable error codes, secure session storage, integer-piastre money formatting, redacting telemetry |
| `packages/edmn_api` | Dart models **generated** from `openapi/*.v1.json` + thin typed clients (`mobile.dart` / `admin.dart` are separate libraries) |
| `packages/edmn_design` | theme (web brand tokens), Arabic-first locales, shared `ar`/`en` ARB strings, the single error-code → message mapping, small widgets (`EgpText`, `ErrorView`, `TestMoneyBanner`) |

## Rules the foundation enforces

- **Server decides.** No business rule, deadline or financial state is computed in Flutter. Allowed actions, Real
  Money status and minimum app versions come from the API (`/api/v1/app/config`).
- **Money is `int` piastres** end to end; `formatEgp` uses integer arithmetic and matches the web `formatEGP`.
- **Arabic (RTL) is the default**, English (LTR) secondary. Use `EdgeInsetsDirectional` / `AlignmentDirectional`;
  never hardcode left/right. All text comes from `EdmnLocalizations`.
- **Errors are localized by stable code** (`ApiErrorCode`) in one place (`apiErrorMessage`), never from server text.
- **Credentials**: refresh token + installation id in Keychain / Android Keystore-backed storage; the 10-minute access
  token only in memory. Telemetry redacts tokens, codes, phone numbers, emails and national ids by key and by value.
- **Mutations** carry one `Idempotency-Key` per user intent (`newIdempotencyKey()`), reused for retries.
- **No financial mutation** exists in either app in Phase 1.

## Dependencies (and why)

| Dependency | Why |
|---|---|
| `flutter_riverpod` 3.4 | dependency injection + async state without globals; every provider is overridable in tests |
| `go_router` 18 | declarative routing with redirect guards (sign-in, mandatory admin TOTP), deep links later |
| `dio` 5.11 | interceptors for auth headers and refresh-and-retry, adapters for deterministic tests |
| `flutter_secure_storage` 11.2 | Keychain / Keystore storage for refresh tokens and the installation id |
| `flutter_localizations` + `intl` (SDK-pinned) | ARB-based `ar`/`en` localization, RTL/LTR, plural rules |

No code-generation runtime (no `build_runner`, `freezed`, `json_serializable`): models come from the in-repo
generator `scripts/generate-dart-api.ts`, which a backend test keeps in sync with the contract.

## Commands

```bash
# contract → Dart models (CI fails when stale)
npx tsx scripts/openapi.ts && npx tsx scripts/generate-dart-api.ts

# per package / app
cd packages/edmn_core && flutter analyze && flutter test
cd apps/customer_mobile && flutter analyze && flutter test
flutter run --dart-define=EDMN_ENV=local                       # Android emulator → http://10.0.2.2:3000
flutter build apk --dart-define=EDMN_ENV=staging --dart-define=EDMN_APP_VERSION=1.0.0
```

`EDMN_ENV=staging|production` builds refuse non-HTTPS base URLs.
