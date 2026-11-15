import 'dart:typed_data';

import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_customer/src/app.dart';
import 'package:edmn_customer/src/common/file_pick.dart';
import 'package:edmn_customer/src/common/ui.dart';
import 'package:edmn_customer/src/providers.dart';
import 'package:edmn_customer/src/version.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// Customer App flows against a fake API that behaves like the server contract (server-priced cart, idempotent
/// checkout key, receipt queued for review, server-decided actions). No real network.
final _config = BuildConfig(environment: AppEnvironment.local, apiBaseUrl: 'http://localhost', appVersion: '1.2.0');

Map<String, dynamic> _line({String variantId = 'v1', int qty = 1, int unit = 125050, List<String> issues = const []}) => {
      'variantId': variantId, 'productSlug': 'headphones', 'title': 'سماعة لاسلكية', 'variantLabel': '', 'condition': 'NEW', 'imageUrl': null,
      'unitPricePiastres': unit, 'compareAtPricePiastres': null, 'priceSeenPiastres': 100000, 'quantity': qty, 'lineTotalPiastres': unit * qty,
      'buyerFeePiastres': 0, 'issues': issues, 'returnPolicy': null,
    };

Map<String, dynamic> _cart({int qty = 1, List<String> issues = const [], bool priced = true}) {
  final sub = 125050 * qty;
  final ship = priced ? 5000 : 0;
  return {
    'groups': [
      {
        'store': {'name': 'متجر القاهرة', 'slug': 'cairo', 'verified': true},
        'lines': [_line(qty: qty, issues: issues)],
        'merchandiseSubtotalPiastres': sub, 'shippingFeePiastres': priced ? ship : null, 'freeShippingApplied': false,
        'etaMinDays': 1, 'etaMaxDays': 3, 'processingDays': 1, 'buyerFeePiastres': 729, 'totalPiastres': sub + ship + 729,
      },
    ],
    'merchandiseTotalPiastres': sub, 'shippingTotalPiastres': ship, 'discountTotalPiastres': 0, 'buyerFeeTotalPiastres': 729,
    'grandTotalPiastres': sub + ship + 729, 'itemCount': qty, 'hasIssues': issues.isNotEmpty, 'shippingResolved': priced,
    'pricingVersionId': '11111111-1111-4111-8111-111111111111', 'pricingUnavailableAr': null, 'canCheckout': issues.isEmpty && priced,
  };
}

const _address = {
  'id': 'a1', 'label': 'البيت', 'recipientName': 'منى السيد', 'phone': '01012345678', 'governorateId': 1, 'city': 'مدينة نصر', 'district': null,
  'street': 'شارع عباس العقاد', 'building': null, 'floor': null, 'apartment': null, 'landmark': null, 'isDefault': true,
};

Map<String, dynamic> _payment({String status = 'AWAITING_PAYMENT', List<String> actions = const ['SUBMIT_PROOF'], List<Map<String, dynamic>> subs = const []}) => {
      'id': 'pay1', 'method': 'INSTAPAY', 'status': status, 'amountDuePiastres': 130779, 'dueAt': '2030-01-02T10:00:00Z', 'isTest': true, 'confirmedAt': null,
      'destinations': [
        {'label': 'إنستاباي — وجهة تجريبية', 'details': {'instapayAddress': 'edmn@instapay'}, 'instructionsAr': null, 'isTest': true},
      ],
      'submissions': subs, 'lastRejectionReasonAr': null, 'allowedActions': actions,
    };

