import 'package:edmn_admin/src/app.dart';
import 'package:edmn_admin/src/providers.dart';
import 'package:edmn_api/admin.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart' show CaptchaSolver, ErrorView;
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

  /// SEC-194: when set, sign-in is refused (the way the server does) until the request carries a captchaToken.
  bool captchaRequired = false;
  final loginCaptchaTokens = <String?>[];

  @override
  Future<SessionResult> login({required String identifier, required String password, required DeviceInfo device, String? captchaToken}) async {
    loginCaptchaTokens.add(captchaToken);
    if (captchaRequired && captchaToken != 'solved-token') {
      throw const ApiFailure(code: ApiErrorCode.validationFailed, status: 422, fieldErrors: {'captcha': ['التحقق مطلوب']});
    }
    return _session();
  }

  SessionResult _session() => SessionResult(
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
    return Profile(id: 'a', fullName: 'مسؤول العمليات', email: 'ops@test.local', phone: null, locale: 'ar', emailVerified: true, phoneVerified: true, isStaff: true, totpEnrolled: true, marketingOptIn: false, permissions: permissions);
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

  final calls = <String>[];
  bool monitorForbidden = false;
  void _gate(String c) {
    calls.add(c);
    if (monitorForbidden) throw const ApiFailure(code: ApiErrorCode.forbidden, status: 403);
  }

  @override
  Future<AdminListSellerApplicationsResponse> sellerApplications({String tab = 'pending'}) async {
    _gate('sellers:$tab');
    return AdminListSellerApplicationsResponse(items: [
      AdminListSellerApplicationsResponseItemsItem(id: 's-$tab', applicant: 'سلمى ع.', storeName: 'متجر سلمى', type: 'INDIVIDUAL', status: tab == 'info' ? 'MORE_INFO_REQUIRED' : 'PENDING_REVIEW', riskLevel: 'LOW', submittedAt: '2026-11-18T10:00:00Z'),
    ]);
  }

  @override
  Future<AdminListIdentityReviewsResponse> identityReviews({String tab = 'pending'}) async {
    _gate('identity:$tab');
    return const AdminListIdentityReviewsResponse(items: [AdminListIdentityReviewsResponseItemsItem(id: 'k1', name: 'كريم م.', status: 'PENDING_REVIEW', documentsComplete: true, submittedAt: '2026-11-18T10:00:00Z', reviewedAt: null)]);
  }

  @override
  Future<AdminListOrdersResponse> orders({String tab = 'all', String? q, int page = 1}) async {
    _gate('orders:$tab:$page${q == null || q.isEmpty ? '' : ':$q'}');
    return AdminListOrdersResponse(
      items: [AdminListOrdersResponseItemsItem(id: 'o$page', orderId: 'o$page', number: '10000$page', customer: 'عمر ا.', store: null, status: 'PENDING_PAYMENT', total: 1937898, at: '2026-11-19T10:00:00Z', sellerOrders: 1)],
      page: page,
      hasMore: page == 1,
    );
  }

  @override
  Future<AdminListDealsResponse> deals({String tab = 'active'}) async {
    _gate('deals:$tab');
    return const AdminListDealsResponse(items: [AdminListDealsResponseItemsItem(id: 'd1', number: '5001', title: 'لابتوب مستعمل', buyer: 'منى أ.', seller: null, sellerConfirmed: false, status: 'ACTIVE', buyerPays: 1500000, updatedAt: '2026-11-19T10:00:00Z')]);
  }

  @override
  Future<AdminListDisputesResponse> disputes({String tab = 'open'}) async {
    _gate('disputes:$tab');
    return AdminListDisputesResponse(items: [
      if (tab != 'closed') AdminListDisputesResponseItemsItem(id: 'x1', number: '7001', kind: 'ORDER', claimant: 'أحمد م.', reasonCode: 'NOT_AS_DESCRIBED', claimedAmount: 40000, status: 'OPEN', assignedToMe: tab == 'mine', createdAt: '2026-11-19T10:00:00Z'),
    ]);
  }

  @override
  Future<AdminListAuditLogResponse> auditLog({int? before, String? action, String? actorType}) async {
    _gate('audit:${before ?? '-'}${actorType == null ? '' : ':$actorType'}${action == null || action.isEmpty ? '' : ':$action'}');
    return AdminListAuditLogResponse(
      items: [AdminListAuditLogResponseItemsItem(id: before == null ? 900 : 800, at: '2026-11-19T10:00:00Z', actorType: 'ADMIN', actor: 'مسؤول ا.', action: before == null ? 'seller.approved' : 'payment.confirmed', entityType: 'seller', entityId: 'e1', channel: 'WEB', hasReason: false)],
      nextBefore: before == null ? 900 : null,
    );
  }

  // ── Batch 3: details and the two safe dispute actions ──
  String? assignedTo;
  final notes = <String>[];
  final actionKeys = <String>[];
  bool assignRefused = false;

  @override
  Future<AdminGetSellerResponse> seller(String id) async {
    _gate('seller:$id');
    return AdminGetSellerResponse(id: id, applicant: 'سلمى ع.', type: 'INDIVIDUAL', status: 'PENDING_REVIEW', riskLevel: 'LOW', governorate: 'القاهرة', storeName: 'متجر سلمى', submittedAt: '2026-11-18T10:00:00Z',
        checklist: const [AdminGetSellerResponseChecklistItem(key: 'id_front', label: 'صورة البطاقة (الوجه)', ok: true), AdminGetSellerResponseChecklistItem(key: 'payout', label: 'بيانات استلام الأموال', ok: false)],
        documents: null, history: const []);
  }

  @override
  Future<AdminGetOrderResponse> order(String id) async {
    _gate('order:$id');
    return AdminGetOrderResponse(id: id, number: '100001', status: 'PAID', customer: 'عمر ا.', placedAt: '2026-11-19T10:00:00Z', paidAt: '2026-11-19T11:00:00Z',
        totals: const AdminGetOrderResponseTotals(merchandise: 1900000, shipping: 0, grand: 1937898), payment: const AdminGetOrderResponsePayment(method: 'INSTAPAY', status: 'CONFIRMED', amount: 1937898),
        sellerOrders: const [
          AdminGetOrderResponseSellerOrdersItem(id: 'so1', number: '100001-1', store: 'تك زون', status: 'SHIPPED', total: 1937898, items: [AdminGetOrderResponseSellerOrdersItemItemsItem(title: 'سامسونج A55', quantity: 1, lineTotal: 1899900)],
              shipment: AdminGetOrderResponseSellerOrdersItemShipment(status: 'SHIPPED', carrier: 'بوسطة', trackingNumber: 'BST123', shippedAt: '2026-11-19T12:00:00Z', expectedAt: null, exception: null,
                  events: [AdminGetOrderResponseSellerOrdersItemShipmentEventsItem(status: 'SHIPPED', description: 'خرجت من المخزن', at: '2026-11-19T12:00:00Z')]),
              followUpFlaggedAt: null),
        ],
        history: const [AdminGetOrderResponseHistoryItem(entityType: 'order', from: 'PENDING_PAYMENT', to: 'PAID', actorType: 'ADMIN', actor: 'مسؤول ا.', note: null, at: '2026-11-19T11:00:00Z')]);
  }

  @override
  Future<AdminGetDisputeResponse> dispute(String id) async {
    _gate('dispute:$id');
    return AdminGetDisputeResponse(id: id, number: '7001', status: 'OPEN', reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج مختلف عن الوصف', claimedAmount: 40000, claimant: 'أحمد م.', respondent: 'تك ز.',
        assignee: assignedTo == null ? null : AdminGetDisputeResponseAssignee(id: assignedTo!, name: 'منى ع.', isMe: false),
        subject: const AdminGetDisputeResponseSubject(kind: 'ORDER', number: '100001-1', id: 'o1'), createdAt: '2026-11-19T10:00:00Z',
        messages: [for (var i = 0; i < notes.length; i++) AdminGetDisputeResponseMessagesItem(id: 'm$i', authorRole: 'ADMIN', author: 'مسؤول ا.', internal: true, body: notes[i], at: '2026-11-19T13:00:00Z')],
        evidence: const [AdminGetDisputeResponseEvidenceItem(uploadedBy: 'أحمد م.', note: 'صورة المنتج', at: '2026-11-19T10:05:00Z')], history: const []);
  }

  @override
  Future<AdminListDisputeAssigneesResponse> disputeAssignees() async => const AdminListDisputeAssigneesResponse(items: [
        AdminListDisputeAssigneesResponseItemsItem(id: 'u-me', name: 'مسؤول ا.', isMe: true),
        AdminListDisputeAssigneesResponseItemsItem(id: 'u-mona', name: 'منى ع.', isMe: false),
      ]);

  @override
  Future<void> assignDispute(String disputeId, String assigneeId, {required String idempotencyKey}) async {
    actionKeys.add(idempotencyKey);
    if (assignRefused) throw const ApiFailure(code: ApiErrorCode.validationFailed, status: 422);
    assignedTo = assigneeId;
  }

  @override
  Future<void> addDisputeNote(String disputeId, String body, {required String idempotencyKey}) async {
    actionKeys.add(idempotencyKey);
    notes.add(body);
  }

  @override
  Future<int> revokeUserSessions(String userId, {required String reason, required String idempotencyKey}) async {
    revokeAttempts++;
    keys.add(idempotencyKey);
    if (!steppedUp) throw const ApiFailure(code: ApiErrorCode.stepUpRequired, status: 401);
    return 3;
  }
}

