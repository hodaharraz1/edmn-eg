'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { validation } from '@/server/core/errors';
import { parseEgp, parsePercentToBps } from '@/server/core/money';
import { ECONOMIC_CLASSES, PAYOUT_CHANNELS, REFUND_LIFECYCLE_STAGES, REFUND_REASON_CODES, RESPONSIBLE_PARTIES, SHIPPING_REFUND_RULES, TRANSFER_COST_PAYERS, type EconomicClass, type PricingModel } from '@/server/db/schema';
import { approveVersion, cancelVersion, createDraft, publishVersion, reopenDraft, submitVersion, updateDraft } from '@/server/modules/pricing/service';
import { markChannelReviewed, saveChannelVersion } from '@/server/modules/pricing/payout-costs';
import { createPolicyDraft, publishPolicy, saveDraftRules, type RuleInput } from '@/server/modules/pricing/refund-policy';
import { recordCost } from '@/server/modules/pricing/profitability';
import { bool, runAction, str, type ActionState } from '@/server/web/action';
import { requireAdmin } from '@/server/web/session';

async function run(fd: FormData, fn: (actor: Awaited<ReturnType<typeof requireAdmin>>) => Promise<ActionState | void>, paths: string[]) {
  const actor = await requireAdmin();
  const res = await runAction(() => fn(actor));
  for (const p of paths) revalidatePath(p);
  const back = str(fd, 'back');
  if (res.code === 'STEP_UP_REQUIRED') redirect(`/admin/step-up?next=${encodeURIComponent(back || '/admin/finance/pricing')}`);
  return res;
}
const done = (message = 'تم التنفيذ') => ({ message });
const egp = (v: string, label: string) => {
  try {
    return parseEgp(v);
  } catch {
    throw validation(`${label}: مبلغ غير صحيح`);
  }
};
const optEgp = (v: string, label: string) => (v.trim() === '' ? null : egp(v, label));
const pct = (v: string, label: string) => {
  try {
    return parsePercentToBps(v.trim() === '' ? '0' : v);
  } catch {
    throw validation(`${label}: نسبة غير صحيحة (مثال 3.5)`);
  }
};
const PRICING_PATHS = ['/admin/finance/pricing', '/admin/finance/pricing/marketplace', '/admin/finance/pricing/protected-deals', '/admin/finance/pricing/simulator'];
const modelPath = (m: string) => (m === 'PROTECTED_DEAL' ? '/admin/finance/pricing/protected-deals' : '/admin/finance/pricing/marketplace');

/** Parse the tier grid: t__<class>__<i>__{lower,upper,buyer,seller,total}. Empty rows are ignored. */
function parseTiers(fd: FormData) {
  const rows = new Map<string, Record<string, string>>();
  for (const [k, v] of fd.entries()) {
    const m = /^t__([A-Z_]+)__(\d+)__(lower|upper|buyer|seller|total)$/.exec(k);
    if (!m) continue;
    const key = `${m[1]}__${m[2]}`;
    rows.set(key, { ...(rows.get(key) ?? {}), cls: m[1], [m[3]]: String(v) });
  }
  const out: { economicClass: string; lowerBound: number; upperBound: number | null; buyerBps: number; sellerBps: number; totalBps: number }[] = [];
  for (const r of rows.values()) {
    if (!r.lower?.trim() && !r.buyer?.trim() && !r.seller?.trim()) continue;
    const label = `${r.cls}`;
    out.push({
      economicClass: r.cls,
      lowerBound: egp(r.lower ?? '0', `${label} الحد الأدنى`),
      upperBound: optEgp(r.upper ?? '', `${label} الحد الأعلى`),
      buyerBps: pct(r.buyer ?? '', `${label} نسبة المشتري`),
      sellerBps: pct(r.seller ?? '', `${label} نسبة البائع`),
      totalBps: pct(r.total ?? '', `${label} الإجمالي`),
    });
  }
  return out;
}

