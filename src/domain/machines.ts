import { defineMachine } from './state-machine';

/* ───────────────────────── Seller ───────────────────────── */
export const SELLER_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'MORE_INFO_REQUIRED',
  'APPROVED',
  'RESTRICTED',
  'SUSPENDED',
  'REJECTED',
] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];
export const sellerMachine = defineMachine<SellerStatus>('seller', SELLER_STATUSES, {
  DRAFT: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED'],
  MORE_INFO_REQUIRED: ['PENDING_REVIEW', 'REJECTED'],
  APPROVED: ['RESTRICTED', 'SUSPENDED'],
  RESTRICTED: ['APPROVED', 'SUSPENDED'],
  SUSPENDED: ['APPROVED', 'RESTRICTED'],
  REJECTED: [],
});

/* ───────────────────────── Product ───────────────────────── */
export const PRODUCT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'LIVE',
  'REJECTED',
  'SUSPENDED',
  'ARCHIVED',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
/**
 * APPROVED = moderation passed but seller has it deactivated (not visible).
 * LIVE     = approved and visible to customers.
 * REJECTED = moderation rejected or changes requested; seller edits and resubmits.
 */
export const productMachine = defineMachine<ProductStatus>('product', PRODUCT_STATUSES, {
  DRAFT: ['SUBMITTED', 'ARCHIVED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'LIVE', 'REJECTED', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'LIVE', 'REJECTED'],
  APPROVED: ['LIVE', 'SUSPENDED', 'ARCHIVED'],
  LIVE: ['APPROVED', 'SUSPENDED', 'ARCHIVED'],
  REJECTED: ['SUBMITTED', 'DRAFT', 'ARCHIVED'],
  SUSPENDED: ['APPROVED', 'ARCHIVED'],
  ARCHIVED: [],
});

export const REVISION_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/* ───────────────────────── Parent order ───────────────────────── */
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_UNDER_REVIEW',
  'PAID',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CLOSED_UNFULFILLED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
/**
 * The parent order is DERIVED from its seller sub-orders (see syncParentStatus):
 *  - all sub-orders CANCELLED                                  → CANCELLED
 *  - all COMPLETED                                             → COMPLETED
 *  - all final, at least one COMPLETED and one not completed   → PARTIALLY_COMPLETED
 *  - all final, none completed, at least one DELIVERY_FAILED   → CLOSED_UNFULFILLED
 * A cancelled or failed sub-order is never presented as successfully completed.
 */
export const orderMachine = defineMachine<OrderStatus>('order', ORDER_STATUSES, {
  PENDING_PAYMENT: ['PAYMENT_UNDER_REVIEW', 'PAID', 'CANCELLED'],
  PAYMENT_UNDER_REVIEW: ['PAID', 'PENDING_PAYMENT', 'CANCELLED'],
  PAID: ['COMPLETED', 'PARTIALLY_COMPLETED', 'CLOSED_UNFULFILLED', 'CANCELLED'],
  COMPLETED: [],
  PARTIALLY_COMPLETED: [],
  CLOSED_UNFULFILLED: [],
  CANCELLED: [],
});

/* ───────────────────────── Seller order (fulfilment unit) ───────────────────────── */
export const SELLER_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_UNDER_REVIEW',
  'PAID',
  'SELLER_CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'SHIPPED',
  'AWAITING_BUYER_RESPONSE',
  'DELIVERED',
  'COMPLETED',
  'DELIVERY_FAILED',
  'CANCELLED',
] as const;
export type SellerOrderStatus = (typeof SELLER_ORDER_STATUSES)[number];
/**
 * Fulfilment + entitlement lifecycle of one seller sub-order.
 *  SHIPPED                  in transit; a seller statement alone never proves delivery
 *  AWAITING_BUYER_RESPONSE  valid delivery evidence established (authoritative delivery event + timely
 *                           seller evidence, or Operations review); the buyer's 24-hour window is running
 *  DELIVERED                receipt basis established (BUYER_CONFIRMED or TIMEOUT_ENTITLEMENT…):
 *                           ENTITLED, AWAITING ADMIN RELEASE — funds are still pending, NOT available
 *  COMPLETED                only after a committed, Admin-approved seller release (DB-enforced)
 *  DELIVERY_FAILED          final: returned to seller / lost — refund path, never a completion
 * Cancellation is possible only before SHIPPED.
 */
