import { z } from 'zod';
import { recordTransition } from '@/server/audit/audit';
import type { Actor } from '@/server/core/actor';
import { validation } from '@/server/core/errors';
import type { DbOrTx } from '@/server/db/client';
import type { StateMachine } from '@/domain/state-machine';

/** Assert a state-machine transition and append it to status_history. Callers then write the row. */
export async function transition<S extends string>(
  tx: DbOrTx,
  actor: Actor,
  machine: StateMachine<S>,
  entityId: string,
  from: S,
  to: S,
  reason?: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  machine.assert(from, to);
  await recordTransition(tx, actor, machine.name, entityId, from, to, reason, meta);
}

export function parse<T extends z.ZodType>(schema: T, input: unknown, message = 'يرجى مراجعة البيانات المدخلة'): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fe = z.flattenError(r.error).fieldErrors as Record<string, string[]>;
    const first = Object.values(fe).flat()[0] ?? r.error.issues[0]?.message;
    throw validation(first && first !== 'Invalid input' ? first : message, fe);
  }
  return r.data;
}

export const reasonSchema = z.string().trim().min(3, 'يجب ذكر سبب واضح').max(1000);

export function requireReason(reason: string | null | undefined): string {
  return parse(reasonSchema, reason ?? '');
}

export const PAGE_SIZE = 20;
export function pageOf(page: unknown, size = PAGE_SIZE) {
  const p = Math.max(1, Math.min(10_000, Number.parseInt(String(page ?? '1'), 10) || 1));
  return { limit: size, offset: (p - 1) * size, page: p };
}
