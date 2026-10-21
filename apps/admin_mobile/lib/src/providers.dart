import 'package:edmn_api/admin.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final buildConfigProvider = Provider<BuildConfig>((ref) => BuildConfig.fromDefines());
final telemetryProvider = Provider<Telemetry>((ref) => Telemetry());

/// Admin credentials: own namespace, never shared with the Customer App.
final sessionStoreProvider = Provider<SessionStore>((ref) => SecureSessionStore(namespace: 'edmn.admin'));

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    config: ref.watch(buildConfigProvider),
    store: ref.watch(sessionStoreProvider),
    refreshPath: AdminApiPaths.adminRefreshToken.path,
    telemetry: ref.watch(telemetryProvider),
  );
  client.onSessionEnded = () => ref.read(adminSessionProvider.notifier).set(AdminSessionState.signedOut);
  return client;
});

final adminApiProvider = Provider<AdminApi>((ref) => AdminApi(ref.watch(apiClientProvider)));

class LocaleController extends Notifier<Locale> {
  @override
  Locale build() => EdmnLocales.fallback;
  void set(Locale l) => state = l;
}

final localeProvider = NotifierProvider<LocaleController, Locale>(LocaleController.new);

/// signedOut → (password) → needsMfa → (TOTP) → ready. Every admin API is refused by the server before `ready`.
enum AdminSessionState { signedOut, needsMfa, ready }

class AdminSession extends Notifier<AdminSessionState> {
  @override
  AdminSessionState build() => AdminSessionState.signedOut;
  void set(AdminSessionState s) => state = s;
}

final adminSessionProvider = NotifierProvider<AdminSession, AdminSessionState>(AdminSession.new);

/// Whether the account still has to enrol an authenticator (from the login response).
class TotpEnrolled extends Notifier<bool> {
  @override
  bool build() => true;
  void set(bool v) => state = v;
}

final totpEnrolledProvider = NotifierProvider<TotpEnrolled, bool>(TotpEnrolled.new);
