import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where credentials live on the device.
///
/// * refresh token + installation id → Keychain (iOS, first-unlock-this-device-only) / Android Keystore-backed storage.
/// * access token → memory only (10-minute lifetime; never persisted).
/// Nothing here is ever logged; telemetry redacts these keys by name as a second line of defence.
abstract class SessionStore {
  Future<String?> readRefreshToken();
  Future<void> writeRefreshToken(String? token);
  Future<String> installationId();
}

class SecureSessionStore implements SessionStore {
  SecureSessionStore({required String namespace, FlutterSecureStorage? storage})
      : _ns = namespace,
        _storage = storage ??
            const FlutterSecureStorage(
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
              aOptions: AndroidOptions(),
            );

  final String _ns;
  final FlutterSecureStorage _storage;

  String get _refreshKey => '$_ns.refresh_token';
  String get _installationKey => '$_ns.installation_id';

  @override
  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  @override
  Future<void> writeRefreshToken(String? token) => token == null ? _storage.delete(key: _refreshKey) : _storage.write(key: _refreshKey, value: token);

  @override
  Future<String> installationId() async {
    final existing = await _storage.read(key: _installationKey);
    if (existing != null && RegExp(r'^[A-Za-z0-9_-]{16,128}$').hasMatch(existing)) return existing;
    final r = Random.secure();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    final id = List.generate(32, (_) => alphabet[r.nextInt(alphabet.length)]).join();
    await _storage.write(key: _installationKey, value: id);
    return id;
  }
}

/// In-memory store for tests and previews.
class MemorySessionStore implements SessionStore {
  MemorySessionStore({this.refreshToken, String? installation}) : _installation = installation ?? 'test-installation-0001';
  String? refreshToken;
  final String _installation;

  @override
  Future<String?> readRefreshToken() async => refreshToken;

  @override
  Future<void> writeRefreshToken(String? token) async => refreshToken = token;

  @override
  Future<String> installationId() async => _installation;
}
