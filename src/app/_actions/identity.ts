'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { reviewIdentity, revealIdentityNumber, submitIdentity, type IdentityDecision } from '@/server/modules/identity/service';
import { archiveReceivingDestination, revealReceivingDestination, reviewReceivingDestination, submitReceivingDestination, type DestinationDecision } from '@/server/modules/identity/receiving';
import { revealRefundDestination, useReceivingDestinationForRefund } from '@/server/modules/finance/refunds';
import { escalateTicket, qaReviewTicket, rateTicket, reopenTicket, type ESCALATION_TARGETS } from '@/server/modules/support/service';
import { bool, fileOf, int, runAction, str, type ActionState } from '@/server/web/action';
import { requireAdmin, requireCustomer } from '@/server/web/session';

const DECISIONS = ['APPROVE', 'MORE_INFO_REQUIRED', 'REJECT', 'REVERIFICATION_REQUIRED'] as const;

/* ───────── Customer: التحقق من الهوية ───────── */
export async function submitIdentityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/identity');
  const res = await runAction(async () => {
    await submitIdentity(actor, { legalName: str(fd, 'legalName'), nationalId: str(fd, 'nationalId') }, { front: await fileOf(fd, 'front'), back: await fileOf(fd, 'back') });
    return { message: 'بياناتك اتبعتت للمراجعة. هنبلغك أول ما يتم القرار.' };
  });
  revalidatePath('/account/identity');
  return res;
}

/* ───────── Customer: بيانات استلام الأموال (NOT a wallet) ───────── */
export async function submitReceivingDestinationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/receiving');
  const res = await runAction(async () => {
    const type = str(fd, 'type');
    const input =
      type === 'BANK_ACCOUNT'
        ? { type: 'BANK_ACCOUNT' as const, holderName: str(fd, 'holderName'), bankName: str(fd, 'bankName'), accountNumber: str(fd, 'accountNumber'), iban: str(fd, 'iban') }
        : { type: 'MOBILE_WALLET' as const, holderName: str(fd, 'holderName'), walletProvider: str(fd, 'walletProvider'), walletNumber: str(fd, 'walletNumber') };
    await submitReceivingDestination(actor, input, { replacesId: str(fd, 'replacesId') || undefined });
    return { message: 'البيانات اتسجلت وهتتراجع قبل استخدامها. مفيش أي مبلغ بيتحول بمجرد الحفظ.' };
  });
  revalidatePath('/account/receiving');
  return res;
}

export async function archiveReceivingDestinationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/receiving');
  const res = await runAction(async () => {
    await archiveReceivingDestination(actor, str(fd, 'id'));
    return { message: 'اتأرشفت.' };
  });
  revalidatePath('/account/receiving');
  return res;
}

/** Customer chooses an APPROVED receiving destination for a refund that cannot go back to the original payment. */
export async function chooseRefundDestinationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/orders');
  const res = await runAction(async () => {
    await useReceivingDestinationForRefund(actor, str(fd, 'refundId'), str(fd, 'destinationId'), str(fd, 'reason'));
    return { message: 'اتسجل اختيارك. الاسترداد لسه محتاج اعتماد من فريق اضمن قبل أي تحويل.' };
  });
  const back = str(fd, 'back');
  if (back.startsWith('/account/')) revalidatePath(back);
  return res;
}

/* ───────── Customer: support reopen + rating ───────── */
export async function reopenTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/support');
  const res = await runAction(async () => {
    await reopenTicket(actor, str(fd, 'ticketId'), str(fd, 'reason'));
    return { message: 'التذكرة اتفتحت تاني وهيتم الرد عليك.' };
  });
  revalidatePath(`/account/support/${str(fd, 'ticketId')}`);
  return res;
}

export async function rateTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/support');
  const res = await runAction(async () => {
    await rateTicket(actor, str(fd, 'ticketId'), int(fd, 'rating') ?? 0, str(fd, 'comment'));
    return { message: 'شكرًا على تقييمك.' };
  });
  revalidatePath(`/account/support/${str(fd, 'ticketId')}`);
  return res;
}

