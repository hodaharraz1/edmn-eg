/// Device push-token registration (PKG-PUSH-01). The token source is pluggable: the DEFAULT provider returns null —
/// no push SDK is wired and no FCM/APNs keys exist — so out of the box NOTHING is registered and NOTHING is sent.
/// When the owner provisions keys, the app passes the SDK's token reader as [provider] and this same code path
/// registers it. Registration is bound server-side to the session's own installation. Works with either app by
/// passing that app's typed client calls as [register]/[unregister].
library;

typedef PushTokenProvider = Future<String?> Function();
typedef PushRegisterCall = Future<void> Function(String token, String idempotencyKey);
typedef PushUnregisterCall = Future<void> Function(String idempotencyKey);

class PushTokenRegistrar {
  PushTokenRegistrar({required this.register, required this.unregister, PushTokenProvider? provider}) : _provider = provider ?? _noToken;
  final PushRegisterCall register;
  final PushUnregisterCall unregister;
  final PushTokenProvider _provider;

  static Future<String?> _noToken() async => null;

  /// Registers the provider's token, if any. Returns true when a token was registered; a null/empty token
  /// registers nothing (the default until a push SDK is wired).
  Future<bool> registerIfAvailable(String Function() newIdempotencyKey) async {
    final token = await _provider();
    if (token == null || token.trim().isEmpty) return false;
    await register(token, newIdempotencyKey());
    return true;
  }

  Future<void> remove(String Function() newIdempotencyKey) => unregister(newIdempotencyKey());
}
