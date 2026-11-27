/**
 * PKG-FOLLOWUP-02: labels and filters of the admin money-movement page. Client-safe (no server imports).
 * One list of kinds and one list of payment-method groups, shared by the query and the page so the filter and
 * the label can never drift apart.
 */
import { PAYMENT_METHOD_CODES } from '@/domain/machines';

export const TX_KINDS = ['ORDER_PAYMENT', 'DEAL_PAYMENT', 'WALLET_SPEND', 'SPEND_REVERSAL', 'WALLET_TOPUP', 'WITHDRAWAL', 'REFUND', 'DEAL_PAYOUT'] as const;
export type TxKind = (typeof TX_KINDS)[number];

export const TX_KIND_META: Record<TxKind, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' | 'brand' }> = {
  ORDER_PAYMENT: { label: 'دفع طلب (وارد)', tone: 'success' },
  DEAL_PAYMENT: { label: 'دفع صفقة (وارد)', tone: 'success' },
  WALLET_TOPUP: { label: 'إيداع في المحفظة (وارد)', tone: 'success' },
  WALLET_SPEND: { label: 'صرف من رصيد المحفظة (دفع طلب أو صفقة)', tone: 'brand' },
  SPEND_REVERSAL: { label: 'استرجاع إلى المحفظة', tone: 'warning' },
  WITHDRAWAL: { label: 'سحب بائع (صادر)', tone: 'warning' },
  REFUND: { label: 'استرداد عميل (صادر)', tone: 'danger' },
  DEAL_PAYOUT: { label: 'مستحق صفقة (صادر)', tone: 'warning' },
};

/** Kinds that exist only for people who can see payments (a deposit is a payment document). */
export const TX_KINDS_NEED_PAYMENTS_VIEW: readonly TxKind[] = ['WALLET_TOPUP'];

export const TX_METHOD_GROUPS = ['BANK_TRANSFER', 'INSTAPAY', 'MOBILE_WALLET', 'COD', 'WALLET'] as const;
export type TxMethodGroup = (typeof TX_METHOD_GROUPS)[number];

export const TX_METHOD_GROUP_LABEL: Record<TxMethodGroup, string> = {
  BANK_TRANSFER: 'تحويل بنكي',
  INSTAPAY: 'إنستاباي',
  MOBILE_WALLET: 'محفظة إلكترونية',
  COD: 'الدفع عند الاستلام',
  WALLET: 'رصيد المحفظة',
};

/** Every payment-method code belongs to exactly one group; the check below keeps a new code from being forgotten. */
export const TX_METHOD_GROUP_CODES: Record<TxMethodGroup, readonly string[]> = {
  BANK_TRANSFER: ['BANK_TRANSFER'],
  INSTAPAY: ['INSTAPAY'],
  MOBILE_WALLET: ['VODAFONE_CASH', 'ORANGE_CASH', 'ETISALAT_CASH', 'WE_PAY', 'BM_WALLET'],
  COD: ['COD'],
  WALLET: ['WALLET'],
};

export function txMethodGroupOf(code: string | null | undefined): TxMethodGroup | null {
  if (!code) return null;
  for (const g of TX_METHOD_GROUPS) if (TX_METHOD_GROUP_CODES[g].includes(code)) return g;
  return null;
}

/** Codes in the machine list that no group covers (must be empty; asserted in a unit test). */
export const UNGROUPED_METHOD_CODES = PAYMENT_METHOD_CODES.filter((c) => txMethodGroupOf(c) === null);

export function parseTxKind(v: unknown): TxKind | null {
  return typeof v === 'string' && (TX_KINDS as readonly string[]).includes(v) ? (v as TxKind) : null;
}
export function parseTxMethodGroup(v: unknown): TxMethodGroup | null {
  return typeof v === 'string' && (TX_METHOD_GROUPS as readonly string[]).includes(v) ? (v as TxMethodGroup) : null;
}
