import 'package:dio/dio.dart';

/// Stable error codes of the EDMN mobile API (`components.schemas.ErrorCode` in openapi/*.json). The apps localize
/// by code — never by parsing the server's Arabic `detail` — so wording can change without an app release.
enum ApiErrorCode {
  validationFailed('validation_failed'),
  unauthenticated('unauthenticated'),
  forbidden('forbidden'),
  notFound('not_found'),
  conflict('conflict'),
  invalidState('invalid_state'),
  insufficientStock('insufficient_stock'),
  insufficientBalance('insufficient_balance'),
  rateLimited('rate_limited'),
  mfaRequired('mfa_required'),
  stepUpRequired('step_up_required'),
  identityRequired('identity_required'),
  sellerRequired('seller_required'),
  idempotencyKeyRequired('idempotency_key_required'),
  idempotencyKeyReused('idempotency_key_reused'),
  idempotencyInProgress('idempotency_in_progress'),
  internalError('internal_error'),

  /// Client-side: no connection, timeout or TLS failure (never sent by the server).
  network('network'),

  /// Client-side: a response that is not a valid problem document, or a code this build does not know yet.
  unknown('unknown');

  const ApiErrorCode(this.wire);
  final String wire;

  static ApiErrorCode fromWire(String? value) => ApiErrorCode.values.firstWhere((c) => c.wire == value, orElse: () => ApiErrorCode.unknown);
}

/// A failed API call, mapped once in the HTTP layer. UI code switches on [code]; [reference] is shown to the user for
/// support on internal errors; [detail] is a server-side fallback text only.
class ApiFailure implements Exception {
  const ApiFailure({required this.code, this.status, this.detail, this.reference, this.retryAfter, this.fieldIssues = const []});

  final ApiErrorCode code;
  final int? status;
  final String? detail;
  final String? reference;
  final Duration? retryAfter;
  final List<({String path, String code})> fieldIssues;

  bool get isRetryable => code == ApiErrorCode.network || code == ApiErrorCode.rateLimited || code == ApiErrorCode.idempotencyInProgress || (status ?? 0) >= 500;

  static ApiFailure fromDio(DioException e) {
    final res = e.response;
    if (res == null) return const ApiFailure(code: ApiErrorCode.network);
    final data = res.data;
    final retry = int.tryParse(res.headers.value('retry-after') ?? '');
    if (data is Map && data['code'] is String) {
      final issues = <({String path, String code})>[
        for (final i in (data['issues'] as List? ?? const []))
          if (i is Map) (path: '${i['path']}', code: '${i['code']}'),
      ];
      return ApiFailure(
        code: ApiErrorCode.fromWire(data['code'] as String),
        status: res.statusCode,
        detail: data['detail'] as String?,
        reference: data['reference'] as String?,
        retryAfter: retry == null ? null : Duration(seconds: retry),
        fieldIssues: issues,
      );
    }
    return ApiFailure(code: ApiErrorCode.unknown, status: res.statusCode, retryAfter: retry == null ? null : Duration(seconds: retry));
  }

  @override
  String toString() => 'ApiFailure(${code.wire}, status: $status, ref: $reference)';
}
