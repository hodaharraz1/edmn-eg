'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cancelWithdrawal, previewAccountWithdrawal, requestAccountWithdrawal, type AccountDestination } from '@/server/modules/finance/withdrawals';
import { formatEGP } from '@/lib/format';
import { runAction, str, type ActionState } from '@/server/web/action';
import { requireCustomer } from '@/server/web/session';

function destinationOf(fd: FormData): AccountDestination {
  const v = str(fd, 'destination');
  return v === 'store' ? { kind: 'STORE_PAYOUT_METHOD' } : { kind: 'RECEIVING_DESTINATION', id: v.replace(/^rd:/, '') };
}

/** Preview of how the amount would be split across sources (nothing is requested, nothing moves). */
export async function previewAccountWithdrawalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/earnings');
  return runAction(async () => {
    const r = await previewAccountWithdrawal(actor, str(fd, 'amount'), destinationOf(fd));
    if (!r.plan) return { message: `المتاح للسحب لهذه الوجهة ${formatEGP(r.available)} فقط`, data: { plan: [] } };
    return { message: 'التوزيع المتوقع (يتأكد عند اعتماد الإدارة):', data: { plan: r.plan.map((x) => ({ source: x.sourceType === 'MARKETPLACE' ? 'رصيد مبيعات المتجر' : 'رصيد الصفقات المحمية', amount: formatEGP(x.amount) })) } };
  });
}

export async function requestAccountWithdrawalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/earnings');
  const res = await runAction(async () => {
    const r = await requestAccountWithdrawal(actor, { amount: str(fd, 'amount'), clientKey: str(fd, 'clientKey') || randomUUID(), destination: destinationOf(fd) });
    return { message: r.created ? `طلب السحب #${r.withdrawal.number} اتسجل. مفيش أي مبلغ اتحرك لحد ما الإدارة تعتمده.` : 'الطلب ده متسجل قبل كده.' };
  });
  revalidatePath('/account/earnings');
  return res;
}

export async function cancelAccountWithdrawalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/earnings');
  const res = await runAction(async () => {
    await cancelWithdrawal(actor, str(fd, 'id'));
    return { message: 'اتلغى الطلب.' };
  });
  revalidatePath('/account/earnings');
  return res;
}
