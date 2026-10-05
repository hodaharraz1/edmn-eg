'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { regenerateDeliveryOtp, reportDeliveryException, reportNotReceived, verifyDeliveryOtp, refreshInvitation, addDealPhotos, cancelDeal, claimInvitation, confirmDealReceipt, createDeal, inviteSeller, markDealDelivered, rejectInvitation, respondToChangeRequest, respondToOffer, revokeInvitation, saveDealStep, startDealPayment, submitSellerOffer } from '@/server/modules/deals/service';
import { returnPolicyFromValues } from '@/domain/return-policy';
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

/**
 * The raw invitation token exists only once (only its hash is stored). It is handed to the buyer's
 * share screen through a short-lived, httpOnly, path-scoped cookie — never in a URL / browser history.
 */
async function flashInvite(dealId: string, link: string) {
  (await cookies()).set(`edmn_inv_${dealId}`, link.split('/').pop()!, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: `/account/deals/${dealId}`, maxAge: 15 * 60 });
}

export async function inviteSellerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  let link = '';
  const res = await runAction(async () => {
    link = (await inviteSeller(actor, dealId, bool(fd, 'acceptTerms'))).link;
  });
  if (res.ok) {
    await flashInvite(dealId, link);
    redirect(`/account/deals/${dealId}`);
  }
  return res;
}

export async function refreshInviteAction(fd: FormData) {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  let link = '';
  const res = await runAction(async () => {
    link = (await refreshInvitation(actor, dealId)).link;
  });
  if (res.ok) {
    await flashInvite(dealId, link);
    redirect(`/account/deals/${dealId}`);
  }
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

function payoutFrom(fd: FormData) {
  const type = str(fd, 'payoutType');
  return type === 'BANK_ACCOUNT'
    ? { type: 'BANK_ACCOUNT' as const, holderName: str(fd, 'holderName'), bankName: str(fd, 'bankName'), accountNumber: str(fd, 'accountNumber'), iban: str(fd, 'iban') }
    : type === 'MOBILE_WALLET'
      ? { type: 'MOBILE_WALLET' as const, holderName: str(fd, 'holderName'), walletProvider: str(fd, 'walletProvider'), walletNumber: str(fd, 'walletNumber') }
      : { type: 'INSTAPAY' as const, holderName: str(fd, 'holderName'), instapayAddress: str(fd, 'instapayAddress') };
}
const fdValues = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>;
const policyFrom = (fd: FormData) => returnPolicyFromValues((k) => str(fd, k), (k) => fd.getAll(k).map(String));

/** "Accept and continue": binds the invitation to the signed-in account, then opens the deal page. */
export async function claimInviteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const token = str(fd, 'token');
  const actor = await requireCustomer(`/deal/invite/${token}`);
  let dealId = '';
  const res = await runAction(async () => {
    dealId = await claimInvitation(actor, token);
  });
  if (res.ok) redirect(`/account/deals/${dealId}`);
  return res;
}

/** Seller offer (first offer with own details, or a counter-offer). */
export async function sellerOfferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const values = fdValues(fd);
  const first = str(fd, 'first') === '1';
  const res = await runAction(async () => {
    await submitSellerOffer(
      actor,
      dealId,
      {
        ...(first ? { details: { fullName: str(fd, 'fullName'), contactEmail: str(fd, 'contactEmail') }, location: Object.fromEntries(Object.entries(values).filter(([k]) => k.startsWith('loc_')).map(([k, v]) => [k.slice(4), v])), payout: payoutFrom(fd) } : {}),
        offer: { unitPrice: str(fd, 'unitPrice'), shippingFee: str(fd, 'shippingFee'), deliveryMethod: str(fd, 'deliveryMethod'), processingDays: str(fd, 'processingDays') as unknown as number, deliveryMinDays: str(fd, 'deliveryMinDays') as unknown as number, deliveryMaxDays: str(fd, 'deliveryMaxDays') as unknown as number, defects: str(fd, 'defects'), accessories: str(fd, 'accessories'), warranty: str(fd, 'warranty') },
        returnPolicy: policyFrom(fd),
        message: str(fd, 'message'),
      },
      bool(fd, 'acceptTerms'),
    );
    return { message: 'تم إرسال عرضك للمشتري للمراجعة.' };
  });
  revalidatePath(`/account/deals/${dealId}`);
  return res;
}

