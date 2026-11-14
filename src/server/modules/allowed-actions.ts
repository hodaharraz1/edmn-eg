import type { DealStatus, SellerOrderStatus } from '@/domain/machines';
import { sellerOrderMachine } from '@/domain/machines';

/**
 * Server-side `allowed_actions` (Phase 1).
 *
 * The apps must never re-implement the Protected Deal or fulfilment state machines: every deal / seller-order payload
 * they receive carries the list of actions the CURRENT viewer may attempt now. These pure functions mirror the guards
 * in deals/service.ts, commerce/fulfilment.ts and postpurchase/disputes.ts (role + status + the flags the guard reads);
 * tests/unit/allowed-actions.test.ts pins the full status × role matrix.
 *
 * An action listed here is an INVITATION to try, not a grant: the service re-checks everything under a row lock
 * (payment proof under review, rate limits, dispute windows, kill switches…). An action NOT listed is always refused
 * by the service, so hiding it can never hide a capability the user actually has.
 *
 * Staff/financial actions (hold, release, refund approval) are deliberately absent: they are Admin App concerns with
 * their own permission and maker/checker checks.
 */

export const DEAL_ACTIONS = [
  'EDIT_DRAFT',
  'ADD_PHOTOS',
  'INVITE_SELLER',
  'REFRESH_INVITATION',
  'REVOKE_INVITATION',
  'CANCEL',
  'RESPOND_TO_OFFER',
  'START_PAYMENT',
  'VIEW_DELIVERY_CODE',
  'REGENERATE_DELIVERY_CODE',
  'REPORT_NOT_RECEIVED',
  'REPORT_DELIVERY_EXCEPTION',
  'CONFIRM_RECEIPT',
  'OPEN_DISPUTE',
  'REJECT_INVITATION',
  'SUBMIT_OFFER',
  'RESPOND_TO_CHANGE_REQUEST',
  'MARK_SHIPPED',
  'VERIFY_DELIVERY_CODE',
] as const;
export type DealAction = (typeof DEAL_ACTIONS)[number];

export type DealRole = 'BUYER' | 'SELLER' | 'NONE';

export interface DealActionView {
  status: DealStatus;
  role: DealRole;
  /** externalDeals.handoverVerifiedAt is set (a delivery code was verified). */
  handoverVerified: boolean;
  /** The deal used up its lifetime delivery-code guesses (regeneration is refused). */
  otpGuessesExhausted?: boolean;
}

