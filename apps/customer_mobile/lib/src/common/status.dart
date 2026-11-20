import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/widgets.dart';

import 'ui.dart';

/// Server status → label + tone. The app never infers a status; unknown values show neutrally.
(String, EdmnTone) orderStatus(EdmnLocalizations t, String status) => switch (status) {
      'PENDING_PAYMENT' => (t.statusPendingPayment, EdmnTone.warning),
      'PAYMENT_UNDER_REVIEW' => (t.statusPaymentUnderReview, EdmnTone.warning),
      'PAID' => (t.statusProcessing, EdmnTone.info),
      'COMPLETED' => (t.statusCompleted, EdmnTone.success),
      'PARTIALLY_COMPLETED' => (t.statusPartiallyCompleted, EdmnTone.success),
      'CLOSED_UNFULFILLED' => (t.statusClosedUnfulfilled, EdmnTone.danger),
      'CANCELLED' => (t.statusCancelled, EdmnTone.danger),
      _ => (status, EdmnTone.neutral),
    };

(String, EdmnTone) sellerOrderStatus(EdmnLocalizations t, String status) => switch (status) {
      'PENDING_PAYMENT' => (t.statusPendingPayment, EdmnTone.warning),
      'PAYMENT_UNDER_REVIEW' => (t.statusPaymentUnderReview, EdmnTone.warning),
      'PAID' => (t.stepPaymentConfirmed, EdmnTone.info),
      'SELLER_CONFIRMED' => (t.stepOrderConfirmed, EdmnTone.info),
      'PROCESSING' || 'READY_TO_SHIP' => (t.stepPreparing, EdmnTone.info),
      'SHIPPED' => (t.stepOnTheWay, EdmnTone.info),
      'AWAITING_BUYER_RESPONSE' || 'DELIVERED' => (t.stepDelivered, EdmnTone.success),
      'COMPLETED' => (t.statusCompleted, EdmnTone.success),
      'DELIVERY_FAILED' => (t.deliveryFailed, EdmnTone.danger),
      'CANCELLED' => (t.statusCancelled, EdmnTone.danger),
      _ => (status, EdmnTone.neutral),
    };

/// What the SELLER sees for one of its sub-orders: one distinct label per server state (no two states share a label),
/// plus a plain next-step hint. Delivery, the buyer's confirmation and EDMN's approval of the earnings are separate
/// states; nothing here implies money was released before COMPLETED.
(String, EdmnTone) sellerOrderStatusChip(EdmnLocalizations t, String s) => switch (s) {
      'PENDING_PAYMENT' => (t.soAwaitingPayment, EdmnTone.warning),
      'PAYMENT_UNDER_REVIEW' => (t.soPaymentReview, EdmnTone.warning),
      'PAID' => (t.soNew, EdmnTone.warning),
      'SELLER_CONFIRMED' => (t.soAccepted, EdmnTone.info),
      'PROCESSING' => (t.soPreparing, EdmnTone.info),
      'READY_TO_SHIP' => (t.soReady, EdmnTone.info),
      'SHIPPED' => (t.soShipped, EdmnTone.info),
      'AWAITING_BUYER_RESPONSE' => (t.soAwaitingBuyer, EdmnTone.success),
      'DELIVERED' => (t.soReceived, EdmnTone.success),
      'COMPLETED' => (t.soCompleted, EdmnTone.success),
      'DELIVERY_FAILED' => (t.soDeliveryFailed, EdmnTone.danger),
      'CANCELLED' => (t.soCancelled, EdmnTone.danger),
      _ => (s, EdmnTone.neutral),
    };

String? sellerOrderStatusHint(EdmnLocalizations t, String s) => switch (s) {
      'PENDING_PAYMENT' || 'PAYMENT_UNDER_REVIEW' => t.soHintAwaitingPayment,
      'PAID' => t.soHintPaid,
      'SELLER_CONFIRMED' => t.soHintConfirmed,
      'PROCESSING' => t.soHintProcessing,
      'READY_TO_SHIP' => t.soHintReady,
      'SHIPPED' => t.soHintShipped,
      'AWAITING_BUYER_RESPONSE' => t.soHintAwaitingBuyer,
      'DELIVERED' => t.soHintReceived,
      'COMPLETED' => t.soHintCompleted,
      'DELIVERY_FAILED' => t.soHintFailed,
      'CANCELLED' => t.soHintCancelled,
      _ => null,
    };