export const sellerOrderMachine = defineMachine<SellerOrderStatus>('seller_order', SELLER_ORDER_STATUSES, {
  PENDING_PAYMENT: ['PAYMENT_UNDER_REVIEW', 'PAID', 'CANCELLED'],
  PAYMENT_UNDER_REVIEW: ['PAID', 'PENDING_PAYMENT', 'CANCELLED'],
  PAID: ['SELLER_CONFIRMED', 'CANCELLED'],
  SELLER_CONFIRMED: ['PROCESSING', 'READY_TO_SHIP', 'CANCELLED'],
  PROCESSING: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['AWAITING_BUYER_RESPONSE', 'DELIVERED', 'DELIVERY_FAILED'],
  AWAITING_BUYER_RESPONSE: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  DELIVERY_FAILED: [],
  CANCELLED: [],
});
/** Statuses in which a sub-order can still be cancelled: strictly BEFORE shipment. */
export const SELLER_ORDER_CANCELLABLE: readonly SellerOrderStatus[] = [
  'PAID',
  'SELLER_CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
];
/** How the receipt / entitlement basis of a seller sub-order was established (never a single boolean). */
export const RECEIPT_BASES = ['BUYER_CONFIRMED', 'TIMEOUT_ENTITLEMENT', 'DISPUTE_DECISION', 'LEGACY_ADMIN_ON_BEHALF', 'LEGACY_PRE_HARDENING'] as const;
export type ReceiptBasis = (typeof RECEIPT_BASES)[number];
export const CANCELLATION_REASON_CODES = [
  'BUYER_REQUEST',
  'SELLER_UNABLE_TO_FULFIL',
  'OUT_OF_STOCK',
  'PAYMENT_FAILURE',
  'RISK_REVIEW',
  'ADMIN_OPERATIONAL',
  'DUPLICATE_ORDER',
  'OTHER',
] as const;
export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number];

