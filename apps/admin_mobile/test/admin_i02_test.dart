import 'package:edmn_admin/src/app.dart';
import 'package:edmn_admin/src/providers.dart';
import 'package:edmn_api/admin.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Admin App screens for the Instinct I02 endpoints (issue #7): returns monitoring, customer 360, support inbox with the
/// one approved write (staff reply), and the operational alerts inbox. Everything else stays on the web console.
final _config = BuildConfig(environment: AppEnvironment.local, apiBaseUrl: 'http://localhost', appVersion: '1.0.0');

class _Api extends AdminApi {
  _Api(this.permissions) : super(ApiClient(config: _config, store: MemorySessionStore(), refreshPath: '/r', telemetry: Telemetry([])));
  final List<String> permissions;
  final calls = <String>[];
  final replies = <(String, String, String)>[];
  bool replyRefused = false;

  @override
  Future<SessionResult> login({required String identifier, required String password, required DeviceInfo device}) async => SessionResult(
      user: const SessionResultUser(id: 'a', fullName: 'مسؤول', isStaff: true),
      tokens: TokenPair(accessToken: 'em1.a.b', accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: 'r' * 40, sessionExpiresAt: '2030-01-01T00:00:00Z'),
      deviceId: 'd',
      mfa: const SessionResultMfa(required: true, enrolled: true));
  @override
  Future<void> verifyTotp(String code) async {}
  @override
  Future<Profile> me() async => Profile(id: 'a', fullName: 'مسؤول الدعم', email: 'ops@test.local', phone: null, locale: 'ar', emailVerified: true, phoneVerified: true, isStaff: true, totpEnrolled: true, marketingOptIn: false, permissions: permissions);
  @override
  Future<AdminListMySessionsResponse> mySessions() async => const AdminListMySessionsResponse(items: []);

  @override
  Future<AdminListReturnsResponse> returns({String tab = 'pending', String? q, int page = 1}) async {
    calls.add('returns:$tab:${q ?? ''}');
    return const AdminListReturnsResponse(items: [
      AdminListReturnsResponseItemsItem(id: 'r1', number: '500031', status: 'REQUESTED', nextAction: 'Review and approve or reject on the web console', reason: 'DAMAGED', store: 'تك زون', customer: 'منى خ.', refundAmount: null, createdAt: '2026-11-24T10:00:00Z'),
    ], page: 1, hasMore: false);
  }

  @override
  Future<AdminReturnDetailResponse> returnDetail(String id) async {
    calls.add('return:$id');
    return const AdminReturnDetailResponse(id: 'r1', number: '500031', status: 'REQUESTED', nextAction: 'Review and approve or reject on the web console', reason: 'DAMAGED', description: 'الشاشة وصلت مكسورة',
        isStatutory: true, decisionReason: null, returnCarrier: null, returnTracking: null, inspectionNote: null, refundAmount: null, includeShipping: false,
        items: [AdminReturnDetailResponseItemsItem(orderItemId: 'i1', quantity: 1, unitPrice: 1899900)], evidenceCount: 2, createdAt: '2026-11-24T10:00:00Z', updatedAt: null);
  }

  @override
  Future<AdminListCustomersResponse> customers({String? q, int page = 1}) async {
    calls.add('customers:${q ?? ''}');
    return const AdminListCustomersResponse(items: [
      AdminListCustomersResponseItemsItem(id: 'u1', name: 'منى خالد', email: 'mo***@demo.edmn.local', phone: '+2010*****777', status: 'ACTIVE', orderCount: 7, createdAt: '2026-01-01T00:00:00Z'),
    ], page: 1, hasMore: false);
  }

  @override
  Future<AdminCustomerDetailResponse> customer(String userId) async {
    calls.add('customer:$userId');
    return const AdminCustomerDetailResponse(id: 'u1', name: 'منى خالد', email: 'mo***@demo.edmn.local', emailVerified: true, phone: '+2010*****777', phoneVerified: false, status: 'ACTIVE',
        lastLoginAt: '2026-11-24T09:00:00Z', addresses: ['سموحة، الإسكندرية'], counts: AdminCustomerDetailResponseCounts(orders: 7, returns: 2, disputes: 1, supportTickets: 3, deals: 0, reviews: 4),
        recentOrders: [AdminCustomerDetailResponseRecentOrdersItem(id: 'o1', number: '100043', status: 'COMPLETED', grandTotal: 1937898, placedAt: '2026-11-24T08:00:00Z')], createdAt: '2026-01-01T00:00:00Z');
  }

