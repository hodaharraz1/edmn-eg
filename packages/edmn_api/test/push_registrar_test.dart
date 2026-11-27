import 'package:edmn_api/mobile.dart';
import 'package:flutter_test/flutter_test.dart';

/// PushTokenRegistrar (PKG-PUSH-01): the default provider has no token (no push SDK wired, no keys), so NOTHING is
/// registered; a provided token registers exactly once; empty/blank tokens register nothing.
void main() {
  test('default provider registers nothing and never calls the api', () async {
    var calls = 0;
    final r = PushTokenRegistrar(register: (t, k) async => calls++, unregister: (k) async => calls++);
    expect(await r.registerIfAvailable(() => 'idem-1'), isFalse);
    expect(calls, 0);
  });

  test('blank provider token registers nothing', () async {
    var calls = 0;
    final r = PushTokenRegistrar(register: (t, k) async => calls++, unregister: (k) async => calls++, provider: () async => '   ');
    expect(await r.registerIfAvailable(() => 'idem-1'), isFalse);
    expect(calls, 0);
  });

  test('a real token registers once with the generated idempotency key', () async {
    final seen = <(String, String)>[];
    final r = PushTokenRegistrar(register: (t, k) async => seen.add((t, k)), unregister: (k) async {}, provider: () async => 'fcm-token-abc');
    expect(await r.registerIfAvailable(() => 'idem-42'), isTrue);
    expect(seen, [('fcm-token-abc', 'idem-42')]);
  });

  test('unregister delegates with the generated idempotency key', () async {
    final seen = <String>[];
    final r = PushTokenRegistrar(register: (t, k) async {}, unregister: (k) async => seen.add(k));
    await r.remove(() => 'idem-7');
    expect(seen, ['idem-7']);
  });
}
