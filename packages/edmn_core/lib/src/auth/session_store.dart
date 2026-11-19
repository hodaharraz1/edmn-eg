import 'dart:io';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

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

/// Tells a fresh install apart from a normal launch. It must live inside the app's own sandbox, which the OS deletes
/// on uninstall. The Keychain does not: on iOS its items survive deleting the app.
abstract class InstallMarker {
  Future<bool> exists();
  Future<void> create();
}

/// A small file in the application-support directory (removed with the app on iOS and Android).
class FileInstallMarker implements InstallMarker {
  FileInstallMarker(this.name);
  final String name;
  Future<File> _file() async => File('${(await getApplicationSupportDirectory()).path}/.$name.installed');
  @override
  Future<bool> exists() async => (await _file()).exists();
  @override
  Future<void> create() async {
    final f = await _file();
    await f.parent.create(recursive: true);
    await f.writeAsString('1', flush: true);
  }
}

class SecureSessionStore implements SessionStore {
  SecureSessionStore({required String namespace, FlutterSecureStorage? storage, InstallMarker? marker})
      : _ns = namespace,
        _marker = marker ?? FileInstallMarker(namespace),
        _storage = storage ??
            const FlutterSecureStorage(
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
              aOptions: AndroidOptions(),
            );

  final String _ns;
  final FlutterSecureStorage _storage;
  final InstallMarker _marker;
  Future<void>? _fresh;

  String get _refreshKey => '$_ns.refresh_token';
  String get _installationKey => '$_ns.installation_id';

  /// First launch after (re)installing: forget credentials a previous install left in the Keychain, so a reinstalled
  /// or handed-over device never opens signed in to the old account (MASVS-STORAGE, policy SEC-122). Runs once.
  Future<void> _ensureFreshInstall() => _fresh ??= () async {
        try {
          if (await _marker.exists()) return;
          await _storage.delete(key: _refreshKey);
          await _storage.delete(key: _installationKey);
          await _marker.create();
        } catch (_) {
          // Storage unavailable (tests, web): keep the previous behaviour rather than failing the launch.
        }
      }();

  @override
  Future<String?> readRefreshToken() async {
    await _ensureFreshInstall();
    return _storage.read(key: _refreshKey);
  }

  @override
  Future<void> writeRefreshToken(String? token) async {
    await _ensureFreshInstall();
    return token == null ? _storage.delete(key: _refreshKey) : _storage.write(key: _refreshKey, value: token);
  }

  @override
  Future<String> installationId() async {
    await _ensureFreshInstall();
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
