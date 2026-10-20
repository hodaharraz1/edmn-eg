import { describe, expect, it } from 'vitest';
import { DELIVERY_EVENT_SOURCES, RECEIPT_BASES, refundMachine, sellerOrderMachine, withdrawalMachine } from '@/domain/machines';

describe('hardened state machines', () => {
  it('no path skips the buyer window / entitlement / Admin release', () => {
    expect(sellerOrderMachine.can('SHIPPED', 'COMPLETED')).toBe(false);
    expect(sellerOrderMachine.can('AWAITING_BUYER_RESPONSE', 'COMPLETED')).toBe(false);
    expect(sellerOrderMachine.can('SHIPPED', 'AWAITING_BUYER_RESPONSE')).toBe(true);
    expect(sellerOrderMachine.can('AWAITING_BUYER_RESPONSE', 'DELIVERED')).toBe(true);
    expect(sellerOrderMachine.can('DELIVERED', 'COMPLETED')).toBe(true);
  });

  it('cancellation is impossible from SHIPPED onwards', () => {
    for (const s of ['SHIPPED', 'AWAITING_BUYER_RESPONSE', 'DELIVERED', 'COMPLETED'] as const) expect(sellerOrderMachine.can(s, 'CANCELLED')).toBe(false);
  });

  it('a seller is never an authoritative delivery-event source; timeout and buyer confirmation are distinct bases', () => {
    expect(DELIVERY_EVENT_SOURCES as readonly string[]).not.toContain('SELLER');
    expect(RECEIPT_BASES).toEqual(expect.arrayContaining(['BUYER_CONFIRMED', 'TIMEOUT_ENTITLEMENT']));
  });

  it('refund approval and payout are separate steps; withdrawal request → approval before paid', () => {
    expect(refundMachine.can('REQUESTED', 'COMPLETED')).toBe(false);
    expect(refundMachine.can('APPROVED', 'COMPLETED')).toBe(true);
    expect(withdrawalMachine.can('REQUESTED', 'PAID')).toBe(false);
  });
});
