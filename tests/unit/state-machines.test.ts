import { describe, expect, it } from 'vitest';
import {
  dealMachine,
  disputeMachine,
  orderMachine,
  paymentMachine,
  productMachine,
  returnMachine,
  sellerMachine,
  sellerOrderMachine,
  shipmentMachine,
  withdrawalMachine,
} from '@/domain/machines';
import { DomainError } from '@/server/core/errors';

describe('state machines', () => {
  it('allow documented transitions', () => {
    expect(sellerMachine.can('PENDING_REVIEW', 'APPROVED')).toBe(true);
    expect(productMachine.can('SUBMITTED', 'LIVE')).toBe(true);
    expect(orderMachine.can('PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW')).toBe(true);
    expect(sellerOrderMachine.can('SHIPPED', 'DELIVERED')).toBe(true);
    expect(paymentMachine.can('REJECTED', 'PAYMENT_SUBMITTED')).toBe(true);
    expect(shipmentMachine.can('SHIPPED', 'DELIVERED')).toBe(true);
    expect(returnMachine.can('INSPECTION', 'REFUND_PENDING')).toBe(true);
    expect(dealMachine.can('DELIVERED', 'COMPLETED')).toBe(true);
    expect(disputeMachine.can('OPEN', 'RESOLVED')).toBe(true);
    expect(withdrawalMachine.can('APPROVED', 'PAID')).toBe(true);
  });
  it('block invalid transitions with a DomainError', () => {
    expect(() => sellerMachine.assert('DRAFT', 'APPROVED')).toThrow(DomainError);
    expect(() => paymentMachine.assert('AWAITING_PAYMENT', 'CONFIRMED')).toThrow(); // proof is mandatory
    expect(() => sellerOrderMachine.assert('PAID', 'SHIPPED')).toThrow(); // must be confirmed first
    expect(() => sellerOrderMachine.assert('SHIPPED', 'CANCELLED')).toThrow(); // returns instead
    expect(() => withdrawalMachine.assert('REQUESTED', 'PAID')).toThrow(); // must be approved
    expect(() => withdrawalMachine.assert('PAID', 'REJECTED')).toThrow();
    expect(() => dealMachine.assert('INVITED', 'ACTIVE')).toThrow();
    expect(() => productMachine.assert('ARCHIVED', 'LIVE')).toThrow();
  });
  it('treat terminal states as final', () => {
    for (const m of [paymentMachine, withdrawalMachine, dealMachine, returnMachine] as unknown as { terminal: string[]; next(s: string): readonly string[] }[]) {
      for (const t of m.terminal) expect(m.next(t)).toHaveLength(0);
    }
    expect(paymentMachine.terminal).toContain('CONFIRMED');
    expect(withdrawalMachine.terminal).toContain('PAID');
  });
});
