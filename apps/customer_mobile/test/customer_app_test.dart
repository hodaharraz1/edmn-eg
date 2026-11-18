import 'dart:typed_data';

import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_customer/src/app.dart';
import 'package:edmn_customer/src/common/file_pick.dart';
import 'package:edmn_customer/src/common/ui.dart';
import 'package:edmn_customer/src/features/auth/reset_password_screen.dart' show resetTokenFrom;
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

Map<String, dynamic> _deal({String role = 'BUYER', String status = 'OFFER_PENDING_BUYER', List<String> actions = const ['RESPOND_TO_OFFER', 'CANCEL']}) => {
      'id': 'd1', 'ref': 'PD-000001', 'role': role, 'status': status, 'wizardStep': 6, 'title': 'لابتوب مستعمل', 'description': 'حالة ممتازة', 'condition': 'USED',
      'quantity': 1, 'sourceUrl': null, 'deliveryMethod': 'مندوب', 'deliveryDeadline': '2030-01-08T10:00:00Z', 'inspectionDays': 2, 'customTerms': null,
      'buyerName': 'منى', 'sellerName': 'أحمد',
      'money': {
        'basis': 'OFFER', 'goodsTotalPiastres': 1500000,
        'unitPricePiastres': 1500000, 'shippingFeePiastres': 5000, 'totalPiastres': 1505000, 'buyerFeePiastres': 15050, 'sellerFeePiastres': 22575,
        'buyerPaysPiastres': 1520050, 'sellerReceivesPiastres': 1482425,
      },
      'terms': {
        'currentVersion': 1, 'latestStatus': 'PENDING', 'latestProposedBy': 'SELLER', 'latestMessage': null,
        'history': [
          {'version': 1, 'proposedBy': 'SELLER', 'status': 'PENDING', 'message': null, 'createdAt': '2030-01-01T10:00:00Z', 'terms': <String, dynamic>{}},
        ],
      },
      'payment': null, 'evidenceCount': 0, 'payout': null, 'buyerLocation': null, 'sellerLocation': null, 'handoverVerified': false,
      'buyerResponseDueAt': null, 'financialHold': false, 'createdAt': '2030-01-01T10:00:00Z', 'allowedActions': actions,
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
  Map<String, dynamic> dealJson = _deal();
  final dealDecisions = <(String, String)>[];
  int inviteCalls = 0;
  // Phase 6: notifications + password reset
  List<Map<String, dynamic>> notifs = [];
  final readCalls = <List<String>?>[];
  final resetCalls = <(String, String)>[];
  ApiFailure? resetError;
  @override
  Future<ListNotificationsResponse> notifications({bool unreadOnly = false, String? before}) async => ListNotificationsResponse.fromJson({
        'items': [for (final n in notifs) if (!unreadOnly || n['read'] == false) n],
        'unread': notifs.where((n) => n['read'] == false).length,
        'nextBefore': null,
      });
  @override
  Future<int> unreadNotifications() async => notifs.where((n) => n['read'] == false).length;
  @override
  Future<int> markNotificationsRead({List<String>? ids}) async {
    readCalls.add(ids);
    for (final n in notifs) {
      if (ids == null || ids.contains(n['id'])) n['read'] = true;
    }
    return notifs.where((n) => n['read'] == false).length;
  }
  @override
  Future<void> resetPassword(String token, String newPassword) async {
    resetCalls.add((token, newPassword));
    if (resetError != null) throw resetError!;
  }

  // Returns / disputes / reviews
  String returnBlock = '';
  List<String> returnActions = const [];
  String returnSide = 'BUYER';
  String disputeState = 'OPEN';
  final storeSteps = <String>[];
  final sellerRatings = <int>[];
  bool sellerReviewed = false;
  @override
  Future<List<ReturnSummary>> returns({bool store = false}) async => const [];
  @override
  Future<List<DisputeSummary>> disputes({bool store = false}) async => const [];
  @override
  Future<GetReturnOptionsResponse> returnOptions(String sellerOrderId) async => GetReturnOptionsResponse.fromJson({
        'eligible': returnBlock.isEmpty, 'blockReason': returnBlock.isEmpty ? null : returnBlock,
        'window': {'statutoryDays': 14, 'voluntaryDays': 0, 'effectiveDays': 14, 'disputeDays': 30, 'deliveredAt': '2030-01-01T10:00:00Z', 'deadline': '2030-01-15T10:00:00Z', 'protectedDeadline': '2030-01-31T10:00:00Z'},
        'reasons': [
          {'code': 'CHANGED_MIND', 'requiresEvidence': false, 'protected': false, 'available': false},
          {'code': 'DAMAGED', 'requiresEvidence': true, 'protected': true, 'available': true},
        ],
        'items': [{'orderItemId': '22222222-2222-4222-8222-222222222222', 'title': 'سماعة لاسلكية', 'variantLabel': '', 'unitPricePiastres': 125050, 'quantity': 2, 'returnableQuantity': 2}],
        'returnShippingPayer': 'BY_REASON',
      });
  @override
  Future<ReturnCase> returnCase(String id, {bool store = false}) async => ReturnCase.fromJson({
        'id': id, 'number': '9001', 'status': returnActions.contains('SHIP_BACK') ? 'APPROVED' : 'REQUESTED', 'side': returnSide, 'reason': 'DAMAGED', 'description': 'الشاشة مكسورة',
        'orderLabel': '100001-A', 'orderId': '11111111-1111-4111-8111-111111111111', 'sellerOrderId': '33333333-3333-4333-8333-333333333333', 'storeName': 'متجر القاهرة',
        'createdAt': '2030-01-02T10:00:00Z',
        'items': [{'orderItemId': '22222222-2222-4222-8222-222222222222', 'title': 'سماعة لاسلكية', 'variantLabel': '', 'quantity': 1, 'unitPricePiastres': 125050}],
        'evidence': <Map<String, dynamic>>[], 'decisionReason': null, 'returnCarrier': null, 'returnTracking': null,
        'shipBackTo': returnActions.contains('SHIP_BACK') ? {'address': '12 شارع التحرير، الدقي', 'governorateId': 2, 'shippingPayer': 'SELLER'} : null,
        'refundAmountPiastres': null, 'refunds': <Map<String, dynamic>>[], 'disputeId': null, 'allowedActions': returnActions,
      });
  @override
  Future<ReturnCase> storeReturnStep(String id, String step, {String? note, String? reason, bool? includeShipping, bool? restock, required String idempotencyKey}) async {
    storeSteps.add(step);
    returnActions = const ['MARK_RECEIVED'];
    return returnCase(id, store: true);
  }
  @override
  Future<DisputeCase> dispute(String id, {bool store = false}) async {
    final open = disputeState == 'OPEN';
    return DisputeCase.fromJson({
      'id': id, 'number': '8001', 'status': disputeState, 'role': 'CLAIMANT',
      'context': {'kind': 'ORDER', 'id': '33333333-3333-4333-8333-333333333333', 'orderId': '11111111-1111-4111-8111-111111111111', 'ref': '#100001-A'},
      'reasonCode': 'NOT_AS_DESCRIBED', 'description': 'اللون مختلف عن الإعلان تمامًا', 'claimedAmountPiastres': 125050, 'createdAt': '2030-01-03T10:00:00Z', 'returnId': null,
      'messages': [{'id': 'dm1', 'from': 'RESPONDENT', 'mine': false, 'body': 'المنتج مطابق', 'createdAt': '2030-01-03T12:00:00Z'}],
      'evidence': <Map<String, dynamic>>[],
      'decision': open ? null : {'code': 'FULL_REFUND', 'amountPiastres': 125050, 'note': 'الصور بتثبت الاختلاف', 'decidedAt': '2030-01-05T10:00:00Z'},
      'refunds': open ? <Map<String, dynamic>>[] : [{'id': '44444444-4444-4444-8444-444444444444', 'status': 'REQUESTED', 'amountPiastres': 125050, 'reference': null}],
      'fundsFrozen': open, 'allowedActions': open ? ['REPLY', 'ADD_EVIDENCE'] : <String>[],
    });
  }
  Map<String, dynamic> _reviewOpts() => {
        'eligible': true, 'storeName': 'متجر القاهرة', 'sellerReviewed': sellerReviewed,
        'items': [{'orderItemId': '22222222-2222-4222-8222-222222222222', 'title': 'سماعة لاسلكية', 'variantLabel': '', 'reviewed': true}],
      };
  @override
  Future<ReviewOptions> reviewOptions(String sellerOrderId) async => ReviewOptions.fromJson(_reviewOpts());
  @override
  Future<ReviewOptions> reviewSeller(String sellerOrderId, int rating, {String? body, required String idempotencyKey}) async {
    sellerRatings.add(rating);
    sellerReviewed = true;
    return ReviewOptions.fromJson(_reviewOpts());
  }

  // Wallet
  String? walletBlock;
  int requestFailures = 0;
  final requestKeys = <String>[];
  @override
  Future<GetWalletResponse> wallet() async {
    Map<String, dynamic> b(int avail) => {
          'pendingPiastres': 50000, 'heldPiastres': 30000, 'awaitingReleasePiastres': 20000, 'availablePiastres': avail, 'reservedPiastres': 10000,
          'debtPiastres': 0, 'unsecuredClaimsPiastres': 0, 'paidOutPiastres': 0,
        };
    return GetWalletResponse.fromJson({
      'hasEarnings': true, 'balances': b(125000),
      'sources': [{...b(125000), 'source': 'MARKETPLACE', 'storeName': 'متجر القاهرة'}],
      'items': <Map<String, dynamic>>[],
      'payout': {
        'identityApproved': walletBlock != 'IDENTITY',
        'destinations': [{'key': 'STORE_PAYOUT_METHOD', 'label': 'إنستاباي ••••ab', 'scope': 'STORE_AND_DEALS'}],
        'minimumPiastres': 10000, 'blockReason': walletBlock,
      },
      'topUpAvailable': false, 'realMoney': false,
    });
  }
  @override
  Future<ListWalletActivityResponse> walletActivity({String? kind, String? q}) async => ListWalletActivityResponse.fromJson({'items': <Map<String, dynamic>>[]});
  @override
  Future<ListAccountPayoutRequestsResponse> accountPayoutRequests() async => ListAccountPayoutRequestsResponse.fromJson({
        'items': [
          {'id': 'r1', 'number': '7001', 'amountPiastres': 20000, 'status': 'TRANSFER_UNCERTAIN', 'destination': 'إنستاباي ••••ab', 'createdAt': '2030-01-01T10:00:00Z',
            'paidAt': null, 'reference': null, 'reasonAr': null, 'isTest': true, 'sources': <Map<String, dynamic>>[], 'cancellable': false},
        ],
      });
  @override
  Future<PreviewAccountPayoutRequestResponse> previewAccountPayout(int amountPiastres, String destination) async => PreviewAccountPayoutRequestResponse.fromJson({
        'amountPiastres': amountPiastres, 'availablePiastres': 125000, 'fits': amountPiastres <= 125000, 'destination': 'إنستاباي ••••ab',
        'sources': [{'source': 'MARKETPLACE', 'amountPiastres': amountPiastres}],
      });
  @override
  Future<CreateAccountPayoutRequestResponse> requestAccountPayout(int amountPiastres, String destination, String clientKey) async {
    requestKeys.add(clientKey);
    if (requestFailures-- > 0) throw const ApiFailure(code: ApiErrorCode.network);
    return CreateAccountPayoutRequestResponse.fromJson({
      'created': requestKeys.where((k) => k == clientKey).length == 1,
      'request': {'id': 'r2', 'number': '7002', 'amountPiastres': amountPiastres, 'status': 'REQUESTED', 'destination': 'إنستاباي ••••ab', 'createdAt': '2030-01-01T10:00:00Z',
        'paidAt': null, 'reference': null, 'reasonAr': null, 'isTest': true, 'sources': <Map<String, dynamic>>[], 'cancellable': false},
    });
  }

  // Messaging / support
  bool convCanWrite = true;
  int sendFailures = 0;
  final sendKeys = <String>[];
  final seenUpTo = <String?>[];
  List<String> ticketActions = const ['REPLY'];
  final ticketRatings = <int>[];

  Map<String, dynamic> _msg(String id, {bool mine = false}) => {
        'id': id, 'side': mine ? 'BUYER' : 'SELLER', 'mine': mine, 'body': mine ? 'ممكن ميعاد الشحن؟' : 'هيتشحن بكرة', 'hidden': false,
        'createdAt': '2030-01-01T10:00:00Z', 'attachments': <Map<String, dynamic>>[], 'readByOther': mine,
      };
  @override
  Future<GetConversationResponse> conversation(String id, {bool store = false}) async => GetConversationResponse.fromJson({
        'id': id, 'context': 'SELLER_ORDER', 'side': 'BUYER', 'ref': 'طلب #100001-A', 'title': 'سماعة لاسلكية', 'status': 'PAID', 'otherParty': 'متجر القاهرة',
        'link': {'kind': 'ORDER', 'id': '11111111-1111-4111-8111-111111111111'}, 'canWrite': convCanWrite,
        'readOnlyReason': convCanWrite ? null : 'الطلب ده خلص من فترة، والمحادثة بقت للقراءة بس.',
        'messages': [_msg('m1', mine: true), _msg('m2')],
      });
  @override
  Future<SendMessageResponse> sendMessage(String id, String body, String clientKey, {List<(Uint8List, String)> attachments = const [], bool store = false}) async {
    sendKeys.add(clientKey);
    if (sendFailures-- > 0) throw const ApiFailure(code: ApiErrorCode.rateLimited, status: 429);
    return SendMessageResponse.fromJson({'id': 'm3', 'createdAt': '2030-01-01T10:01:00Z'});
  }
  @override
  Future<int> markConversationSeen(String id, {String? upToMessageId, bool store = false}) async {
    seenUpTo.add(upToMessageId);
    return 0;
  }
  @override
  Future<ListSupportTicketsResponse> supportTickets() async => ListSupportTicketsResponse.fromJson({
        'items': [
          {'id': 'x1', 'number': '1042', 'type': 'ORDER', 'subject': 'استفسار عن الطلب', 'status': 'OPEN', 'relatedType': null, 'relatedId': null, 'rating': null,
            'createdAt': '2030-01-01T10:00:00Z', 'updatedAt': '2030-01-01T10:00:00Z', 'allowedActions': ['REPLY']},
        ],
      });
  @override
  Future<ListConversationsResponse> conversations({bool store = false, String? filter, String? q}) async => ListConversationsResponse.fromJson({
        'items': [
          {'id': 'c1', 'context': 'SELLER_ORDER', 'ref': 'طلب #100001-A', 'title': 'سماعة لاسلكية', 'status': 'PAID', 'otherParty': 'متجر القاهرة', 'side': 'BUYER',
            'lastMessageAt': '2030-01-01T10:00:00Z', 'preview': 'هيتشحن بكرة', 'unread': filter == null ? 2 : 0},
        ],
        'unread': 2,
      });
  @override
  Future<GetSupportTicketResponse> supportTicket(String id) async => GetSupportTicketResponse.fromJson({
        'id': id, 'number': '1042', 'type': 'ORDER', 'subject': 'استفسار عن الطلب', 'status': ticketActions.contains('RATE') ? 'RESOLVED' : 'OPEN',
        'relatedType': null, 'relatedId': null, 'rating': null, 'createdAt': '2030-01-01T10:00:00Z', 'updatedAt': '2030-01-01T10:00:00Z', 'allowedActions': ticketActions,
        'messages': [
          {'id': 't1', 'fromStaff': false, 'mine': true, 'body': 'محتاج أعرف حالة الطلب', 'createdAt': '2030-01-01T10:00:00Z', 'attachmentFileId': null},
          {'id': 't2', 'fromStaff': true, 'mine': false, 'body': 'الطلب في انتظار تأكيد الدفع', 'createdAt': '2030-01-01T11:00:00Z', 'attachmentFileId': null},
        ],
      });
  @override
  Future<GetSupportTicketResponse> rateSupportTicket(String id, int rating, {String? comment, required String idempotencyKey}) async {
    ticketRatings.add(rating);
    ticketActions = const ['REPLY', 'REOPEN'];
    return supportTicket(id);
  }
  int codeReveals = 0;

  @override
  Future<ListDealsResponse> deals() async => ListDealsResponse.fromJson({
        'items': [
          {'id': 'd1', 'ref': 'PD-000001', 'title': 'لابتوب مستعمل', 'status': dealJson['status'], 'role': dealJson['role'], 'counterparty': 'أحمد', 'totalPiastres': 1520050, 'createdAt': '2030-01-01T10:00:00Z'},
        ],
      });
  @override
  Future<ProtectedDeal> deal(String id) async => ProtectedDeal.fromJson(dealJson);
  @override
  Future<ProtectedDeal> respondDealOffer(String id, int version, String decision, {Map<String, dynamic>? change, required String idempotencyKey}) async {
    dealDecisions.add((decision, idempotencyKey));
    dealJson = _deal(status: 'ACCEPTED', actions: const ['START_PAYMENT', 'CANCEL']);
    return ProtectedDeal.fromJson(dealJson);
  }
  @override
  Future<InviteDealSellerResponse> inviteDealSeller(String id) async {
    inviteCalls++;
    dealJson = _deal(status: 'INVITED', actions: const ['REFRESH_INVITATION', 'REVOKE_INVITATION', 'CANCEL']);
    return InviteDealSellerResponse.fromJson({'link': 'https://edmn.local/deals/invite/abcdefghijklmnopqrstuvwxyz', 'deal': dealJson});
  }
  @override
  Future<GetDealDeliveryCodeResponse> dealDeliveryCode(String id) async {
    codeReveals++;
    return GetDealDeliveryCodeResponse.fromJson({'available': true, 'code': '483920', 'expiresAt': '2030-01-02T10:00:00Z', 'attemptsLeft': 5});
  }

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
  testWidgets('starts in Arabic (RTL) on the home tab: products with EGP prices, no global TEST banner, board navigation', (t) async {
    await _start(t, FakeMobileApi());
    expect(Directionality.of(t.element(find.text('سماعة لاسلكية').first)), TextDirection.rtl);
    expect(find.text('1,250.5 ج.م'), findsWidgets);
    // Real Money is OFF, but the TEST notice belongs to money steps only — never app-wide.
    expect(find.textContaining('وضع تجريبي'), findsNothing);
    expect(find.byKey(const Key('test-money-notice')), findsNothing);
    for (final tab in ['الرئيسية', 'الأقسام', 'إعادة الطلب', 'طلباتي']) {
      expect(find.text(tab), findsOneWidget);
    }
  });

  testWidgets('the TEST notice appears inside the payment step while Real Money is OFF', (t) async {
    await _start(t, FakeMobileApi(), signedIn: true);
    await _go(t, '/payments/pay1');
    expect(find.byKey(const Key('test-money-notice')), findsOneWidget);
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

  testWidgets('notifications: empty state; a tap marks only that one read and opens its typed target; no target = no navigation', (t) async {
    final api = FakeMobileApi();
    await _start(t, api, signedIn: true);
    await _go(t, '/notifications');
    expect(find.byKey(const Key('notif-empty')), findsOneWidget);
    api.notifs = [
      {'id': 'n1', 'event': 'SUPPORT_REPLY', 'title': 'رد على تذكرتك', 'body': 'فريق أضمن رد على التذكرة #1042', 'read': false, 'createdAt': '2030-01-02T10:00:00Z', 'target': {'kind': 'TICKET', 'id': '11111111-1111-4111-8111-111111111111'}},
      {'id': 'n2', 'event': 'RETURN_UPDATED', 'title': 'تحديث الإرجاع', 'body': 'الإرجاع اتقبل', 'read': false, 'createdAt': '2030-01-01T10:00:00Z', 'target': null},
    ];
    await _go(t, '/orders');
    await _go(t, '/notifications');
    expect(find.byKey(const Key('notif-n1')), findsOneWidget);
    expect(find.text('غير مقروءة (2)'), findsOneWidget);
    await t.tap(find.byKey(const Key('notif-n2')));
    await t.pumpAndSettle();
    expect(api.readCalls.last, ['n2']);
    expect(find.byKey(const Key('notif-n1')), findsOneWidget); // still on the list: nothing to open
    await t.tap(find.byKey(const Key('notif-read-all')));
    await t.pumpAndSettle();
    expect(api.readCalls.last, isNull); // «mark all» sends no ids
    expect(find.byKey(const Key('notif-read-all')), findsNothing);
  });

  testWidgets('reset password: token from the link; mismatch is caught locally; success signs out and offers sign-in', (t) async {
    final api = FakeMobileApi();
    await _start(t, api);
    const token = 'abcdefghijklmnopqrstuvwxyz012345';
    await _go(t, '/reset-password?token=$token');
    expect(find.byKey(const Key('reset-link')), findsNothing); // the link already carries the token
    Future<void> type(String k, String v) => t.enterText(find.descendant(of: find.byKey(Key(k)), matching: find.byType(EditableText)), v);
    await type('reset-password', 'NewPass2030');
    await type('reset-confirm', 'Different2030');
    await t.tap(find.byKey(const Key('reset-submit')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('reset-problem')), findsOneWidget);
    expect(api.resetCalls, isEmpty);
    await type('reset-confirm', 'NewPass2030');
    await t.tap(find.byKey(const Key('reset-submit')));
    await t.pumpAndSettle();
    expect(api.resetCalls.single, (token, 'NewPass2030'));
    expect(find.byKey(const Key('reset-done')), findsOneWidget);
    expect(find.byKey(const Key('reset-to-sign-in')), findsOneWidget);
  });

  testWidgets('reset password: an expired / used link shows the server error and a way to get a new link', (t) async {
    final api = FakeMobileApi()..resetError = const ApiFailure(code: ApiErrorCode.validationFailed, status: 422);
    await _start(t, api);
    await _go(t, '/reset-password');
    Future<void> type(String k, String v) => t.enterText(find.descendant(of: find.byKey(Key(k)), matching: find.byType(EditableText)), v);
    await type('reset-link', 'not a link');
    await type('reset-password', 'NewPass2030');
    await type('reset-confirm', 'NewPass2030');
    await t.tap(find.byKey(const Key('reset-submit')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('reset-problem')), findsOneWidget);
    expect(api.resetCalls, isEmpty);
    await type('reset-link', 'https://edmneg.com/reset-password?token=abcdefghijklmnopqrstuvwxyz012345');
    await t.tap(find.byKey(const Key('reset-submit')));
    await t.pumpAndSettle();
    expect(api.resetCalls.single.$1, 'abcdefghijklmnopqrstuvwxyz012345');
    expect(find.byKey(const Key('reset-error')), findsOneWidget);
    expect(find.byKey(const Key('reset-new-link')), findsOneWidget);
  });

  test('reset token is taken from a pasted link or a bare token, and nothing else', () {
    expect(resetTokenFrom('https://x.test/reset-password?token=abcdefghijklmnopqrstuvwxyz012345'), 'abcdefghijklmnopqrstuvwxyz012345');
    expect(resetTokenFrom(' abcdefghijklmnopqrstuvwxyz012345 '), 'abcdefghijklmnopqrstuvwxyz012345');
    expect(resetTokenFrom('short'), isNull);
    expect(resetTokenFrom('https://x.test/reset-password?token=<script>'), isNull);
    expect(resetTokenFrom(''), isNull);
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

  testWidgets('protected deal: buyer sees server money and accepts the offer only after confirming; no release/refund button exists', (t) async {
    final api = FakeMobileApi();
    await _start(t, api, signedIn: true);
    await _go(t, '/deals');
    expect(find.byKey(const Key('deal-d1')), findsOneWidget);
    await _go(t, '/deals/d1');
    expect(find.text('15,200.5 ج.م'), findsWidgets); // buyerPays from the server
    final accept = find.byKey(const Key('deal-accept'));
    await _reveal(t, accept);
    await t.tap(accept);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('dialog-cancel')));
    await t.pumpAndSettle();
    expect(api.dealDecisions, isEmpty);
    await t.tap(accept);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('dialog-confirm')));
    await t.pumpAndSettle();
    expect(api.dealDecisions.single.$1, 'ACCEPT');
    expect(find.byKey(const Key('deal-pay')), findsOneWidget);
    expect(find.byKey(const Key('deal-accept')), findsNothing);
    for (final k in ['deal-release', 'deal-refund', 'deal-payout']) {
      expect(find.byKey(Key(k)), findsNothing);
    }
  });

  testWidgets('protected deal: invitation link is shown to the buyer after inviting; seller actions follow allowedActions', (t) async {
    final api = FakeMobileApi()..dealJson = _deal(status: 'DRAFT', actions: const ['INVITE_SELLER', 'CANCEL']);
    await _start(t, api, signedIn: true);
    await _go(t, '/deals/d1');
    final inv = find.byKey(const Key('deal-invite'));
    await _reveal(t, inv);
    await t.tap(inv);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('dialog-confirm')));
    await t.pumpAndSettle();
    expect(api.inviteCalls, 1);
    await t.scrollUntilVisible(find.byKey(const Key('invite-link-card')), -250, scrollable: _mainList);
    expect(find.byKey(const Key('invite-link-card')), findsOneWidget);
    expect(find.textContaining('/deals/invite/'), findsOneWidget);

    api.dealJson = _deal(role: 'SELLER', status: 'ACTIVE', actions: const ['MARK_SHIPPED']);
    await _go(t, '/deals');
    await _go(t, '/deals/d1');
    await _reveal(t, find.byKey(const Key('deal-ship')));
    expect(find.byKey(const Key('deal-ship')), findsOneWidget);
    expect(find.byKey(const Key('deal-code')), findsNothing); // the delivery code is never shown to the seller
    expect(find.byKey(const Key('deal-confirm')), findsNothing);
  });

  testWidgets('protected deal: the buyer reveals the delivery code from the server with expiry and attempts', (t) async {
    final api = FakeMobileApi()..dealJson = _deal(status: 'DELIVERED', actions: const ['VIEW_DELIVERY_CODE', 'REPORT_NOT_RECEIVED']);
    await _start(t, api, signedIn: true);
    await _go(t, '/deals/d1');
    final b = find.byKey(const Key('deal-code'));
    await _reveal(t, b);
    await t.tap(b);
    await t.pumpAndSettle();
    expect(api.codeReveals, 1);
    expect(find.byKey(const Key('delivery-code')), findsOneWidget);
    expect(find.textContaining('المحاولات المتبقية 5'), findsOneWidget);
  });

  testWidgets('chat: a failed send is retried with the SAME client key (no duplicate); the next message gets a new one; seen = last rendered', (t) async {
    final api = FakeMobileApi()..sendFailures = 1;
    await _start(t, api, signedIn: true);
    await _go(t, '/messages/c1');
    expect(find.text('هيتشحن بكرة'), findsOneWidget);
    expect(find.byKey(const Key('conv-context')), findsOneWidget);
    expect(api.seenUpTo, ['m2']);
    await t.enterText(find.descendant(of: find.byKey(const Key('message-input')), matching: find.byType(EditableText)), 'تمام شكراً');
    await t.tap(find.byKey(const Key('send')));
    await t.pumpAndSettle();
    expect(find.text('تمام شكراً'), findsOneWidget); // kept for the retry
    expect(find.text('الرسالة ما اتبعتتش. اضغط إرسال تاني، ومش هتتكرر.'), findsOneWidget);
    await t.pump(const Duration(seconds: 6)); // let the message clear
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('send')));
    await t.pumpAndSettle();
    expect(api.sendKeys, hasLength(2));
    expect(api.sendKeys[0], api.sendKeys[1]);
    await t.enterText(find.descendant(of: find.byKey(const Key('message-input')), matching: find.byType(EditableText)), 'رسالة تانية');
    await t.tap(find.byKey(const Key('send')));
    await t.pumpAndSettle();
    expect(api.sendKeys[2], isNot(api.sendKeys[0]));
  });

  testWidgets('inbox lists conversations with the server unread count', (t) async {
    await _start(t, FakeMobileApi(), signedIn: true);
    await _go(t, '/messages');
    expect(find.byKey(const Key('conv-c1')), findsOneWidget);
    expect(find.byKey(const Key('unread-c1')), findsOneWidget);
    await _go(t, '/support');
    expect(find.byKey(const Key('ticket-x1')), findsOneWidget);
  });

  testWidgets('chat: a read-only conversation shows the server reason and no composer', (t) async {
    final api = FakeMobileApi()..convCanWrite = false;
    await _start(t, api, signedIn: true);
    await _go(t, '/messages/c1');
    expect(find.byKey(const Key('read-only')), findsOneWidget);
    expect(find.byKey(const Key('send')), findsNothing);
  });

  testWidgets('support: staff shown as «فريق أضمن»; rating only when the server allows it, once', (t) async {
    final api = FakeMobileApi();
    await _start(t, api, signedIn: true);
    await _go(t, '/support/x1');
    expect(find.text('فريق أضمن'), findsOneWidget);
    expect(find.byKey(const Key('rate-ticket')), findsNothing);
    api.ticketActions = const ['REPLY', 'REOPEN', 'RATE'];
    await _go(t, '/support');
    await _go(t, '/support/x1');
    final rate = find.byKey(const Key('rate-ticket'));
    await _reveal(t, rate);
    await t.tap(rate);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('star-4')));
    await t.tap(find.byKey(const Key('rate-submit')));
    await t.pumpAndSettle();
    expect(api.ticketRatings, [4]);
    expect(find.byKey(const Key('rate-ticket')), findsNothing);
    expect(find.byKey(const Key('reopen-ticket')), findsOneWidget);
  });

  testWidgets('wallet: server balances, held money is not shown as available, TEST notice in the wallet, no top-up flow', (t) async {
    await _start(t, FakeMobileApi(), signedIn: true);
    await _go(t, '/wallet');
    expect(find.byKey(const Key('wallet-card')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('wallet-card')), matching: find.text('1,250 ج.م')), findsOneWidget);
    expect(find.byKey(const Key('test-money-notice')), findsOneWidget);
    expect(find.textContaining('شحن'), findsNothing); // no top-up
    expect(find.textContaining('تحويل رصيد'), findsNothing); // no wallet-to-wallet transfer
    await _reveal(t, find.byKey(const Key('balance-breakdown')));
    expect(find.text('300 ج.م'), findsWidgets); // held, listed apart from available
    await _reveal(t, find.byKey(const Key('no-topup')));
  });

  testWidgets('wallet: a blocked payout says why (identity) and offers no request button', (t) async {
    final api = FakeMobileApi()..walletBlock = 'IDENTITY';
    await _start(t, api, signedIn: true);
    await _go(t, '/wallet/payout');
    expect(find.byKey(const Key('payout-block')), findsOneWidget);
    expect(find.byKey(const Key('payout-submit')), findsNothing);
    expect(find.byKey(const Key('payout-preview-btn')), findsNothing);
  });

  testWidgets('payout request: server preview → confirmation → a retry reuses the SAME client key; uncertain stays uncertain', (t) async {
    final api = FakeMobileApi()..requestFailures = 1;
    await _start(t, api, signedIn: true);
    await _go(t, '/wallet/payout');
    await _reveal(t, find.byKey(const Key('acc-payout-r1')));
    expect(find.textContaining('جاري التحقق من التحويل'), findsOneWidget); // TRANSFER_UNCERTAIN from the server
    expect(find.byKey(const Key('cancel-acc-payout-r1')), findsNothing);
    await t.scrollUntilVisible(find.byKey(const Key('payout-amount')), -250, scrollable: _mainList);
    await t.enterText(find.descendant(of: find.byKey(const Key('payout-amount')), matching: find.byType(EditableText)), '500');
    await t.pumpAndSettle();
    await _reveal(t, find.byKey(const Key('payout-preview-btn')));
    await t.tap(find.byKey(const Key('payout-preview-btn')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('payout-preview')), findsOneWidget);
    for (var i = 0; i < 2; i++) {
      await _reveal(t, find.byKey(const Key('payout-submit')));
      await t.tap(find.byKey(const Key('payout-submit')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const Key('dialog-confirm')));
      await t.pumpAndSettle();
      await t.pump(const Duration(seconds: 6));
      await t.pumpAndSettle();
    }
    expect(api.requestKeys, hasLength(2));
    expect(api.requestKeys[0], api.requestKeys[1]);
    await t.scrollUntilVisible(find.byKey(const Key('payout-result')), -250, scrollable: _mainList);
    expect(find.byKey(const Key('payout-result')), findsOneWidget);
  });

  testWidgets('return request: the policy window and reasons come from the server; a closed window offers a dispute instead', (t) async {
    final api = FakeMobileApi();
    await _start(t, api, signedIn: true);
    await _go(t, '/returns/new?so=s1');
    expect(find.byKey(const Key('return-window')), findsOneWidget);
    expect(find.textContaining('انتهت مدة الإرجاع لهذا السبب'), findsOneWidget); // change-of-mind closed by the server
    api.returnBlock = 'WINDOW_CLOSED';
    await _go(t, '/returns');
    await _go(t, '/returns/new?so=s1');
    expect(find.byKey(const Key('return-blocked')), findsOneWidget);
    expect(find.byKey(const Key('ret-reasons')), findsNothing);
  });

  testWidgets('returns: the buyer sees only buyer steps with the ship-back address; the store sees only the steps the server allows', (t) async {
    final api = FakeMobileApi()..returnActions = const ['SHIP_BACK'];
    await _start(t, api, signedIn: true);
    await _go(t, '/returns/r1');
    await _reveal(t, find.byKey(const Key('ret-ship')));
    expect(find.byKey(const Key('ship-back-to'), skipOffstage: false), findsOneWidget);
    for (final k in ['ret-approve', 'ret-reject', 'ret-accept']) {
      expect(find.byKey(Key(k)), findsNothing);
    }
    api
      ..returnSide = 'STORE'
      ..returnActions = const ['APPROVE', 'REJECT']
      ..isSeller = true
      ..isOwner = true;
    await _go(t, '/returns');
    await _go(t, '/seller/returns/r1');
    await _reveal(t, find.byKey(const Key('ret-approve')));
    expect(find.byKey(const Key('ret-accept')), findsNothing); // refund request not allowed yet
    await t.tap(find.byKey(const Key('ret-approve')));
    await t.pumpAndSettle();
    expect(api.storeSteps, ['APPROVE']);
  });

  testWidgets('dispute: frozen-funds notice and reply while open; after EDMN decides, the decision and refund state show and replying is gone', (t) async {
    final api = FakeMobileApi();
    await _start(t, api, signedIn: true);
    await _go(t, '/disputes/d1');
    expect(find.byKey(const Key('dsp-frozen')), findsOneWidget);
    await _reveal(t, find.byKey(const Key('dsp-send')));
    expect(find.byKey(const Key('dsp-decision')), findsNothing);
    api.disputeState = 'RESOLVED';
    await _go(t, '/disputes');
    await _go(t, '/disputes/d1');
    expect(find.byKey(const Key('dsp-frozen')), findsNothing);
    expect(find.byKey(const Key('dsp-decision')), findsOneWidget);
    expect(find.text('استرداد كامل'), findsOneWidget);
    await _reveal(t, find.byKey(const Key('dsp-support')));
    expect(find.byKey(const Key('dsp-send')), findsNothing);
    for (final k in ['dsp-resolve', 'dsp-refund', 'dsp-release']) {
      expect(find.byKey(Key(k)), findsNothing);
    }
  });

  testWidgets('reviews: an already reviewed item cannot be reviewed again; the store review is sent once', (t) async {
    final api = FakeMobileApi();
    await _start(t, api, signedIn: true);
    await _go(t, '/reviews/new?so=s1');
    expect(find.byKey(const Key('reviewed-22222222-2222-4222-8222-222222222222')), findsOneWidget);
    await _reveal(t, find.byKey(const Key('rev-form-seller-submit')));
    await t.tap(find.byKey(const Key('rev-form-seller-star-4')));
    await t.pumpAndSettle();
    await _reveal(t, find.byKey(const Key('rev-form-seller-submit')));
    await t.tap(find.byKey(const Key('rev-form-seller-submit')));
    await t.pumpAndSettle();
    expect(api.sellerRatings, [4]);
    expect(find.byKey(const Key('seller-reviewed')), findsOneWidget);
    expect(find.byKey(const Key('rev-form-seller-submit')), findsNothing);
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
