import { describe, expect, it } from 'vitest';
import { PAYMENT_METHOD_CODES } from '@/domain/machines';
import { label } from '@/lib/i18n/labels';
import { statusLabel } from '@/lib/i18n/labels';
import { TX_KINDS, TX_KIND_META, TX_KINDS_NEED_PAYMENTS_VIEW, TX_METHOD_GROUPS, TX_METHOD_GROUP_CODES, TX_METHOD_GROUP_LABEL, UNGROUPED_METHOD_CODES, parseTxKind, parseTxMethodGroup, txMethodGroupOf } from '@/lib/transaction-labels';

/** PKG-FOLLOWUP-02: the /admin/transactions labels and filters. Pure checks, no database. */
describe('payment-method filter', () => {
  it('every payment method the system knows belongs to exactly one filter group', () => {
    expect(UNGROUPED_METHOD_CODES).toEqual([]);
    for (const code of PAYMENT_METHOD_CODES) {
      const groups = TX_METHOD_GROUPS.filter((g) => TX_METHOD_GROUP_CODES[g].includes(code));
      expect(groups, code).toHaveLength(1);
    }
  });
  it('offers the five choices the owner asked for, with Arabic names', () => {
    expect(TX_METHOD_GROUPS.map((g) => TX_METHOD_GROUP_LABEL[g])).toEqual(['تحويل بنكي', 'إنستاباي', 'محفظة إلكترونية', 'الدفع عند الاستلام', 'رصيد المحفظة']);
    expect(txMethodGroupOf('VODAFONE_CASH')).toBe('MOBILE_WALLET');
    expect(txMethodGroupOf('WALLET')).toBe('WALLET');
    expect(txMethodGroupOf('COD')).toBe('COD');
    expect(txMethodGroupOf(null)).toBeNull();
  });
  it('WALLET has an Arabic method label', () => {
    expect(label('paymentMethod', 'WALLET')).toBe('رصيد المحفظة');
  });
  it('unknown filter values are ignored, never passed to the query', () => {
    expect(parseTxKind('x; drop table')).toBeNull();
    expect(parseTxKind('WALLET_TOPUP')).toBe('WALLET_TOPUP');
    expect(parseTxMethodGroup('VODAFONE_CASH')).toBeNull(); // a code, not a group
    expect(parseTxMethodGroup('MOBILE_WALLET')).toBe('MOBILE_WALLET');
    expect(parseTxMethodGroup(['WALLET'])).toBeNull();
  });
});

describe('kinds', () => {
  it('each kind has a clear Arabic label', () => {
    for (const k of TX_KINDS) expect(TX_KIND_META[k].label).toMatch(/[\u0600-\u06FF]/);
    expect(TX_KIND_META.WALLET_TOPUP.label).toContain('إيداع');
    expect(TX_KIND_META.WALLET_SPEND.label).toContain('صرف');
    expect(TX_KIND_META.SPEND_REVERSAL.label).toContain('استرجاع');
  });
  it('a deposit is a payment document: it needs payments.view', () => {
    expect(TX_KINDS_NEED_PAYMENTS_VIEW).toContain('WALLET_TOPUP');
  });
  it('the deposit statuses read in Arabic', () => {
    for (const s of ['PENDING_REVIEW', 'CREDITED', 'REJECTED', 'CANCELLED']) expect(statusLabel(s)).toMatch(/[\u0600-\u06FF]/);
  });
});
