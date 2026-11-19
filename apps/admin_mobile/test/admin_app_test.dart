import 'package:edmn_admin/src/app.dart';
import 'package:edmn_admin/src/providers.dart';
import 'package:edmn_api/admin.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart' show ErrorView;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

final _config = BuildConfig(environment: AppEnvironment.local, apiBaseUrl: 'http://localhost', appVersion: '1.0.0');

class FakeAdminApi extends AdminApi {
  FakeAdminApi({this.enrolled = true, this.permissions = const ['customers.manage', 'dashboard.view']})
      : super(ApiClient(config: _config, store: MemorySessionStore(), refreshPath: '/r', telemetry: Telemetry([])));
  final bool enrolled;
  final List<String> permissions;
  bool verified = false;
  bool steppedUp = false;
  int revokeAttempts = 0;
  final keys = <String>[];

  @override
  Future<SessionResult> login({required String identifier, required String password, required DeviceInfo device}) async => SessionResult(
      user: const SessionResultUser(id: 'a', fullName: 'مسؤول', isStaff: true),
      tokens: TokenPair(accessToken: 'em1.a.b', accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: 'r' * 40, sessionExpiresAt: '2030-01-01T00:00:00Z'),
      deviceId: 'd', mfa: SessionResultMfa(required: true, enrolled: enrolled));

