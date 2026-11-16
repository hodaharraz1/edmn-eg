import 'dart:convert';
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
  /// Help / FAQ page authored in the admin CMS (404 when not published).
  Future<GetContentPageResponse> contentPage(String slug) async =>
      GetContentPageResponse.fromJson(await client.getJson(fillPath(MobileApiPaths.getContentPage.path, {'slug': slug})));
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
  Future<Map<String, dynamic>> _multipart(String path, {required Map<String, String> fields, Map<String, List<(Uint8List, String)>> files = const {}, required String? idempotencyKey}) =>
      client.guard((d) async {
        final form = FormData.fromMap(fields);
        for (final e in files.entries) {
          for (final (bytes, name) in e.value) {
            form.files.add(MapEntry(e.key, MultipartFile.fromBytes(bytes, filename: name)));
          }
        }
        return (await d.post<Map<String, dynamic>>(path, data: form, options: Options(contentType: 'multipart/form-data', headers: {'idempotency-key': ?idempotencyKey}))).data!;
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

  // ── Protected Deal (أضمن صفقة) ───────────────────────────────────────────────────────────────────────────────
  String _deal(String p, String id) => fillPath(p, {'dealId': id});
  Future<ListDealsResponse> deals() async => ListDealsResponse.fromJson(await client.getJson(MobileApiPaths.listDeals.path));
  Future<ProtectedDeal> deal(String id) async => ProtectedDeal.fromJson(await client.getJson(_deal(MobileApiPaths.getDeal.path, id)));
  Future<ProtectedDeal> createDeal(Map<String, dynamic> step1, {required String idempotencyKey}) async =>
      ProtectedDeal.fromJson(await client.sendJson('POST', MobileApiPaths.createDeal.path, body: step1, idempotencyKey: idempotencyKey));
  Future<ProtectedDeal> saveDealStep(String id, int step, Map<String, dynamic> body) async =>
      ProtectedDeal.fromJson(await client.sendJson('PUT', fillPath(MobileApiPaths.saveDealStep.path, {'dealId': id, 'step': '$step'}), body: body));
  Future<ProtectedDeal> addDealPhotos(String id, List<(Uint8List, String)> photos, {required String idempotencyKey}) async =>
      ProtectedDeal.fromJson(await _multipart(_deal(MobileApiPaths.addDealPhotos.path, id), fields: {}, files: {'photos': photos}, idempotencyKey: idempotencyKey));
  /// Returns the bearer invitation link (share it; never log it).
  Future<InviteDealSellerResponse> inviteDealSeller(String id) async =>
      InviteDealSellerResponse.fromJson(await client.sendJson('POST', _deal(MobileApiPaths.inviteDealSeller.path, id), body: {'acceptTerms': true}));
  Future<RefreshDealInvitationResponse> refreshDealInvitation(String id) async =>
      RefreshDealInvitationResponse.fromJson(await client.sendJson('POST', _deal(MobileApiPaths.refreshDealInvitation.path, id)));
  Future<ProtectedDeal> revokeDealInvitation(String id, {required String idempotencyKey}) async =>
      ProtectedDeal.fromJson(await client.sendJson('POST', _deal(MobileApiPaths.revokeDealInvitation.path, id), idempotencyKey: idempotencyKey));
  Future<ProtectedDeal> claimDealInvitation(String token) async =>
      ProtectedDeal.fromJson(await client.sendJson('POST', MobileApiPaths.claimDealInvitation.path, body: {'token': token}));
  Future<void> declineDeal(String id, String reason, {required String idempotencyKey}) =>
      client.sendJson('POST', _deal(MobileApiPaths.declineDealInvitation.path, id), body: {'reason': reason}, idempotencyKey: idempotencyKey);
  Future<ProtectedDeal> submitDealOffer(String id, Map<String, dynamic> body, {required String idempotencyKey}) async =>
      ProtectedDeal.fromJson(await client.sendJson('POST', _deal(MobileApiPaths.submitDealOffer.path, id), body: {...body, 'acceptTerms': true}, idempotencyKey: idempotencyKey));
  Future<ProtectedDeal> respondDealOffer(String id, int version, String decision, {Map<String, dynamic>? change, required String idempotencyKey}) async => ProtectedDeal.fromJson(
      await client.sendJson('POST', _deal(MobileApiPaths.respondDealOffer.path, id), body: {'version': version, 'decision': decision, 'change': ?change}, idempotencyKey: idempotencyKey));
  Future<ProtectedDeal> respondDealChange(String id, int version, String decision, {required String idempotencyKey}) async => ProtectedDeal.fromJson(
      await client.sendJson('POST', _deal(MobileApiPaths.respondDealChangeRequest.path, id), body: {'version': version, 'decision': decision}, idempotencyKey: idempotencyKey));
  Future<ProtectedDeal> cancelDeal(String id, String reason, {required String idempotencyKey}) async =>
      ProtectedDeal.fromJson(await client.sendJson('POST', _deal(MobileApiPaths.cancelDeal.path, id), body: {'reason': reason}, idempotencyKey: idempotencyKey));
  Future<StartDealPaymentResponse> startDealPayment(String id, String method, {required String idempotencyKey}) async => StartDealPaymentResponse.fromJson(
      await client.sendJson('POST', _deal(MobileApiPaths.startDealPayment.path, id), body: {'method': method}, idempotencyKey: idempotencyKey));
  Future<ProtectedDeal> markDealShipped(String id, String note, List<(Uint8List, String)> proof, {required String idempotencyKey}) async =>
      ProtectedDeal.fromJson(await _multipart(_deal(MobileApiPaths.markDealShipped.path, id), fields: {'note': note}, files: {'proof': proof}, idempotencyKey: idempotencyKey));
  Future<GetDealDeliveryCodeResponse> dealDeliveryCode(String id) async => GetDealDeliveryCodeResponse.fromJson(await client.getJson(_deal(MobileApiPaths.getDealDeliveryCode.path, id)));
  Future<ProtectedDeal> regenerateDealDeliveryCode(String id, {required String idempotencyKey}) async =>
      ProtectedDeal.fromJson(await client.sendJson('POST', _deal(MobileApiPaths.regenerateDealDeliveryCode.path, id), idempotencyKey: idempotencyKey));
  Future<ProtectedDeal> verifyDealDeliveryCode(String id, String code) async =>
      ProtectedDeal.fromJson(await client.sendJson('POST', _deal(MobileApiPaths.verifyDealDeliveryCode.path, id), body: {'code': code}));
  Future<ProtectedDeal> confirmDealReceipt(String id, {required String idempotencyKey}) async =>
      ProtectedDeal.fromJson(await client.sendJson('POST', _deal(MobileApiPaths.confirmDealReceipt.path, id), idempotencyKey: idempotencyKey));
  Future<ProtectedDeal> reportDealNotReceived(String id, String description, {required String idempotencyKey}) async => ProtectedDeal.fromJson(
      await client.sendJson('POST', _deal(MobileApiPaths.reportDealNotReceived.path, id), body: {'description': description}, idempotencyKey: idempotencyKey));

  // ── Messaging (buyer ↔ store, deal parties) and support ─────────────────────────────────────────────────────────
  // `store: true` uses the store-side routes (session user's store membership with orders.communicate).
  String _cv(bool store, String p) => store ? p.replaceFirst('/api/v1/conversations', '/api/v1/seller/conversations') : p;
  Future<ListConversationsResponse> conversations({bool store = false, String? filter, String? q}) async => ListConversationsResponse.fromJson(
      await client.getJson(_cv(store, MobileApiPaths.listConversations.path), query: {'filter': ?filter, if (q != null && q.isNotEmpty) 'q': q}));
  Future<int> unreadMessages({bool store = false}) async =>
      GetUnreadMessagesResponse.fromJson(await client.getJson(_cv(store, MobileApiPaths.getUnreadMessages.path))).unread;
  Future<GetConversationResponse> conversation(String id, {bool store = false}) async =>
      GetConversationResponse.fromJson(await client.getJson(_cv(store, fillPath(MobileApiPaths.getConversation.path, {'conversationId': id}))));
  /// [clientKey] is reused when the same message is retried: the server then returns the original, never a duplicate.
  Future<SendMessageResponse> sendMessage(String id, String body, String clientKey, {List<(Uint8List, String)> attachments = const [], bool store = false}) async =>
      SendMessageResponse.fromJson(await _multipart(_cv(store, fillPath(MobileApiPaths.sendMessage.path, {'conversationId': id})),
          fields: {'body': body, 'clientKey': clientKey}, files: {'attachments': attachments}, idempotencyKey: null));
  /// Only this marks messages read: call it with the newest message that was actually on screen.
  Future<int> markConversationSeen(String id, {String? upToMessageId, bool store = false}) async => MarkConversationSeenResponse.fromJson(await client.sendJson(
          'POST', _cv(store, fillPath(MobileApiPaths.markConversationSeen.path, {'conversationId': id})), body: {'upToMessageId': ?upToMessageId}))
      .unread;
  Future<void> reportMessage(String messageId, String reason, {String? note, bool store = false}) async => client.sendJson(
      'POST', _cv(store, fillPath(MobileApiPaths.reportMessage.path, {'messageId': messageId})), body: {'reason': reason, if (note != null && note.isNotEmpty) 'note': note});
  Future<String> openOrderConversation(String sellerOrderId, {bool store = false}) async => OpenOrderConversationResponse.fromJson(await client.sendJson('POST',
          fillPath(store ? MobileApiPaths.openStoreOrderConversation.path : MobileApiPaths.openOrderConversation.path, {'sellerOrderId': sellerOrderId})))
      .conversationId;
  Future<String> openDealConversation(String dealId) async =>
      OpenOrderConversationResponse.fromJson(await client.sendJson('POST', _deal(MobileApiPaths.openDealConversation.path, dealId))).conversationId;

  Future<ListSupportTicketsResponse> supportTickets() async => ListSupportTicketsResponse.fromJson(await client.getJson(MobileApiPaths.listSupportTickets.path));
  Future<GetSupportTicketResponse> supportTicket(String id) async =>
      GetSupportTicketResponse.fromJson(await client.getJson(fillPath(MobileApiPaths.getSupportTicket.path, {'ticketId': id})));
  Future<GetSupportTicketResponse> openSupportTicket(Map<String, String> fields, {(Uint8List, String)? attachment, required String idempotencyKey}) async =>
      GetSupportTicketResponse.fromJson(await _multipart(MobileApiPaths.openSupportTicket.path, fields: fields, files: {'attachment': [?attachment]}, idempotencyKey: idempotencyKey));
  Future<GetSupportTicketResponse> replySupportTicket(String id, String body, {(Uint8List, String)? attachment, required String idempotencyKey}) async =>
      GetSupportTicketResponse.fromJson(await _multipart(fillPath(MobileApiPaths.replySupportTicket.path, {'ticketId': id}),
          fields: {'body': body}, files: {'attachment': [?attachment]}, idempotencyKey: idempotencyKey));
  Future<GetSupportTicketResponse> reopenSupportTicket(String id, String reason, {required String idempotencyKey}) async => GetSupportTicketResponse.fromJson(
      await client.sendJson('POST', fillPath(MobileApiPaths.reopenSupportTicket.path, {'ticketId': id}), body: {'reason': reason}, idempotencyKey: idempotencyKey));
  Future<GetSupportTicketResponse> rateSupportTicket(String id, int rating, {String? comment, required String idempotencyKey}) async => GetSupportTicketResponse.fromJson(
      await client.sendJson('POST', fillPath(MobileApiPaths.rateSupportTicket.path, {'ticketId': id}),
          body: {'rating': rating, if (comment != null && comment.isNotEmpty) 'comment': comment}, idempotencyKey: idempotencyKey));

  // ── Wallet: earnings, activity, payout REQUESTS, receiving accounts; store statement ──────────────────────────
  // Every amount is computed by the server from the ledger. A payout request moves nothing; EDMN approves, reserves
  // and transfers in the admin console.
  Future<GetWalletResponse> wallet() async => GetWalletResponse.fromJson(await client.getJson(MobileApiPaths.getWallet.path));
  Future<ListWalletActivityResponse> walletActivity({String? kind, String? q, int page = 1}) async => ListWalletActivityResponse.fromJson(
      await client.getJson(MobileApiPaths.listWalletActivity.path, query: {'kind': ?kind, if (q != null && q.isNotEmpty) 'q': q, 'page': page}));
  Future<GetWalletActivityResponse> walletActivityDetail(String id) async => GetWalletActivityResponse.fromJson(
      await client.getJson(fillPath(MobileApiPaths.getWalletActivity.path, {'activityId': id})));
  Future<ListAccountPayoutRequestsResponse> accountPayoutRequests() async =>
      ListAccountPayoutRequestsResponse.fromJson(await client.getJson(MobileApiPaths.listAccountPayoutRequests.path));
  Future<PreviewAccountPayoutRequestResponse> previewAccountPayout(int amountPiastres, String destination) async => PreviewAccountPayoutRequestResponse.fromJson(
      await client.sendJson('POST', MobileApiPaths.previewAccountPayoutRequest.path, body: {'amountPiastres': amountPiastres, 'destination': destination}));
  /// [clientKey] identifies this one request: a retry with the same key returns the original (created=false).
  Future<CreateAccountPayoutRequestResponse> requestAccountPayout(int amountPiastres, String destination, String clientKey) async =>
      CreateAccountPayoutRequestResponse.fromJson(await client.sendJson('POST', MobileApiPaths.createAccountPayoutRequest.path,
          body: {'amountPiastres': amountPiastres, 'destination': destination, 'clientKey': clientKey}));
  Future<CancelAccountPayoutRequestResponse> cancelAccountPayout(String id, {required String idempotencyKey}) async => CancelAccountPayoutRequestResponse.fromJson(
      await client.sendJson('POST', fillPath(MobileApiPaths.cancelAccountPayoutRequest.path, {'requestId': id}), idempotencyKey: idempotencyKey));
  Future<ListReceivingAccountsResponse> receivingAccounts() async => ListReceivingAccountsResponse.fromJson(await client.getJson(MobileApiPaths.listReceivingAccounts.path));
  Future<AddReceivingAccountResponse> addReceivingAccount(Map<String, dynamic> account, {String? replacesId, required String idempotencyKey}) async =>
      AddReceivingAccountResponse.fromJson(await client.sendJson('POST', MobileApiPaths.addReceivingAccount.path,
          body: {'account': account, 'replacesId': ?replacesId}, idempotencyKey: idempotencyKey));
  Future<ArchiveReceivingAccountResponse> archiveReceivingAccount(String id, {required String idempotencyKey}) async => ArchiveReceivingAccountResponse.fromJson(
      await client.sendJson('POST', fillPath(MobileApiPaths.archiveReceivingAccount.path, {'accountId': id}), idempotencyKey: idempotencyKey));
  Future<GetSellerStatementResponse> sellerStatement() async => GetSellerStatementResponse.fromJson(await client.getJson(MobileApiPaths.getSellerStatement.path));
  Future<GetSellerPayoutAccountResponse> sellerPayoutAccount() async =>
      GetSellerPayoutAccountResponse.fromJson(await client.getJson(MobileApiPaths.getSellerPayoutAccount.path));

  // ── Returns, disputes, reviews ──────────────────────────────────────────────────────────────────────────────
  // `store: true` = Seller Center side (returns.manage / orders.manage). Refunds are only REQUESTED; EDMN approves.
  Future<GetReturnOptionsResponse> returnOptions(String sellerOrderId) async =>
      GetReturnOptionsResponse.fromJson(await client.getJson(fillPath(MobileApiPaths.getReturnOptions.path, {'sellerOrderId': sellerOrderId})));
  Future<ReturnCase> createReturn({required String sellerOrderId, required String reason, required String description, required List<Map<String, Object>> items, List<(Uint8List, String)> evidence = const [], required String idempotencyKey}) async =>
      ReturnCase.fromJson(await _multipart(MobileApiPaths.createReturn.path,
          fields: {'sellerOrderId': sellerOrderId, 'reason': reason, 'description': description, 'items': jsonEncode(items)}, files: {'evidence': evidence}, idempotencyKey: idempotencyKey));
  Future<List<ReturnSummary>> returns({bool store = false}) async => (store
          ? ListStoreReturnsResponse.fromJson(await client.getJson(MobileApiPaths.listStoreReturns.path)).items
          : ListMyReturnsResponse.fromJson(await client.getJson(MobileApiPaths.listMyReturns.path)).items);
  Future<ReturnCase> returnCase(String id, {bool store = false}) async => ReturnCase.fromJson(
      await client.getJson(fillPath(store ? MobileApiPaths.getStoreReturn.path : MobileApiPaths.getMyReturn.path, {'returnId': id})));
  Future<ReturnCase> shipBackReturn(String id, String carrier, String tracking, {required String idempotencyKey}) async => ReturnCase.fromJson(await client.sendJson(
      'POST', fillPath(MobileApiPaths.shipBackReturn.path, {'returnId': id}), body: {'carrier': carrier, 'tracking': tracking}, idempotencyKey: idempotencyKey));
  Future<String> escalateReturn(String id, String description, {bool store = false, required String idempotencyKey}) async => EscalatedReturn.fromJson(await client.sendJson('POST',
          fillPath(store ? MobileApiPaths.escalateStoreReturn.path : MobileApiPaths.escalateMyReturn.path, {'returnId': id}),
          body: {'description': description}, idempotencyKey: idempotencyKey))
      .disputeId;
  Future<ReturnCase> storeReturnStep(String id, String step, {String? note, String? reason, bool? includeShipping, bool? restock, required String idempotencyKey}) async =>
      ReturnCase.fromJson(await client.sendJson('POST', fillPath(MobileApiPaths.runStoreReturnStep.path, {'returnId': id}),
          body: {'step': step, 'note': ?note, 'reason': ?reason, 'includeShipping': ?includeShipping, 'restock': ?restock}, idempotencyKey: idempotencyKey));

  Future<DisputeCase> openDispute({String? sellerOrderId, String? dealId, required String reasonCode, required String description, int? claimedAmountPiastres, List<(Uint8List, String)> evidence = const [], required String idempotencyKey}) async =>
      DisputeCase.fromJson(await _multipart(MobileApiPaths.openDispute.path,
          fields: {'sellerOrderId': ?sellerOrderId, 'dealId': ?dealId, 'reasonCode': reasonCode, 'description': description, if (claimedAmountPiastres != null) 'claimedAmountPiastres': '$claimedAmountPiastres'},
          files: {'evidence': evidence}, idempotencyKey: idempotencyKey));
  Future<List<DisputeSummary>> disputes({bool store = false}) async => (store
          ? ListStoreDisputesResponse.fromJson(await client.getJson(MobileApiPaths.listStoreDisputes.path)).items
          : ListMyDisputesResponse.fromJson(await client.getJson(MobileApiPaths.listMyDisputes.path)).items);
  Future<DisputeCase> dispute(String id, {bool store = false}) async => DisputeCase.fromJson(
      await client.getJson(fillPath(store ? MobileApiPaths.getStoreDispute.path : MobileApiPaths.getMyDispute.path, {'disputeId': id})));
  Future<DisputeCase> replyDispute(String id, String body, {(Uint8List, String)? attachment, bool store = false, required String idempotencyKey}) async => DisputeCase.fromJson(await _multipart(
      fillPath(store ? MobileApiPaths.replyStoreDispute.path : MobileApiPaths.replyDispute.path, {'disputeId': id}),
      fields: {'body': body}, files: {'attachment': [?attachment]}, idempotencyKey: idempotencyKey));

  Future<ReviewOptions> reviewOptions(String sellerOrderId) async =>
      ReviewOptions.fromJson(await client.getJson(fillPath(MobileApiPaths.getReviewOptions.path, {'sellerOrderId': sellerOrderId})));
  Future<ReviewOptions> reviewProduct(String orderItemId, int rating, {String? title, String? body, List<(Uint8List, String)> photos = const [], required String idempotencyKey}) async =>
      ReviewOptions.fromJson(await _multipart(MobileApiPaths.reviewProduct.path,
          fields: {'orderItemId': orderItemId, 'rating': '$rating', if (title != null && title.isNotEmpty) 'title': title, if (body != null && body.isNotEmpty) 'body': body},
          files: {'photos': photos}, idempotencyKey: idempotencyKey));
  Future<ReviewOptions> reviewSeller(String sellerOrderId, int rating, {String? body, required String idempotencyKey}) async => ReviewOptions.fromJson(await client.sendJson(
      'POST', MobileApiPaths.reviewSeller.path, body: {'sellerOrderId': sellerOrderId, 'rating': rating, if (body != null && body.isNotEmpty) 'body': body}, idempotencyKey: idempotencyKey));
}
