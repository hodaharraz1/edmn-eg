import Link from 'next/link';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { pricingVersionAction } from '@/app/_actions/pricing';
import { hasPermission, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { auditLogs, categories, users, type PricingModel } from '@/server/db/schema';
import { activeVersionId, compareVersions, governanceFor, listVersions, loadVersion, batchFor } from '@/server/modules/pricing/service';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DefinitionList, PageHeader, Tabs } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';

export const pctOf = (bps: number | null | undefined) => (bps === null || bps === undefined ? '—' : `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`);
const pctInput = (bps: number) => (bps / 100).toFixed(2).replace(/\.?0+$/, '');
const CLASS_LABEL: Record<string, string> = { LOW_MARGIN: 'هامش منخفض', STANDARD: 'قياسي', HIGH_MARGIN: 'هامش مرتفع', DEAL: 'الضمانة' };
const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = { ACTIVE: 'success', SCHEDULED: 'info', APPROVED: 'info', VALIDATED: 'warning', DRAFT: 'neutral', SUPERSEDED: 'neutral', CANCELLED: 'danger' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'ساري', SCHEDULED: 'مجدول', APPROVED: 'معتمد (غير منشور)', VALIDATED: 'مُرسل للاعتماد', DRAFT: 'مسودة', SUPERSEDED: 'سابق', CANCELLED: 'ملغي' };
export const classLabel = (c: string) => CLASS_LABEL[c] ?? c;

export function PricingNav({ active }: { active: string }) {
  return (
    <Tabs
      active={active}
      tabs={[
        { key: 'overview', label: 'نظرة عامة', href: '/admin/finance/pricing' },
        { key: 'marketplace', label: 'تسعير السوق', href: '/admin/finance/pricing/marketplace' },
        { key: 'deals', label: 'تسعير الضمانة', href: '/admin/finance/pricing/protected-deals' },
        { key: 'payout', label: 'تكاليف وحدود التحويل', href: '/admin/finance/pricing/payout-costs' },
        { key: 'refund', label: 'سياسة استرداد الرسوم', href: '/admin/finance/pricing/refund-policy' },
        { key: 'sim', label: 'المحاكي', href: '/admin/finance/pricing/simulator' },
        { key: 'profit', label: 'الربحية', href: '/admin/finance/profitability' },
      ]}
    />
  );
}

