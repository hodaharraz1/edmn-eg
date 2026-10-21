import 'package:edmn_core/edmn_core.dart';

import 'generated/admin_api.dart';
import 'http.dart';

/// Typed calls for the Admin App. Phase 1 deliberately has NO financial mutation: sign-in, MFA, step-up, own
/// sessions and remote revocation of another account's sessions (lost device / compromise) only.
class AdminApi {
  AdminApi(this.client);
  final ApiClient client;

  Future<SessionResult> login({required String identifier, required String password, required DeviceInfo device}) async {
    final r = SessionResult.fromJson(
        await client.sendJson('POST', AdminApiPaths.adminLogin.path, body: AdminLoginRequest(identifier: identifier, password: password, device: device).toJson(), skipAuth: true));
    await client.adoptTokens(SessionTokens.fromJson(r.tokens.toJson()));
    return r;
  }

  Future<AdminMfaEnrollResponse> enrollTotp() async => AdminMfaEnrollResponse.fromJson(await client.sendJson('POST', AdminApiPaths.adminMfaEnroll.path));
  Future<void> verifyTotp(String code) => client.sendJson('POST', AdminApiPaths.adminMfaVerify.path, body: AdminMfaVerifyRequest(code: code).toJson());
  Future<void> stepUp(String code) => client.sendJson('POST', AdminApiPaths.adminStepUp.path, body: AdminStepUpRequest(code: code).toJson());

  Future<void> logout() async {
    try {
      await client.sendJson('POST', AdminApiPaths.adminLogout.path);
    } finally {
      await client.clearSession();
    }
  }

  Future<Profile> me() async => Profile.fromJson(await client.getJson(AdminApiPaths.adminGetMe.path));
  Future<AdminListMySessionsResponse> mySessions() async => AdminListMySessionsResponse.fromJson(await client.getJson(AdminApiPaths.adminListMySessions.path));
  Future<void> revokeSession(String sessionId, {required String idempotencyKey}) =>
      client.sendJson('DELETE', fillPath(AdminApiPaths.adminRevokeMySession.path, {'sessionId': sessionId}), idempotencyKey: idempotencyKey);
  Future<int> revokeOtherSessions({required String idempotencyKey}) async =>
      AdminRevokeMyOtherSessionsResponse.fromJson(await client.sendJson('POST', AdminApiPaths.adminRevokeMyOtherSessions.path, idempotencyKey: idempotencyKey)).revoked;
  Future<int> revokeUserSessions(String userId, {required String reason, required String idempotencyKey}) async => AdminRevokeUserSessionsResponse.fromJson(
          await client.sendJson('POST', fillPath(AdminApiPaths.adminRevokeUserSessions.path, {'userId': userId}), body: AdminRevokeUserSessionsRequest(reason: reason).toJson(), idempotencyKey: idempotencyKey))
      .revoked;
}