const BUYER_CANCELLABLE: readonly DealStatus[] = ['DRAFT', 'INVITED', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED', 'ACCEPTED', 'PAYMENT_PENDING'];
const DISPUTABLE: readonly DealStatus[] = ['ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING', 'BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE'];
const NOT_RECEIVED: readonly DealStatus[] = ['DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING'];

export function dealAllowedActions(v: DealActionView): DealAction[] {
  const s = v.status;
  const out: DealAction[] = [];
  if (v.role === 'NONE') return out;
  const exceptionOpen = s === 'DELIVERED' || (s === 'BUYER_CONFIRMATION_PENDING' && !v.handoverVerified);
  if (v.role === 'BUYER') {
    if (s === 'DRAFT') out.push('EDIT_DRAFT', 'INVITE_SELLER');
    if (s === 'DRAFT' || s === 'INVITED') out.push('ADD_PHOTOS');
    if (s === 'INVITED') out.push('REFRESH_INVITATION', 'REVOKE_INVITATION');
    if (BUYER_CANCELLABLE.includes(s)) out.push('CANCEL');
    if (s === 'OFFER_PENDING_BUYER') out.push('RESPOND_TO_OFFER');
    if (s === 'PAYMENT_PENDING') out.push('START_PAYMENT');
    if (s === 'DELIVERED') {
      out.push('VIEW_DELIVERY_CODE');
      if (!v.otpGuessesExhausted) out.push('REGENERATE_DELIVERY_CODE');
    }
    if (NOT_RECEIVED.includes(s)) out.push('REPORT_NOT_RECEIVED');
    if (exceptionOpen) out.push('REPORT_DELIVERY_EXCEPTION');
    if ((s === 'DELIVERY_HANDOVER_VERIFIED' || s === 'BUYER_CONFIRMATION_PENDING') && v.handoverVerified) out.push('CONFIRM_RECEIPT');
    if (DISPUTABLE.includes(s)) out.push('OPEN_DISPUTE');
  } else {
    if (s === 'SELLER_JOINED') out.push('REJECT_INVITATION');
    if (s === 'SELLER_JOINED' || s === 'CHANGE_REQUESTED') out.push('SUBMIT_OFFER');
    if (s === 'CHANGE_REQUESTED') out.push('RESPOND_TO_CHANGE_REQUEST');
    if (s === 'ACTIVE') out.push('MARK_SHIPPED');
    if (s === 'DELIVERED') {
      out.push('VERIFY_DELIVERY_CODE');
      if (!v.otpGuessesExhausted) out.push('REGENERATE_DELIVERY_CODE');
    }
    if (exceptionOpen) out.push('REPORT_DELIVERY_EXCEPTION');
    if (DISPUTABLE.includes(s)) out.push('OPEN_DISPUTE');
  }
  return out;
}

export const SELLER_ORDER_ACTIONS = [
  'REQUEST_CANCELLATION',
  'CONFIRM_RECEIPT',
  'REPORT_PROBLEM',
  'OPEN_DISPUTE',
  'CONFIRM_ORDER',
  'START_PROCESSING',
  'MARK_READY_TO_SHIP',
  'SAVE_SHIPMENT',
  'MARK_SHIPPED',
  'ADD_TRACKING_EVENT',
  'SUBMIT_DELIVERY_EVIDENCE',
  'ACCEPT_CANCELLATION',
] as const;
export type SellerOrderAction = (typeof SELLER_ORDER_ACTIONS)[number];

export interface SellerOrderActionView {
  status: SellerOrderStatus;
  /** BUYER = the order's customer; SELLER = a store member holding orders.manage. */
  role: 'BUYER' | 'SELLER' | 'NONE';
  cancellationPending: boolean;
  openDispute: boolean;
  /** Dispute window (disputes.windowDays from delivery) has passed. */
  disputeWindowClosed?: boolean;
}

const BUYER_CANCEL_REQUESTABLE: readonly SellerOrderStatus[] = ['PAID', 'PAYMENT_UNDER_REVIEW', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'];
const PROBLEM_REPORTABLE: readonly SellerOrderStatus[] = ['SHIPPED', 'AWAITING_BUYER_RESPONSE', 'DELIVERED', 'COMPLETED'];
const NOT_DISPUTABLE: readonly SellerOrderStatus[] = ['PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'CANCELLED'];

export function sellerOrderAllowedActions(v: SellerOrderActionView): SellerOrderAction[] {
  const s = v.status;
  const out: SellerOrderAction[] = [];
  if (v.role === 'BUYER') {
    if (BUYER_CANCEL_REQUESTABLE.includes(s) && !v.cancellationPending) out.push('REQUEST_CANCELLATION');
    if ((s === 'SHIPPED' || s === 'AWAITING_BUYER_RESPONSE') && !v.openDispute) out.push('CONFIRM_RECEIPT');
    if (PROBLEM_REPORTABLE.includes(s)) out.push('REPORT_PROBLEM');
    if (!NOT_DISPUTABLE.includes(s) && !v.openDispute && !v.disputeWindowClosed) out.push('OPEN_DISPUTE');
  } else if (v.role === 'SELLER') {
    if (s === 'PAID') out.push('CONFIRM_ORDER');
    if (sellerOrderMachine.can(s, 'PROCESSING')) out.push('START_PROCESSING');
    if (sellerOrderMachine.can(s, 'READY_TO_SHIP')) out.push('MARK_READY_TO_SHIP');
    if (['SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED'].includes(s)) out.push('SAVE_SHIPMENT');
    if (['SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'].includes(s) && !v.cancellationPending) out.push('MARK_SHIPPED');
    if (s === 'SHIPPED') out.push('ADD_TRACKING_EVENT');
    if (s === 'SHIPPED' || s === 'AWAITING_BUYER_RESPONSE') out.push('SUBMIT_DELIVERY_EVIDENCE');
    if (v.cancellationPending && s !== 'CANCELLED') out.push('ACCEPT_CANCELLATION');
    if (!NOT_DISPUTABLE.includes(s) && !v.openDispute && !v.disputeWindowClosed) out.push('OPEN_DISPUTE');
  }
  return out;
}