/* ───────────────────────── Payment (manual verification) ───────────────────────── */
export const PAYMENT_STATUSES = [
  'AWAITING_PAYMENT',
  'PAYMENT_SUBMITTED',
  'UNDER_REVIEW',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentMachine = defineMachine<PaymentStatus>('payment', PAYMENT_STATUSES, {
  AWAITING_PAYMENT: ['PAYMENT_SUBMITTED', 'EXPIRED', 'CANCELLED'],
  PAYMENT_SUBMITTED: ['UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'AWAITING_PAYMENT', 'CANCELLED'],
  UNDER_REVIEW: ['CONFIRMED', 'REJECTED', 'AWAITING_PAYMENT', 'CANCELLED'],
  REJECTED: ['PAYMENT_SUBMITTED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: [],
  EXPIRED: [],
  CANCELLED: [],
});
export const PAYMENT_SUBMISSION_STATUSES = ['SUBMITTED', 'ACCEPTED', 'REJECTED', 'NEW_PROOF_REQUESTED', 'SUPERSEDED'] as const;
export type PaymentSubmissionStatus = (typeof PAYMENT_SUBMISSION_STATUSES)[number];

/* ───────────────────────── Shipment ───────────────────────── */
export const SHIPMENT_STATUSES = ['CREATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'EXCEPTION', 'RETURNED_TO_SELLER', 'LOST'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
/** DELIVERED here means an AUTHORITATIVE delivery event was recorded (carrier / Operations), never a seller claim. */
export const shipmentMachine = defineMachine<ShipmentStatus>('shipment', SHIPMENT_STATUSES, {
  CREATED: ['SHIPPED'],
  SHIPPED: ['IN_TRANSIT', 'DELIVERED', 'FAILED', 'EXCEPTION'],
  IN_TRANSIT: ['DELIVERED', 'FAILED', 'EXCEPTION'],
  FAILED: ['SHIPPED', 'IN_TRANSIT', 'EXCEPTION', 'RETURNED_TO_SELLER'],
  EXCEPTION: ['IN_TRANSIT', 'SHIPPED', 'DELIVERED', 'RETURNED_TO_SELLER', 'LOST'],
  RETURNED_TO_SELLER: ['SHIPPED'],
  DELIVERED: [],
  LOST: [],
});
export const SHIPMENT_EXCEPTION_CODES = [
  'DELIVERY_ATTEMPT_FAILED',
  'BUYER_UNAVAILABLE',
  'BUYER_REFUSED',
  'WRONG_ADDRESS',
  'RETURN_TO_SELLER',
  'LOST_IN_TRANSIT',
  'DAMAGED_IN_TRANSIT',
  'CARRIER_EXCEPTION',
] as const;
export type ShipmentExceptionCode = (typeof SHIPMENT_EXCEPTION_CODES)[number];
/** Where an authoritative delivery event came from. A seller statement is deliberately NOT a source. */
export const DELIVERY_EVENT_SOURCES = ['OPERATIONS_CARRIER_CHECK', 'CARRIER_INTEGRATION'] as const;
export type DeliveryEventSource = (typeof DELIVERY_EVENT_SOURCES)[number];

/* ───────────────────────── Return ───────────────────────── */
export const RETURN_STATUSES = [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'RETURN_IN_TRANSIT',
  'RECEIVED',
  'INSPECTION',
  'REFUND_PENDING',
  'REFUNDED',
  'REJECTED',
  'DISPUTED',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export const returnMachine = defineMachine<ReturnStatus>('return', RETURN_STATUSES, {
  REQUESTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['RETURN_IN_TRANSIT', 'RECEIVED'],
  RETURN_IN_TRANSIT: ['RECEIVED'],
  RECEIVED: ['INSPECTION', 'REFUND_PENDING'],
  INSPECTION: ['REFUND_PENDING', 'DISPUTED'],
  REFUND_PENDING: ['REFUNDED'],
  REJECTED: ['DISPUTED'],
  DISPUTED: ['APPROVED', 'REFUND_PENDING', 'REJECTED'],
  REFUNDED: [],
});

/* ───────────────────────── Refund record (manual money-out to customer) ───────────────────────── */
export const REFUND_STATUSES = [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
  // Legacy (pre-hardening) records: PENDING = reversal already posted, awaiting payout; PAID = paid out.
  'PENDING',
  'PAID',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
/**
 * REQUESTED → (Admin approval: reversal journal) APPROVED → PROCESSING → (execution evidence: payout journal) COMPLETED.
 * Nothing moves money before APPROVED; a FAILED payout keeps the liability and can be retried after reconciliation.
 */
export const refundMachine = defineMachine<RefundStatus>('refund', REFUND_STATUSES, {
  REQUESTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'COMPLETED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  FAILED: ['PROCESSING', 'COMPLETED'],
  PENDING: ['PAID', 'PROCESSING', 'FAILED', 'COMPLETED'],
  COMPLETED: [],
  PAID: [],
  REJECTED: [],
  CANCELLED: [],
});
/** Refund statuses in which money is still owed to the customer or about to be (blocks closure / completion). */
export const REFUND_OPEN_STATUSES: readonly RefundStatus[] = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'FAILED', 'PENDING'];

/* ───────────────────────── External protected deal ───────────────────────── */
export const DEAL_STATUSES = [
  'DRAFT',
  'INVITED',
  'SELLER_JOINED',
  'OFFER_PENDING_BUYER',
  'CHANGE_REQUESTED',
  'ACCEPTED',
  'PAYMENT_PENDING',
  'PAYMENT_UNDER_REVIEW',
  'ACTIVE',
  'DELIVERED',
  'DELIVERY_HANDOVER_VERIFIED',
  'BUYER_CONFIRMATION_PENDING',
  'BUYER_CONFIRMED_RECEIPT',
  'ENTITLED_AWAITING_RELEASE',
  'COMPLETED',
  'DISPUTED',
  'REFUND_PENDING',
  'CANCELLED',
  'REFUNDED',
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export const dealMachine = defineMachine<DealStatus>('external_deal', DEAL_STATUSES, {
  DRAFT: ['INVITED', 'CANCELLED'],
  INVITED: ['SELLER_JOINED', 'CANCELLED', 'DRAFT'],
  SELLER_JOINED: ['OFFER_PENDING_BUYER', 'CANCELLED'],
  OFFER_PENDING_BUYER: ['ACCEPTED', 'CHANGE_REQUESTED', 'CANCELLED'],
  CHANGE_REQUESTED: ['ACCEPTED', 'OFFER_PENDING_BUYER', 'CANCELLED'],
  ACCEPTED: ['PAYMENT_PENDING', 'CANCELLED'],
  PAYMENT_PENDING: ['PAYMENT_UNDER_REVIEW', 'ACTIVE', 'CANCELLED'],
  PAYMENT_UNDER_REVIEW: ['ACTIVE', 'PAYMENT_PENDING', 'CANCELLED'],
  ACTIVE: ['DELIVERED', 'DISPUTED'],
  // DELIVERED = shipped / out for handover. Only a verified delivery OTP moves it on; the seller can
  // never mark the buyer as having received the goods.
  DELIVERED: ['DELIVERY_HANDOVER_VERIFIED', 'DISPUTED'],
  // After a verified OTP handover the buyer has a response window: explicit confirmation, a problem
  // report (dispute + hold) or — only once the window expires with no objection — timeout entitlement.
  DELIVERY_HANDOVER_VERIFIED: ['BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE', 'BUYER_CONFIRMATION_PENDING', 'DISPUTED'],
  BUYER_CONFIRMATION_PENDING: ['BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE', 'DISPUTED'],
  // Entitled, still held: only an explicit Admin release (approval + DEAL_SETTLEMENT journal) completes it.
  BUYER_CONFIRMED_RECEIPT: ['COMPLETED', 'DISPUTED'],
  ENTITLED_AWAITING_RELEASE: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['ENTITLED_AWAITING_RELEASE', 'REFUND_PENDING', 'ACTIVE', 'COMPLETED', 'REFUNDED'],
  // Refund decided; the reversal journal posts only on Admin refund approval.
  REFUND_PENDING: ['REFUNDED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
});

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED', 'EXPIRED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/* ───────────────────────── Dispute ───────────────────────── */
export const DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION', 'RESOLVED', 'CLOSED'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export const disputeMachine = defineMachine<DisputeStatus>('dispute', DISPUTE_STATUSES, {
  OPEN: ['UNDER_REVIEW', 'AWAITING_INFORMATION', 'RESOLVED', 'CLOSED'],
  UNDER_REVIEW: ['AWAITING_INFORMATION', 'RESOLVED'],
  AWAITING_INFORMATION: ['UNDER_REVIEW', 'RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
});
export const DISPUTE_DECISIONS = [
  'FULL_REFUND',
  'PARTIAL_REFUND',
  'RETURN_REQUIRED',
  'REPLACEMENT',
  'RELEASE_TO_SELLER',
  'REJECT_CLAIM',
] as const;
export type DisputeDecision = (typeof DISPUTE_DECISIONS)[number];

/* ───────────────────────── Withdrawal ───────────────────────── */
export const WITHDRAWAL_STATUSES = [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'PROCESSING',
  'PAID',
  'REJECTED',
  'CANCELLED',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];
/**
 * A REQUEST moves no money. APPROVED = Admin approval atomically reserves available funds
 * (AVAILABLE → WITHDRAWAL_RESERVED). PAID = separately authorized payout recording.
 */
export const withdrawalMachine = defineMachine<WithdrawalStatus>('withdrawal', WITHDRAWAL_STATUSES, {
  REQUESTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'PAID', 'REJECTED'],
  PROCESSING: ['PAID', 'REJECTED'],
  PAID: [],
  REJECTED: [],
  CANCELLED: [],
});

/* ───────────────────────── Ledger adjustment (maker/checker) ───────────────────────── */
export const ADJUSTMENT_STATUSES = ['PENDING_APPROVAL', 'POSTED', 'REJECTED'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

/* ───────────────────────── Support ───────────────────────── */
export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'WAITING_SELLER',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const ticketMachine = defineMachine<TicketStatus>('support_ticket', TICKET_STATUSES, {
  OPEN: ['IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_SELLER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'WAITING_SELLER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  WAITING_SELLER: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  ESCALATED: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
});

/* ───────────────────────── Misc enums ───────────────────────── */
export const SELLER_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;
export type SellerType = (typeof SELLER_TYPES)[number];
export const PRODUCT_CONDITIONS = ['NEW', 'USED'] as const;
export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number];
export const USED_GRADES = ['LIKE_NEW', 'VERY_GOOD', 'GOOD', 'ACCEPTABLE'] as const;
export type UsedGrade = (typeof USED_GRADES)[number];
export const PAYMENT_METHOD_CODES = ['BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH'] as const;
export type PaymentMethodCode = (typeof PAYMENT_METHOD_CODES)[number];
export const PAYOUT_TYPES = ['BANK_ACCOUNT', 'INSTAPAY', 'MOBILE_WALLET'] as const;
export type PayoutType = (typeof PAYOUT_TYPES)[number];
export const ATTRIBUTE_TYPES = ['TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'BOOLEAN'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];
export const RETURN_REASONS = [
  'CHANGED_MIND',
  'WRONG_ITEM',
  'DAMAGED',
  'DEFECTIVE',
  'MISSING_PARTS',
  'NOT_AS_DESCRIBED',
  'COUNTERFEIT_SUSPECTED',
  'OTHER',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export const TICKET_TYPES = ['ORDER', 'PAYMENT', 'SHIPPING', 'RETURN', 'PRODUCT', 'SELLER', 'EXTERNAL_DEAL', 'ACCOUNT'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const SELLER_DOCUMENT_KINDS = [
  'NATIONAL_ID_FRONT',
  'NATIONAL_ID_BACK',
  'COMMERCIAL_REGISTRATION',
  'TAX_CARD',
  'AUTHORIZATION_LETTER',
  'OTHER',
] as const;
export type SellerDocumentKind = (typeof SELLER_DOCUMENT_KINDS)[number];
export const SELLER_MEMBER_ROLES = [
  'STORE_OWNER',
  'STORE_MANAGER',
  'CATALOG_MANAGER',
  'ORDER_MANAGER',
  'FINANCE',
  'SUPPORT',
] as const;
export type SellerMemberRole = (typeof SELLER_MEMBER_ROLES)[number];