  @override
  Future<AdminMfaEnrollResponse> enrollTotp() async => const AdminMfaEnrollResponse(secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x');

  @override
  Future<void> verifyTotp(String code) async {
    if (code != '123456') throw const ApiFailure(code: ApiErrorCode.unauthenticated, status: 401);
    verified = true;
  }

  @override
  Future<void> stepUp(String code) async => steppedUp = code == '654321';

  @override
  Future<Profile> me() async {
    if (!verified) throw const ApiFailure(code: ApiErrorCode.mfaRequired, status: 401);
    return Profile(id: 'a', fullName: 'مسؤول العمليات', email: 'ops@test.local', phone: null, locale: 'ar', emailVerified: true, phoneVerified: true, isStaff: true, totpEnrolled: true, permissions: permissions);
  }

  final dashboardRanges = <String>[];
  bool dashboardForbidden = false;
  bool realMoney = false;

  @override
  Future<AdminGetDashboardResponse> dashboard({String range = '30d'}) async {
    dashboardRanges.add(range);
    if (dashboardForbidden) throw const ApiFailure(code: ApiErrorCode.forbidden, status: 403);
    return AdminGetDashboardResponse(
      range: range,
      realMoney: realMoney,
      kpis: const AdminGetDashboardResponseKpis(gmv: 1234550, revenue: 61700, ordersTotal: 12, ordersPaid: 9, aov: 137172, deals: 3, dealsValue: 500000, activeBuyers: 7, activeSellers: 4, returnRate: 0.05, disputeRate: 0.0),
      queues: const AdminGetDashboardResponseQueues(pendingSellers: 2, pendingProducts: 0, pendingPayments: 1, pendingWithdrawals: 1, pendingWithdrawalsAmount: 250000, pendingRefunds: 0, openDisputes: 1, openTickets: 3, unconfirmedDeliveries: 0),
      topCategories: const [AdminGetDashboardResponseTopCategoriesItem(name: 'موبايلات', gmv: 900000)],
      topSellers: const [],
      daily: const [],
    );
  }

  @override
  Future<int> revokeUserSessions(String userId, {required String reason, required String idempotencyKey}) async {
    revokeAttempts++;
    keys.add(idempotencyKey);
    if (!steppedUp) throw const ApiFailure(code: ApiErrorCode.stepUpRequired, status: 401);
    return 3;
  }
}

Widget _app(FakeAdminApi api) => ProviderScope(overrides: [
      buildConfigProvider.overrideWithValue(_config),
      sessionStoreProvider.overrideWithValue(MemorySessionStore()),
      adminApiProvider.overrideWithValue(api),
    ], child: const AdminApp());

Future<void> _ready(WidgetTester t) async {
  await _signIn(t);
  await t.enterText(find.byKey(const Key('totp')), '123456');
  await t.tap(find.byKey(const Key('verify')));
  await t.pumpAndSettle();
}

Future<void> _signIn(WidgetTester t) async {
  await t.enterText(find.byKey(const Key('identifier')), 'ops@test.local');
  await t.enterText(find.byKey(const Key('password')), 'Test@12345');
  await t.tap(find.byKey(const Key('submit')));
  await t.pumpAndSettle();
}

void main() {
  testWidgets('nothing is reachable before sign-in and TOTP; a wrong code is refused', (t) async {
    final api = FakeAdminApi();
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('identifier')), findsOneWidget);
    await _signIn(t);
    expect(find.byKey(const Key('totp')), findsOneWidget);
    expect(find.byKey(const Key('totp-secret')), findsNothing);
    await t.enterText(find.byKey(const Key('totp')), '000000');
    await t.tap(find.byKey(const Key('verify')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('error')), findsOneWidget);
    await t.enterText(find.byKey(const Key('totp')), '123456');
    await t.tap(find.byKey(const Key('verify')));
    await t.pumpAndSettle();
    expect(find.text('مسؤول العمليات'), findsOneWidget);
    expect(find.byKey(const Key('permission-count')), findsOneWidget);
    expect(Directionality.of(t.element(find.text('مسؤول العمليات'))), TextDirection.rtl);
  });

  testWidgets('accounts without an authenticator are enrolled first', (t) async {
    await t.pumpWidget(_app(FakeAdminApi(enrolled: false)));
    await t.pumpAndSettle();
    await _signIn(t);
    expect(find.byKey(const Key('totp-secret')), findsOneWidget);
  });

  testWidgets('revoking another account: step-up when the server asks, then success with a fresh idempotency key', (t) async {
    final api = FakeAdminApi();
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _signIn(t);
    await t.enterText(find.byKey(const Key('totp')), '123456');
    await t.tap(find.byKey(const Key('verify')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('revoke-user-sessions')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('user-id')), '00000000-0000-4000-8000-000000000001');
    await t.enterText(find.byKey(const Key('reason')), 'هاتف مفقود');
    await t.tap(find.byKey(const Key('submit')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('step-up-code')), '654321');
    await t.tap(find.byKey(const Key('step-up-confirm')));
    await t.pumpAndSettle();
    expect(api.steppedUp, isTrue);
    expect(api.revokeAttempts, 2);
    expect(api.keys.toSet().length, 2);
    expect(find.byKey(const Key('result')), findsOneWidget);
  });

  testWidgets('the security action is hidden without the server permission', (t) async {
    final api = FakeAdminApi(permissions: const ['dashboard.view']);
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _signIn(t);
    await t.enterText(find.byKey(const Key('totp')), '123456');
    await t.tap(find.byKey(const Key('verify')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('revoke-user-sessions')), findsNothing);
  });

  testWidgets('the app is covered whenever it leaves the foreground (app-switcher snapshot), and uncovered on return', (t) async {
    await t.pumpWidget(_app(FakeAdminApi()));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('privacy-shield')), findsNothing);
    for (final state in [AppLifecycleState.inactive, AppLifecycleState.hidden, AppLifecycleState.paused]) {
      t.binding.handleAppLifecycleStateChanged(state);
      await t.pump();
      expect(find.byKey(const Key('privacy-shield')), findsOneWidget, reason: '$state');
    }
    // Coming back goes through the real order; the cover stays until the app is fully in front again.
    for (final state in [AppLifecycleState.hidden, AppLifecycleState.inactive]) {
      t.binding.handleAppLifecycleStateChanged(state);
      await t.pump();
      expect(find.byKey(const Key('privacy-shield')), findsOneWidget, reason: '$state');
    }
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await t.pump();
    expect(find.byKey(const Key('privacy-shield')), findsNothing);
  });

  testWidgets('dashboard: server figures in EGP, test-money notice while Real Money is OFF, range reloads', (t) async {
    final api = FakeAdminApi();
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await t.tap(find.byKey(const Key('open-dashboard')));
    await t.pumpAndSettle();
    expect(api.dashboardRanges, ['30d']);
    expect(find.byKey(const Key('test-money-notice')), findsOneWidget);
    expect(find.text('12,345.5 ج.م'), findsOneWidget); // 1,234,550 piastres, formatted like the web formatEGP
    expect(find.text('2,500 ج.م'), findsOneWidget); // pending withdrawals amount
    await t.scrollUntilVisible(find.text('موبايلات'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('موبايلات'), findsOneWidget);
    await t.drag(find.byType(ListView).first, const Offset(0, 2000));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('range-7d')));
    await t.pumpAndSettle();
    expect(api.dashboardRanges.last, '7d');
  });

  testWidgets('dashboard: the entry is hidden without dashboard.view', (t) async {
    final noPerm = FakeAdminApi(permissions: const ['customers.manage']);
    await t.pumpWidget(_app(noPerm));
    await t.pumpAndSettle();
    await _ready(t);
    expect(find.byKey(const Key('open-dashboard')), findsNothing);
  });

  testWidgets('dashboard: a server refusal shows an error, never figures', (t) async {
    final refused = FakeAdminApi()..dashboardForbidden = true;
    await t.pumpWidget(_app(refused));
    await t.pumpAndSettle();
    await _ready(t);
    await t.tap(find.byKey(const Key('open-dashboard')));
    await t.pumpAndSettle();
    expect(find.byType(ErrorView), findsOneWidget);
    expect(find.byKey(const Key('kpi-gmv')), findsNothing);
  });

  testWidgets('dashboard: no test-money notice when the server reports Real Money ON', (t) async {
    final api = FakeAdminApi()..realMoney = true;
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await t.tap(find.byKey(const Key('open-dashboard')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('kpi-gmv')), findsOneWidget);
    expect(find.byKey(const Key('test-money-notice')), findsNothing);
  });
}