Map<String, dynamic> _order({String status = 'PENDING_PAYMENT', String soStatus = 'PENDING_PAYMENT', List<String> soActions = const [], List<String> actions = const ['CANCEL_UNPAID']}) => {
      'id': 'o1', 'number': '100001', 'status': status, 'placedAt': '2030-01-01T10:00:00Z', 'paymentMethod': 'INSTAPAY', 'shippingAddress': <String, dynamic>{},
      'customerNote': null, 'merchandiseTotalPiastres': 125050, 'shippingTotalPiastres': 5000, 'discountTotalPiastres': 0, 'buyerFeeTotalPiastres': 729,
      'grandTotalPiastres': 130779, 'cancelReasonAr': null, 'allowedActions': actions, 'payment': _payment(),
      'sellerOrders': [
        {
          'id': 'so1', 'number': '100001-A', 'status': soStatus, 'store': {'name': 'متجر القاهرة', 'slug': 'cairo'},
          'merchandiseSubtotalPiastres': 125050, 'shippingFeePiastres': 5000, 'buyerFeePiastres': 729, 'grossTotalPiastres': 130779, 'refundedTotalPiastres': 0,
          'shippingEtaMinDays': 1, 'shippingEtaMaxDays': 3, 'shippedAt': null, 'deliveredAt': null, 'buyerResponseDueAt': null, 'receiptBasis': null,
          'cancelledAt': null, 'cancelReasonAr': null, 'cancellationPending': false, 'openDispute': false,
          'items': [
            {
              'id': 'i1', 'productId': 'p1', 'productSlug': 'headphones', 'variantId': 'v1', 'title': 'سماعة لاسلكية', 'variantLabel': '', 'condition': 'NEW',
              'imageUrl': null, 'unitPricePiastres': 125050, 'quantity': 1, 'lineTotalPiastres': 125050, 'refundedQuantity': 0, 'returnedQuantity': 0, 'returnPolicy': null,
            },
          ],
          'shipment': null, 'disputes': [], 'returns': [], 'refunds': [], 'allowedActions': soActions,
        },
      ],
    };

class FakeMobileApi extends MobileApi {
  FakeMobileApi({this.minVersion = '1.0.0', this.realMoney = false, this.loginError, this.productError})
      : super(ApiClient(config: _config, store: MemorySessionStore(), refreshPath: '/r', telemetry: Telemetry([])));
  final String minVersion;
  final bool realMoney;
  final ApiFailure? loginError;
  final ApiFailure? productError;
  int revokeCalls = 0;
  int cartQty = 0;
  final placedKeys = <String>[];
  final placedTotals = <int>[];
  final proofKeys = <String>[];
  String orderStatus = 'PENDING_PAYMENT';
  List<String> soActions = const [];
  Map<String, dynamic> paymentJson = _payment();
  final confirmKeys = <String>[];

  @override
  Future<AppConfig> appConfig() async => AppConfig(
      minSupportedVersion: AppConfigMinSupportedVersion(customer: minVersion, admin: '1.0.0'),
      defaultLocale: 'ar', locales: const ['ar', 'en'], currency: 'EGP', realMoneyEnabled: realMoney, maintenanceMode: false,
      deliveryOtp: const AppConfigDeliveryOtp(inApp: true, sms: true));

  @override
  Future<ListCategoriesResponse> categories() async => ListCategoriesResponse(items: [
        Category(id: 'c1', slug: 'electronics', nameAr: 'إلكترونيات', nameEn: 'Electronics', icon: 'Cpu', children: const []),
      ]);

  @override
  Future<List<ListGovernoratesResponseItemsItem>> governorates() async => const [ListGovernoratesResponseItemsItem(id: 1, code: 'C', nameAr: 'القاهرة', nameEn: 'Cairo')];

  @override
  Future<SearchProductsResponse> searchProducts({String? q, String? categoryId, String? sort, String? condition, String? storeSlug, bool? inStock, int page = 1, int pageSize = 24}) async =>
      SearchProductsResponse(
        items: [
          ProductCard(id: 'p1', slug: 'headphones', titleAr: 'سماعة لاسلكية', condition: 'NEW', usedGrade: null, minPricePiastres: 125050, compareAtPricePiastres: null,
              inStock: true, ratingAvg: 4.5, ratingCount: 3, store: const ProductCardStore(name: 'متجر القاهرة', slug: 'cairo', verified: true), imageUrl: null, defaultVariantId: 'v1', variantCount: 1),
        ],
        page: 1, pageSize: pageSize, total: 1, pages: 1,
      );

  @override
  Future<ProductDetail> product(String slug) async => productError != null
      ? throw productError!
      : ProductDetail.fromJson({
          'id': 'p1', 'slug': 'headphones', 'titleAr': 'سماعة لاسلكية', 'titleEn': null, 'description': 'صوت عالي الدقة', 'keyFeatures': [], 'condition': 'NEW',
          'usedGrade': null, 'conditionNotes': null, 'defects': null, 'includedAccessories': null, 'warrantyInfo': null, 'processingDays': 2, 'ratingAvg': 0, 'ratingCount': 0,
          'brand': null, 'category': null, 'breadcrumbs': [], 'store': {'name': 'متجر القاهرة', 'slug': 'cairo', 'verified': true, 'ratingAvg': 0, 'ratingCount': 0},
          'images': [], 'specs': [],
          'variants': [
            {'id': 'v1', 'label': 'أسود', 'options': <String, dynamic>{}, 'pricePiastres': 125050, 'compareAtPricePiastres': null, 'available': true, 'specs': []},
          ],
        });