export async function pricingVersionAction(_p: ActionState, fd: FormData) {
  const op = str(fd, 'op');
  const id = str(fd, 'versionId');
  const model = (str(fd, 'model') || 'MARKETPLACE') as PricingModel;
  let target = '';
  const res = await run(
    fd,
    async (a) => {
      if (op === 'create') {
        const v = await createDraft(a, model, str(fd, 'from') || null, str(fd, 'name'));
        target = `${modelPath(model)}?v=${v.id}`;
        return done('تم إنشاء مسودة جديدة');
      }
      if (op === 'save') {
        const categoryClasses: { categoryId: string; economicClass: EconomicClass }[] = [];
        for (const [k, v] of fd.entries()) {
          const m = /^cat__([0-9a-f-]{36})$/.exec(k);
          if (m && (ECONOMIC_CLASSES as readonly string[]).includes(String(v))) categoryClasses.push({ categoryId: m[1], economicClass: v as EconomicClass });
        }
        await updateDraft(
          a,
          id,
          {
            name: str(fd, 'name'),
            minFee: egp(str(fd, 'minFee'), 'الحد الأدنى للرسوم'),
            targetMarginBps: pct(str(fd, 'targetMargin'), 'الهامش المستهدف'),
            notes: str(fd, 'notes') || null,
            assumptions: {
              collectionCostBps: pct(str(fd, 'a_collectionCostBps'), 'تكلفة التحصيل'),
              collectionCostFixed: egp(str(fd, 'a_collectionCostFixed') || '0', 'تكلفة التحصيل الثابتة'),
              refundReserveBps: pct(str(fd, 'a_refundReserveBps'), 'احتياطي الاسترداد'),
              disputeReserveBps: pct(str(fd, 'a_disputeReserveBps'), 'احتياطي النزاعات'),
              operationalReserveBps: pct(str(fd, 'a_operationalReserveBps'), 'الاحتياطي التشغيلي'),
              fraudReserveBps: pct(str(fd, 'a_fraudReserveBps'), 'احتياطي الاحتيال'),
              taxProvisionBps: pct(str(fd, 'a_taxProvisionBps'), 'مخصص الضرائب'),
              edmnPayoutCostFixed: egp(str(fd, 'a_edmnPayoutCostFixed') || '0', 'تكلفة التحويل على اضمن'),
            },
            tiers: parseTiers(fd),
            ...(model === 'MARKETPLACE' ? { categoryClasses } : {}),
          },
          str(fd, 'reason') || 'تعديل مسودة',
        );
        return done('تم حفظ المسودة');
      }
      if (op === 'submit') {
        const r = await submitVersion(a, id, str(fd, 'reason'));
        return done(r.belowTarget ? `تم الإرسال — تحذير: الهامش المتوقع ${(r.expectedMarginBps / 100).toFixed(2)}% أقل من المستهدف` : `تم الإرسال للاعتماد — الهامش المتوقع ${(r.expectedMarginBps / 100).toFixed(2)}%`);
      }
      if (op === 'reopen') {
        await reopenDraft(a, id, str(fd, 'reason'));
        return done('أعيد الإصدار إلى مسودة');
      }
      if (op === 'approve') {
        await approveVersion(a, id, { reason: str(fd, 'reason'), overrideMarginGuard: bool(fd, 'override'), overrideReason: str(fd, 'overrideReason') });
        return done('تم الاعتماد');
      }
      if (op === 'publish') {
        const when = str(fd, 'effectiveFrom');
        const eff = when ? new Date(when) : null;
        if (eff && Number.isNaN(eff.getTime())) throw validation('تاريخ السريان غير صحيح');
        const r = await publishVersion(a, id, { effectiveFrom: eff, reason: str(fd, 'reason') });
        return done(r.scheduled ? `تمت الجدولة للسريان في ${r.effectiveFrom.toISOString()}` : 'تم النشر وأصبح الإصدار ساريًا للمعاملات الجديدة');
      }
      if (op === 'cancel') {
        await cancelVersion(a, id, str(fd, 'reason'));
        return done('تم إلغاء الإصدار');
      }
      throw validation('عملية غير معروفة');
    },
    PRICING_PATHS,
  );
  if (res.ok && target) redirect(target);
  return res;
}

