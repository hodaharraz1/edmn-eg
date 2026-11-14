import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Composition root. Every dependency is a provider so tests (and previews) override it — no globals.
final buildConfigProvider = Provider<BuildConfig>((ref) => BuildConfig.fromDefines());
final telemetryProvider = Provider<Telemetry>((ref) => Telemetry());

/// Customer App credentials live in their own namespace: they are never shared with the Admin App.
final sessionStoreProvider = Provider<SessionStore>((ref) => SecureSessionStore(namespace: 'edmn.customer'));

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    config: ref.watch(buildConfigProvider),
    store: ref.watch(sessionStoreProvider),
    refreshPath: MobileApiPaths.refreshToken.path,
    telemetry: ref.watch(telemetryProvider),
  );
  client.onSessionEnded = () => ref.read(signedInProvider.notifier).set(false);
  return client;
});

final mobileApiProvider = Provider<MobileApi>((ref) => MobileApi(ref.watch(apiClientProvider)));

/// Server-side app configuration (minimum versions, Real Money flag). Nothing here is hardcoded in the app.
final appConfigProvider = FutureProvider<AppConfig>((ref) => ref.watch(mobileApiProvider).appConfig());

class LocaleController extends Notifier<Locale> {
  @override
  Locale build() => EdmnLocales.fallback;
  void set(Locale l) => state = l;
}

final localeProvider = NotifierProvider<LocaleController, Locale>(LocaleController.new);

class SignedIn extends Notifier<bool> {
  @override
  bool build() => false;
  void set(bool v) => state = v;
}

final signedInProvider = NotifierProvider<SignedIn, bool>(SignedIn.new);