  @override
  Future<ListProductReviewsResponse> productReviews(String slug) async => const ListProductReviewsResponse(items: []);

  @override
  Future<SessionResult> login({required String identifier, required String password, required DeviceInfo device}) async {
    if (loginError != null) throw loginError!;
    return SessionResult(
        user: const SessionResultUser(id: 'u', fullName: 'عميل', isStaff: false),
        tokens: TokenPair(accessToken: 'em1.a.b', accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: 'r' * 40, sessionExpiresAt: '2030-01-01T00:00:00Z'),
        deviceId: 'd', mfa: const SessionResultMfa(required: false, enrolled: false));
  }

  @override
  Future<Profile> me() async => const Profile(
      id: 'u', fullName: 'منى السيد', email: 'mona@test.local', phone: '+201012345678', locale: 'ar', emailVerified: true, phoneVerified: true, isStaff: false, totpEnrolled: false, permissions: []);

  @override
  Future<Cart> cart({int? governorateId}) async => Cart.fromJson(cartQty == 0
      ? {
          'groups': [], 'merchandiseTotalPiastres': 0, 'shippingTotalPiastres': 0, 'discountTotalPiastres': 0, 'buyerFeeTotalPiastres': 0, 'grandTotalPiastres': 0,
          'itemCount': 0, 'hasIssues': false, 'shippingResolved': true, 'pricingVersionId': null, 'pricingUnavailableAr': null, 'canCheckout': false,
        }
      : _cart(qty: cartQty));

  @override
  Future<int> addToCart(String variantId, int quantity, {required String idempotencyKey}) async => cartQty += quantity;

  @override
  Future<void> setCartQuantity(String variantId, int quantity) async => cartQty = quantity;

  @override
  Future<Checkout> checkout({String? addressId}) async => Checkout.fromJson({
        'selectedAddressId': 'a1', 'addresses': [_address], 'cart': _cart(qty: cartQty == 0 ? 1 : cartQty),
        'paymentMethods': [
          {'code': 'INSTAPAY', 'nameAr': 'إنستاباي', 'nameEn': 'InstaPay', 'instructionsAr': null},
          {'code': 'BANK_TRANSFER', 'nameAr': 'تحويل بنكي', 'nameEn': 'Bank transfer', 'instructionsAr': null},
        ],
        'paymentWindowHours': 48, 'realMoneyEnabled': false, 'mandatoryRightsNoticeAr': 'حقوقك كمستهلك محفوظة',
      });

  @override
  Future<PlaceOrderResponse> placeOrder(PlaceOrderRequest r) async {
    placedKeys.add(r.checkoutKey);
    placedTotals.add(r.expectedTotalPiastres);
    cartQty = 0;
    return const PlaceOrderResponse(orderId: 'o1', created: true);
  }

  @override
  Future<ListOrdersResponse> orders({int page = 1}) async => ListOrdersResponse.fromJson({
        'page': 1, 'pageSize': 20,
        'items': [
          {'id': 'o1', 'number': '100001', 'status': orderStatus, 'grandTotalPiastres': 130779, 'placedAt': '2030-01-01T10:00:00Z', 'paymentStatus': 'AWAITING_PAYMENT',
            'paymentDueAt': '2030-01-02T10:00:00Z', 'itemCount': 1, 'thumbnails': []},
        ],
      });

  @override
  Future<Order> order(String id) async => Order.fromJson(_order(status: orderStatus, soStatus: soActions.contains('CONFIRM_RECEIPT') ? 'SHIPPED' : 'PENDING_PAYMENT', soActions: soActions));

  @override
  Future<void> confirmReceipt(String sellerOrderId, {required String idempotencyKey}) async => confirmKeys.add(idempotencyKey);

  @override
  Future<GetPaymentResponse> payment(String id) async => GetPaymentResponse.fromJson({...paymentJson, 'orderId': 'o1', 'dealId': null, 'orderNumber': '100001'});

