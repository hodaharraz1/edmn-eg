import 'package:edmn_admin/src/app.dart';
import 'package:edmn_admin/src/providers.dart';
import 'package:edmn_api/admin.dart';
import 'package:edmn_core/edmn_core.dart';
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
}
