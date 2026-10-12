import { DomainError } from '@/server/core/errors';
import type { DbOrTx } from '@/server/db/client';
import { getSetting } from '@/server/modules/settings';

/**
 * CONTROLLED PILOT (Batch 2). Off by default. When `pilot.enabled`, only allow-listed users may start NEW
 * commerce (place an order, invite a seller to a Protected Deal, pay a deal), and amounts are capped only when
 * the owner configured a cap (null = no cap; no limit is invented here). Existing orders/deals, support,
 * disputes and history are never affected.
 */
export async function assertPilotAllowed(conn: DbOrTx, userId: string, op: 'ORDER' | 'DEAL', amount?: number | null): Promise<void> {
  if (!(await getSetting('pilot.enabled', conn))) return;
  const allowed = await getSetting('pilot.allowedUserIds', conn);
  if (!allowed.includes(userId)) throw new DomainError('FORBIDDEN', 'المنصة في مرحلة تجريبية محدودة حاليًا، والعمليات الجديدة متاحة للمشاركين في التجربة بس.');
  if (amount === undefined || amount === null) return;
  const cap = await getSetting(op === 'ORDER' ? 'pilot.maxOrderAmount' : 'pilot.maxDealAmount', conn);
  if (cap !== null && amount > cap) throw new DomainError('INVALID_STATE', 'المبلغ أكبر من الحد المسموح بيه في المرحلة التجريبية.');
}