  @override
  Future<void> submitPaymentProof(String paymentId,
      {required Uint8List bytes, required String fileName, required String claimedAmount, String? reference, String? payerName, required String clientKey}) async {
    proofKeys.add(clientKey);
    paymentJson = _payment(status: 'PAYMENT_SUBMITTED', actions: const [], subs: [
      {'id': 's1', 'status': 'SUBMITTED', 'claimedAmountPiastres': 130779, 'reference': reference, 'submittedAt': '2030-01-01T11:00:00Z', 'reviewReasonAr': null, 'proofFileId': 'f1'},
    ]);
  }

  bool isSeller = false;
  bool isOwner = false;

  @override
  Future<GetSellerFundsResponse> sellerFunds() async => GetSellerFundsResponse.fromJson({
        'pendingPiastres': 50000, 'availablePiastres': 200000, 'heldPiastres': 50000, 'reservedForPayoutPiastres': 0, 'bookedDebtPiastres': 0,
        'unsecuredClaimsPiastres': 0, 'withdrawablePiastres': 150000, 'openPayoutRequests': 1, 'blockReasonAr': null,
      });

  @override
  Future<ListSellerPayoutRequestsResponse> payoutRequests() async => ListSellerPayoutRequestsResponse.fromJson({
        'items': [
          {'id': 'w1', 'amountPiastres': 100000, 'status': 'TRANSFER_UNCERTAIN', 'createdAt': '2030-01-01T10:00:00Z', 'paidAt': null, 'reference': null, 'reasonAr': null, 'cancellable': false},
          {'id': 'w2', 'amountPiastres': 20000, 'status': 'REQUESTED', 'createdAt': '2030-01-02T10:00:00Z', 'paidAt': null, 'reference': null, 'reasonAr': null, 'cancellable': true},
        ],
      });
  final steps = <String>[];

  @override
  Future<GetMySellerMembershipResponse> sellerMembership() async => GetMySellerMembershipResponse.fromJson({
        'membership': isSeller
            ? {
                'status': 'APPROVED', 'type': 'BUSINESS', 'role': isOwner ? 'STORE_OWNER' : 'ORDER_MANAGER',
                'permissions': isOwner ? ['finance.view', 'finance.withdraw', 'orders.manage', 'store.manage'] : ['orders.manage', 'inventory.manage'],
                'store': {'name': 'تك زون', 'slug': 'tech'}, 'canOperate': true,
              }
            : null,
      });

  @override
  Future<GetSellerHomeResponse> sellerHome() async => GetSellerHomeResponse.fromJson({
        'orders': {'pendingConfirmation': 2, 'processing': 1, 'readyToShip': 0, 'shipped': 3, 'openReturns': 0, 'last30Days': 12},
        'products': {'live': 7, 'outOfStock': 1, 'lowStock': 0},
        'rating': {'average': 4.8, 'count': 20},
        'sales': null,
        'onTimeRate': 0.9,
      });

  Map<String, dynamic> _so(List<String> actions) => {
        'id': 'so1', 'number': '100001-A', 'status': 'PAID', 'paidAt': '2030-01-01T10:00:00Z', 'processingDays': 1,
        'shipTo': {'recipientName': 'منى السيد', 'phone': '01012345678', 'governorate': 'القاهرة', 'city': 'مدينة نصر', 'district': null, 'street': 'عباس العقاد',
          'building': null, 'floor': null, 'apartment': null, 'landmark': null},
        'items': [{'id': 'i1', 'title': 'سماعة', 'variantLabel': 'أسود', 'condition': 'NEW', 'imageUrl': null, 'quantity': 1, 'unitPricePiastres': 125050, 'lineTotalPiastres': 125050}],
        'merchandiseSubtotalPiastres': 125050, 'shippingFeePiastres': 5000, 'economics': null, 'shipment': null, 'cancellationRequest': null, 'openDispute': false,
        'allowedActions': actions,
      };

  @override
  Future<SellerOrder> sellerOrder(String id) async => SellerOrder.fromJson(_so(steps.isEmpty ? const ['CONFIRM_ORDER', 'SAVE_SHIPMENT'] : const ['START_PROCESSING', 'SAVE_SHIPMENT']));

