import 'dart:async';

import 'package:dio/dio.dart';

import '../auth/session_store.dart';
import '../config/app_environment.dart';
import '../observability/telemetry.dart';
import 'api_error.dart';

/// Tokens as returned by login / register / refresh (`SessionTokens` in the contract).
class SessionTokens {
  const SessionTokens({required this.accessToken, required this.accessTokenExpiresAt, required this.refreshToken});
  final String accessToken;
  final DateTime accessTokenExpiresAt;
  final String refreshToken;

  factory SessionTokens.fromJson(Map<String, dynamic> j) =>
      SessionTokens(accessToken: j['accessToken'] as String, accessTokenExpiresAt: DateTime.parse(j['accessTokenExpiresAt'] as String), refreshToken: j['refreshToken'] as String);
}

/// HTTP client for one app audience (Customer or Admin). Adds the installation header, request ids and the current
/// language; attaches the in-memory access token; on 401 performs ONE single-flight refresh (rotating the refresh token)
/// and retries the request once. A failed refresh clears the session and notifies [onSessionEnded].
class ApiClient {
  ApiClient({
    required BuildConfig config,
    required this.store,
    required this.refreshPath,
    required this.telemetry,
    this.languageCode = 'ar',
    HttpClientAdapter? adapter,
  }) : dio = Dio(BaseOptions(
          baseUrl: config.apiBaseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 20),
          sendTimeout: const Duration(seconds: 20),
          responseType: ResponseType.json,
          contentType: Headers.jsonContentType,
        )) {
    if (adapter != null) dio.httpClientAdapter = adapter;
    dio.interceptors.add(InterceptorsWrapper(onRequest: _onRequest, onError: _onError));
  }

  final Dio dio;
  final SessionStore store;

  /// `/api/v1/auth/token/refresh` (customer) or `/api/v1/admin/auth/token/refresh` (admin): a token from one app is
  /// never accepted by the other.
  final String refreshPath;
  final Telemetry telemetry;
  String languageCode;

  String? _accessToken;
  DateTime? _accessExpiresAt;
  Future<bool>? _refreshing;
  void Function()? onSessionEnded;

  bool get hasSession => _accessToken != null;

  Future<void> adoptTokens(SessionTokens t) async {
    _accessToken = t.accessToken;
    _accessExpiresAt = t.accessTokenExpiresAt;
    await store.writeRefreshToken(t.refreshToken);
  }

  Future<void> clearSession() async {
    _accessToken = null;
    _accessExpiresAt = null;
    await store.writeRefreshToken(null);
  }

  Future<void> _onRequest(RequestOptions o, RequestInterceptorHandler h) async {
    o.headers['x-edmn-installation'] = await store.installationId();
    o.headers['accept-language'] = languageCode;
    o.headers['x-request-id'] ??= _requestId();
    final skipAuth = o.extra['skipAuth'] == true;
    if (!skipAuth) {
      if (_accessToken != null && _accessExpiresAt != null && _accessExpiresAt!.isBefore(DateTime.now().add(const Duration(seconds: 30)))) {
        await refresh();
      }
      if (_accessToken != null) o.headers['authorization'] = 'Bearer $_accessToken';
    }
    h.next(o);
  }

  Future<void> _onError(DioException e, ErrorInterceptorHandler h) async {
    final o = e.requestOptions;
    final unauthorized = e.response?.statusCode == 401 && e.response?.data is Map && (e.response!.data as Map)['code'] == 'unauthenticated';
    if (unauthorized && o.extra['skipAuth'] != true && o.extra['retried'] != true && await refresh()) {
      o.extra['retried'] = true;
      o.headers['authorization'] = 'Bearer $_accessToken';
      try {
        return h.resolve(await dio.fetch<dynamic>(o));
      } on DioException catch (retryError) {
        return h.next(retryError);
      }
    }
    telemetry.event('api.error', {'path': o.path, 'status': e.response?.statusCode, 'code': (e.response?.data is Map) ? (e.response!.data as Map)['code'] : 'network'});
    h.next(e);
  }

  /// Single-flight refresh. Returns false (and ends the session) when the refresh token is missing or refused.
  Future<bool> refresh() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    final rt = await store.readRefreshToken();
    if (rt == null) return false;
    try {
      final res = await dio.post<Map<String, dynamic>>(refreshPath,
          data: {'refreshToken': rt, 'installationId': await store.installationId()}, options: Options(extra: {'skipAuth': true}));
      await adoptTokens(SessionTokens.fromJson(res.data!));
      return true;
    } on DioException catch (e) {
      // Only a definitive refusal ends the session; a network error keeps it for the next attempt.
      if (e.response?.statusCode == 401) {
        await clearSession();
        onSessionEnded?.call();
      }
      return false;
    }
  }

  /// Runs [call] and maps every failure to an [ApiFailure] with a stable code.
  Future<T> guard<T>(Future<T> Function(Dio dio) call) async {
    try {
      return await call(dio);
    } on DioException catch (e) {
      throw ApiFailure.fromDio(e);
    }
  }

  static int _seq = 0;
  static String _requestId() => 'm${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}${(_seq++).toRadixString(36)}';
}
