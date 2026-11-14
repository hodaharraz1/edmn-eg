import 'package:edmn_core/edmn_core.dart';

import 'generated/mobile_api.dart';
import 'http.dart';

/// Typed calls for the Customer App. Paths come from the generated contract; every failure surfaces as [ApiFailure].
class MobileApi {
  MobileApi(this.client);
  final ApiClient client;

  // ── Public, read-only ───────────────────────────────────────────────────────────────────────────────────────
  Future<AppConfig> appConfig() async => AppConfig.fromJson(await client.getJson(MobileApiPaths.getAppConfig.path));
  Future<ListCategoriesResponse> categories() async => ListCategoriesResponse.fromJson(await client.getJson(MobileApiPaths.listCategories.path));
  Future<SearchProductsResponse> searchProducts({String? q, String? categoryId, String? sort, int page = 1, int pageSize = 24}) async =>
      SearchProductsResponse.fromJson(await client.getJson(MobileApiPaths.searchProducts.path,
          query: {if (q != null && q.isNotEmpty) 'q': q, 'categoryId': ?categoryId, 'sort': ?sort, 'page': page, 'pageSize': pageSize}));
  Future<ProductDetail> product(String slug) async => ProductDetail.fromJson(await client.getJson(fillPath(MobileApiPaths.getProduct.path, {'slug': slug})));
  Future<ListProductReviewsResponse> productReviews(String slug) async =>
      ListProductReviewsResponse.fromJson(await client.getJson(fillPath(MobileApiPaths.listProductReviews.path, {'slug': slug})));
  Future<Store> store(String slug) async => Store.fromJson(await client.getJson(fillPath(MobileApiPaths.getStore.path, {'slug': slug})));

  // ── Auth (credential responses are adopted by the client; never cached or logged) ──────────────────────────
  Future<SessionResult> login({required String identifier, required String password, required DeviceInfo device}) async {
    final r = SessionResult.fromJson(
        await client.sendJson('POST', MobileApiPaths.login.path, body: LoginRequest(identifier: identifier, password: password, device: device).toJson(), skipAuth: true));
    await client.adoptTokens(SessionTokens.fromJson(r.tokens.toJson()));
    return r;
  }

  Future<void> logout() async {
    try {
      await client.sendJson('POST', MobileApiPaths.logout.path);
    } finally {
      await client.clearSession();
    }
  }

  Future<Profile> me() async => Profile.fromJson(await client.getJson(MobileApiPaths.getMe.path));
  Future<ListMySessionsResponse> mySessions() async => ListMySessionsResponse.fromJson(await client.getJson(MobileApiPaths.listMySessions.path));
  Future<void> revokeSession(String sessionId, {required String idempotencyKey}) =>
      client.sendJson('DELETE', fillPath(MobileApiPaths.revokeMySession.path, {'sessionId': sessionId}), idempotencyKey: idempotencyKey);
  Future<int> revokeOtherSessions({required String idempotencyKey}) async =>
      RevokeMyOtherSessionsResponse.fromJson(await client.sendJson('POST', MobileApiPaths.revokeMyOtherSessions.path, idempotencyKey: idempotencyKey)).revoked;
}
