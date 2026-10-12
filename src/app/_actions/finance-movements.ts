'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cancelMovementRequest, rejectMovementRequest, requestMovement } from '@/server/modules/finance/movements';
import type { MovementKind } from '@/server/db/schema';
import { runAction, str, type ActionState } from '@/server/web/action';
import { requireAdmin } from '@/server/web/session';

const KINDS: MovementKind[] = ['SELLER_RELEASE', 'DEAL_RELEASE', 'REFUND_APPROVAL', 'REFUND_REVOCATION', 'WITHDRAWAL_REVERSAL', 'WITHDRAWAL_RETURN'];

async function run(fd: FormData, fn: (a: Awaited<ReturnType<typeof requireAdmin>>) => Promise<ActionState | void>) {
  const actor = await requireAdmin();
  const res = await runAction(() => fn(actor));
  const back = str(fd, 'back');
  for (const p of [back, '/admin/approvals', '/admin/releases', '/admin/refunds', '/admin/withdrawals'].filter(Boolean)) revalidatePath(p);
  if (res.code === 'STEP_UP_REQUIRED') redirect(`/admin/step-up?next=${encodeURIComponent(back || '/admin')}`);
  return res;
}

/** Maker step: proposes ONE financial movement for an exact amount. Nothing moves until a different Checker executes. */
export async function movementRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    const kind = str(fd, 'kind') as MovementKind;
    if (!KINDS.includes(kind)) throw new Error('kind');
    const mode = str(fd, 'mode');
    await requestMovement(a, kind, { entityId: str(fd, 'entityId'), amount: Number(str(fd, 'amount')), reason: str(fd, 'reason'), params: mode ? { mode } : undefined });
    return { message: 'تم تسجيل طلب الحركة. التنفيذ يحتاج معتمدًا آخر — لم يتحرك أي مبلغ بعد.' };
  });
}

export async function movementRejectAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    await rejectMovementRequest(a, str(fd, 'requestId'), str(fd, 'reason'));
    return { message: 'تم رفض الطلب. لم يتحرك أي مبلغ.' };
  });
}

export async function movementCancelAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    await cancelMovementRequest(a, str(fd, 'requestId'));
    return { message: 'تم سحب طلبك.' };
  });
}
