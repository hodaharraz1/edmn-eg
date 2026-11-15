import 'dart:typed_data';

import 'package:dio/dio.dart';
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
  Future<SearchProductsResponse> searchProducts({String? q, String? categoryId, String? sort, String? condition, String? storeSlug, bool? inStock, int page = 1, int pageSize = 24}) async =>
      SearchProductsResponse.fromJson(await client.getJson(MobileApiPaths.searchProducts.path, query: {
        if (q != null && q.isNotEmpty) 'q': q,
        'categoryId': ?categoryId,
        'sort': ?sort,
        'condition': ?condition,
        'storeSlug': ?storeSlug,
        if (inStock != null) 'inStock': '$inStock',
        'page': page,
        'pageSize': pageSize,
      }));
  Future<List<ListGovernoratesResponseItemsItem>> governorates() async => ListGovernoratesResponse.fromJson(await client.getJson(MobileApiPaths.listGovernorates.path)).items;
  Future<LegalDocument> legalDocument(String slug) async => LegalDocument.fromJson(await client.getJson(fillPath(MobileApiPaths.getLegalDocument.path, {'slug': slug})));
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

  Future<SessionResult> register({required String fullName, required String phone, required String email, required String password, required DeviceInfo device}) async {
    final r = SessionResult.fromJson(await client.sendJson('POST', MobileApiPaths.register.path,
        body: RegisterRequest(fullName: fullName, email: email, phone: phone, password: password, device: device).toJson(), skipAuth: true));
    await client.adoptTokens(SessionTokens.fromJson(r.tokens.toJson()));
    return r;
  }

  /// Always answers OK (the server never reveals whether the account exists).
  Future<void> forgotPassword(String identifier) => client.sendJson('POST', MobileApiPaths.forgotPassword.path, body: {'identifier': identifier}, skipAuth: true);

  // ── Account ────────────────────────────────────────────────────────────────────────────────────────────────
  Future<Profile> updateMe({required String fullName}) async => Profile.fromJson(await client.sendJson('PATCH', MobileApiPaths.updateMe.path, body: {'fullName': fullName}));

  /// Every other device is signed out; this device receives new tokens.
  Future<void> changePassword({required String current, required String next}) async {
    final tokens = await client.sendJson('POST', MobileApiPaths.changePassword.path, body: {'current': current, 'next': next});
    await client.adoptTokens(SessionTokens.fromJson(tokens));
  }

  Future<void> sendVerificationCode(String channel) => client.sendJson('POST', MobileApiPaths.sendVerificationCode.path, body: {'channel': channel});
  Future<Profile> confirmVerificationCode(String channel, String code) async =>
      Profile.fromJson(await client.sendJson('POST', MobileApiPaths.confirmVerificationCode.path, body: {'channel': channel, 'code': code}));

  // ── Addresses ──────────────────────────────────────────────────────────────────────────────────────────────
  Future<List<Address>> addresses() async => ListAddressesResponse.fromJson(await client.getJson(MobileApiPaths.listAddresses.path)).items;
  Future<String> createAddress(CreateAddressRequest a, {required String idempotencyKey}) async =>
      CreateAddressResponse.fromJson(await client.sendJson('POST', MobileApiPaths.createAddress.path, body: a.toJson(), idempotencyKey: idempotencyKey)).id;
  Future<void> updateAddress(String id, CreateAddressRequest a) => client.sendJson('PUT', fillPath(MobileApiPaths.updateAddress.path, {'addressId': id}), body: a.toJson());
  Future<void> deleteAddress(String id, {required String idempotencyKey}) =>
      client.sendJson('DELETE', fillPath(MobileApiPaths.deleteAddress.path, {'addressId': id}), idempotencyKey: idempotencyKey);

  // ── Cart (server-priced) ───────────────────────────────────────────────────────────────────────────────────
  Future<Cart> cart({int? governorateId}) async => Cart.fromJson(await client.getJson(MobileApiPaths.getCart.path, query: {'governorateId': ?governorateId}));
  Future<int> addToCart(String variantId, int quantity, {required String idempotencyKey}) async => AddCartItemResponse.fromJson(await client
          .sendJson('POST', MobileApiPaths.addCartItem.path, body: {'variantId': variantId, 'quantity': quantity}, idempotencyKey: idempotencyKey))
      .quantity;
  Future<void> setCartQuantity(String variantId, int quantity) =>
      client.sendJson('PUT', fillPath(MobileApiPaths.setCartItemQuantity.path, {'variantId': variantId}), body: {'quantity': quantity});
  Future<void> acknowledgeCartPrices() => client.sendJson('POST', MobileApiPaths.acknowledgeCartPrices.path);

  // ── Checkout and orders ────────────────────────────────────────────────────────────────────────────────────
  Future<Checkout> checkout({String? addressId}) async => Checkout.fromJson(await client.getJson(MobileApiPaths.getCheckout.path, query: {'addressId': ?addressId}));

  /// [checkoutKey] identifies THIS checkout: retries with the same key return the same order (never a second one).
  Future<PlaceOrderResponse> placeOrder(PlaceOrderRequest r) async => PlaceOrderResponse.fromJson(await client.sendJson('POST', MobileApiPaths.placeOrder.path, body: r.toJson()));
  Future<ListOrdersResponse> orders({int page = 1}) async => ListOrdersResponse.fromJson(await client.getJson(MobileApiPaths.listOrders.path, query: {'page': page}));
  Future<Order> order(String id) async => Order.fromJson(await client.getJson(fillPath(MobileApiPaths.getOrder.path, {'orderId': id})));
  Future<void> cancelUnpaidOrder(String id, {required String idempotencyKey}) =>
      client.sendJson('POST', fillPath(MobileApiPaths.cancelUnpaidOrder.path, {'orderId': id}), idempotencyKey: idempotencyKey);
  Future<void> confirmReceipt(String sellerOrderId, {required String idempotencyKey}) =>
      client.sendJson('POST', fillPath(MobileApiPaths.confirmReceipt.path, {'sellerOrderId': sellerOrderId}), idempotencyKey: idempotencyKey);
  Future<String> requestCancellation(String sellerOrderId, String note, {required String idempotencyKey}) async => RequestCancellationResponse.fromJson(await client.sendJson(
          'POST', fillPath(MobileApiPaths.requestCancellation.path, {'sellerOrderId': sellerOrderId}),
          body: {'note': note}, idempotencyKey: idempotencyKey))
      .status;
  Future<void> reportOrderProblem(String sellerOrderId, String kind, String description, {required String idempotencyKey}) => client.sendJson(
      'POST', fillPath(MobileApiPaths.reportOrderProblem.path, {'sellerOrderId': sellerOrderId}),
      body: {'kind': kind, 'description': description}, idempotencyKey: idempotencyKey);

  // ── Manual payment ─────────────────────────────────────────────────────────────────────────────────────────
  Future<GetPaymentResponse> payment(String id) async => GetPaymentResponse.fromJson(await client.getJson(fillPath(MobileApiPaths.getPayment.path, {'paymentId': id})));

  /// Uploads the receipt (multipart). The server only QUEUES it for staff review; it never marks the payment paid.
  /// [clientKey] is this submission's idempotency key: reuse it when retrying the same upload.
  Future<void> submitPaymentProof(String paymentId,
          {required Uint8List bytes, required String fileName, required String claimedAmount, String? reference, String? payerName, required String clientKey}) =>
      client.guard((d) => d.post<dynamic>(fillPath(MobileApiPaths.submitPaymentProof.path, {'paymentId': paymentId}),
          data: FormData.fromMap({
            'claimedAmount': claimedAmount,
            if (reference != null && reference.isNotEmpty) 'reference': reference,
            if (payerName != null && payerName.isNotEmpty) 'payerName': payerName,
            'clientKey': clientKey,
            'proof': MultipartFile.fromBytes(bytes, filename: fileName),
          }),
          options: Options(contentType: 'multipart/form-data')));

  /// Private file bytes (receipts, evidence) the signed-in user may read. Never cached to disk by the client.
  Future<Uint8List> file(String fileId) => client.guard((d) async =>
      Uint8List.fromList((await d.get<List<int>>(fillPath(MobileApiPaths.getFile.path, {'fileId': fileId}), options: Options(responseType: ResponseType.bytes))).data!));

  // ── Seller Center (same app; the store is the session user's membership) ─────────────────────────────────
  Future<GetMySellerMembershipResponse> sellerMembership() async => GetMySellerMembershipResponse.fromJson(await client.getJson(MobileApiPaths.getMySellerMembership.path));
  Future<GetSellerHomeResponse> sellerHome() async => GetSellerHomeResponse.fromJson(await client.getJson(MobileApiPaths.getSellerHome.path));
  Future<ListSellerOrdersResponse> sellerOrders({String? status, int page = 1}) async =>
      ListSellerOrdersResponse.fromJson(await client.getJson(MobileApiPaths.listSellerOrders.path, query: {'status': ?status, 'page': page}));
  Future<SellerOrder> sellerOrder(String id) async => SellerOrder.fromJson(await client.getJson(fillPath(MobileApiPaths.getSellerOrder.path, {'sellerOrderId': id})));

  /// One fulfilment step; the server refuses a step that is not in the order's allowedActions.
  Future<SellerOrder> sellerOrderStep(String id, String step, {String? note, required String idempotencyKey}) async => SellerOrder.fromJson(await client.sendJson(
      'POST', fillPath(MobileApiPaths.runSellerOrderStep.path, {'sellerOrderId': id}),
      body: {'step': step, if (note != null && note.isNotEmpty) 'note': note}, idempotencyKey: idempotencyKey));

  Future<SellerOrder> saveSellerShipment(String id,
          {required String carrierName, String? trackingNumber, required DateTime shippedAt, Uint8List? waybill, String? waybillName, required String idempotencyKey}) async =>
      SellerOrder.fromJson(await client.guard((d) async => (await d.post<Map<String, dynamic>>(fillPath(MobileApiPaths.saveSellerShipment.path, {'sellerOrderId': id}),
              data: FormData.fromMap({
                'carrierName': carrierName,
                if (trackingNumber != null && trackingNumber.isNotEmpty) 'trackingNumber': trackingNumber,
                'shippedAt': shippedAt.toUtc().toIso8601String(),
                if (waybill != null) 'waybill': MultipartFile.fromBytes(waybill, filename: waybillName ?? 'waybill.jpg'),
              }),
              options: Options(contentType: 'multipart/form-data', headers: {'idempotency-key': idempotencyKey})))
          .data!));

  Future<ListSellerProductsResponse> sellerProducts({String? status, int page = 1}) async =>
      ListSellerProductsResponse.fromJson(await client.getJson(MobileApiPaths.listSellerProducts.path, query: {'status': ?status, 'page': page}));
  Future<SetSellerVariantStockResponse> setVariantStock(String variantId, int stockOnHand) async => SetSellerVariantStockResponse.fromJson(
      await client.sendJson('PUT', fillPath(MobileApiPaths.setSellerVariantStock.path, {'variantId': variantId}), body: {'stockOnHand': stockOnHand}));

  /// Read-only funds position (finance.view).
  Future<GetSellerFundsResponse> sellerFunds() async => GetSellerFundsResponse.fromJson(await client.getJson(MobileApiPaths.getSellerFunds.path));

  // ── Seller setup: identity, application, products, shipping, store, payout REQUESTS ─────────────────────────
  Future<Map<String, dynamic>> _multipart(String path, {required Map<String, String> fields, Map<String, List<(Uint8List, String)>> files = const {}, required String idempotencyKey}) =>
      client.guard((d) async {
        final form = FormData.fromMap(fields);
        for (final e in files.entries) {
          for (final (bytes, name) in e.value) {
            form.files.add(MapEntry(e.key, MultipartFile.fromBytes(bytes, filename: name)));
          }
        }
        return (await d.post<Map<String, dynamic>>(path, data: form, options: Options(contentType: 'multipart/form-data', headers: {'idempotency-key': idempotencyKey}))).data!;
      });

  Future<IdentityStatus> myIdentity() async => IdentityStatus.fromJson(await client.getJson(MobileApiPaths.getMyIdentity.path));
  Future<IdentityStatus> submitIdentity({required String legalName, required String nationalId, (Uint8List, String)? front, (Uint8List, String)? back, required String idempotencyKey}) async =>
      IdentityStatus.fromJson(await _multipart(MobileApiPaths.submitMyIdentity.path,
          fields: {'legalName': legalName, 'nationalId': nationalId}, files: {'front': [?front], 'back': [?back]}, idempotencyKey: idempotencyKey));

  Future<SellerApplication> sellerApplication() async => SellerApplication.fromJson(await client.getJson(MobileApiPaths.getSellerApplication.path));
  Future<SellerApplication> startSellerApplication(String type) async =>
      SellerApplication.fromJson(await client.sendJson('POST', MobileApiPaths.startSellerApplication.path, body: {'type': type}));
  Future<SellerApplication> saveApplicationIdentity(Map<String, dynamic> body) async =>
      SellerApplication.fromJson(await client.sendJson('PUT', MobileApiPaths.saveSellerApplicationIdentity.path, body: body));
  Future<SellerApplication> saveApplicationBusiness(Map<String, dynamic> body) async =>
      SellerApplication.fromJson(await client.sendJson('PUT', MobileApiPaths.saveSellerApplicationBusiness.path, body: body));
  Future<SellerApplication> saveApplicationStore(Map<String, String> fields, {(Uint8List, String)? logo, required String idempotencyKey}) async =>
      SellerApplication.fromJson(await _multipart(MobileApiPaths.saveSellerApplicationStore.path, fields: fields, files: {'logo': [?logo]}, idempotencyKey: idempotencyKey));
  Future<SellerApplication> uploadApplicationDocument(String kind, (Uint8List, String) file, {required String idempotencyKey}) async =>
      SellerApplication.fromJson(await _multipart(MobileApiPaths.uploadSellerApplicationDocument.path, fields: {'kind': kind}, files: {'file': [file]}, idempotencyKey: idempotencyKey));
  Future<SellerApplication> addPayoutAccount(Map<String, dynamic> body, {required String idempotencyKey}) async =>
      SellerApplication.fromJson(await client.sendJson('POST', MobileApiPaths.addSellerPayoutAccount.path, body: body, idempotencyKey: idempotencyKey));
  Future<SellerApplication> submitSellerApplication({required String idempotencyKey}) async =>
      SellerApplication.fromJson(await client.sendJson('POST', MobileApiPaths.submitSellerApplication.path, body: {'acceptAgreement': true}, idempotencyKey: idempotencyKey));

  Future<GetCategoryAttributesResponse> categoryAttributes(String categoryId) async =>
      GetCategoryAttributesResponse.fromJson(await client.getJson(fillPath(MobileApiPaths.getCategoryAttributes.path, {'categoryId': categoryId})));
  Future<SellerProductEditor> sellerProduct(String id) async => SellerProductEditor.fromJson(await client.getJson(fillPath(MobileApiPaths.getSellerProduct.path, {'productId': id})));
  Future<SellerProductEditor> createSellerProduct({required String categoryId, required String titleAr, required String condition, required String idempotencyKey}) async =>
      SellerProductEditor.fromJson(await client.sendJson('POST', MobileApiPaths.createSellerProduct.path,
          body: {'categoryId': categoryId, 'titleAr': titleAr, 'condition': condition}, idempotencyKey: idempotencyKey));
  Future<SellerProductEditor> saveProductDetails(String id, Map<String, dynamic> body) async =>
      SellerProductEditor.fromJson(await client.sendJson('PUT', fillPath(MobileApiPaths.saveSellerProductDetails.path, {'productId': id}), body: body));
  Future<SellerProductEditor> saveProductLogistics(String id, Map<String, dynamic> body) async =>
      SellerProductEditor.fromJson(await client.sendJson('PUT', fillPath(MobileApiPaths.saveSellerProductLogistics.path, {'productId': id}), body: body));
  Future<SellerProductEditor> addProductImages(String id, List<(Uint8List, String)> images, {bool actualItem = false, required String idempotencyKey}) async =>
      SellerProductEditor.fromJson(await _multipart(fillPath(MobileApiPaths.addSellerProductImages.path, {'productId': id}),
          fields: {'isActualItem': '$actualItem'}, files: {'images': images}, idempotencyKey: idempotencyKey));
  Future<SellerProductEditor> deleteProductImage(String id, String fileId, {required String idempotencyKey}) async => SellerProductEditor.fromJson(await client
      .sendJson('DELETE', fillPath(MobileApiPaths.deleteSellerProductImage.path, {'productId': id, 'fileId': fileId}), idempotencyKey: idempotencyKey));
  Future<SellerProductEditor> saveProductVariants(String id, List<Map<String, dynamic>> variants) async =>
      SellerProductEditor.fromJson(await client.sendJson('PUT', fillPath(MobileApiPaths.saveSellerProductVariants.path, {'productId': id}), body: {'variants': variants}));
  Future<SellerProductEditor> submitProduct(String id, {required String idempotencyKey}) async =>
      SellerProductEditor.fromJson(await client.sendJson('POST', fillPath(MobileApiPaths.submitSellerProduct.path, {'productId': id}), idempotencyKey: idempotencyKey));
  Future<SellerProductEditor> setProductListed(String id, bool listed, {required String idempotencyKey}) async => SellerProductEditor.fromJson(
      await client.sendJson('POST', fillPath(MobileApiPaths.setSellerProductVisibility.path, {'productId': id}), body: {'listed': listed}, idempotencyKey: idempotencyKey));

  Future<GetSellerShippingRatesResponse> shippingRates() async => GetSellerShippingRatesResponse.fromJson(await client.getJson(MobileApiPaths.getSellerShippingRates.path));
  Future<GetSellerShippingRatesResponse> saveShippingRates(List<Map<String, dynamic>> items) async =>
      GetSellerShippingRatesResponse.fromJson(await client.sendJson('PUT', MobileApiPaths.saveSellerShippingRates.path, body: {'items': items}));
  Future<SellerStoreSettings> storeSettings() async => SellerStoreSettings.fromJson(await client.getJson(MobileApiPaths.getSellerStoreSettings.path));
  Future<SellerStoreSettings> saveStoreSettings(Map<String, dynamic> body) async =>
      SellerStoreSettings.fromJson(await client.sendJson('PUT', MobileApiPaths.saveSellerStoreSettings.path, body: body));

  /// Payout REQUESTS only — EDMN staff review (two people) and transfer; the app never moves money.
  Future<ListSellerPayoutRequestsResponse> payoutRequests() async => ListSellerPayoutRequestsResponse.fromJson(await client.getJson(MobileApiPaths.listSellerPayoutRequests.path));
  Future<PreviewSellerPayoutRequestResponse> previewPayout(int amountPiastres) async =>
      PreviewSellerPayoutRequestResponse.fromJson(await client.sendJson('POST', MobileApiPaths.previewSellerPayoutRequest.path, body: {'amountPiastres': amountPiastres}));
  Future<CreateSellerPayoutRequestResponse> requestPayout(int amountPiastres, {required String clientKey}) async => CreateSellerPayoutRequestResponse.fromJson(
      await client.sendJson('POST', MobileApiPaths.createSellerPayoutRequest.path, body: {'amountPiastres': amountPiastres, 'clientKey': clientKey}));
  Future<ListSellerPayoutRequestsResponse> cancelPayoutRequest(String id, {required String idempotencyKey}) async => ListSellerPayoutRequestsResponse.fromJson(
      await client.sendJson('POST', fillPath(MobileApiPaths.cancelSellerPayoutRequest.path, {'requestId': id}), idempotencyKey: idempotencyKey));
}
