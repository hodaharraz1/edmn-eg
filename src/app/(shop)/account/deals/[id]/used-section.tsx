import { FileCheck2, History, Lock, ShieldCheck } from 'lucide-react';
import Link from '@/ui/link';
import { usedAmendAction, usedAmendRespondAction, usedStartAction } from '@/app/_actions/used';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { Alert } from '@/ui/feedback';
import { Field, Input, Textarea } from '@/ui/form';
import { formatDate } from '@/lib/format';
import { ConditionDetails, CoverageList, PassportLink, SafetyScoreCard, SellerSignalsCard } from '@/app/_components/used';
import { dealSnapshots, snapshotIntact, type ConditionSnapshot } from '@/server/modules/used/snapshots';
import { usedDealView } from '@/server/modules/used/views';
import { dealUsesPolicy } from '@/server/modules/used/snapshots';
import { db } from '@/server/db/client';
import type { externalDeals } from '@/server/db/schema';
import type { ProtectionLevel } from '@/domain/used';

type Deal = typeof externalDeals.$inferSelect;
const DOCUMENTING = ['SELLER_JOINED', 'CHANGE_REQUESTED'];
const AMENDABLE = ['PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'ACTIVE'];

const snapFields = (s: ConditionSnapshot) => s.fields.map((f) => ({ code: f.code, group: f.group, label: f.label, display: f.display }));
const snapEvidence = (s: ConditionSnapshot) => s.evidence.map((e) => ({ slot: e.slot, label: e.label, fileId: e.fileId, storageKey: null, private: true }));

/**
 * Trusted Used Commerce on a protected deal: the seller documents the condition before offering; the buyer reviews
 * the documented condition with the offer; after agreement the FROZEN snapshot is shown (with its integrity check),
 * and any material change is an amendment the buyer accepts or rejects.
 */
export async function UsedDealSection({ deal, isBuyer, isSeller }: { deal: Deal; isBuyer: boolean; isSeller: boolean }) {
  const policy = await dealUsesPolicy(db, deal);
  if (!policy) return null;
  const view = await usedDealView(deal.id);
  const snaps = await dealSnapshots(deal.id);
  const binding = [...snaps].reverse().find((s) => s.status === 'ACCEPTED');
  const proposed = [...snaps].reverse().find((s) => s.status === 'PROPOSED');
  const amendment = proposed && (proposed.snapshot as ConditionSnapshot).amendment ? proposed : null;
  const offerSnap = proposed && !amendment ? proposed : null;
  const shown = binding ?? offerSnap;
  const snap = shown?.snapshot as ConditionSnapshot | undefined;

  return (
    <section className="card space-y-4 p-5" data-testid="used-deal-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <ShieldCheck className="size-5 text-brand-700" aria-hidden /> حالة المنتج المستعمل — {policy.policy.title}
        </h2>
        {view?.bundle.passport && <PassportLink code={view.bundle.passport.code} level={view.level} className="w-full sm:w-auto" />}
      </div>

      {/* Seller: document before the offer. */}
      {isSeller && DOCUMENTING.includes(deal.status) && (
        <div data-testid="seller-condition-step" className="rounded-2xl bg-brand-50 p-4 text-sm ring-1 ring-brand-200">
          {!view ? (
            <>
              <p className="font-semibold">قبل ما تقدّم عرضك: وثّق حالة المنتج (بيانات منظمة + صور + إقرار).</p>
              <form action={usedStartAction} className="mt-3">
                <input type="hidden" name="mode" value="deal" />
                <input type="hidden" name="dealId" value={deal.id} />
                <button type="submit" className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-500">ابدأ توثيق الحالة</button>
              </form>
            </>
          ) : view.bundle.report.status === 'DECLARED' ? (
            <p className="flex flex-wrap items-center gap-2">
              <FileCheck2 className="size-4 text-emerald-700" aria-hidden /> التوثيق مكتمل ومقرّ بيه — هيتبعت مع عرضك ويتجمّد لما المشتري يوافق.
              <Link href={`/account/deals/${deal.id}/condition`} className="font-semibold text-brand-700 underline">مراجعة / تعديل</Link>
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-2">
              التوثيق لسه مكملش ({Math.round(((view.bundle.check.conditionCompleteness + view.bundle.check.evidenceCompleteness) / 2) * 100)}%) — العرض مش هيتبعت من غيره.
              <Link href={`/account/deals/${deal.id}/condition`} className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline">كمّل التوثيق</Link>
            </p>
          )}
        </div>
      )}
      {isBuyer && DOCUMENTING.includes(deal.status) && <Alert tone="info">البائع بيوثّق حالة المنتج (البيانات والصور) — هتراجعها مع عرضه قبل ما توافق.</Alert>}

      {snap && shown && (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="condition-freeze">
            {binding ? (
              <>
                <Lock className="size-4 text-brand-700" aria-hidden />
                <span className="font-semibold">الحالة المتفق عليها — مجمّدة (نسخة {binding.version})</span>
                <span className="text-xs text-muted">{formatDate(binding.respondedAt ?? binding.createdAt, true)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${snapshotIntact(binding) ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`} data-testid="snapshot-integrity">
                  {snapshotIntact(binding) ? 'سليمة ومطابقة لبصمتها' : 'تحذير: البصمة غير مطابقة'}
                </span>
                <span className="ltr font-mono text-[11px] text-muted" title={binding.hash}>{binding.hash.slice(0, 12)}…</span>
              </>
            ) : (
              <span className="font-semibold">الحالة المعروضة مع العرض الحالي — بتتجمّد لما توافق على العرض</span>
            )}
          </p>
          <ConditionDetails fields={snapFields(snap)} defects={snap.defects} identifierMasked={snap.identifier?.masked ?? null} evidence={snapEvidence(snap)} showPrivate />
          <p className="text-sm">
            <span className="font-semibold">فترة الفحص بعد الاستلام:</span> {snap.commercial.inspectionDays ?? deal.inspectionDays} أيام — فلوسك فاضلة محمية طول الفترة دي.
          </p>
        </div>
      )}

      {view && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold">اضمن بتحميك في إيه بالظبط؟</h3>
            <CoverageList level={(snap?.passport.level as ProtectionLevel | undefined) ?? view.level} warranty={(deal.agreedTerms as { disclosure?: { warranty?: string } } | null)?.disclosure?.warranty} />
          </div>
          <SafetyScoreCard score={view.score} />
          {view.seller && isBuyer && <SellerSignalsCard signals={view.seller.signals} className="lg:col-span-2" />}
        </div>
      )}

      {/* Amendments after agreement (before shipping). */}
      {amendment && isBuyer && (
        <div className="space-y-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200" data-testid="amendment-review">
          <p className="font-semibold">البائع اقترح تعديل على الحالة المتفق عليها (نسخة {amendment.version})</p>
          <p className="text-sm">السبب: {(amendment.snapshot as ConditionSnapshot).amendment!.reason}</p>
          <ConditionDetails fields={snapFields(amendment.snapshot as ConditionSnapshot)} defects={(amendment.snapshot as ConditionSnapshot).defects} identifierMasked={null} evidence={[]} showPrivate={false} />
          <p className="text-xs text-muted">الحالة المتفق عليها فاضلة سارية لحد ما توافق. لو رفضت، تقدر تكمل على الحالة الأصلية أو تتواصل مع الدعم.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <form action={usedAmendRespondAction} className="sm:flex-1">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="snapshotId" value={amendment.id} />
              <input type="hidden" name="decision" value="accept" />
              <ConfirmSubmit variant="success" className="w-full" confirm="توافق على الحالة الجديدة؟ هتبقى هي المرجع في أي نزاع.">موافق على التعديل</ConfirmSubmit>
            </form>
            <form action={usedAmendRespondAction} className="sm:flex-1">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="snapshotId" value={amendment.id} />
              <input type="hidden" name="decision" value="reject" />
              <ConfirmSubmit variant="outline" className="w-full" confirm="ترفض التعديل؟ الحالة الأصلية فاضلة هي المرجع.">رفض التعديل</ConfirmSubmit>
            </form>
          </div>
        </div>
      )}
      {amendment && isSeller && <Alert tone="info">اقترحت تعديل على الحالة — مستنيين رد المشتري. الحالة الأصلية فاضلة سارية لحد ما يوافق.</Alert>}
      {isSeller && binding && !amendment && AMENDABLE.includes(deal.status) && !deal.deliveredAt && (
        <details className="rounded-2xl border border-line p-4 text-sm" data-testid="amendment-form">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
            <History className="size-4" aria-hidden /> ظهر تغيير جوهري في الحالة قبل الشحن؟
          </summary>
          <ActionForm action={usedAmendAction} className="mt-3 space-y-3">
            <input type="hidden" name="dealId" value={deal.id} />
            <p className="text-xs text-muted">مينفعش تغيّر الحالة المتفق عليها بصمت. التعديل بيتبعت للمشتري كنسخة جديدة ولازم يوافق عليها.</p>
            <Field label="صحة البطارية الجديدة (اختياري)" htmlFor="f_battery_health"><Input id="f_battery_health" name="f_battery_health" type="number" min={1} max={100} dir="ltr" /></Field>
            <Field label="إفصاح إضافي (العيب أو التغيير)" htmlFor="am-note"><Textarea id="am-note" name="note" rows={2} maxLength={500} /></Field>
            <Field label="سبب التعديل" htmlFor="am-reason" required><Input id="am-reason" name="reason" required minLength={5} /></Field>
            <SubmitButton variant="secondary">ابعت التعديل للمشتري</SubmitButton>
          </ActionForm>
        </details>
      )}
    </section>
  );
}
