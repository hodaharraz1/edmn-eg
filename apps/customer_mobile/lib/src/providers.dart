import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Composition root. Every dependency is a provider so tests (and previews) override it — no globals.
final buildConfigProvider = Provider<BuildConfig>((ref) => BuildConfig.fromDefines());

/// SEC-194: shows the server's CAPTCHA challenge (a web view of the server-hosted page) and returns its token. Tests override it.
final captchaSolverProvider = Provider<CaptchaSolver>((ref) => showCaptchaChallenge);
final telemetryProvider = Provider<Telemetry>((ref) => Telemetry());

/// Customer App credentials live in their own namespace: they are never shared with the Admin App.
final sessionStoreProvider = Provider<SessionStore>((ref) => SecureSessionStore(namespace: 'edmn.customer'));

/// Non-secret app preferences (onboarding seen, language, recent searches). Overridden in tests.
final appPrefsProvider = Provider<AppPrefs>((ref) => SecureAppPrefs());

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

/// Real Money as the server reports it. Unknown (config not loaded) counts as OFF, so money steps keep their TEST notice.
final realMoneyProvider = Provider<bool>((ref) => ref.watch(appConfigProvider).value?.realMoneyEnabled ?? false);

class LocaleController extends Notifier<Locale> {
  @override
  Locale build() => EdmnLocales.fallback;
  void set(Locale l) {
    state = l;
    ref.read(apiClientProvider).languageCode = l.languageCode;
    ref.read(appPrefsProvider).write('locale', l.languageCode);
  }
}

final localeProvider = NotifierProvider<LocaleController, Locale>(LocaleController.new);

class SignedIn extends Notifier<bool> {
  @override
  bool build() => false;
  void set(bool v) => state = v;
}

final signedInProvider = NotifierProvider<SignedIn, bool>(SignedIn.new);

/// App start: restores the language, then the session from the stored refresh token (single refresh). Never blocks on
/// a fixed delay; the splash shows only while this runs.
final bootstrapProvider = FutureProvider<BootstrapResult>((ref) async {
  final prefs = ref.read(appPrefsProvider);
  final lang = await prefs.read('locale');
  if (lang != null) ref.read(localeProvider.notifier).set(lang == 'en' ? EdmnLocales.english : EdmnLocales.arabic);
  final onboarded = await prefs.read('onboarded') == '1';
  var signedIn = false;
  try {
    signedIn = await ref.read(apiClientProvider).refresh();
  } catch (_) {
    signedIn = false;
  }
  ref.read(signedInProvider.notifier).set(signedIn);
  return BootstrapResult(onboarded: onboarded, signedIn: signedIn);
});

class BootstrapResult {
  const BootstrapResult({required this.onboarded, required this.signedIn});
  final bool onboarded;
  final bool signedIn;
}

/// The signed-in user's profile (null when signed out). Roles and permissions come from here, never from the app.
final profileProvider = FutureProvider<Profile?>((ref) async {
  if (!ref.watch(signedInProvider)) return null;
  return ref.watch(mobileApiProvider).me();
});

/// Governorate used to price shipping in the cart (chosen by the buyer, else the default address).
class GovernorateController extends Notifier<int?> {
  @override
  int? build() => null;
  void set(int? id) => state = id;
}

final governorateProvider = NotifierProvider<GovernorateController, int?>(GovernorateController.new);
final governoratesProvider = FutureProvider((ref) => ref.watch(mobileApiProvider).governorates());

abstract class AppPrefs {
  Future<String?> read(String key);
  Future<void> write(String key, String? value);
}

class SecureAppPrefs implements AppPrefs {
  final _s = const FlutterSecureStorage();
  @override
  Future<String?> read(String key) async {
    try {
      return await _s.read(key: 'edmn.customer.pref.$key');
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String key, String? value) async {
    try {
      value == null ? await _s.delete(key: 'edmn.customer.pref.$key') : await _s.write(key: 'edmn.customer.pref.$key', value: value);
    } catch (_) {}
  }
}

class MemoryAppPrefs implements AppPrefs {
  MemoryAppPrefs([Map<String, String>? initial]) : values = {...?initial};
  final Map<String, String> values;
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String? value) async => value == null ? values.remove(key) : values[key] = value;
}
