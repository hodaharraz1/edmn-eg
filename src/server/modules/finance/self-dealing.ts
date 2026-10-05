import { sql } from 'drizzle-orm';
import type { Actor } from '@/server/core/actor';
import { forbidden } from '@/server/core/errors';
import type { DbOrTx } from '@/server/db/client';

/** Separation of duties: staff can never act on money or listings of a store they own or work for. */
export async function assertNotSelfDealing(tx: DbOrTx, actor: Actor, sellerId: string) {
  if (!actor.userId || actor.type === 'SYSTEM') return;
  const r = await tx.execute(sql`select 1 from sellers s left join seller_members m on m.seller_id = s.id and m.user_id = ${actor.userId} and m.is_active
    where s.id = ${sellerId} and (s.owner_user_id = ${actor.userId} or m.user_id is not null) limit 1`);
  if (r.rows.length) throw forbidden('لا يمكنك تنفيذ هذا الإجراء على متجر أنت مالكه أو عضو فيه');
}