/* ───────── Admin ───────── */
async function adminRun(fd: FormData, fn: (a: Awaited<ReturnType<typeof requireAdmin>>) => Promise<ActionState | void>, paths: string[]) {
  const actor = await requireAdmin();
  const res = await runAction(() => fn(actor));
  for (const p of paths.filter(Boolean)) revalidatePath(p);
  const back = str(fd, 'back');
  if (res.code === 'STEP_UP_REQUIRED') redirect(`/admin/step-up?next=${encodeURIComponent(back || '/admin')}`);
  return res;
}

export async function identityReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminRun(fd, async (a) => {
    const decision = str(fd, 'decision') as IdentityDecision;
    if (!DECISIONS.includes(decision)) throw new Error('decision');
    await reviewIdentity(a, str(fd, 'id'), decision, { reason: str(fd, 'reason'), internalNote: str(fd, 'internalNote'), expectedVersion: int(fd, 'expectedVersion') });
    return { message: 'تم تسجيل القرار وإبلاغ العميل.' };
  }, ['/admin/identity', `/admin/identity/${str(fd, 'id')}`]);
}

export async function revealIdentityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminRun(fd, async (a) => ({ message: 'تم الكشف (مسجل في سجل التدقيق)', data: { rows: [{ label: 'الرقم القومي', value: await revealIdentityNumber(a, str(fd, 'id')) }] } }), []);
}

export async function destinationReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminRun(fd, async (a) => {
    const decision = str(fd, 'decision') as DestinationDecision;
    if (!DECISIONS.includes(decision)) throw new Error('decision');
    await reviewReceivingDestination(a, str(fd, 'id'), decision, { reason: str(fd, 'reason'), holderMatchesIdentity: bool(fd, 'holderMatchesIdentity') });
    return { message: 'تم تسجيل القرار.' };
  }, ['/admin/receiving-destinations']);
}

const FIELD_LABELS: Record<string, string> = { type: 'النوع', holderName: 'اسم صاحب الحساب', bankName: 'البنك', accountNumber: 'رقم الحساب', iban: 'IBAN', walletProvider: 'مزود المحفظة', walletNumber: 'رقم المحفظة', method: 'الوسيلة', payerName: 'اسم المحوِّل', payerReference: 'مرجع الدفع', details: 'البيانات', masked: 'مختصر' };
const rowsOf = (o: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([k, v]) => FIELD_LABELS[k] && v !== '' && v != null)
    .map(([k, v]) => ({ label: FIELD_LABELS[k], value: String(v) }));

export async function revealDestinationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminRun(fd, async (a) => ({ message: 'تم الكشف (مسجل)', data: { rows: rowsOf(await revealReceivingDestination(a, str(fd, 'id'))) } }), []);
}

export async function revealRefundDestinationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminRun(fd, async (a) => ({ message: 'تم الكشف (مسجل)', data: { rows: rowsOf(await revealRefundDestination(a, str(fd, 'id'))) } }), []);
}

export async function escalateTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminRun(fd, async (a) => {
    await escalateTicket(a, str(fd, 'ticketId'), {
      team: str(fd, 'team'),
      specialistUserId: str(fd, 'specialistUserId') || null,
      linkedType: (str(fd, 'linkedType') || null) as (typeof ESCALATION_TARGETS)[number] | null,
      linkedId: str(fd, 'linkedId') || null,
      note: str(fd, 'note'),
    });
    return { message: 'تم التصعيد.' };
  }, [`/admin/support/${str(fd, 'ticketId')}`, '/admin/support']);
}

export async function adminReopenTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminRun(fd, async (a) => {
    await reopenTicket(a, str(fd, 'ticketId'), str(fd, 'reason'));
    return { message: 'تمت إعادة فتح التذكرة ببدء دورة SLA جديدة.' };
  }, [`/admin/support/${str(fd, 'ticketId')}`, '/admin/support']);
}

export async function qaTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminRun(fd, async (a) => {
    await qaReviewTicket(a, str(fd, 'ticketId'), int(fd, 'score') ?? 0, str(fd, 'note'));
    return { message: 'تم حفظ تقييم الجودة.' };
  }, [`/admin/support/${str(fd, 'ticketId')}`]);
}
