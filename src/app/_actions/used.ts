'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addReportEvidence, declareReport, ensureDealReport, ensureProductReport, recordInspection, removeReportEvidence, saveReportAnswers, verifyPassport } from '@/server/modules/used/reports';
import { proposeConditionAmendment, respondConditionAmendment } from '@/server/modules/used/snapshots';
import { savePolicy } from '@/server/modules/used/policies';
import { updateSetting } from '@/server/modules/settings';
import { openDispute } from '@/server/modules/postpurchase/disputes';
import { validation } from '@/server/core/errors';
import { safeNext } from '@/server/web/safe-next';
import { bool, fileOf, filesOf, runAction, str, type ActionState } from '@/server/web/action';
import { requireAdmin, requireCustomer, requireSellerActor } from '@/server/web/session';
import { SAFETY_FACTORS, USED_DISPUTE_REASON_CODES } from '@/domain/used';

/** Product reports are edited by the store (seller actor); deal reports by the bound deal seller (customer actor). */
async function editor(fd: FormData) {
  const back = safeNext(str(fd, 'back'), '/');
  return { actor: str(fd, 'mode') === 'product' ? await requireSellerActor(back) : await requireCustomer(back), back };
}

const textValues = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === 'string' && k.startsWith('f_')).map(([k, v]) => [k.slice(2), v as string]));

export async function usedStartAction(fd: FormData) {
  const kind = str(fd, 'mode');
  if (kind === 'product') {
    const actor = await requireSellerActor('/seller/products');
    const productId = str(fd, 'productId');
    const res = await runAction(async () => void (await ensureProductReport(actor, productId)));
    if (res.ok) redirect(`/seller/products/${productId}/condition`);
    redirect(`/seller/products/${productId}?error=${encodeURIComponent(res.error ?? '')}`);
  }
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const res = await runAction(async () => void (await ensureDealReport(actor, dealId)));
  redirect(res.ok ? `/account/deals/${dealId}/condition` : `/account/deals/${dealId}`);
}

export async function usedSaveAnswersAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, back } = await editor(fd);
  const res = await runAction(async () => {
    const check = await saveReportAnswers(actor, str(fd, 'reportId'), textValues(fd));
    return { message: check.complete ? 'تم الحفظ — التوثيق كامل، أكّد الإقرار تحت.' : `تم الحفظ. لسه ناقص: ${check.problems.length}` };
  });
  revalidatePath(back);
  return res;
}

export async function usedAddEvidenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, back } = await editor(fd);
  const res = await runAction(async () => {
    await addReportEvidence(actor, str(fd, 'reportId'), str(fd, 'slot'), await filesOf(fd, 'files'));
    return { message: 'اترفعت الصور' };
  });
  revalidatePath(back);
  return res;
}

export async function usedRemoveEvidenceAction(fd: FormData) {
  const { actor, back } = await editor(fd);
  await runAction(() => removeReportEvidence(actor, str(fd, 'reportId'), str(fd, 'evidenceId')));
  revalidatePath(back);
}

export async function usedDeclareAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, back } = await editor(fd);
  const res = await runAction(async () => {
    const { passportCode } = await declareReport(actor, str(fd, 'reportId'), bool(fd, 'declare'));
    return { message: `تم الإقرار. جواز المنتج: ${passportCode}` };
  });
  revalidatePath(back);
  return res;
}

/* ───────── Protected deals: amendments, structured disputes ───────── */

export async function usedAmendAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const res = await runAction(async () => {
    await proposeConditionAmendment(actor, dealId, { changes: textValues(fd), note: str(fd, 'note'), reason: str(fd, 'reason') });
    return { message: 'اتبعت التعديل للمشتري — الحالة المتفق عليها فاضلة سارية لحد ما يوافق' };
  });
  revalidatePath(`/account/deals/${dealId}`);
  return res;
}

export async function usedAmendRespondAction(fd: FormData) {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  await runAction(() => respondConditionAmendment(actor, dealId, str(fd, 'snapshotId'), str(fd, 'decision') === 'accept'));
  revalidatePath(`/account/deals/${dealId}`);
}

/** «توجد مشكلة» during the inspection period: a structured used-product reason + evidence → the existing dispute flow. */
export async function usedDisputeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/deals');
  const dealId = str(fd, 'dealId');
  const sellerOrderId = str(fd, 'sellerOrderId');
  let disputeId = '';
  const res = await runAction(async () => {
    const reason = str(fd, 'reasonCode');
    if (!(USED_DISPUTE_REASON_CODES as string[]).includes(reason)) throw validation('اختار سبب المشكلة');
    const d = await openDispute(actor, { dealId: dealId || undefined, sellerOrderId: sellerOrderId || undefined, reasonCode: reason, description: str(fd, 'description') }, await filesOf(fd, 'evidence'));
    disputeId = d.id;
  });
  if (res.ok) redirect(`/account/disputes/${disputeId}`);
  return res;
}

/* ───────── Admin ───────── */

async function adminDo(fd: FormData, fn: (a: Awaited<ReturnType<typeof requireAdmin>>) => Promise<ActionState | void>, paths: string[]) {
  const actor = await requireAdmin();
  const res = await runAction(() => fn(actor));
  for (const p of paths) revalidatePath(p);
  if (res.code === 'STEP_UP_REQUIRED') redirect(`/admin/step-up?next=${encodeURIComponent(safeNext(str(fd, 'back'), '/admin/used'))}`);
  return res;
}

export async function usedVerifyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminDo(fd, async (a) => {
    await verifyPassport(a, str(fd, 'passportId'), str(fd, 'decision') === 'VERIFIED' ? 'VERIFIED' : 'REJECTED', str(fd, 'note'));
    return { message: 'اتسجلت المراجعة' };
  }, ['/admin/used/passports']);
}

export async function usedInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminDo(fd, async (a) => {
    const result = str(fd, 'result');
    if (!['PASS', 'PASS_WITH_NOTES', 'FAIL'].includes(result)) throw validation('اختار نتيجة الفحص');
    await recordInspection(a, str(fd, 'passportId'), { provider: str(fd, 'provider'), inspectorName: str(fd, 'inspectorName'), result: result as 'PASS', summary: str(fd, 'summary'), performedAt: new Date(str(fd, 'performedAt')) }, await fileOf(fd, 'report'));
    return { message: 'اتسجل تقرير الفحص' };
  }, ['/admin/used/passports']);
}

export async function usedPolicyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminDo(fd, async (a) => {
    let config: unknown;
    try {
      config = JSON.parse(str(fd, 'config'));
    } catch {
      throw validation('صيغة JSON غير صحيحة');
    }
    await savePolicy(a, { categoryId: str(fd, 'categoryId'), config, enabled: bool(fd, 'enabled'), reason: str(fd, 'reason') });
    return { message: 'اتحفظت سياسة الفئة (نسخة جديدة)' };
  }, ['/admin/used/policies']);
}

export async function usedScoreRulesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return adminDo(fd, async (a) => {
    const n = (k: string) => Number(str(fd, k));
    const value = {
      weights: Object.fromEntries(SAFETY_FACTORS.map((f) => [f, n(`w_${f}`)])),
      thresholds: { high: n('high'), medium: n('medium') },
      fullAccountAgeDays: n('fullAccountAgeDays'),
      fullCompletedDeals: n('fullCompletedDeals'),
    };
    await updateSetting(a, 'used.safetyScore', value, str(fd, 'reason'));
    return { message: 'اتحفظت قواعد المؤشر' };
  }, ['/admin/used/score']);
}
