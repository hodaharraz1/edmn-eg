import { describe, expect, it } from 'vitest';
import { DEAL_STATUSES, SELLER_ORDER_STATUSES, type DealStatus, type SellerOrderStatus } from '@/domain/machines';
import { dealAllowedActions, sellerOrderAllowedActions, type DealAction, type SellerOrderAction } from '@/server/modules/allowed-actions';

/**
 * Exhaustive status × role matrix for server-side allowed_actions. Each expectation mirrors a guard in the domain
 * services (cited per row) — a change to a service guard must change this table, never the app.
 */
const DEAL_BUYER: Record<DealStatus, DealAction[]> = {
  DRAFT: ['EDIT_DRAFT', 'INVITE_SELLER', 'ADD_PHOTOS', 'CANCEL'], // requireDraft, addDealPhotos, cancelDeal
  INVITED: ['ADD_PHOTOS', 'REFRESH_INVITATION', 'REVOKE_INVITATION', 'CANCEL'],
  SELLER_JOINED: ['CANCEL'],
  OFFER_PENDING_BUYER: ['CANCEL', 'RESPOND_TO_OFFER'],
  CHANGE_REQUESTED: ['CANCEL'],
  ACCEPTED: ['CANCEL'],
  PAYMENT_PENDING: ['CANCEL', 'START_PAYMENT'],
  PAYMENT_UNDER_REVIEW: [],
  ACTIVE: ['OPEN_DISPUTE'],
  DELIVERED: ['VIEW_DELIVERY_CODE', 'REGENERATE_DELIVERY_CODE', 'REPORT_NOT_RECEIVED', 'REPORT_DELIVERY_EXCEPTION', 'OPEN_DISPUTE'],
  DELIVERY_HANDOVER_VERIFIED: ['REPORT_NOT_RECEIVED', 'CONFIRM_RECEIPT', 'OPEN_DISPUTE'],
  BUYER_CONFIRMATION_PENDING: ['REPORT_NOT_RECEIVED', 'CONFIRM_RECEIPT', 'OPEN_DISPUTE'],
  BUYER_CONFIRMED_RECEIPT: ['OPEN_DISPUTE'],
  ENTITLED_AWAITING_RELEASE: ['OPEN_DISPUTE'],
  COMPLETED: [],
  DISPUTED: [],
  REFUND_PENDING: [],
  CANCELLED: [],
  REFUNDED: [],
};

const DEAL_SELLER: Record<DealStatus, DealAction[]> = {
  DRAFT: [],
  INVITED: [],
  SELLER_JOINED: ['REJECT_INVITATION', 'SUBMIT_OFFER'],
  OFFER_PENDING_BUYER: [],
  CHANGE_REQUESTED: ['SUBMIT_OFFER', 'RESPOND_TO_CHANGE_REQUEST'],
  ACCEPTED: [],
  PAYMENT_PENDING: [],
  PAYMENT_UNDER_REVIEW: [],
  ACTIVE: ['MARK_SHIPPED', 'OPEN_DISPUTE'],
  DELIVERED: ['VERIFY_DELIVERY_CODE', 'REGENERATE_DELIVERY_CODE', 'REPORT_DELIVERY_EXCEPTION', 'OPEN_DISPUTE'],
  DELIVERY_HANDOVER_VERIFIED: ['OPEN_DISPUTE'],
  BUYER_CONFIRMATION_PENDING: ['OPEN_DISPUTE'],
  BUYER_CONFIRMED_RECEIPT: ['OPEN_DISPUTE'],
  ENTITLED_AWAITING_RELEASE: ['OPEN_DISPUTE'],
  COMPLETED: [],
  DISPUTED: [],
  REFUND_PENDING: [],
  CANCELLED: [],
  REFUNDED: [],
};

const sorted = <T extends string>(a: T[]) => [...a].sort();

