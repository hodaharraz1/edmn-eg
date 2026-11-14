import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:flutter_test/flutter_test.dart';

/// Scripted server: /me returns 401 until a refresh happened; refresh rotates tokens.
class _FakeServer implements HttpClientAdapter {
  int refreshCalls = 0;
  int meCalls = 0;
  bool refuseRefresh = false;
  final seenHeaders = <Map<String, dynamic>>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    seenHeaders.add(Map.of(o.headers));
    ResponseBody json(int status, Object body) =>
        ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: ['application/json']});
    if (o.path.endsWith('/token/refresh')) {
      refreshCalls++;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      if (refuseRefresh) return json(401, {'code': 'unauthenticated', 'status': 401});
      return json(200, {'accessToken': 'em1.new.sig', 'accessTokenExpiresAt': DateTime.now().add(const Duration(minutes: 10)).toIso8601String(), 'refreshToken': 'rotated-$refreshCalls', 'sessionExpiresAt': '2030-01-01T00:00:00Z'});
    }
    meCalls++;
    if (o.headers['authorization'] != 'Bearer em1.new.sig') return json(401, {'code': 'unauthenticated', 'status': 401});
    return json(200, {'ok': true});
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _client(_FakeServer server, MemorySessionStore store) => ApiClient(
      config: BuildConfig(environment: AppEnvironment.local, apiBaseUrl: 'http://localhost', appVersion: '1.0.0'),
      store: store,
      refreshPath: '/api/v1/auth/token/refresh',
      telemetry: Telemetry([]),
      adapter: server,
    );

void main() {
  test('a 401 triggers ONE refresh for concurrent requests, rotates the refresh token and retries', () async {
    final server = _FakeServer();
    final store = MemorySessionStore(refreshToken: 'original');
    final c = _client(server, store);
    await c.adoptTokens(SessionTokens(accessToken: 'em1.old.sig', accessTokenExpiresAt: DateTime.now().add(const Duration(minutes: 5)), refreshToken: 'original'));
    final results = await Future.wait([c.dio.get<dynamic>('/api/v1/me'), c.dio.get<dynamic>('/api/v1/me'), c.dio.get<dynamic>('/api/v1/me')]);
    expect(results.every((r) => r.statusCode == 200), isTrue);
    expect(server.refreshCalls, 1);
    expect(store.refreshToken, 'rotated-1');
    expect(server.seenHeaders.every((h) => h['x-edmn-installation'] == 'test-installation-0001'), isTrue);
  });

  test('a refused refresh ends the session (tokens wiped, callback fired) and surfaces unauthenticated', () async {
    final server = _FakeServer()..refuseRefresh = true;
    final store = MemorySessionStore(refreshToken: 'stolen-or-revoked');
    final c = _client(server, store);
    var ended = false;
    c.onSessionEnded = () => ended = true;
    await c.adoptTokens(SessionTokens(accessToken: 'em1.old.sig', accessTokenExpiresAt: DateTime.now().add(const Duration(minutes: 5)), refreshToken: 'stolen-or-revoked'));
    ApiFailure? f;
    try {
      await c.guard((d) => d.get<dynamic>('/api/v1/me'));
    } on ApiFailure catch (e) {
      f = e;
    }
    expect(f?.code, ApiErrorCode.unauthenticated);
    expect(ended, isTrue);
    expect(store.refreshToken, isNull);
    expect(c.hasSession, isFalse);
  });

  test('hosted builds refuse plain HTTP', () {
    expect(() => BuildConfig(environment: AppEnvironment.production, apiBaseUrl: 'http://edmneg.com', appVersion: '1.0.0'), throwsStateError);
    expect(BuildConfig(environment: AppEnvironment.staging, apiBaseUrl: 'https://staging.edmneg.com', appVersion: '1.0.0').isProduction, isFalse);
  });

  test('idempotency keys are 32 url-safe characters and unique', () {
    final keys = {for (var i = 0; i < 200; i++) newIdempotencyKey()};
    expect(keys.length, 200);
    expect(keys.every((k) => RegExp(r'^[A-Za-z0-9_-]{32}$').hasMatch(k)), isTrue);
  });
}
