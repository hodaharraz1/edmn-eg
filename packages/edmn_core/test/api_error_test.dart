import 'package:dio/dio.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:flutter_test/flutter_test.dart';

DioException _err(int status, Object? data, {Map<String, List<String>> headers = const {}}) {
  final o = RequestOptions(path: '/x');
  return DioException(requestOptions: o, response: Response(requestOptions: o, statusCode: status, data: data, headers: Headers.fromMap(headers)));
}

void main() {
  test('every server code maps to a stable enum value (contract ErrorCode)', () {
    for (final wire in ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'conflict', 'invalid_state', 'insufficient_stock', 'insufficient_balance', 'rate_limited', 'mfa_required', 'step_up_required', 'identity_required', 'seller_required', 'idempotency_key_required', 'idempotency_key_reused', 'idempotency_in_progress', 'internal_error']) {
      expect(ApiErrorCode.fromWire(wire).wire, wire);
    }
    expect(ApiErrorCode.fromWire('brand_new_code'), ApiErrorCode.unknown);
  });

  test('problem+json → ApiFailure with issues, reference and Retry-After', () {
    final f = ApiFailure.fromDio(_err(429, {'code': 'rate_limited', 'status': 429}, headers: {'retry-after': ['7']}));
    expect(f.code, ApiErrorCode.rateLimited);
    expect(f.retryAfter, const Duration(seconds: 7));
    expect(f.isRetryable, isTrue);
    final v = ApiFailure.fromDio(_err(422, {'code': 'validation_failed', 'issues': [{'path': 'email', 'code': 'invalid_format'}]}));
    expect(v.fieldIssues.single.path, 'email');
    final i = ApiFailure.fromDio(_err(500, {'code': 'internal_error', 'reference': 'abc-123'}));
    expect(i.reference, 'abc-123');
  });

  test('no response is a network failure; non-problem bodies are unknown', () {
    expect(ApiFailure.fromDio(DioException(requestOptions: RequestOptions(path: '/'))).code, ApiErrorCode.network);
    expect(ApiFailure.fromDio(_err(502, '<html>bad gateway</html>')).code, ApiErrorCode.unknown);
  });
}
