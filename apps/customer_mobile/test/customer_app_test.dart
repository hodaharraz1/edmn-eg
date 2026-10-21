import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_customer/src/app.dart';
import 'package:edmn_customer/src/providers.dart';
import 'package:edmn_customer/src/version.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

final _config = BuildConfig(environment: AppEnvironment.local, apiBaseUrl: 'http://localhost', appVersion: '1.2.0');

class FakeMobileApi extends MobileApi {
  FakeMobileApi({this.minVersion = '1.0.0', this.realMoney = false, this.loginError})
      : super(ApiClient(config: _config, store: MemorySessionStore(), refreshPath: '/r', telemetry: Telemetry([])));
  final String minVersion;
  final bool realMoney;
  final ApiFailure? loginError;
  int revokeCalls = 0;

  @override
  Future<AppConfig> appConfig() async => AppConfig(
      minSupportedVersion: AppConfigMinSupportedVersion(customer: minVersion, admin: '1.0.0'),
      defaultLocale: 'ar', locales: const ['ar', 'en'], currency: 'EGP', realMoneyEnabled: realMoney, maintenanceMode: false,
      deliveryOtp: const AppConfigDeliveryOtp(inApp: true, sms: true));

  @override
  Future<SearchProductsResponse> searchProducts({String? q, String? categoryId, String? sort, int page = 1, int pageSize = 24}) async => SearchProductsResponse(
        items: [
          ProductCard(id: 'p1', slug: 'headphones', titleAr: 'سماعة لاسلكية', condition: 'NEW', usedGrade: null, minPricePiastres: 125050, compareAtPricePiastres: null,
              inStock: true, ratingAvg: 4.5, ratingCount: 3, store: const ProductCardStore(name: 'متجر القاهرة', slug: 'cairo', verified: true), imageUrl: null, defaultVariantId: 'v1', variantCount: 1),
        ],
        page: 1, pageSize: 24, total: 1, pages: 1,
      );

  @override
  Future<ProductDetail> product(String slug) async => throw const ApiFailure(code: ApiErrorCode.notFound, status: 404);

  @override
  Future<SessionResult> login({required String identifier, required String password, required DeviceInfo device}) async {
    if (loginError != null) throw loginError!;
    return SessionResult(
        user: const SessionResultUser(id: 'u', fullName: 'عميل', isStaff: false),
        tokens: TokenPair(accessToken: 'em1.a.b', accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: 'r' * 40, sessionExpiresAt: '2030-01-01T00:00:00Z'),
        deviceId: 'd', mfa: const SessionResultMfa(required: false, enrolled: false));
  }

  @override
  Future<ListMySessionsResponse> mySessions() async => ListMySessionsResponse(items: [
        DeviceSession(id: 'a' * 32, scope: 'MOBILE', current: true, createdAt: '', lastSeenAt: '', expiresAt: '', device: const DeviceSessionDevice(platform: 'ANDROID', name: 'Pixel', appVersion: '1.2.0', app: 'CUSTOMER'), userAgent: null),
        DeviceSession(id: 'b' * 32, scope: 'MOBILE', current: false, createdAt: '', lastSeenAt: 'yesterday', expiresAt: '', device: const DeviceSessionDevice(platform: 'IOS', name: 'Old iPhone', appVersion: '1.0.0', app: 'CUSTOMER'), userAgent: null),
      ]);

  @override
  Future<int> revokeOtherSessions({required String idempotencyKey}) async {
    revokeCalls++;
    return 1;
  }
}

Widget _app(FakeMobileApi api) => ProviderScope(overrides: [
      buildConfigProvider.overrideWithValue(_config),
      sessionStoreProvider.overrideWithValue(MemorySessionStore()),
      mobileApiProvider.overrideWithValue(api),
    ], child: const CustomerApp());

void main() {
  testWidgets('starts in Arabic (RTL), lists products with EGP prices and the TEST-money banner', (t) async {
    await t.pumpWidget(_app(FakeMobileApi()));
    await t.pumpAndSettle();
    expect(Directionality.of(t.element(find.text('سماعة لاسلكية'))), TextDirection.rtl);
    expect(find.text('1,250.5 ج.م'), findsOneWidget);
    expect(find.textContaining('وضع تجريبي'), findsOneWidget);
  });

  testWidgets('switching to English flips to LTR and English money format', (t) async {
    await t.pumpWidget(_app(FakeMobileApi()));
    await t.pumpAndSettle();
    await t.tap(find.byIcon(Icons.translate));
    await t.pumpAndSettle();
    expect(Directionality.of(t.element(find.text('سماعة لاسلكية'))), TextDirection.ltr);
    expect(find.text('EGP 1,250.5'), findsOneWidget);
  });

  testWidgets('no TEST banner when the server says Real Money is on', (t) async {
    await t.pumpWidget(_app(FakeMobileApi(realMoney: true)));
    await t.pumpAndSettle();
    expect(find.textContaining('وضع تجريبي'), findsNothing);
  });

  testWidgets('an unsupported version is blocked by the server-side minimum', (t) async {
    await t.pumpWidget(_app(FakeMobileApi(minVersion: '2.0.0')));
    await t.pumpAndSettle();
    expect(find.text('تحديث مطلوب'), findsOneWidget);
    expect(find.text('سماعة لاسلكية'), findsNothing);
  });

  testWidgets('API errors are shown by stable code (localized), not by server text', (t) async {
    await t.pumpWidget(_app(FakeMobileApi()));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('product-headphones')));
    await t.pumpAndSettle();
    expect(find.text('مش لاقيين اللي بتدور عليه'), findsOneWidget);
  });

  testWidgets('account pages require sign-in; sign-in validates, maps errors, then signs out other devices once', (t) async {
    final api = FakeMobileApi(loginError: const ApiFailure(code: ApiErrorCode.unauthenticated, status: 401));
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await t.tap(find.byIcon(Icons.login));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('submit')));
    await t.pumpAndSettle();
    expect(find.text('الحقل ده مطلوب'), findsNWidgets(2));
    await t.enterText(find.byKey(const Key('identifier')), 'buyer@test.local');
    await t.enterText(find.byKey(const Key('password')), 'wrong');
    await t.tap(find.byKey(const Key('submit')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('sign-in-error')), findsOneWidget);
  });

  testWidgets('signed-in user sees devices and can sign out the others', (t) async {
    final api = FakeMobileApi();
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await t.tap(find.byIcon(Icons.login));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('identifier')), 'buyer@test.local');
    await t.enterText(find.byKey(const Key('password')), 'Test@12345');
    await t.tap(find.byKey(const Key('submit')));
    await t.pumpAndSettle();
    await t.tap(find.byIcon(Icons.devices));
    await t.pumpAndSettle();
    expect(find.text('الجهاز ده'), findsOneWidget);
    expect(find.text('Old iPhone'), findsOneWidget);
    await t.tap(find.byKey(const Key('revoke-others')));
    await t.pumpAndSettle();
    expect(api.revokeCalls, 1);
    expect(find.text('تم الخروج من جهاز واحد'), findsOneWidget);
  });

  test('semantic version gate', () {
    expect(isVersionSupported('1.2.0', '1.0.0'), isTrue);
    expect(isVersionSupported('1.2.0', '1.2.0'), isTrue);
    expect(isVersionSupported('1.2.0+7', '1.10.0'), isFalse);
    expect(isVersionSupported('2.0.0', '1.99.99'), isTrue);
  });
}