/** Buyer: accept the seller's offer / request a return-policy change / reject. */
export async function buyerOfferResponseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const decision = str(fd, 'decision') as 'ACCEPT' | 'REQUEST_CHANGE' | 'REJECT';
  const res = await runAction(async () => {
    await respondToOffer(actor, dealId, int(fd, 'version') ?? 0, decision, decision === 'REQUEST_CHANGE' ? { returnPolicy: policyFrom(fd), message: str(fd, 'message') } : undefined);
    return { message: decision === 'ACCEPT' ? 'تم الاتفاق على الشروط. يمكنك الدفع الآن.' : decision === 'REJECT' ? 'تم رفض العرض وإلغاء الصفقة.' : 'تم إرسال طلب التعديل للبائع.' };
  });
  revalidatePath(`/account/deals/${dealId}`);
  return res;
}

/** Seller: accept or reject the buyer's change request (counter-offer goes through sellerOfferAction). */
export async function sellerChangeResponseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const decision = str(fd, 'decision') === 'ACCEPT' ? 'ACCEPT' : 'REJECT';
  const res = await runAction(async () => {
    await respondToChangeRequest(actor, dealId, int(fd, 'version') ?? 0, decision);
    return { message: decision === 'ACCEPT' ? 'تم قبول التعديل والاتفاق على الشروط.' : 'تم رفض التعديل، وعرضك السابق قائم.' };
  });
  revalidatePath(`/account/deals/${dealId}`);
  return res;
}

export async function revokeInviteAction(fd: FormData) {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  await runAction(async () => revokeInvitation(actor, dealId));
  revalidatePath(`/account/deals/${dealId}`);
}

export async function rejectInviteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const token = str(fd, 'token');
  const dealId = str(fd, 'dealId');
  const actor = await requireCustomer(token ? `/deal/invite/${token}` : '/account/deals');
  const res = await runAction(async () => {
    await rejectInvitation(actor, token ? { token } : { dealId }, str(fd, 'reason'));
    return { message: 'تم إبلاغ المشتري برفض الصفقة.' };
  });
  if (dealId) revalidatePath(`/account/deals/${dealId}`);
  return res;
}

/** Seller / courier enters the buyer's handover code at physical handover. Moves no money. */
export async function verifyDeliveryOtpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const res = await runAction(async () => {
    await verifyDeliveryOtp(actor, dealId, str(fd, 'code'));
    return { message: 'تم التحقق من تسليم المنتج للمشتري.' };
  });
  revalidatePath(`/account/deals/${dealId}`);
  return res;
}

/** New handover code (always delivered to the BUYER); the previous one stops working. */
export async function regenerateDeliveryOtpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const res = await runAction(async () => {
    await regenerateDeliveryOtp(actor, dealId);
    return { message: 'تم إصدار رمز استلام جديد وإرساله للمشتري. الرمز السابق لم يعد صالحًا.' };
  });
  revalidatePath(`/account/deals/${dealId}`);
  return res;
}

/** Buyer: "لم أستلم المنتج فعليًا" — a delivery conflict after a verified handover; funds stay held. */
export async function reportNotReceivedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const res = await runAction(async () => {
    const r = await reportNotReceived(actor, dealId, str(fd, 'description'));
    return { message: r.conflict ? 'تم تسجيل البلاغ وتحويل الصفقة لمراجعة فريق العمليات. المبلغ محجوز لحين القرار.' : 'تم فتح نزاع عدم الاستلام. المبلغ محجوز لحين القرار.' };
  });
  revalidatePath(`/account/deals/${dealId}`);
  return res;
}

/** Buyer or seller: the handover code cannot be used → Operations review (never an automatic release). */
export async function reportDeliveryExceptionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const res = await runAction(async () => {
    await reportDeliveryException(actor, dealId, str(fd, 'description'));
    return { message: 'تم تحويل التسليم لمراجعة فريق العمليات. لن يُصرف أي مبلغ قبل القرار.' };
  });
  revalidatePath(`/account/deals/${dealId}`);
  return res;
}
