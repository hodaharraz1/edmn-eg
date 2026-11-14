import 'package:dio/dio.dart';
import 'package:edmn_core/edmn_core.dart';

/// Small helpers shared by the generated-model clients.
extension ApiCalls on ApiClient {
  Future<Map<String, dynamic>> getJson(String path, {Map<String, dynamic>? query}) =>
      guard((d) async => (await d.get<Map<String, dynamic>>(path, queryParameters: query)).data!);

  Future<Map<String, dynamic>> sendJson(String method, String path, {Object? body, String? idempotencyKey, bool skipAuth = false}) => guard((d) async {
        final res = await d.request<Map<String, dynamic>>(path,
            data: body ?? <String, dynamic>{},
            options: Options(method: method, headers: {'idempotency-key': ?idempotencyKey}, extra: {if (skipAuth) 'skipAuth': true}));
        return res.data!;
      });
}

/// Fills an OpenAPI path template (`/x/{id}`) with URL-encoded values.
String fillPath(String template, Map<String, String> params) =>
    template.replaceAllMapped(RegExp(r'\{(\w+)\}'), (m) => Uri.encodeComponent(params[m[1]]!));
