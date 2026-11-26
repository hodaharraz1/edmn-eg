'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cancelMovementRequest, rejectMovementRequest, requestMovement } from '@/server/modules/finance/movements';
import type { MovementKind } from '@/server/db/schema';
import { runAction, str, type ActionState } from '@/server/web/action';
import { requireAdmin } from '@/server/web/session';

const KINDS: MovementKind[] = ['SELLER_RELEASE', 'DEAL_RELEASE', 'REFUND_APPROVAL', 'REFUND_REVOCATION', 'WITHDRAWAL_REVERSAL', 'WITHDRAWAL_RETURN', 'COD_REMITTANCE', 'COD_SHORTAGE_RESOLUTION', 'WALLET_TOPUP_CREDIT'];

async function run(fd: FormData, fn: (a: Awaited<ReturnType<typeof requireAdmin>>) => Promise<ActionState | void>) {
  const actor = await requireAdmin();
  const res = await runAction(() => fn(actor));
  const back = str(fd, 'back');
  for (const p of [back, '/admin/approvals', '/admin/releases', '/admin/refunds', '/admin/withdrawals', '/admin/wallet-topups'].filter(Boolean)) revalidatePath(p);
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

/** Checker step for COD: record the courier company's cash remittance (post the journal entry). */
export async function codRemittanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    const { recordCodRemittance } = await import('@/server/modules/payments/service');
    const { parseEgp } = await import('@/server/core/money');
    const r = await recordCodRemittance(a, str(fd, 'paymentId'), { reason: str(fd, 'reason'), actualAmount: parseEgp(str(fd, 'actualAmount')), statementRef: str(fd, 'statementRef') });
    return {
      message: r.alreadyConfirmed
        ? 'التحصيل مسجَّل من قبل.'
        : r.shortfall > 0
          ? `تم تسجيل التحصيل بعجز قدره ${(r.shortfall / 100).toFixed(2)} جنيه — العجز ظاهر للمراجعة في هذه الصفحة حتى يُسترد أو يُشطب.`
          : 'تم تسجيل تحصيل شركة الشحن بالكامل. مستحقات البائعين معلقة وتُتاح بعملية الإتاحة المعتادة بعد فترة الإرجاع.',
    };
  });
}

/** Checker step for COD-02: settle an OPEN courier shortfall (the resolution comes from the Maker's request). */
export async function codShortageResolveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    const { resolveCodShortfall } = await import('@/server/modules/payments/service');
    const r = await resolveCodShortfall(a, str(fd, 'shortfallId'), { reason: str(fd, 'reason') });
    return { message: r.alreadyResolved ? 'العجز مسوّى من قبل.' : r.resolution === 'RECOVERED' ? 'تم تسجيل استرداد العجز نقدًا من شركة الشحن.' : 'تم شطب العجز كمصروف تسوية بعد الاعتماد.' };
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

/** Checker step for PKG-WALLET-01: credit a verified deposit to the customer's wallet (the Maker's request is the proposal). */
export async function walletTopupCreditAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    const { creditTopup } = await import('@/server/modules/finance/wallet-topups');
    const r = await creditTopup(a, str(fd, 'topupId'), str(fd, 'note') || null);
    return { message: r.alreadyCredited ? 'الإيداع اتضاف قبل كده.' : 'تمت إضافة الإيداع لمحفظة العميل بعد موافقة شخصين.' };
  });
}

/** Reject a deposit (nothing posted; the customer sees the reason). */
export async function walletTopupRejectAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    const { rejectTopup } = await import('@/server/modules/finance/wallet-topups');
    const r = await rejectTopup(a, str(fd, 'topupId'), str(fd, 'reason'));
    return { message: r.alreadyRejected ? 'الإيداع مرفوض من قبل.' : 'تم رفض الإيداع. لم يتحرك أي مبلغ.' };
  });
}
