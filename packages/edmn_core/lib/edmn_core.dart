/// Shared, UI-free foundations for the EDMN Customer and Admin apps.
///
/// Business rules never live here: the server decides (allowed actions, deadlines, money). This package only moves
/// data safely: environment selection, the HTTP client with device-bound token refresh, stable error codes, secure
/// storage, integer-piastre money formatting and redacting telemetry.
library;

export 'src/api/api_client.dart';
export 'src/api/api_error.dart';
export 'src/api/idempotency.dart';
export 'src/auth/session_store.dart';
export 'src/config/app_environment.dart';
export 'src/money/money.dart';
export 'src/observability/telemetry.dart';
