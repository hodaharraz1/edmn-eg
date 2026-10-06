'use server';

import { revalidatePath } from 'next/cache';
import { hideMessage, reportMessage, resolveReport, sendMessage, setConversationLock } from '@/server/modules/messaging/service';
import { runAction, str, type ActionState } from '@/server/web/action';
import { requireAdmin, requireCustomer, requireSellerActor } from '@/server/web/session';

/**
 * Buyer ↔ seller messaging actions. The surface only chooses which identity the caller acts with
 * (store member in the Seller Center, or the customer account); the service re-derives authorization
 * from the order/deal on every call.
 */
async function actorFor(surface: string) {
  return surface === 'seller' ? requireSellerActor('/seller/messages') : requireCustomer('/account/messages');
}

const MAX_FILES = 3;

export async function sendMessageAction(_p: ActionState | null, fd: FormData): Promise<ActionState> {
  const surface = str(fd, 'surface');
  const actor = await actorFor(surface);
  const conversationId = str(fd, 'conversationId');
  const res = await runAction(async () => {
    const files: { data: Buffer; name: string }[] = [];
    const entries = fd.getAll('attachments');
    let count = 0;
    for (const v of entries) {
      if (typeof v === 'string' || v.size === 0) continue;
      if (++count > MAX_FILES) break;
      files.push({ data: Buffer.from(await v.arrayBuffer()), name: v.name });
    }
    if (entries.filter((v) => typeof v !== 'string' && v.size > 0).length > MAX_FILES) {
      return { ok: false, error: `تقدر ترفق ${MAX_FILES} ملفات بالكتير في الرسالة` };
    }
    await sendMessage(actor, conversationId, { body: String(fd.get('body') ?? ''), clientKey: str(fd, 'clientKey') }, files);
    return { message: 'تم الإرسال' };
  });
  if (res.ok) revalidatePath(surface === 'seller' ? `/seller/messages/${conversationId}` : `/account/messages/${conversationId}`);
  return res;
}

export async function reportMessageAction(_p: ActionState | null, fd: FormData): Promise<ActionState> {
  const actor = await actorFor(str(fd, 'surface'));
  return runAction(async () => {
    await reportMessage(actor, str(fd, 'messageId'), { reason: str(fd, 'reason'), note: str(fd, 'note') });
    return { message: 'البلاغ وصلنا، وفريق اضمن هيراجعه' };
  });
}

/* ── Staff moderation (audited in the service) ── */

export async function hideMessageAction(_p: ActionState | null, fd: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  const res = await runAction(async () => {
    await hideMessage(actor, str(fd, 'messageId'), str(fd, 'reason'));
    return { message: 'تم إخفاء الرسالة عن الطرفين (الأصل محفوظ)' };
  });
  revalidatePath(`/admin/messages/${str(fd, 'conversationId')}`);
  return res;
}

export async function resolveReportAction(_p: ActionState | null, fd: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  const decision = str(fd, 'decision') === 'ACTIONED' ? 'ACTIONED' : 'DISMISSED';
  const res = await runAction(async () => {
    await resolveReport(actor, str(fd, 'reportId'), decision, str(fd, 'note'));
    return { message: 'تم تسجيل القرار' };
  });
  revalidatePath('/admin/messages');
  return res;
}

export async function lockConversationAction(_p: ActionState | null, fd: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  const res = await runAction(async () => {
    await setConversationLock(actor, str(fd, 'conversationId'), str(fd, 'locked') === 'true', str(fd, 'reason'));
    return { message: 'تم التحديث' };
  });
  revalidatePath(`/admin/messages/${str(fd, 'conversationId')}`);
  return res;
}