describe('allowed_actions — Protected Deals', () => {
  it('buyer matrix covers every status (handover verified)', () => {
    for (const s of DEAL_STATUSES) {
      const handoverVerified = !['DRAFT', 'INVITED', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'ACTIVE', 'DELIVERED'].includes(s);
      expect(sorted(dealAllowedActions({ status: s, role: 'BUYER', handoverVerified })), s).toEqual(sorted(DEAL_BUYER[s]));
    }
  });

  it('seller matrix covers every status', () => {
    for (const s of DEAL_STATUSES) {
      const handoverVerified = ['DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING', 'BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE', 'COMPLETED'].includes(s);
      expect(sorted(dealAllowedActions({ status: s, role: 'SELLER', handoverVerified })), s).toEqual(sorted(DEAL_SELLER[s]));
    }
  });

  it('a non-party gets nothing in any status', () => {
    for (const s of DEAL_STATUSES) expect(dealAllowedActions({ status: s, role: 'NONE', handoverVerified: true })).toEqual([]);
  });

  it('receipt can never be confirmed before a verified handover (legacy pending without OTP → exception path only)', () => {
    const legacy = dealAllowedActions({ status: 'BUYER_CONFIRMATION_PENDING', role: 'BUYER', handoverVerified: false });
    expect(legacy).not.toContain('CONFIRM_RECEIPT');
    expect(legacy).toContain('REPORT_DELIVERY_EXCEPTION');
    expect(dealAllowedActions({ status: 'DELIVERED', role: 'BUYER', handoverVerified: false })).not.toContain('CONFIRM_RECEIPT');
  });

  it('the seller is never offered a buyer-only action (confirm receipt, view code, payment, cancel)', () => {
    for (const s of DEAL_STATUSES) {
      const a = dealAllowedActions({ status: s, role: 'SELLER', handoverVerified: true });
      for (const buyerOnly of ['CONFIRM_RECEIPT', 'VIEW_DELIVERY_CODE', 'START_PAYMENT', 'CANCEL', 'RESPOND_TO_OFFER'] as const) expect(a).not.toContain(buyerOnly);
    }
  });

  it('exhausted delivery-code guesses remove regeneration for both parties', () => {
    expect(dealAllowedActions({ status: 'DELIVERED', role: 'BUYER', handoverVerified: false, otpGuessesExhausted: true })).not.toContain('REGENERATE_DELIVERY_CODE');
    expect(dealAllowedActions({ status: 'DELIVERED', role: 'SELLER', handoverVerified: false, otpGuessesExhausted: true })).not.toContain('REGENERATE_DELIVERY_CODE');
  });

  it('no financial action is ever offered to a party', () => {
    for (const s of DEAL_STATUSES)
      for (const role of ['BUYER', 'SELLER'] as const) {
        const a: string[] = dealAllowedActions({ status: s, role, handoverVerified: true });
        for (const fin of ['RELEASE', 'REFUND', 'SET_HOLD', 'APPROVE']) expect(a.some((x) => x.includes(fin))).toBe(false);
      }
  });
});

const SO_BUYER: Record<SellerOrderStatus, SellerOrderAction[]> = {
  PENDING_PAYMENT: [],
  PAYMENT_UNDER_REVIEW: ['REQUEST_CANCELLATION'],
  PAID: ['REQUEST_CANCELLATION', 'OPEN_DISPUTE'],
  SELLER_CONFIRMED: ['REQUEST_CANCELLATION', 'OPEN_DISPUTE'],
  PROCESSING: ['REQUEST_CANCELLATION', 'OPEN_DISPUTE'],
  READY_TO_SHIP: ['REQUEST_CANCELLATION', 'OPEN_DISPUTE'],
  SHIPPED: ['CONFIRM_RECEIPT', 'REPORT_PROBLEM', 'OPEN_DISPUTE'],
  AWAITING_BUYER_RESPONSE: ['CONFIRM_RECEIPT', 'REPORT_PROBLEM', 'OPEN_DISPUTE'],
  DELIVERED: ['REPORT_PROBLEM', 'OPEN_DISPUTE'],
  COMPLETED: ['REPORT_PROBLEM', 'OPEN_DISPUTE'],
  DELIVERY_FAILED: ['OPEN_DISPUTE'],
  CANCELLED: [],
};