(String, EdmnTone) paymentStatus(EdmnLocalizations t, String status) => switch (status) {
      'AWAITING_PAYMENT' => (t.statusPendingPayment, EdmnTone.warning),
      'PAYMENT_SUBMITTED' || 'UNDER_REVIEW' => (t.receiptUnderReview, EdmnTone.warning),
      'CONFIRMED' => (t.paymentConfirmed, EdmnTone.success),
      'REJECTED' => (t.paymentRejected, EdmnTone.danger),
      'EXPIRED' => (t.paymentExpired, EdmnTone.danger),
      'CANCELLED' => (t.statusCancelled, EdmnTone.danger),
      _ => (status, EdmnTone.neutral),
    };

(String, EdmnTone) refundStatus(EdmnLocalizations t, String status) => switch (status) {
      // Neither paid nor failed: shown as "being verified", never as success or failure.
      'TRANSFER_UNCERTAIN' => (t.refundUncertain, EdmnTone.warning),
      'COMPLETED' || 'PAID' => (t.refundCompleted, EdmnTone.success),
      'REJECTED' || 'FAILED' || 'CANCELLED' => (t.refundNotPaid, EdmnTone.danger),
      _ => (t.refundInProgress, EdmnTone.info),
    };

/// Which list filter an order belongs to (board pills). Derived only from the server status.
enum OrderFilter { all, inProgress, delivered, cancelled }

bool orderMatches(OrderFilter f, String status) => switch (f) {
      OrderFilter.all => true,
      OrderFilter.inProgress => const {'PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PAID'}.contains(status),
      OrderFilter.delivered => const {'COMPLETED', 'PARTIALLY_COMPLETED'}.contains(status),
      OrderFilter.cancelled => const {'CANCELLED', 'CLOSED_UNFULFILLED'}.contains(status),
    };

const _rank = {
  'PENDING_PAYMENT': 0,
  'PAYMENT_UNDER_REVIEW': 0,
  'PAID': 1,
  'SELLER_CONFIRMED': 2,
  'PROCESSING': 3,
  'READY_TO_SHIP': 3,
  'SHIPPED': 4,
  'AWAITING_BUYER_RESPONSE': 5,
  'DELIVERED': 5,
  'COMPLETED': 6,
};

/// Vertical tracking for ONE seller sub-order. A step is "done" only when the server status (or a server timestamp)
/// says so. Delivery, the buyer's receipt confirmation and the money release are separate: completion here means the
/// order is completed, never that funds were released.
List<EdmnTimelineStep> trackingSteps(BuildContext context, Order order, OrderSellerOrdersItem so) {
  final t = EdmnLocalizations.of(context);
  if (so.status == 'CANCELLED' || so.status == 'DELIVERY_FAILED') {
    return [
      EdmnTimelineStep(title: t.stepOrderPlaced, state: EdmnStepState.done, time: formatDateTime(context, order.placedAt)),
      EdmnTimelineStep(
        title: so.status == 'CANCELLED' ? t.statusCancelled : t.deliveryFailed,
        state: EdmnStepState.failed,
        time: formatDateTime(context, so.cancelledAt),
        detail: so.cancelReasonAr,
      ),
    ];
  }
  final r = _rank[so.status] ?? 0;
  final inTransit = so.shipment?.status == 'IN_TRANSIT';
  EdmnStepState at(int needed) => r >= needed ? EdmnStepState.done : (r == needed - 1 ? EdmnStepState.current : EdmnStepState.pending);
  final steps = <EdmnTimelineStep>[
    EdmnTimelineStep(title: t.stepOrderPlaced, state: EdmnStepState.done, time: formatDateTime(context, order.placedAt)),
    EdmnTimelineStep(title: t.stepPaymentConfirmed, state: at(1), time: formatDateTime(context, order.payment?.confirmedAt)),
    EdmnTimelineStep(title: t.stepOrderConfirmed, state: at(2)),
    EdmnTimelineStep(title: t.stepPreparing, state: at(3)),
    EdmnTimelineStep(
      title: inTransit ? t.stepOnTheWay : t.stepShipped,
      state: at(4),
      time: formatDateTime(context, so.shippedAt),
      detail: so.shipment?.trackingNumber == null ? null : t.trackingNumber(so.shipment!.trackingNumber!),
    ),
    EdmnTimelineStep(title: t.stepDelivered, state: at(5), time: formatDateTime(context, so.deliveredAt)),
    EdmnTimelineStep(title: t.stepCompleted, state: r >= 6 ? EdmnStepState.done : (r == 5 ? EdmnStepState.current : EdmnStepState.pending)),
  ];
  return steps;
}
