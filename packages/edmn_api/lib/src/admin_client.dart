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

  /// Read-only operational dashboard (dashboard.view). [range]: today, 7d, 30d, 90d or 365d.
  Future<AdminGetDashboardResponse> dashboard({String range = '30d'}) async =>
      AdminGetDashboardResponse.fromJson(await client.getJson(AdminApiPaths.adminGetDashboard.path, query: {'range': range}));

  // Monitoring (read-only; each enforced server-side with the web console's permission for the same page).
  Future<AdminListSellerApplicationsResponse> sellerApplications({String tab = 'pending'}) async =>
      AdminListSellerApplicationsResponse.fromJson(await client.getJson(AdminApiPaths.adminListSellerApplications.path, query: {'tab': tab}));
  Future<AdminListIdentityReviewsResponse> identityReviews({String tab = 'pending'}) async =>
      AdminListIdentityReviewsResponse.fromJson(await client.getJson(AdminApiPaths.adminListIdentityReviews.path, query: {'tab': tab}));
  Future<AdminListOrdersResponse> orders({String tab = 'all', String? q, int page = 1}) async => AdminListOrdersResponse.fromJson(
      await client.getJson(AdminApiPaths.adminListOrders.path, query: {'tab': tab, if (q != null && q.trim().isNotEmpty) 'q': q.trim(), 'page': '$page'}));
  Future<AdminListDealsResponse> deals({String tab = 'active'}) async => AdminListDealsResponse.fromJson(await client.getJson(AdminApiPaths.adminListDeals.path, query: {'tab': tab}));
  Future<AdminListDisputesResponse> disputes({String tab = 'open'}) async =>
      AdminListDisputesResponse.fromJson(await client.getJson(AdminApiPaths.adminListDisputes.path, query: {'tab': tab}));
  Future<AdminListAuditLogResponse> auditLog({int? before, String? action, String? actorType}) async => AdminListAuditLogResponse.fromJson(await client.getJson(AdminApiPaths.adminListAuditLog.path, query: {
        if (before != null) 'before': '$before',
        if (action != null && action.trim().isNotEmpty) 'action': action.trim(),
        'actorType': ?actorType,
      }));

  // Detail views (read-only; same permission as the console page).
  Future<AdminGetSellerResponse> seller(String id) async => AdminGetSellerResponse.fromJson(await client.getJson(fillPath(AdminApiPaths.adminGetSeller.path, {'sellerId': id})));
  Future<AdminGetIdentityReviewResponse> identityReview(String id) async =>
      AdminGetIdentityReviewResponse.fromJson(await client.getJson(fillPath(AdminApiPaths.adminGetIdentityReview.path, {'verificationId': id})));
  Future<AdminGetOrderResponse> order(String id) async => AdminGetOrderResponse.fromJson(await client.getJson(fillPath(AdminApiPaths.adminGetOrder.path, {'orderId': id})));
  Future<AdminGetDealResponse> deal(String id) async => AdminGetDealResponse.fromJson(await client.getJson(fillPath(AdminApiPaths.adminGetDeal.path, {'dealId': id})));
  Future<AdminGetDisputeResponse> dispute(String id) async => AdminGetDisputeResponse.fromJson(await client.getJson(fillPath(AdminApiPaths.adminGetDispute.path, {'disputeId': id})));

  // The only staff actions on mobile: workflow-only, audited, no money and no KYC/seller decision.
  Future<AdminListDisputeAssigneesResponse> disputeAssignees() async => AdminListDisputeAssigneesResponse.fromJson(await client.getJson(AdminApiPaths.adminListDisputeAssignees.path));
  Future<void> assignDispute(String disputeId, String assigneeId, {required String idempotencyKey}) => client.sendJson('POST', fillPath(AdminApiPaths.adminAssignDispute.path, {'disputeId': disputeId}),
      body: AdminAssignDisputeRequest(assigneeId: assigneeId).toJson(), idempotencyKey: idempotencyKey);
  Future<void> addDisputeNote(String disputeId, String body, {required String idempotencyKey}) => client.sendJson('POST', fillPath(AdminApiPaths.adminAddDisputeNote.path, {'disputeId': disputeId}),
      body: AdminAddDisputeNoteRequest(body: body).toJson(), idempotencyKey: idempotencyKey);

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