export async function payoutChannelAction(_p: ActionState, fd: FormData) {
  return run(
    fd,
    async (a) => {
      if (str(fd, 'op') === 'review') {
        await markChannelReviewed(a, str(fd, 'id'), str(fd, 'reason'));
        return done('تم تسجيل المراجعة');
      }
      const channel = str(fd, 'channel');
      if (!(PAYOUT_CHANNELS as readonly string[]).includes(channel)) throw validation('قناة غير معروفة');
      const payer = str(fd, 'payerPolicy');
      if (!(TRANSFER_COST_PAYERS as readonly string[]).includes(payer)) throw validation('سياسة تحمل التكلفة غير صالحة');
      const when = str(fd, 'effectiveFrom');
      await saveChannelVersion(
        a,
        {
          channel: channel as never,
          name: str(fd, 'name') || channel,
          isActive: bool(fd, 'isActive'),
          costBps: pct(str(fd, 'costPct'), 'نسبة التكلفة'),
          costFixed: egp(str(fd, 'costFixed') || '0', 'التكلفة الثابتة'),
          costMin: egp(str(fd, 'costMin') || '0', 'أدنى تكلفة'),
          costMax: optEgp(str(fd, 'costMax'), 'أقصى تكلفة'),
          payerPolicy: payer as never,
          maxPerTransaction: optEgp(str(fd, 'maxPerTransaction'), 'حد العملية'),
          maxPerDay: optEgp(str(fd, 'maxPerDay'), 'الحد اليومي'),
          maxPerMonth: optEgp(str(fd, 'maxPerMonth'), 'الحد الشهري'),
          recipientMaxPerDay: optEgp(str(fd, 'recipientMaxPerDay'), 'حد المستفيد اليومي'),
          recipientMaxPerMonth: optEgp(str(fd, 'recipientMaxPerMonth'), 'حد المستفيد الشهري'),
          warningThresholdBps: pct(str(fd, 'warningPct') || '80', 'حد التحذير'),
          effectiveFrom: when ? new Date(when) : null,
          notes: str(fd, 'notes') || null,
          sourceReference: str(fd, 'sourceReference') || null,
        },
        str(fd, 'reason'),
      );
      return done('تم حفظ إصدار جديد لإعدادات القناة');
    },
    ['/admin/finance/pricing/payout-costs', '/admin/finance/pricing'],
  );
}

export async function refundPolicyAction(_p: ActionState, fd: FormData) {
  return run(
    fd,
    async (a) => {
      const op = str(fd, 'op');
      if (op === 'createDraft') {
        await createPolicyDraft(a, str(fd, 'from') || null);
        return done('تم إنشاء مسودة سياسة');
      }
      if (op === 'publish') {
        await publishPolicy(a, str(fd, 'versionId'), { legalReviewConfirmed: bool(fd, 'legalReviewed'), legalPolicyVersion: str(fd, 'legalPolicyVersion'), reason: str(fd, 'reason') });
        return done('تم نشر السياسة');
      }
      if (op === 'saveRules') {
        const rules: RuleInput[] = [];
        for (let i = 0; i < 60; i++) {
          const stage = str(fd, `r${i}_stage`);
          if (!stage) continue;
          const pick = <T extends string>(v: string, list: readonly T[], label: string) => {
            if (!(list as readonly string[]).includes(v)) throw validation(`${label} غير صالح`);
            return v as T;
          };
          rules.push({
            lifecycleStage: pick(stage, REFUND_LIFECYCLE_STAGES, 'المرحلة'),
            reasonCode: pick(str(fd, `r${i}_reason`), REFUND_REASON_CODES, 'السبب'),
            responsibleParty: pick(str(fd, `r${i}_party`), RESPONSIBLE_PARTIES, 'المسؤول'),
            buyerFeeRefundBps: pct(str(fd, `r${i}_buyer`), 'نسبة رد رسوم المشتري'),
            sellerFeeReversalBps: pct(str(fd, `r${i}_seller`), 'نسبة عكس رسوم البائع'),
            shippingRefund: pick(str(fd, `r${i}_shipping`), SHIPPING_REFUND_RULES, 'رد الشحن'),
            returnShippingPayer: pick(str(fd, `r${i}_returnPayer`), RESPONSIBLE_PARTIES, 'متحمل شحن الإرجاع'),
            transferCostPayer: pick(str(fd, `r${i}_transferPayer`), RESPONSIBLE_PARTIES, 'متحمل رسوم التحويل'),
            manualReview: bool(fd, `r${i}_manual`),
            notes: str(fd, `r${i}_notes`) || null,
          });
        }
        await saveDraftRules(a, str(fd, 'versionId'), rules, str(fd, 'reason'));
        return done('تم حفظ القواعد');
      }
      throw validation('عملية غير معروفة');
    },
    ['/admin/finance/pricing/refund-policy'],
  );
}

export async function profitabilityCostAction(_p: ActionState, fd: FormData) {
  return run(
    fd,
    async (a) => {
      await recordCost(a, {
        entityType: str(fd, 'entityType') as never,
        entityId: str(fd, 'entityId'),
        costType: str(fd, 'costType'),
        nature: str(fd, 'nature'),
        borneBy: str(fd, 'borneBy'),
        amount: egp(str(fd, 'amount'), 'المبلغ'),
        notes: str(fd, 'notes'),
        reference: str(fd, 'reference') || undefined,
      });
      return done('تم تسجيل التكلفة');
    },
    ['/admin/finance/profitability'],
  );
}
