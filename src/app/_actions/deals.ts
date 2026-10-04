'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { refreshInvitation, acceptInvitation, addDealPhotos, cancelDeal, confirmDealReceipt, createDeal, inviteSeller, markDealDelivered, rejectInvitation, saveDealStep, startDealPayment } from '@/server/modules/deals/service';
import { submitProof } from '@/server/modules/payments/service';
import { bool, fileOf, filesOf, int, runAction, str, type ActionState } from '@/server/web/action';
import { requireCustomer } from '@/server/web/session';

export async function dealStepAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals/new');
  const step = int(fd, 'step') ?? 1;
  let dealId = str(fd, 'dealId');
  const values = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const res = await runAction(async () => {
    if (!dealId) {
      const d = await createDeal(actor, values as never);
      dealId = d.id;
    } else if (step <= 5) {
      await saveDealStep(actor, dealId, step, values);
    }
    const photos = await filesOf(fd, 'photos');
    if (photos.length) await addDealPhotos(actor, dealId, photos);
  });
  if (res.ok) redirect(`/account/deals/new?deal=${dealId}&step=${Math.min(step + 1, 6)}`);
  return res;
}

export async function inviteSellerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  let link = '';
  const res = await runAction(async () => {
    link = (await inviteSeller(actor, dealId, bool(fd, 'acceptTerms'))).link;
  });
  // The raw token is shown once to the buyer so they can share it (only its hash is stored).
  if (res.ok) redirect(`/account/deals/${dealId}?invite=${encodeURIComponent(link.split('/').pop()!)}`);
  return res;
}

export async function refreshInviteAction(fd: FormData) {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  let link = '';
  const res = await runAction(async () => {
    link = (await refreshInvitation(actor, dealId)).link;
  });
  if (res.ok) redirect(`/account/deals/${dealId}?invite=${encodeURIComponent(link.split('/').pop()!)}`);
}

export async function startDealPaymentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const res = await runAction(async () => {
    await startDealPayment(actor, str(fd, 'dealId'), str(fd, 'method') as 'INSTAPAY');
  });
  revalidatePath(`/account/deals/${str(fd, 'dealId')}`);
  return res;
}

export async function dealProofAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const res = await runAction(async () => {
    await submitProof(actor, str(fd, 'paymentId'), { claimedAmount: str(fd, 'claimedAmount'), reference: str(fd, 'reference'), clientKey: str(fd, 'clientKey') }, await fileOf(fd, 'proof'));
    return { message: 'تم استلام إثبات الدفع وجارٍ التحقق منه.' };
  });
  revalidatePath(`/account/deals/${str(fd, 'dealId')}`);
  return res;
}

export async function dealDeliveredAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const res = await runAction(async () => {
    await markDealDelivered(actor, str(fd, 'dealId'), str(fd, 'note'), await filesOf(fd, 'proof'));
    return { message: 'تم تسجيل التسليم. بانتظار تأكيد المشتري.' };
  });
  revalidatePath(`/account/deals/${str(fd, 'dealId')}`);
  return res;
}

export async function dealConfirmAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const res = await runAction(async () => {
    await confirmDealReceipt(actor, str(fd, 'dealId'));
    return { message: 'تم تأكيد الاستلام واكتمال الصفقة.' };
  });
  revalidatePath(`/account/deals/${str(fd, 'dealId')}`);
  return res;
}

export async function cancelDealAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const res = await runAction(async () => cancelDeal(actor, str(fd, 'dealId'), str(fd, 'reason')));
  revalidatePath(`/account/deals/${str(fd, 'dealId')}`);
  return res;
}

export async function acceptInviteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const token = str(fd, 'token');
  const actor = await requireCustomer(`/deal-invite/${token}`);
  let dealId = '';
  const type = str(fd, 'payoutType');
  const payout =
    type === 'BANK_ACCOUNT'
      ? { type: 'BANK_ACCOUNT' as const, holderName: str(fd, 'holderName'), bankName: str(fd, 'bankName'), accountNumber: str(fd, 'accountNumber'), iban: str(fd, 'iban') }
      : type === 'MOBILE_WALLET'
        ? { type: 'MOBILE_WALLET' as const, holderName: str(fd, 'holderName'), walletProvider: str(fd, 'walletProvider'), walletNumber: str(fd, 'walletNumber') }
        : { type: 'INSTAPAY' as const, holderName: str(fd, 'holderName'), instapayAddress: str(fd, 'instapayAddress') };
  const res = await runAction(async () => {
    dealId = await acceptInvitation(actor, token, payout, bool(fd, 'acceptTerms'));
  });
  if (res.ok) redirect(`/account/deals/${dealId}`);
  return res;
}

export async function rejectInviteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const token = str(fd, 'token');
  const actor = await requireCustomer(`/deal-invite/${token}`);
  return runAction(async () => {
    await rejectInvitation(actor, token, str(fd, 'reason'));
    return { message: 'تم إبلاغ المشتري برفض الصفقة.' };
  });
}