  @override
  Future<AdminListSupportTicketsResponse> supportTickets({String tab = 'open', int page = 1}) async {
    calls.add('tickets:$tab');
    return const AdminListSupportTicketsResponse(items: [
      AdminListSupportTicketsResponseItemsItem(id: 't1', number: '1042', subject: 'مشكلة في الدفع', type: 'PAYMENT', fromSeller: false, requester: 'منى خ.', priority: 'HIGH', status: 'OPEN', assignedToMe: true, updatedAt: '2026-11-24T11:00:00Z'),
    ], page: 1, hasMore: false);
  }

  @override
  Future<AdminSupportTicketDetailResponse> supportTicket(String id) async {
    calls.add('ticket:$id');
    return AdminSupportTicketDetailResponse(id: 't1', number: '1042', type: 'PAYMENT', subject: 'مشكلة في الدفع', status: 'OPEN', priority: 'HIGH', fromSeller: false, assignedToMe: true, messages: [
      const AdminSupportTicketDetailResponseMessagesItem(id: 'm1', isStaff: false, isInternal: false, author: 'منى خ.', body: 'رفعت الإيصال ولسه مستني', hasAttachment: true, createdAt: '2026-11-24T10:00:00Z'),
      for (final (i, r) in replies.indexed) AdminSupportTicketDetailResponseMessagesItem(id: 'r$i', isStaff: true, isInternal: false, author: 'فريق الدعم', body: r.$2, hasAttachment: false, createdAt: null),
    ], createdAt: '2026-11-24T10:00:00Z', updatedAt: null);
  }

  @override
  Future<void> replySupportTicket(String ticketId, String body, {required String idempotencyKey}) async {
    if (replyRefused) throw const ApiFailure(code: ApiErrorCode.forbidden, status: 403);
    replies.add((ticketId, body, idempotencyKey));
  }

  @override
  Future<AdminListClosureRequestsResponse> closureRequests({String tab = 'open'}) async {
    calls.add('closures:$tab');
    return AdminListClosureRequestsResponse(items: [
      if (tab == 'open') const AdminListClosureRequestsResponseItemsItem(id: 'c1', customer: 'عميل ا.', status: 'PENDING', createdAt: '2026-11-25T09:00:00Z'),
    ]);
  }

  @override
  Future<AdminListAlertsResponse> alerts({String? stage, String? rule, int page = 1}) async {
    calls.add('alerts:${stage ?? 'all'}');
    return const AdminListAlertsResponse(rules: [
      AdminListAlertsResponseRulesItem(code: 'SEC_LEDGER_HEALTH', title: 'فحص سلامة الدفتر غير سليم', category: 'SECURITY', severity: 'CRITICAL', staffPermission: 'finance.view', enabled: true, openCount: 1),
    ], items: [
      AdminListAlertsResponseItemsItem(id: 'a1', rule: 'SEC_LEDGER_HEALTH', stage: 'OVERDUE', severity: 'CRITICAL', ref: 'CRITICAL', sentCount: 3, deadlineAt: null, lastSentAt: '2026-11-24T12:00:00Z', updatedAt: null),
    ], page: 1, hasMore: false);
  }
}

Widget _app(_Api api) => ProviderScope(overrides: [
      buildConfigProvider.overrideWithValue(_config),
      sessionStoreProvider.overrideWithValue(MemorySessionStore()),
      adminApiProvider.overrideWithValue(api),
    ], child: const AdminApp());

Future<void> _ready(WidgetTester t, _Api api) async {
  t.view.physicalSize = const Size(1170, 2532);
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
  await t.pumpWidget(_app(api));
  await t.pumpAndSettle();
  await t.enterText(find.byKey(const Key('identifier')), 'ops@test.local');
  await t.enterText(find.byKey(const Key('password')), 'Test@12345');
  await t.tap(find.byKey(const Key('submit')));
  await t.pumpAndSettle();
  await t.enterText(find.byKey(const Key('totp')), '123456');
  await t.tap(find.byKey(const Key('verify')));
  await t.pumpAndSettle();
}

Future<void> _open(WidgetTester t, String path, [String? rowId]) async {
  final entry = find.byKey(Key('open-$path'));
  await t.scrollUntilVisible(entry, 200, scrollable: find.byType(Scrollable).first);
  await t.tap(entry);
  await t.pumpAndSettle();
  if (rowId != null) {
    await t.tap(find.byKey(Key('row-$rowId')));
    await t.pumpAndSettle();
  }
}