  @override
  Future<SellerOrder> sellerOrderStep(String id, String step, {String? note, required String idempotencyKey}) async {
    steps.add(step);
    return sellerOrder(id);
  }

  @override
  Future<ListMySessionsResponse> mySessions() async => ListMySessionsResponse(items: [
        DeviceSession(id: 'a' * 32, scope: 'MOBILE', current: true, createdAt: '', lastSeenAt: '', expiresAt: '', device: const DeviceSessionDevice(platform: 'ANDROID', name: 'Pixel', appVersion: '1.2.0', app: 'CUSTOMER'), userAgent: null),
        DeviceSession(id: 'b' * 32, scope: 'MOBILE', current: false, createdAt: '', lastSeenAt: '2030-01-01T00:00:00Z', expiresAt: '', device: const DeviceSessionDevice(platform: 'IOS', name: 'Old iPhone', appVersion: '1.0.0', app: 'CUSTOMER'), userAgent: null),
      ]);

  @override
  Future<int> revokeOtherSessions({required String idempotencyKey}) async {
    revokeCalls++;
    return 1;
  }
}

class _FakePicker implements FilePickerService {
  @override
  Future<PickedFile?> pick({bool allowPdf = true}) async => PickedFile(name: 'receipt.png', bytes: Uint8List.fromList([1, 2, 3]));
}

Widget _app(FakeMobileApi api, {bool signedIn = false}) => ProviderScope(overrides: [
      buildConfigProvider.overrideWithValue(_config),
      sessionStoreProvider.overrideWithValue(MemorySessionStore()),
      appPrefsProvider.overrideWithValue(MemoryAppPrefs({'onboarded': '1'})),
      mobileApiProvider.overrideWithValue(api),
      filePickerProvider.overrideWithValue(_FakePicker()),
      if (signedIn) signedInProvider.overrideWith(_AlwaysSignedIn.new),
    ], child: const CustomerApp());

class _AlwaysSignedIn extends SignedIn {
  @override
  bool build() => true;
  @override
  void set(bool v) {}
}

Future<void> _start(WidgetTester t, FakeMobileApi api, {bool signedIn = false}) async {
  t.view.physicalSize = const Size(1170, 2532);
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
  await t.pumpWidget(_app(api, signedIn: signedIn));
  await t.pumpAndSettle();
}

Finder get _mainList => find.byType(Scrollable).first;

Future<void> _reveal(WidgetTester t, Finder f) async {
  await t.scrollUntilVisible(f, 250, scrollable: _mainList);
  await t.pumpAndSettle();
}

Future<void> _go(WidgetTester t, String location) async {
  final ctx = t.element(find.byType(Navigator).first);
  GoRouterHelper(ctx).go(location);
  await t.pumpAndSettle();
}

