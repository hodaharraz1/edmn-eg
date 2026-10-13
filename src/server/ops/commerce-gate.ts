import { DomainError } from '@/server/core/errors';
import { runtimeEnvironment } from '@/server/core/runtime-env';
import { db, type DbOrTx } from '@/server/db/client';
import { getSetting, realMoneyEnabled } from '@/server/modules/settings';

/**
 * PUBLIC WEBSITE vs TRANSACTIONS (final audit). New commerce (placing an order, inviting a seller to a Protected
 * Deal, paying a deal) is open only when:
 *   - maintenance mode is off, AND
 *   - outside PRODUCTION, or in PRODUCTION once real money is enabled (a production payment is always real money:
 *     test destinations are refused there by trigger).
 * Browsing, registration, login, identity, seller onboarding, support, existing orders/deals, disputes and history
 * are never affected — so www can go public before real money without a single fake or half-working payment.
 */
export type TransactionsState = { open: true; reason: null } | { open: false; reason: 'MAINTENANCE' | 'NOT_LAUNCHED' };

export async function transactionsState(conn: DbOrTx = db): Promise<TransactionsState> {
  if (await getSetting('marketplace.maintenanceMode', conn)) return { open: false, reason: 'MAINTENANCE' };
  if (runtimeEnvironment() === 'PRODUCTION' && !(await realMoneyEnabled(conn))) return { open: false, reason: 'NOT_LAUNCHED' };
  return { open: true, reason: null };
}

export const TRANSACTIONS_CLOSED_MESSAGE = {
  MAINTENANCE: 'المنصة في صيانة مؤقتة: الطلبات والصفقات الجديدة موقوفة دلوقتي. حسابك وطلباتك الحالية متاحة عادي.',
  NOT_LAUNCHED: 'الشراء والصفقات المحمية على اضمن هيبدأوا قريبًا. تقدر تتصفح المنتجات وتسجّل حسابك دلوقتي.',
} as const;

export async function assertTransactionsOpen(conn: DbOrTx = db): Promise<void> {
  const s = await transactionsState(conn);
  if (!s.open) throw new DomainError('INVALID_STATE', TRANSACTIONS_CLOSED_MESSAGE[s.reason]);
}