void main() {
  testWidgets('menu: each new screen appears only with its server permission; alerts accept either permission', (t) async {
    await _ready(t, _Api(const ['returns.manage', 'support.manage']));
    expect(find.byKey(const Key('open-/monitor/returns')), findsOneWidget);
    expect(find.byKey(const Key('open-/monitor/support')), findsOneWidget);
    expect(find.byKey(const Key('open-/monitor/customers')), findsNothing);
    expect(find.byKey(const Key('open-/monitor/alerts')), findsNothing);
  });

  testWidgets('alerts entry with settings.manage only; customers with customers.view only', (t) async {
    await _ready(t, _Api(const ['settings.manage', 'customers.view']));
    expect(find.byKey(const Key('open-/monitor/alerts')), findsOneWidget);
    expect(find.byKey(const Key('open-/monitor/customers')), findsOneWidget);
    expect(find.byKey(const Key('open-/monitor/returns')), findsNothing);
  });

  testWidgets('closures: entry follows the web page permission (customers.view or customers.manage); list is masked and read-only', (t) async {
    final api = _Api(const ['customers.view']);
    await _ready(t, api);
    expect(find.byKey(const Key('open-/monitor/closures')), findsOneWidget);
    await _open(t, '/monitor/closures');
    expect(api.calls, contains('closures:open'));
    expect(find.text('عميل ا.'), findsOneWidget);
    expect(find.text('PENDING'), findsOneWidget);
  });

  testWidgets('closures: hidden without either customer permission', (t) async {
    await _ready(t, _Api(const ['returns.manage']));
    expect(find.byKey(const Key('open-/monitor/closures')), findsNothing);
  });

  testWidgets('returns: list → detail shows the Arabic next step from the status, no decision button, the web-console notice', (t) async {
    final api = _Api(const ['returns.manage']);
    await _ready(t, api);
    await _open(t, '/monitor/returns', 'r1');
    expect(api.calls, containsAll(['returns:pending:', 'return:r1']));
    expect(find.textContaining('مراجعة الطلب وقبوله أو رفضه'), findsOneWidget);
    expect(find.textContaining('Review and approve'), findsNothing); // the server's English text is never shown
    expect(find.byKey(const Key('returns-on-web')), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing); // monitoring only
  });

  testWidgets('customers: server-side search; 360 shows masked contact data left-to-right, counts and recent orders', (t) async {
    final api = _Api(const ['customers.view', 'orders.view']);
    await _ready(t, api);
    await _open(t, '/monitor/customers');
    await t.enterText(find.byType(TextField).first, 'منى');
    await t.testTextInput.receiveAction(TextInputAction.search);
    await t.pumpAndSettle();
    expect(api.calls, contains('customers:منى'));
    await t.tap(find.byKey(const Key('row-u1')));
    await t.pumpAndSettle();
    final email = find.textContaining('mo***@demo.edmn.local');
    expect(email, findsOneWidget);
    expect(t.widget<Text>(email).textDirection, TextDirection.ltr);
    expect(find.textContaining('غير موثّق'), findsOneWidget); // phone not verified
    expect(find.byKey(const Key('cust-order-o1')), findsOneWidget);
  });

  testWidgets('support: one reply per intent (one idempotency key), shown in the thread; a refusal shows the server error', (t) async {
    final api = _Api(const ['support.manage']);
    await _ready(t, api);
    await _open(t, '/monitor/support', 't1');
    expect(find.text('رفعت الإيصال ولسه مستني'), findsOneWidget);
    await t.tap(find.byKey(const Key('reply')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('reply-text')), 'راجعنا الإيصال وسيتم التأكيد خلال ساعة');
    await t.tap(find.byKey(const Key('reply-send')));
    await t.pumpAndSettle();
    expect(api.replies, hasLength(1));
    expect(api.replies.single.$1, 't1');
    expect(find.byKey(const Key('reply-sent')), findsOneWidget);
    expect(find.text('راجعنا الإيصال وسيتم التأكيد خلال ساعة'), findsOneWidget);

    await t.pump(const Duration(seconds: 5));
    await t.pumpAndSettle();
    api.replyRefused = true;
    await t.tap(find.byKey(const Key('reply')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('reply-text')), 'رد ثاني');
    await t.tap(find.byKey(const Key('reply-send')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('action-error')), findsOneWidget);
    expect(api.replies, hasLength(1));
  });

  testWidgets('alerts: rule titles, stage filter reaches the server, rows have no detail', (t) async {
    final api = _Api(const ['notifications.manage']);
    await _ready(t, api);
    await _open(t, '/monitor/alerts');
    expect(find.text('فحص سلامة الدفتر غير سليم'), findsOneWidget);
    expect(find.textContaining('3'), findsWidgets);
    await t.tap(find.text('متأخر').first);
    await t.pumpAndSettle();
    expect(api.calls, contains('alerts:OVERDUE'));
  });
}
