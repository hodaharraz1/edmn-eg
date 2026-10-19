import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import Link from '@/ui/link';
import { usedInspectionAction, usedVerifyAction } from '@/app/_actions/used';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { conditionSnapshots, productPassportEvents, productPassports, riskFlags, usedConditionReports } from '@/server/db/schema';
import { reportBundle } from '@/server/modules/used/reports';
import { snapshotIntact } from '@/server/modules/used/snapshots';
import { fieldsOf, evidenceOf } from '@/server/modules/used/views';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { PageHeader, Timeline } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Field, Input, Select, Textarea } from '@/ui/form';
import { ConditionDetails, ProtectionLevelBadge } from '@/app/_components/used';
import type { ProtectionLevel } from '@/domain/used';

export const metadata = { title: 'جواز منتج' };

export default async function PassportAdmin(props: { params: Promise<{ id: string }> }) {
  const { actor, allowed } = await adminWith(['products.moderate', 'deals.manage']);
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [pp] = await db.select().from(productPassports).where(eq(productPassports.id, id));
  if (!pp) notFound();
  // Product passports are reviewed by catalog moderators, deal passports by deal staff.
  if (!hasPermission(actor, pp.productId ? 'products.moderate' : 'deals.manage')) return <Forbidden />;
  const [r] = await db.select().from(usedConditionReports).where(eq(usedConditionReports.id, pp.reportId));
  const b = await reportBundle(db, r);
  const [events, snaps, flags] = await Promise.all([
    db.select().from(productPassportEvents).where(eq(productPassportEvents.passportId, pp.id)).orderBy(asc(productPassportEvents.createdAt)),
    db.select().from(conditionSnapshots).where(eq(conditionSnapshots.passportId, pp.id)).orderBy(asc(conditionSnapshots.createdAt)),
    db.select().from(riskFlags).where(and(eq(riskFlags.entityType, 'product_passport'), eq(riskFlags.entityId, pp.id))),
  ]);
  const back = `/admin/used/passports/${pp.id}`;
  return (
    <div className="space-y-5" data-testid="admin-passport">
      <PageHeader
        title={`جواز المنتج ${pp.code}`}
        description={pp.productId ? 'إعلان في السوق' : 'صفقة محمية'}
        actions={<><ProtectionLevelBadge level={pp.level as ProtectionLevel} /><Link href={`/passport/${pp.code}`} target="_blank" className="text-sm text-brand-700 hover:underline">الصفحة العامة</Link></>}
      />
      {flags.filter((f) => f.status === 'OPEN').map((f) => (
        <Alert key={f.id} tone="danger" title="مؤشر مخاطر مفتوح">{f.note}</Alert>
      ))}
      <section className="card space-y-3 p-5">
        <h2 className="font-bold">بيانات الحالة (نسخة {r.version}) — {r.status === 'DRAFT' ? 'لسه من غير إقرار' : r.status === 'LOCKED' ? 'مجمّدة في اتفاق' : 'مقرّ بيها'}</h2>
        <ConditionDetails fields={fieldsOf(b)} defects={b.check.defects} identifierMasked={r.identifierMasked} evidence={evidenceOf(b)} showPrivate />
        <p className="text-xs text-muted">رقم الجهاز الكامل مش بيظهر هنا: محفوظ متشفّر، والمقارنة بين الجوازات بتتم ببصمة مشفرة.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ActionForm action={usedVerifyAction} className="card space-y-3 p-5" data-testid="verify-form">
          <input type="hidden" name="passportId" value={pp.id} />
          <input type="hidden" name="back" value={back} />
          <h2 className="font-bold">مراجعة المستندات والصور</h2>
          <p className="text-xs text-muted">الحالة الحالية: <Badge tone={pp.verificationStatus === 'VERIFIED' ? 'success' : pp.verificationStatus === 'REJECTED' ? 'danger' : 'warning'}>{pp.verificationStatus}</Badge>{pp.verifiedAt ? ` · ${formatDate(pp.verifiedAt, true)}` : ''}. المراجعة مش فحص فني، ومحتاجة تأكيد هوية حديث (2FA).</p>
          <Field label="القرار" htmlFor="decision"><Select id="decision" name="decision"><option value="VERIFIED">البيانات والصور مطابقة (موثّق)</option><option value="REJECTED">محتاجة تصحيح</option></Select></Field>
          <Field label="ملاحظة المراجعة" htmlFor="note" required><Textarea id="note" name="note" rows={2} required minLength={3} /></Field>
          <SubmitButton>تسجيل المراجعة</SubmitButton>
        </ActionForm>
        <ActionForm action={usedInspectionAction} encType="multipart/form-data" className="card space-y-3 p-5" data-testid="inspection-form">
          <input type="hidden" name="passportId" value={pp.id} />
          <input type="hidden" name="back" value={back} />
          <h2 className="font-bold">تسجيل فحص فني فعلي</h2>
          <p className="text-xs text-muted">«مفحوص» بيظهر بس مع تقرير فحص حقيقي مرفوع. التسجيل نهائي (أي تصحيح = فحص جديد).</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="جهة الفحص" htmlFor="provider" required><Input id="provider" name="provider" required /></Field>
            <Field label="اسم الفاحص" htmlFor="inspectorName" required><Input id="inspectorName" name="inspectorName" required /></Field>
            <Field label="النتيجة" htmlFor="result"><Select id="result" name="result"><option value="PASS">ناجح</option><option value="PASS_WITH_NOTES">ناجح بملاحظات</option><option value="FAIL">غير ناجح</option></Select></Field>
            <Field label="تاريخ الفحص" htmlFor="performedAt" required><Input id="performedAt" name="performedAt" type="date" required /></Field>
          </div>
          <Field label="ملخص النتيجة" htmlFor="summary" required><Textarea id="summary" name="summary" rows={2} required minLength={10} /></Field>
          <FileInput name="report" label="تقرير الفحص (PDF أو صورة)" accept="image/jpeg,image/png,image/webp,application/pdf" required />
          <SubmitButton variant="secondary">تسجيل الفحص</SubmitButton>
        </ActionForm>
      </div>

      {b.inspections.length > 0 && (
        <section className="card space-y-2 p-5 text-sm">
          <h2 className="font-bold">الفحوصات المسجلة</h2>
          {b.inspections.map((i) => (
            <p key={i.id}>{formatDate(i.performedAt)} · {i.provider} · {i.inspectorName} · {i.result} — {i.summary} · <a href={`/api/files/${i.reportFileId}`} target="_blank" rel="noopener" className="text-brand-700 underline">التقرير</a></p>
          ))}
        </section>
      )}

      <section className="card space-y-2 p-5 text-sm" data-testid="admin-snapshots">
        <h2 className="font-bold">الحالات المجمّدة ({snaps.length})</h2>
        {snaps.length === 0 ? <p className="text-muted">لسه مفيش اتفاق ثبّت الحالة.</p> : (
          <ul className="divide-y divide-line">
            {snaps.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-semibold">نسخة {s.version}</span>
                <Badge tone={s.status === 'ACCEPTED' ? 'success' : 'neutral'}>{s.status}</Badge>
                <Badge tone={snapshotIntact(s) ? 'success' : 'danger'}>{snapshotIntact(s) ? 'البصمة سليمة' : 'البصمة غير مطابقة'}</Badge>
                <span className="ltr font-mono text-xs text-muted">{s.hash.slice(0, 16)}…</span>
                {s.dealId && <Link href={`/admin/deals/${s.dealId}`} className="text-brand-700 hover:underline">الصفقة</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-bold">سجل الجواز</h2>
        <Timeline items={events.map((e) => ({ title: e.kind, time: formatDate(e.createdAt, true), body: e.data ? JSON.stringify(e.data) : undefined, done: true }))} />
      </section>
    </div>
  );
}
