'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { changePassword, confirmVerificationCode, sendVerificationCode } from '@/server/auth/service';
import { confirmReceipt } from '@/server/modules/commerce/fulfilment';
import { archiveAddress } from '@/server/modules/customers/addresses';
import { markRead } from '@/server/modules/notifications/notify';
import { addDisputeMessage, openDispute } from '@/server/modules/postpurchase/disputes';
import { customerShipsReturn, escalateReturn, requestReturn } from '@/server/modules/postpurchase/returns';
import { createProductReview, createSellerReview, reportReview } from '@/server/modules/reviews/service';
import { openTicket, replyToTicket } from '@/server/modules/support/service';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { fileOf, filesOf, int, runAction, str, type ActionState } from '@/server/web/action';
import { requestMeta, requireCustomer, setSessionCookie, WEB_COOKIE } from '@/server/web/session';
import { env } from '@/server/core/env';

export async function confirmReceiptAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/orders');
  const res = await runAction(async () => {
    const r = await confirmReceipt(actor, str(fd, 'sellerOrderId'));
    return { message: r.alreadyConfirmed ? 'تم تأكيد الاستلام مسبقاً.' : 'شكراً! تم تأكيد استلام الطلب. يمكنك الآن تقييم المنتج والبائع.' };
  });
  revalidatePath(`/account/orders/${str(fd, 'orderId')}`);
  return res;
}

export async function requestReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/returns');
  const items = fd
    .getAll('item')
    .map((v) => String(v))
    .map((id) => ({ orderItemId: id, quantity: int(fd, `qty_${id}`) ?? 1 }));
  let id = '';
  const res = await runAction(async () => {
    const r = await requestReturn(actor, { sellerOrderId: str(fd, 'sellerOrderId'), reason: str(fd, 'reason') as 'OTHER', description: str(fd, 'description'), items }, await filesOf(fd, 'evidence'));
    id = r.id;
  });
  if (res.ok) redirect(`/account/returns/${id}`);
  return res;
}

export async function shipReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/returns');
  const res = await runAction(async () => {
    await customerShipsReturn(actor, str(fd, 'returnId'), str(fd, 'carrier'), str(fd, 'tracking'));
    return { message: 'تم تسجيل بيانات شحن المرتجع' };
  });
  revalidatePath(`/account/returns/${str(fd, 'returnId')}`);
  return res;
}

export async function escalateReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/returns');
  let id = '';
  const res = await runAction(async () => {
    const d = await escalateReturn(actor, str(fd, 'returnId'), str(fd, 'description'));
    id = d.id;
  });
  if (res.ok) redirect(`/account/disputes/${id}`);
  return res;
}

export async function openDisputeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account');
  let id = '';
  const res = await runAction(async () => {
    const d = await openDispute(
      actor,
      { sellerOrderId: str(fd, 'sellerOrderId') || undefined, dealId: str(fd, 'dealId') || undefined, reasonCode: str(fd, 'reasonCode'), description: str(fd, 'description'), claimedAmount: str(fd, 'claimedAmount') },
      await filesOf(fd, 'evidence'),
    );
    id = d.id;
  });
  if (res.ok) redirect(`/account/disputes/${id}`);
  return res;
}

export async function disputeMessageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account');
  const res = await runAction(async () => addDisputeMessage(actor, str(fd, 'disputeId'), str(fd, 'body'), false, await fileOf(fd, 'attachment')));
  revalidatePath(`/account/disputes/${str(fd, 'disputeId')}`);
  return res;
}

export async function productReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/reviews');
  const res = await runAction(async () => {
    await createProductReview(actor, { orderItemId: str(fd, 'orderItemId'), rating: int(fd, 'rating') ?? 0, title: str(fd, 'title'), body: str(fd, 'body') }, await filesOf(fd, 'photos'));
    return { message: 'شكراً لتقييمك!' };
  });
  revalidatePath('/account/reviews');
  return res;
}

export async function sellerReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/reviews');
  const opt = (k: string) => int(fd, k) || undefined;
  const res = await runAction(async () => {
    await createSellerReview(actor, { sellerOrderId: str(fd, 'sellerOrderId'), rating: int(fd, 'rating') ?? 0, deliveryRating: opt('deliveryRating'), packagingRating: opt('packagingRating'), accuracyRating: opt('accuracyRating'), body: str(fd, 'body') });
    return { message: 'شكراً لتقييم البائع!' };
  });
  revalidatePath('/account/reviews');
  return res;
}

export async function reportReviewAction(fd: FormData) {
  const actor = await requireCustomer('/');
  await runAction(async () => reportReview(actor, str(fd, 'type') as 'PRODUCT', str(fd, 'reviewId'), str(fd, 'reason')));
}

export async function openTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/support');
  let id = '';
  const res = await runAction(async () => {
    const t = await openTicket(actor, { type: str(fd, 'type') as 'ORDER', subject: str(fd, 'subject'), body: str(fd, 'body'), relatedType: str(fd, 'relatedType'), relatedId: str(fd, 'relatedId') }, await fileOf(fd, 'attachment'));
    id = t.id;
  });
  if (res.ok) redirect(`/account/support/${id}`);
  return res;
}

export async function replyTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/support');
  const res = await runAction(async () => replyToTicket(actor, str(fd, 'ticketId'), str(fd, 'body'), { attachment: await fileOf(fd, 'attachment') }));
  revalidatePath(`/account/support/${str(fd, 'ticketId')}`);
  return res;
}

export async function archiveAddressAction(fd: FormData) {
  const actor = await requireCustomer('/account/addresses');
  await runAction(async () => archiveAddress(actor, str(fd, 'id')));
  revalidatePath('/account/addresses');
}

export async function markNotificationsReadAction() {
  const actor = await requireCustomer('/account/notifications');
  await markRead(db, actor.userId!);
  revalidatePath('/', 'layout');
}

export async function changePasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/security');
  if (str(fd, 'next') !== str(fd, 'confirm')) return { ok: false, error: 'كلمتا المرور غير متطابقتين', at: Date.now() };
  return runAction(async () => {
    const { token } = await changePassword(actor.userId!, str(fd, 'current'), str(fd, 'next'), { ...(await requestMeta()) });
    await setSessionCookie(WEB_COOKIE, token, env().SESSION_TTL_HOURS);
    return { message: 'تم تغيير كلمة المرور. تم تسجيل خروج الأجهزة الأخرى.' };
  });
}

export async function updateProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/profile');
  const name = str(fd, 'fullName');
  if (name.length < 3) return { ok: false, error: 'الاسم قصير جداً', at: Date.now() };
  return runAction(async () => {
    await db.update(users).set({ fullName: name.slice(0, 120) }).where(eq(users.id, actor.userId!));
    return { message: 'تم حفظ البيانات' };
  });
}

export async function sendCodeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/security');
  return runAction(async () => {
    await sendVerificationCode(actor.userId!, str(fd, 'channel') === 'EMAIL' ? 'EMAIL' : 'PHONE');
    return { message: 'تم إرسال رمز التحقق' };
  });
}

export async function confirmCodeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/security');
  const res = await runAction(async () => {
    const ok = await confirmVerificationCode(actor.userId!, str(fd, 'channel') === 'EMAIL' ? 'EMAIL' : 'PHONE', str(fd, 'code'));
    if (!ok) return { ok: false, error: 'الرمز غير صحيح أو منتهي الصلاحية' };
    return { message: 'تم التحقق بنجاح' };
  });
  revalidatePath('/account/security');
  return res;
}
