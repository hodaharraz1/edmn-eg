/// Build-time environment selection. Each binary is built with `--dart-define=EDMN_ENV=local|staging|production`;
/// there is no runtime switch, and a production build can only talk to the production API over HTTPS.
enum AppEnvironment {
  local,
  staging,
  production;

  static AppEnvironment fromDefine([String value = const String.fromEnvironment('EDMN_ENV', defaultValue: 'local')]) {
    return switch (value) {
      'production' => AppEnvironment.production,
      'staging' => AppEnvironment.staging,
      _ => AppEnvironment.local,
    };
  }
}

class BuildConfig {
  BuildConfig({required this.environment, required this.apiBaseUrl, required this.appVersion}) {
    final uri = Uri.parse(apiBaseUrl);
    if (environment != AppEnvironment.local && uri.scheme != 'https') {
      throw StateError('Hosted builds must use HTTPS (got ${uri.scheme})');
    }
  }

  /// Reads `EDMN_ENV`, `EDMN_API_BASE_URL` and `EDMN_APP_VERSION` dart-defines.
  factory BuildConfig.fromDefines() {
    final env = AppEnvironment.fromDefine();
    const override = String.fromEnvironment('EDMN_API_BASE_URL');
    final base = override.isNotEmpty
        ? override
        : switch (env) {
            AppEnvironment.production => 'https://edmneg.com',
            AppEnvironment.staging => 'https://staging.edmneg.com',
            AppEnvironment.local => 'http://10.0.2.2:3000',
          };
    return BuildConfig(environment: env, apiBaseUrl: base, appVersion: const String.fromEnvironment('EDMN_APP_VERSION', defaultValue: '1.0.0'));
  }

  final AppEnvironment environment;
  final String apiBaseUrl;
  final String appVersion;

  bool get isProduction => environment == AppEnvironment.production;
}