const SO_SELLER: Record<SellerOrderStatus, SellerOrderAction[]> = {
  PENDING_PAYMENT: [],
  PAYMENT_UNDER_REVIEW: [],
  PAID: ['CONFIRM_ORDER', 'OPEN_DISPUTE'],
  SELLER_CONFIRMED: ['START_PROCESSING', 'MARK_READY_TO_SHIP', 'SAVE_SHIPMENT', 'MARK_SHIPPED', 'OPEN_DISPUTE'],
  PROCESSING: ['MARK_READY_TO_SHIP', 'SAVE_SHIPMENT', 'MARK_SHIPPED', 'OPEN_DISPUTE'],
  READY_TO_SHIP: ['SAVE_SHIPMENT', 'MARK_SHIPPED', 'OPEN_DISPUTE'],
  SHIPPED: ['SAVE_SHIPMENT', 'ADD_TRACKING_EVENT', 'SUBMIT_DELIVERY_EVIDENCE', 'OPEN_DISPUTE'],
  AWAITING_BUYER_RESPONSE: ['SUBMIT_DELIVERY_EVIDENCE', 'OPEN_DISPUTE'],
  DELIVERED: ['OPEN_DISPUTE'],
  COMPLETED: ['OPEN_DISPUTE'],
  DELIVERY_FAILED: ['OPEN_DISPUTE'],
  CANCELLED: [],
};

describe('allowed_actions — seller orders', () => {
  it('buyer matrix covers every status', () => {
    for (const s of SELLER_ORDER_STATUSES) expect(sorted(sellerOrderAllowedActions({ status: s, role: 'BUYER', cancellationPending: false, openDispute: false })), s).toEqual(sorted(SO_BUYER[s]));
  });

  it('seller matrix covers every status', () => {
    for (const s of SELLER_ORDER_STATUSES) expect(sorted(sellerOrderAllowedActions({ status: s, role: 'SELLER', cancellationPending: false, openDispute: false })), s).toEqual(sorted(SO_SELLER[s]));
  });

  it('a pending buyer cancellation blocks shipment and offers the seller acceptance instead', () => {
    const a = sellerOrderAllowedActions({ status: 'PROCESSING', role: 'SELLER', cancellationPending: true, openDispute: false });
    expect(a).not.toContain('MARK_SHIPPED');
    expect(a).toContain('ACCEPT_CANCELLATION');
    expect(sellerOrderAllowedActions({ status: 'PROCESSING', role: 'BUYER', cancellationPending: true, openDispute: false })).not.toContain('REQUEST_CANCELLATION');
  });

  it('an open dispute removes receipt confirmation and a second dispute; a closed window removes disputes', () => {
    const a = sellerOrderAllowedActions({ status: 'SHIPPED', role: 'BUYER', cancellationPending: false, openDispute: true });
    expect(a).not.toContain('CONFIRM_RECEIPT');
    expect(a).not.toContain('OPEN_DISPUTE');
    expect(sellerOrderAllowedActions({ status: 'COMPLETED', role: 'BUYER', cancellationPending: false, openDispute: false, disputeWindowClosed: true })).not.toContain('OPEN_DISPUTE');
  });

  it('the seller can never confirm delivery or receipt on the buyer’s behalf', () => {
    for (const s of SELLER_ORDER_STATUSES) expect(sellerOrderAllowedActions({ status: s, role: 'SELLER', cancellationPending: false, openDispute: false })).not.toContain('CONFIRM_RECEIPT');
  });

  it('a non-party gets nothing', () => {
    for (const s of SELLER_ORDER_STATUSES) expect(sellerOrderAllowedActions({ status: s, role: 'NONE', cancellationPending: false, openDispute: false })).toEqual([]);
  });
});