export async function PricingModelView({ actor, model, selected }: { actor: Actor; model: PricingModel; selected?: string }) {
  const base = model === 'MARKETPLACE' ? '/admin/finance/pricing/marketplace' : '/admin/finance/pricing/protected-deals';
  const versions = await listVersions(model);
  const activeId = await activeVersionId(db, model);
  const current = versions.find((v) => v.id === selected) ?? versions.find((v) => v.id === activeId) ?? versions[0];
  const userIds = [...new Set(versions.flatMap((v) => [v.createdBy, v.validatedBy, v.approvedBy, v.publishedBy]).filter((x): x is string => !!x))];
  const names = userIds.length ? Object.fromEntries((await db.select({ id: users.id, n: users.fullName }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.n])) : {};
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(actor, p);
  const back = current ? `${base}?v=${current.id}` : base;
  return (
    <div className="space-y-4">
      <PageHeader title={model === 'MARKETPLACE' ? 'تسعير السوق' : 'تسعير الصفقات المحمية (الضمانة)'} description="شرائح تدريجية (حدية) على قيمة المنتجات/الصفقة بدون الشحن. الإصدار المنشور لا يُعدل أبدًا — أي تغيير = إصدار جديد بموافقة شخص آخر و2FA. المعاملات السابقة تحتفظ بلقطتها." />
      <PricingNav active={model === 'MARKETPLACE' ? 'marketplace' : 'deals'} />
      <section className="card overflow-x-auto p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">الإصدارات</h2>
          {can('pricing.draft') && (
            <ActionForm action={pricingVersionAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="op" value="create" /><input type="hidden" name="model" value={model} /><input type="hidden" name="back" value={base} />
              <Select name="from" aria-label="نسخ من" className="w-auto">
                {activeId && <option value={activeId}>نسخ من الإصدار الساري</option>}
                {versions.filter((v) => v.id !== activeId).map((v) => <option key={v.id} value={v.id}>نسخ من الإصدار {v.versionNo}</option>)}
              </Select>
              <SubmitButton size="sm" variant="outline">مسودة جديدة</SubmitButton>
            </ActionForm>
          )}
        </div>
        <table className="w-full text-sm" data-testid="pricing-versions">
          <thead className="text-xs text-muted"><tr><th className="p-2 text-start">#</th><th className="p-2 text-start">الاسم</th><th className="p-2 text-start">الحالة</th><th className="p-2 text-start">السريان</th><th className="p-2 text-start">الهامش المتوقع</th><th className="p-2 text-start">المنشئ / المعتمد</th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className={`border-t border-line ${v.id === current?.id ? 'bg-brand-50' : ''}`}>
                <td className="p-2"><Link className="font-semibold text-brand-700" href={`${base}?v=${v.id}`}>{v.versionNo}</Link></td>
                <td className="p-2">{v.name}</td>
                <td className="p-2"><Badge tone={STATUS_TONE[v.displayStatus]}>{STATUS_LABEL[v.displayStatus]}</Badge>{v.marginOverride && <Badge tone="danger" className="ms-1">استثناء هامش</Badge>}</td>
                <td className="p-2 text-xs">{v.effectiveFrom ? formatDate(v.effectiveFrom, true) : '—'}</td>
                <td className="p-2">{pctOf(v.expectedMarginBps)}</td>
                <td className="p-2 text-xs">{names[v.createdBy ?? ''] ?? '—'} / {names[v.approvedBy ?? ''] ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {current && <VersionDetail actor={actor} versionId={current.id} activeId={activeId} back={back} model={model} displayStatus={current.displayStatus} validatedBy={current.validatedBy} createdBy={current.createdBy} />}
    </div>
  );
}

async function VersionDetail({ actor, versionId, activeId, back, model, displayStatus, validatedBy, createdBy }: { actor: Actor; versionId: string; activeId: string | null; back: string; model: PricingModel; displayStatus: string; validatedBy: string | null; createdBy: string | null }) {
  const v = await loadVersion(db, versionId);
  const gov = await governanceFor(versionId);
  const examples = await batchFor(versionId);
  const diff = activeId && activeId !== versionId ? await compareVersions(activeId, versionId) : [];
  const editable = v.status === 'DRAFT' && hasPermission(actor, 'pricing.draft');
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(actor, p);
  const classes = model === 'MARKETPLACE' ? ['LOW_MARGIN', 'STANDARD', 'HIGH_MARGIN'] : ['DEAL'];
  const cats = model === 'MARKETPLACE' ? await db.select({ id: categories.id, parentId: categories.parentId, name: categories.nameAr, isActive: categories.isActive }).from(categories).orderBy(asc(categories.sortOrder)) : [];
  const roots = cats.filter((c) => !c.parentId && c.isActive);
  const history = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'pricing_version'), eq(auditLogs.entityId, versionId))).orderBy(desc(auditLogs.createdAt)).limit(20);
  const isMaker = actor.userId === validatedBy || actor.userId === createdBy;
  return (
    <>
      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold">الإصدار {v.versionNo}: {v.name}</h2>
          <Badge tone={STATUS_TONE[displayStatus]}>{STATUS_LABEL[displayStatus]}</Badge>
        </div>
        <DefinitionList
          items={[
            { label: 'الحد الأدنى للرسوم (لكل طلب فرعي/صفقة)', value: formatEGP(v.minFee) },
            { label: 'الهامش المستهدف (داخلي)', value: pctOf(v.targetMarginBps) },
            { label: 'الهامش المتوقع من المحاكاة', value: <b data-testid="expected-margin">{pctOf(gov.expectedMarginBps)}</b> },
            { label: 'الشحن ضمن أساس الرسوم', value: 'لا (الشحن على المشتري ومستبعد من الأساس)' },
            { label: 'التقريب', value: 'الإجمالي ونصيب المشتري تقريب نصف لأعلى لأقرب قرش، والبائع = الباقي' },
            { label: 'المعالجة الضريبية', value: 'غير محسومة (UNRESOLVED) — لا تضاف ضريبة للعميل' },
          ]}
        />
        {gov.errors.length > 0 && <Alert tone="danger" title="لا يمكن النشر — أخطاء تحقق">{gov.errors.join(' — ')}</Alert>}
        {gov.belowTarget && <Alert tone="warning" title="تحذير: الهامش المتوقع أقل من المستهدف">النشر العادي محظور. الاعتماد ممكن فقط باستثناء موثق من صاحب صلاحية تجاوز حارس الهامش مع 2FA وسبب.</Alert>}
      </section>

      <ActionForm action={pricingVersionAction} className="card space-y-4 p-4">
        <input type="hidden" name="op" value="save" /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="model" value={model} /><input type="hidden" name="back" value={back} />
        <h3 className="font-bold">الشرائح (النِسب حدّية على الجزء داخل كل شريحة)</h3>
        {!editable && <p className="text-xs text-muted">للعرض فقط — {v.status === 'DRAFT' ? 'ليست لديك صلاحية التعديل' : 'الإصدار غير قابل للتعديل (أنشئ مسودة جديدة)'}.</p>}
        {classes.map((c) => {
          const tiers = v.tiersByClass[c] ?? [];
          const rows = editable ? [...tiers, ...Array.from({ length: 1 }, () => null)] : tiers;
          return (
            <div key={c} className="overflow-x-auto">
              <h4 className="mb-1 text-sm font-semibold">{classLabel(c)}</h4>
              <table className="w-full min-w-[560px] text-sm" data-testid={`tiers-${c}`}>
                <thead className="text-xs text-muted"><tr><th className="p-1 text-start">من (ج.م)</th><th className="p-1 text-start">إلى (ج.م، فارغ = مفتوح)</th><th className="p-1 text-start">المشتري %</th><th className="p-1 text-start">البائع %</th><th className="p-1 text-start">الإجمالي %</th></tr></thead>
                <tbody>
                  {rows.map((t, i) => (
                    <tr key={i} className="border-t border-line">
                      {editable ? (
                        <>
                          <td className="p-1"><Input name={`t__${c}__${i}__lower`} defaultValue={t ? toInputAmount(t.lowerBound) : ''} className="ltr w-28" aria-label={`${classLabel(c)} من`} /></td>
                          <td className="p-1"><Input name={`t__${c}__${i}__upper`} defaultValue={t && t.upperBound !== null ? toInputAmount(t.upperBound) : ''} className="ltr w-28" aria-label={`${classLabel(c)} إلى`} /></td>
                          <td className="p-1"><Input name={`t__${c}__${i}__buyer`} defaultValue={t ? pctInput(t.buyerBps) : ''} className="ltr w-20" aria-label={`${classLabel(c)} المشتري`} /></td>
                          <td className="p-1"><Input name={`t__${c}__${i}__seller`} defaultValue={t ? pctInput(t.sellerBps) : ''} className="ltr w-20" aria-label={`${classLabel(c)} البائع`} /></td>
                          <td className="p-1"><Input name={`t__${c}__${i}__total`} defaultValue={t ? pctInput(t.totalBps) : ''} className="ltr w-20" aria-label={`${classLabel(c)} الإجمالي`} /></td>
                        </>
                      ) : (
                        <>
                          <td className="p-1">{formatEGP(t!.lowerBound)}</td>
                          <td className="p-1">{t!.upperBound === null ? 'مفتوح' : formatEGP(t!.upperBound)}</td>
                          <td className="p-1">{pctOf(t!.buyerBps)}</td>
                          <td className="p-1">{pctOf(t!.sellerBps)}</td>
                          <td className="p-1 font-semibold">{pctOf(t!.totalBps)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {model === 'MARKETPLACE' && (
          <div>
            <h3 className="mb-1 font-bold">تصنيف الفئات الاقتصادي</h3>
            <p className="mb-2 text-xs text-muted">التصنيفات الفرعية ترث تصنيف أقرب أب له إعداد. كل تصنيف رئيسي لازم يكون له فئة، وإلا يتوقف الشراء منه (Fail closed).</p>
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {roots.flatMap((r) => [r, ...cats.filter((c) => c.parentId === r.id)]).map((c) => (
                <li key={c.id} className={`flex items-center justify-between gap-2 text-sm ${c.parentId ? 'ps-4 text-muted' : 'font-semibold'}`}>
                  <span>{c.name}</span>
                  {editable ? (
                    <Select name={`cat__${c.id}`} defaultValue={v.categoryClasses[c.id] ?? ''} className="w-auto text-xs" aria-label={`فئة ${c.name}`}>
                      <option value="">{c.parentId ? 'يرث من الأب' : '— اختر —'}</option>
                      <option value="LOW_MARGIN">هامش منخفض</option>
                      <option value="STANDARD">قياسي</option>
                      <option value="HIGH_MARGIN">هامش مرتفع</option>
                    </Select>
                  ) : (
                    <span className="text-xs">{v.categoryClasses[c.id] ? classLabel(v.categoryClasses[c.id]) : c.parentId ? 'يرث' : 'غير مصنف'}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {editable && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="اسم الإصدار" htmlFor="pv-name"><Input id="pv-name" name="name" defaultValue={v.name} /></Field>
            <Field label="الحد الأدنى للرسوم (ج.م)" htmlFor="pv-min"><Input id="pv-min" name="minFee" defaultValue={toInputAmount(v.minFee)} className="ltr" /></Field>
            <Field label="الهامش المستهدف %" htmlFor="pv-target"><Input id="pv-target" name="targetMargin" defaultValue={pctInput(v.targetMarginBps)} className="ltr" /></Field>
            <Field label="تكلفة التحصيل % (تقدير)" htmlFor="pv-c1"><Input id="pv-c1" name="a_collectionCostBps" defaultValue={pctInput(v.assumptions.collectionCostBps)} className="ltr" /></Field>
            <Field label="تكلفة التحصيل الثابتة ج.م (تقدير)" htmlFor="pv-c2"><Input id="pv-c2" name="a_collectionCostFixed" defaultValue={toInputAmount(v.assumptions.collectionCostFixed)} className="ltr" /></Field>
            <Field label="احتياطي الاسترداد % من القيمة" htmlFor="pv-r1"><Input id="pv-r1" name="a_refundReserveBps" defaultValue={pctInput(v.assumptions.refundReserveBps)} className="ltr" /></Field>
            <Field label="احتياطي النزاعات %" htmlFor="pv-r2"><Input id="pv-r2" name="a_disputeReserveBps" defaultValue={pctInput(v.assumptions.disputeReserveBps)} className="ltr" /></Field>
            <Field label="الاحتياطي التشغيلي %" htmlFor="pv-r3"><Input id="pv-r3" name="a_operationalReserveBps" defaultValue={pctInput(v.assumptions.operationalReserveBps)} className="ltr" /></Field>
            <Field label="احتياطي الاحتيال %" htmlFor="pv-r4"><Input id="pv-r4" name="a_fraudReserveBps" defaultValue={pctInput(v.assumptions.fraudReserveBps)} className="ltr" /></Field>
            <Field label="مخصص ضريبي داخلي % من الإيراد (تقدير)" htmlFor="pv-t"><Input id="pv-t" name="a_taxProvisionBps" defaultValue={pctInput(v.assumptions.taxProvisionBps)} className="ltr" /></Field>
            <Field label="تكلفة تحويل على اضمن ج.م (تقدير)" htmlFor="pv-p"><Input id="pv-p" name="a_edmnPayoutCostFixed" defaultValue={toInputAmount(v.assumptions.edmnPayoutCostFixed)} className="ltr" /></Field>
            <Field label="سبب التعديل" htmlFor="pv-reason"><Input id="pv-reason" name="reason" placeholder="سبب التعديل (يُسجل)" /></Field>
            <Field label="ملاحظات" htmlFor="pv-notes" className="sm:col-span-2 lg:col-span-4"><Textarea id="pv-notes" name="notes" rows={2} defaultValue={v.notes ?? ''} /></Field>
          </div>
        )}
        {editable && <SubmitButton>حفظ المسودة</SubmitButton>}
      </ActionForm>

      <section className="card space-y-3 p-4">
        <h3 className="font-bold">سير الاعتماد (Maker / Checker)</h3>
        <div className="flex flex-wrap gap-3">
          {v.status === 'DRAFT' && can('pricing.submit') && (
            <ActionForm action={pricingVersionAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="op" value="submit" /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="back" value={back} />
              <Input name="reason" placeholder="ملاحظة الإرسال" aria-label="ملاحظة الإرسال" className="w-56" />
              <SubmitButton size="sm">تحقق وأرسل للاعتماد</SubmitButton>
            </ActionForm>
          )}
          {(v.status === 'VALIDATED' || v.status === 'APPROVED') && can('pricing.draft') && (
            <ActionForm action={pricingVersionAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="op" value="reopen" /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="back" value={back} />
              <Input name="reason" required minLength={3} placeholder="سبب إعادة الفتح" aria-label="سبب إعادة الفتح" className="w-48" />
              <SubmitButton size="sm" variant="outline">إعادة للمسودة</SubmitButton>
            </ActionForm>
          )}
          {v.status === 'VALIDATED' && can('pricing.approve') && (
            <ActionForm action={pricingVersionAction} className="w-full space-y-2 rounded-lg border border-line p-3">
              <input type="hidden" name="op" value="approve" /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="back" value={back} />
              {isMaker && <Alert tone="warning">أنت منشئ/مرسل هذا الإصدار — الاعتماد يجب أن يكون من شخص آخر.</Alert>}
              <Input name="reason" required minLength={5} placeholder="سبب الاعتماد" aria-label="سبب الاعتماد" />
              {gov.belowTarget && can('pricing.override_margin_guard') && (
                <>
                  <Checkbox name="override" label="أتجاوز حارس الهامش (استثناء موثق)" />
                  <Input name="overrideReason" placeholder="سبب التجاوز (10 أحرف على الأقل)" aria-label="سبب التجاوز" />
                </>
              )}
              <SubmitButton size="sm">اعتماد الإصدار (2FA)</SubmitButton>
            </ActionForm>
          )}
          {v.status === 'APPROVED' && can('pricing.publish') && (
            <ActionForm action={pricingVersionAction} className="w-full space-y-2 rounded-lg border border-line p-3">
              <input type="hidden" name="op" value="publish" /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="back" value={back} />
              <Field label="تاريخ السريان (فارغ = الآن). يسري على المعاملات الجديدة فقط." htmlFor="pv-eff"><Input id="pv-eff" type="datetime-local" name="effectiveFrom" className="ltr w-64" /></Field>
              <Input name="reason" required minLength={5} placeholder="سبب النشر" aria-label="سبب النشر" />
              <SubmitButton size="sm">نشر / جدولة (2FA)</SubmitButton>
            </ActionForm>
          )}
          {(['DRAFT', 'VALIDATED', 'APPROVED'].includes(v.status) || displayStatus === 'SCHEDULED') && can('pricing.publish') && (
            <ActionForm action={pricingVersionAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="op" value="cancel" /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="back" value={back} />
              <Input name="reason" required minLength={3} placeholder="سبب الإلغاء" aria-label="سبب الإلغاء" className="w-48" />
              <SubmitButton size="sm" variant="outline">إلغاء الإصدار</SubmitButton>
            </ActionForm>
          )}
        </div>
      </section>

      <section className="card overflow-x-auto p-4">
        <h3 className="mb-2 font-bold">أمثلة ومحاكاة الربحية (تقديرية)</h3>
        <table className="w-full min-w-[720px] text-xs" data-testid="pricing-examples">
          <thead className="text-muted"><tr><th className="p-1 text-start">الفئة</th><th className="p-1 text-start">القيمة</th><th className="p-1 text-start">رسوم المشتري</th><th className="p-1 text-start">رسوم البائع</th><th className="p-1 text-start">الإجمالي</th><th className="p-1 text-start">النسبة الفعلية</th><th className="p-1 text-start">صافي المساهمة</th><th className="p-1 text-start">الهامش</th></tr></thead>
          <tbody>
            {examples.map((r) => (
              <tr key={`${r.economicClass}-${r.amount}`} className="border-t border-line">
                <td className="p-1">{classLabel(r.economicClass)}</td>
                <td className="p-1">{formatEGP(r.amount)}</td>
                <td className="p-1">{formatEGP(r.buyerFee)}</td>
                <td className="p-1">{formatEGP(r.sellerFee)}</td>
                <td className="p-1 font-semibold">{formatEGP(r.totalFee)}{r.minApplied && <Badge className="ms-1" tone="neutral">حد أدنى</Badge>}</td>
                <td className="p-1">{pctOf(r.effectiveFeeBps)}</td>
                <td className="p-1">{formatEGP(r.netContribution)}</td>
                <td className="p-1">{r.marginBps !== null && r.marginBps < v.targetMarginBps ? <Badge tone="warning">{pctOf(r.marginBps)}</Badge> : pctOf(r.marginBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-muted">الاحتياطيات والمخصصات تقديرات إدارية وليست حركة نقدية. هامش المساهمة ليس صافي ربح الشركة.</p>
      </section>

      {diff.length > 0 && (
        <section className="card overflow-x-auto p-4">
          <h3 className="mb-2 font-bold">مقارنة مع الإصدار الساري (لا يتغير أي تاريخ)</h3>
          <table className="w-full min-w-[640px] text-xs" data-testid="pricing-diff">
            <thead className="text-muted"><tr><th className="p-1 text-start">الفئة</th><th className="p-1 text-start">القيمة</th><th className="p-1 text-start">فرق المشتري</th><th className="p-1 text-start">فرق البائع</th><th className="p-1 text-start">فرق إيراد اضمن</th><th className="p-1 text-start">فرق الهامش</th></tr></thead>
            <tbody>
              {diff.map((d) => (
                <tr key={`${d.economicClass}-${d.amount}`} className="border-t border-line">
                  <td className="p-1">{classLabel(d.economicClass)}</td>
                  <td className="p-1">{formatEGP(d.amount)}</td>
                  <td className="p-1">{formatEGP(d.buyerDiff ?? 0)}</td>
                  <td className="p-1">{formatEGP(d.sellerDiff ?? 0)}</td>
                  <td className="p-1">{formatEGP(d.revenueDiff ?? 0)}</td>
                  <td className="p-1">{pctOf(d.marginDiffBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card p-4">
        <h3 className="mb-2 font-bold">سجل التدقيق لهذا الإصدار</h3>
        <ul className="space-y-1 text-xs">
          {history.map((h) => <li key={h.id}>{formatDate(h.createdAt, true)} · <b>{h.action}</b>{h.reason ? ` · ${h.reason}` : ''}</li>)}
        </ul>
      </section>
    </>
  );
}
