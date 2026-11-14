import 'package:edmn_core/edmn_core.dart';
import 'package:flutter_test/flutter_test.dart';

class _Capture implements TelemetrySink {
  final events = <(String, Map<String, Object?>)>[];
  @override
  void record(String name, Map<String, Object?> attributes) => events.add((name, attributes));
}

void main() {
  test('credentials, delivery codes and personal data never reach a sink', () {
    final sink = _Capture();
    Telemetry([sink]).event('x', {
      'refreshToken': 'abcdefghijklmnopqrstuvwxyz',
      'deliveryCode': '123456',
      'password': 'p',
      'phone': '+201012345678',
      'note': 'my code is 482913 and mail a@b.co, token em1.aaa.bbb',
      'path': '/api/v1/me',
      'status': 401,
    });
    final attrs = sink.events.single.$2;
    expect(attrs['refreshToken'], '[redacted]');
    expect(attrs['deliveryCode'], '[redacted]');
    expect(attrs['password'], '[redacted]');
    expect(attrs['phone'], '[redacted]');
    expect(attrs['note'], isNot(contains('482913')));
    expect(attrs['note'], isNot(contains('a@b.co')));
    expect(attrs['note'], isNot(contains('em1.aaa.bbb')));
    expect(attrs['path'], '/api/v1/me');
    expect(attrs['status'], 401);
  });

  test('API error codes are kept (renamed errorCode) so failures stay diagnosable', () {
    final sink = _Capture();
    Telemetry([sink]).event('api.error', {'code': 'rate_limited'});
    expect(sink.events.single.$2['errorCode'], 'rate_limited');
  });
}