Widget _app(FakeAdminApi api, {CaptchaSolver? solver}) => ProviderScope(overrides: [
      if (solver != null) captchaSolverProvider.overrideWithValue(solver),
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

void captchaTests() {
  testWidgets('SEC-194: no CAPTCHA is shown or sent while the server does not ask for one', (t) async {
    var solverCalls = 0;
    final api = FakeAdminApi();
    await t.pumpWidget(_app(api, solver: (context, url) async {
      solverCalls++;
      return 'solved-token';
    }));
    await t.pumpAndSettle();
    await _signIn(t);
    expect(solverCalls, 0);
    expect(api.loginCaptchaTokens, [null]);
    expect(find.byKey(const Key('totp')), findsOneWidget);
  });

  testWidgets('SEC-194: when the server asks, the app shows the CAPTCHA and retries the same sign-in with the token', (t) async {
    Uri? shown;
    final api = FakeAdminApi()..captchaRequired = true;
    await t.pumpWidget(_app(api, solver: (context, url) async {
      shown = url;
      return 'solved-token';
    }));
    await t.pumpAndSettle();
    await _signIn(t);
    expect(shown?.path, '/captcha/mobile');
    expect(api.loginCaptchaTokens, [null, 'solved-token']);
    expect(find.byKey(const Key('totp')), findsOneWidget); // reached the second step
  });

  testWidgets('SEC-194: closing the CAPTCHA does not sign in and shows the reason', (t) async {
    final api = FakeAdminApi()..captchaRequired = true;
    await t.pumpWidget(_app(api, solver: (context, url) async => null));
    await t.pumpAndSettle();
    await _signIn(t);
    expect(api.loginCaptchaTokens, [null]);
    expect(find.byKey(const Key('totp')), findsNothing);
    expect(find.byKey(const Key('error')), findsOneWidget);
    expect(find.textContaining('مش روبوت'), findsOneWidget);
  });
}

void main() {
  captchaTests();
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

  testWidgets('monitoring: the home menu shows exactly the screens the server permissions allow', (t) async {
    final api = FakeAdminApi(permissions: const ['orders.view', 'disputes.manage']);
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    expect(find.byKey(const Key('open-/monitor/orders')), findsOneWidget);
    expect(find.byKey(const Key('open-/monitor/disputes')), findsOneWidget);
    for (final hidden in ['sellers', 'identity', 'deals', 'audit']) {
      expect(find.byKey(Key('open-/monitor/$hidden')), findsNothing, reason: hidden);
    }
  });

  testWidgets('monitoring: every screen renders server rows with labelled status, EGP and the read-only notice', (t) async {
    final api = FakeAdminApi(permissions: const ['sellers.review', 'identity.view', 'orders.view', 'deals.view', 'disputes.manage', 'audit.view']);
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    final expectations = {
      '/monitor/sellers': ('متجر سلمى', 'قيد المراجعة'),
      '/monitor/identity': ('كريم م.', 'قيد المراجعة'),
      '/monitor/orders': ('#100001', 'في انتظار الدفع'),
      '/monitor/deals': ('#5001 · لابتوب مستعمل', 'نشطة'),
      '/monitor/disputes': ('#7001', 'مفتوح'),
      '/monitor/audit': ('seller.approved', 'ADMIN'),
    };
    for (final e in expectations.entries) {
      await t.tap(find.byKey(Key('open-${e.key}')));
      await t.pumpAndSettle();
      expect(find.byKey(const Key('read-only-notice')), findsOneWidget, reason: e.key);
      expect(find.text(e.value.$1), findsOneWidget, reason: e.key);
      expect(find.text(e.value.$2), findsWidgets, reason: e.key);
      await t.tap(find.byType(BackButton));
      await t.pumpAndSettle();
    }
    // Money is the server's piastres, formatted like the web formatEGP.
    await t.tap(find.byKey(const Key('open-/monitor/deals')));
    await t.pumpAndSettle();
    expect(find.text('15,000 ج.م'), findsOneWidget);
    expect(find.text('البائع لم ينضم بعد'), findsOneWidget);
  });

  testWidgets('monitoring: tabs reload from the server; pages load more; audit pages by keyset', (t) async {
    final api = FakeAdminApi(permissions: const ['sellers.review', 'orders.view', 'disputes.manage', 'audit.view']);
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await t.tap(find.byKey(const Key('open-/monitor/sellers')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('tab-info')));
    await t.pumpAndSettle();
    expect(api.calls, containsAllInOrder(['sellers:pending', 'sellers:info']));
    expect(find.text('مطلوب معلومات'), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const Key('open-/monitor/orders')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('load-more')));
    await t.pumpAndSettle();
    expect(api.calls, containsAllInOrder(['orders:all:1', 'orders:all:2']));
    expect(find.text('#100001'), findsOneWidget);
    expect(find.text('#100002'), findsOneWidget);
    expect(find.byKey(const Key('load-more')), findsNothing);
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const Key('open-/monitor/disputes')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('tab-closed')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('empty')), findsOneWidget);
    await t.tap(find.byKey(const Key('tab-mine')));
    await t.pumpAndSettle();
    expect(find.text('مسند إليك'), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const Key('open-/monitor/audit')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('load-more')));
    await t.pumpAndSettle();
    expect(api.calls, containsAllInOrder(['audit:-', 'audit:900']));
    expect(find.text('payment.confirmed'), findsOneWidget);
  });

  testWidgets('monitoring: a server refusal shows the error state, never rows', (t) async {
    final api = FakeAdminApi(permissions: const ['deals.view'])..monitorForbidden = true;
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await t.tap(find.byKey(const Key('open-/monitor/deals')));
    await t.pumpAndSettle();
    expect(find.byType(ErrorView), findsOneWidget);
    expect(find.byKey(const Key('row-d1')), findsNothing);
  });

  Future<void> openFrom(WidgetTester t, String spec, String rowId) async {
    await t.tap(find.byKey(Key('open-$spec')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(Key('row-$rowId')));
    await t.pumpAndSettle();
  }

  testWidgets('details: a row opens its detail with server figures, tracking timeline and the read-only notice', (t) async {
    final api = FakeAdminApi(permissions: const ['orders.view', 'sellers.review', 'sellers.view']);
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await openFrom(t, '/monitor/orders', 'o1');
    expect(api.calls, contains('order:o1'));
    expect(find.text('#100001'), findsOneWidget);
    expect(find.text('19,378.98 ج.م'), findsWidgets);
    expect(find.text('BST123'), findsOneWidget);
    await t.scrollUntilVisible(find.text('خرجت من المخزن'), 200, scrollable: find.byType(Scrollable).last);
    expect(find.text('خرجت من المخزن'), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    await openFrom(t, '/monitor/sellers', 's-pending');
    expect(find.text('متجر سلمى'), findsWidgets);
    expect(find.byKey(const Key('docs-hidden')), findsOneWidget); // no documents permission → metadata hidden
    // Each checklist row is one accessible sentence: «label: yes/no».
    expect(find.bySemanticsLabel(RegExp(r'بيانات استلام الأموال: لا')), findsOneWidget);
  });

  testWidgets('dispute: assign to a colleague and add an internal note, each with its own idempotency key', (t) async {
    final api = FakeAdminApi(permissions: const ['disputes.manage']);
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await openFrom(t, '/monitor/disputes', 'x1');
    expect(find.text('غير مسند'), findsOneWidget);
    await t.tap(find.byKey(const Key('assign')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('assignee-u-mona')));
    await t.pumpAndSettle();
    expect(api.assignedTo, 'u-mona');
    expect(find.text('تم إسناد النزاع'), findsOneWidget);
    expect(find.textContaining('منى ع.'), findsWidgets);

    await t.tap(find.byKey(const Key('add-note')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('note-text')), 'راجعت الصور، محتاجين رد البائع');
    await t.tap(find.byKey(const Key('note-save')));
    await t.pumpAndSettle();
    expect(api.notes, ['راجعت الصور، محتاجين رد البائع']);
    expect(find.text('راجعت الصور، محتاجين رد البائع'), findsOneWidget);
    expect(find.textContaining('ملاحظة داخلية'), findsWidgets);
    expect(api.actionKeys.toSet().length, 2);
  });

  testWidgets('dispute: a refused assignment shows the server error and changes nothing', (t) async {
    final api = FakeAdminApi(permissions: const ['disputes.manage'])..assignRefused = true;
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await openFrom(t, '/monitor/disputes', 'x1');
    await t.tap(find.byKey(const Key('assign')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('assignee-u-mona')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('action-error')), findsOneWidget);
    expect(find.text('غير مسند'), findsOneWidget);
  });

  testWidgets('search and filters go to the server: order search, audit actor tab + action filter', (t) async {
    final api = FakeAdminApi(permissions: const ['orders.view', 'audit.view']);
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await t.tap(find.byKey(const Key('open-/monitor/orders')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('search')), '100001');
    await t.testTextInput.receiveAction(TextInputAction.search);
    await t.pumpAndSettle();
    expect(api.calls.last, 'orders:all:1:100001');
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('open-/monitor/audit')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('tab-SELLER')));
    await t.pumpAndSettle();
    expect(api.calls.last, 'audit:-:SELLER');
    await t.enterText(find.byKey(const Key('search')), 'dispute');
    await t.testTextInput.receiveAction(TextInputAction.search);
    await t.pumpAndSettle();
    expect(api.calls.last, 'audit:-:SELLER:dispute');
    expect(find.byKey(const Key('row-900')), findsOneWidget);
  });

  testWidgets('a detail the server refuses shows the error with retry, not stale data', (t) async {
    final api = FakeAdminApi(permissions: const ['orders.view']);
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await t.tap(find.byKey(const Key('open-/monitor/orders')));
    await t.pumpAndSettle();
    api.monitorForbidden = true;
    await t.tap(find.byKey(const Key('row-o1')));
    await t.pumpAndSettle();
    expect(find.byType(ErrorView), findsOneWidget);
    expect(find.text('BST123'), findsNothing);
  });

  testWidgets('English is left-to-right with English labels', (t) async {
    final api = FakeAdminApi(permissions: const ['disputes.manage']);
    await t.pumpWidget(_app(api));
    await t.pumpAndSettle();
    await _ready(t);
    await t.tap(find.byTooltip('اللغة'));
    await t.pumpAndSettle();
    await openFrom(t, '/monitor/disputes', 'x1');
    expect(find.text('Unassigned'), findsOneWidget);
    expect(find.text('Assign'), findsOneWidget);
    expect(Directionality.of(t.element(find.text('Unassigned'))), TextDirection.ltr);
  });
}