void main() {
  testWidgets('starts in Arabic (RTL) on the home tab: products with EGP prices, TEST banner, board navigation', (t) async {
    await _start(t, FakeMobileApi());
    expect(Directionality.of(t.element(find.text('سماعة لاسلكية').first)), TextDirection.rtl);
    expect(find.text('1,250.5 ج.م'), findsWidgets);
    expect(find.textContaining('وضع تجريبي'), findsOneWidget);
    for (final tab in ['الرئيسية', 'الأقسام', 'إعادة الطلب', 'طلباتي']) {
      expect(find.text(tab), findsOneWidget);
    }
  });

  testWidgets('no TEST banner when the server says Real Money is on', (t) async {
    await _start(t, FakeMobileApi(realMoney: true));
    expect(find.textContaining('وضع تجريبي'), findsNothing);
  });

  testWidgets('an unsupported version is blocked by the server-side minimum', (t) async {
    await _start(t, FakeMobileApi(minVersion: '9.0.0'));
    expect(find.text('تحديث مطلوب'), findsOneWidget);
    expect(find.text('سماعة لاسلكية'), findsNothing);
  });

  testWidgets('API errors are shown by stable code (localized), not by server text', (t) async {
    await _start(t, FakeMobileApi(productError: const ApiFailure(code: ApiErrorCode.notFound, status: 404)));
    await _go(t, '/products/headphones');
    expect(find.text('مش لاقيين اللي بتدور عليه'), findsOneWidget);
  });

  testWidgets('a guest who taps "أضف" is sent to sign-in (the mobile cart belongs to an account)', (t) async {
    final api = FakeMobileApi();
    await _start(t, api);
    final add = find.text('أضف').first;
    await t.ensureVisible(add);
    await t.pumpAndSettle();
    await t.tap(add);
    await t.pumpAndSettle();
    expect(find.byKey(const Key('sign-in')), findsOneWidget);
    expect(api.cartQty, 0);
  });

  testWidgets('protected routes require sign-in; sign-in validates fields and maps the error code', (t) async {
    await _start(t, FakeMobileApi(loginError: const ApiFailure(code: ApiErrorCode.unauthenticated, status: 401)));
    await _go(t, '/account/devices');
    expect(find.byKey(const Key('sign-in')), findsOneWidget);
    await t.tap(find.byKey(const Key('sign-in')));
    await t.pumpAndSettle();
    expect(find.text('الحقل ده مطلوب'), findsNWidgets(2));
    await t.enterText(find.byKey(const Key('identifier')), 'a@b.c');
    await t.enterText(find.byKey(const Key('password')), 'x');
    await t.tap(find.byKey(const Key('sign-in')));
    await t.pumpAndSettle();
    expect(find.textContaining('سجّل دخولك'), findsWidgets);
  });

  testWidgets('cart → checkout: the server total is sent as expected total, and a retry reuses ONE checkout key', (t) async {
    final api = FakeMobileApi()..cartQty = 2;
    await _start(t, api, signedIn: true);
    await _go(t, '/cart');
    expect(find.text('2,501 ج.م'), findsWidgets); // line total from the server
    expect(find.byKey(const Key('grand-total')), findsOneWidget);
    await t.tap(find.byKey(const Key('checkout')));
    await t.pumpAndSettle();
    for (var i = 0; i < 2; i++) {
      await t.tap(find.byKey(const Key('checkout-next')));
      await t.pumpAndSettle();
    }
    // Payment step: only server-enabled methods; nothing is preselected.
    expect(find.text('إنستاباي'), findsOneWidget);
    expect(find.text('الدفع عند الاستلام'), findsNothing);
    await t.tap(find.byKey(const Key('radio-INSTAPAY')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('checkout-next')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('checkout-next')));
    await t.pumpAndSettle();
    expect(api.placedKeys, hasLength(1));
    expect(api.placedTotals.single, 2 * 125050 + 5000 + 729);
    expect(find.text('تم إنشاء طلبك'), findsOneWidget);
    // Order screen shows server-allowed actions only: unpaid → cancel + pay, no receipt confirmation.
    expect(find.byKey(const Key('pay-now')), findsOneWidget);
    expect(find.byKey(const Key('confirm-receipt-so1')), findsNothing);
    await _reveal(t, find.byKey(const Key('cancel-order')));
    expect(find.byKey(const Key('cancel-order')), findsOneWidget);
    expect(find.byKey(const Key('confirm-receipt-so1')), findsNothing);
  });

  testWidgets('receipt upload queues the payment for review — it is never shown as paid', (t) async {
    final api = FakeMobileApi();
    await _start(t, api, signedIn: true);
    await _go(t, '/payments/pay1');
    expect(find.textContaining('دفعة تجريبية'), findsOneWidget);
    await t.tap(find.byKey(const Key('submit-receipt')));
    await t.pumpAndSettle();
    expect(api.proofKeys, isEmpty); // no file / amount yet → nothing sent
    await t.tap(find.byKey(const Key('upload-field')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('claimed-amount')), '1307.79');
    await t.tap(find.byKey(const Key('submit-receipt')));
    await t.pumpAndSettle();
    expect(api.proofKeys, hasLength(1));
    expect(find.byKey(const Key('receipt-submitted')), findsOneWidget);
    expect(find.text('تم تأكيد الدفع'), findsNothing);
    expect(find.text('الإيصال تحت المراجعة'), findsWidgets);
    expect(find.byKey(const Key('submit-receipt')), findsNothing);
  });

  testWidgets('confirm receipt appears only when the server allows it, and asks for confirmation first', (t) async {
    final api = FakeMobileApi()
      ..orderStatus = 'PAID'
      ..soActions = const ['CONFIRM_RECEIPT', 'REPORT_PROBLEM'];
    await _start(t, api, signedIn: true);
    await _go(t, '/orders/o1');
    final btn = find.byKey(const Key('confirm-receipt-so1'));
    await _reveal(t, btn);
    await t.tap(btn);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('dialog-cancel')));
    await t.pumpAndSettle();
    expect(api.confirmKeys, isEmpty);
    await t.tap(btn);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('dialog-confirm')));
    await t.pumpAndSettle();
    expect(api.confirmKeys, hasLength(1));
  });

  testWidgets('services without a mobile API say so honestly (no fake balance)', (t) async {
    await _start(t, FakeMobileApi(), signedIn: true);
    await _go(t, '/wallet');
    expect(find.byKey(const Key('not-yet-available')), findsOneWidget);
    expect(find.textContaining('ج.م'), findsNothing);
  });

  testWidgets('English flips to LTR with the English money format', (t) async {
    await _start(t, FakeMobileApi(), signedIn: true);
    await _go(t, '/account');
    await _reveal(t, find.byKey(const Key('menu-language')));
    await t.tap(find.byKey(const Key('menu-language')));
    await t.pumpAndSettle();
    await _go(t, '/');
    expect(Directionality.of(t.element(find.text('سماعة لاسلكية').first)), TextDirection.ltr);
    expect(find.text('EGP 1,250.5'), findsWidgets);
    expect(find.text('Home'), findsOneWidget);
  });

  testWidgets('signed-in user sees devices and can sign out the others once', (t) async {
    final api = FakeMobileApi();
    await _start(t, api, signedIn: true);
    await _go(t, '/account/devices');
    expect(find.text('Old iPhone'), findsOneWidget);
    await t.tap(find.byKey(const Key('revoke-others')));
    await t.pumpAndSettle();
    expect(api.revokeCalls, 1);
  });

  testWidgets('seller center: a buyer without a store sees an honest status, not a dashboard', (t) async {
    await _start(t, FakeMobileApi(), signedIn: true);
    await _go(t, '/seller');
    expect(find.byKey(const Key('not-a-seller')), findsOneWidget);
  });

  testWidgets('seller center: menus follow the role (no money for an order manager); steps follow allowedActions', (t) async {
    final api = FakeMobileApi()..isSeller = true;
    await _start(t, api, signedIn: true);
    await _go(t, '/seller');
    expect(find.text('تك زون'), findsOneWidget);
    expect(find.byKey(const Key('seller-orders')), findsOneWidget);
    expect(find.byKey(const Key('seller-funds')), findsNothing); // ORDER_MANAGER has no finance.view
    await _go(t, '/seller/orders/so1');
    expect(find.byKey(const Key('step-CONFIRM_ORDER')), findsOneWidget);
    expect(find.byKey(const Key('step-MARK_SHIPPED')), findsNothing);
    await t.tap(find.byKey(const Key('step-CONFIRM_ORDER')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('dialog-confirm')));
    await t.pumpAndSettle();
    expect(api.steps, ['CONFIRM_ORDER']);
    expect(find.byKey(const Key('step-START_PROCESSING')), findsOneWidget);
    expect(find.byKey(const Key('step-CONFIRM_ORDER')), findsNothing);
  });

  testWidgets('payouts: TRANSFER_UNCERTAIN is "being verified" (never failed, no cancel / re-send); a pending request can be cancelled', (t) async {
    final api = FakeMobileApi()
      ..isSeller = true
      ..isOwner = true;
    await _start(t, api, signedIn: true);
    await _go(t, '/seller/payouts');
    expect(find.text('جاري التحقق من التحويل'), findsOneWidget);
    expect(find.byKey(const Key('cancel-payout-w1')), findsNothing);
    expect(find.byKey(const Key('cancel-payout-w2')), findsOneWidget);
    expect(find.text('تم التحويل'), findsNothing);
    expect(find.byKey(const Key('new-payout')), findsOneWidget);
  });

  test('version comparison', () {
    expect(isVersionSupported('1.2.0', '1.0.0'), isTrue);
    expect(isVersionSupported('1.2.0+7', '1.10.0'), isFalse);
  });

  test('EGP typed by the buyer is converted to piastres without floating point', () {
    expect(parseEgpToPiastres('1307.79'), 130779);
    expect(parseEgpToPiastres('1,250.5'), 125050);
    expect(parseEgpToPiastres('12.345'), isNull);
    expect(parseEgpToPiastres('abc'), isNull);
  });
}
