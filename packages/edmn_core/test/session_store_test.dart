import 'package:edmn_core/edmn_core.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

class _Marker implements InstallMarker {
  _Marker(this.present);
  bool present;
  int creates = 0;
  @override
  Future<bool> exists() async => present;
  @override
  Future<void> create() async {
    creates++;
    present = true;
  }
}

/// Policy SEC-122 / Q-1: iOS keeps Keychain items after the app is deleted. A fresh install must not open signed in to
/// the previous account; a normal launch must keep the session.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('fresh install: credentials left by a previous install are forgotten, once', () async {
    FlutterSecureStorage.setMockInitialValues({'edmn.customer.refresh_token': 'old-refresh', 'edmn.customer.installation_id': 'OLDINSTALLATION0001'});
    final marker = _Marker(false);
    final store = SecureSessionStore(namespace: 'edmn.customer', marker: marker);
    expect(await store.readRefreshToken(), isNull);
    final id = await store.installationId();
    expect(id, isNot('OLDINSTALLATION0001'));
    expect(marker.creates, 1);
    // After the wipe the new session is kept normally.
    await store.writeRefreshToken('new-refresh');
    expect(await store.readRefreshToken(), 'new-refresh');
    expect(marker.creates, 1);
  });

  test('normal launch (marker present): the existing session and installation id are kept', () async {
    FlutterSecureStorage.setMockInitialValues({'edmn.admin.refresh_token': 'kept-refresh', 'edmn.admin.installation_id': 'KEPTINSTALLATION001'});
    final store = SecureSessionStore(namespace: 'edmn.admin', marker: _Marker(true));
    expect(await store.readRefreshToken(), 'kept-refresh');
    expect(await store.installationId(), 'KEPTINSTALLATION001');
  });

  test('the wipe only touches this app namespace', () async {
    FlutterSecureStorage.setMockInitialValues({'edmn.customer.refresh_token': 'c', 'edmn.admin.refresh_token': 'a'});
    final customer = SecureSessionStore(namespace: 'edmn.customer', marker: _Marker(false));
    expect(await customer.readRefreshToken(), isNull);
    final admin = SecureSessionStore(namespace: 'edmn.admin', marker: _Marker(true));
    expect(await admin.readRefreshToken(), 'a');
  });
}
