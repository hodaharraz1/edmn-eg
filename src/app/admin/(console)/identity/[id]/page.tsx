import { notFound } from 'next/navigation';
import { identityReviewAction, revealIdentityAction } from '@/app/_actions/identity';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { RevealRows } from '@/app/_components/reveal-rows';
import { hasPermission } from '@/server/core/actor';
import { isDomainError } from '@/server/core/errors';
import { documentsUnlocked, IDENTITY_LABELS, identityCase } from '@/server/modules/identity/service';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, DefinitionList, PageHeader, Timeline } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Field, Select, Textarea } from '@/ui/form';
import { statusLabel } from '@/lib/i18n/labels';

export const metadata = { title: 'مراجعة هوية' };

export default async function IdentityCasePage(props: PageProps<'/admin/identity/[id]'>) {
  const { actor, allowed } = await adminWith('identity.view');
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  let c;
  try {
    c = await identityCase(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const v = c.v;
  const back = `/admin/identity/${v.id}`;
  const canReview = hasPermission(actor, 'identity.review') && v.userId !== actor.userId;
  const stepUpFresh = documentsUnlocked(actor);
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'التحقق من الهوية', href: '/admin/identity' }, { label: c.name }]} />} title={`هوية ${c.name}`} actions={<Badge tone={v.status === 'APPROVED' ? 'success' : 'warning'}>{IDENTITY_LABELS[v.status]}</Badge>} />
      {v.source === 'LEGACY_SELLER_APPLICATION' && <Alert tone="warning">الحالة مربوطة بمستندات طلب بائع سابق. موافقة البائع السابقة لا تعني التحقق من الهوية — راجع البيانات كأنها تقديم جديد.</Alert>}
      <section className="card p-4">
        <DefinitionList
          items={[
            { label: 'الاسم القانوني (كما في البطاقة)', value: v.legalName ?? '—' },
            { label: 'الرقم القومي', value: <span className="ltr">•••••••••• {v.nationalIdLast4 ?? ''}</span> },
            { label: 'اسم الحساب', value: c.name },
            { label: 'نسخة التقديم', value: String(v.submissionVersion) },
            { label: 'تاريخ التقديم', value: formatDate(v.submittedAt, true) },
            { label: 'آخر قرار', value: v.reviewedAt ? `${formatDate(v.reviewedAt, true)} ${v.reviewReason ? `· ${v.reviewReason}` : ''}` : '—' },
          ]}
        />
        {c.canSeeDocuments && v.nationalIdEnc && <div className="mt-3 border-t border-line pt-3"><RevealRows action={revealIdentityAction} id={v.id} back={back} label="كشف الرقم القومي كاملًا (2FA، مسجل)" /></div>}
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">صور البطاقة</h2>
        {!c.canSeeDocuments ? (
          <Alert tone="info">عرض صور البطاقة يحتاج صلاحية «عرض مستندات الهوية».</Alert>
        ) : !stepUpFresh ? (
          <Alert tone="warning" action={<a className="text-brand-700 underline" href={`/admin/step-up?next=${encodeURIComponent(back)}`}>تأكيد الهوية (2FA)</a>}>عرض صور البطاقة يحتاج تحققًا ثنائيًا حديثًا، وكل عرض مسجل.</Alert>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="identity-documents">
            {[['وجه البطاقة', v.frontFileId], ['ظهر البطاقة', v.backFileId]].map(([l, f]) => (
              <figure key={l} className="space-y-1">
                <figcaption className="text-sm font-semibold">{l}</figcaption>
                {f ? <a href={`/api/files/${f}`} target="_blank" rel="noreferrer" className="block"><img src={`/api/files/${f}`} alt={l ?? ''} className="max-h-64 w-full rounded-lg object-contain ring-1 ring-line" /></a> : <p className="text-sm text-muted">غير مرفوع</p>}
              </figure>
            ))}
          </div>
        )}
      </section>
      {canReview && ['PENDING_REVIEW', 'APPROVED'].includes(v.status) && (
        <ActionForm action={identityReviewAction} className="card space-y-3 p-4" data-testid="identity-decision">
          <input type="hidden" name="id" value={v.id} /><input type="hidden" name="expectedVersion" value={v.submissionVersion} /><input type="hidden" name="back" value={back} />
          <h2 className="font-bold">القرار</h2>
          <Field label="القرار" htmlFor="id-decision" required>
            <Select id="id-decision" name="decision" required defaultValue="">
              <option value="" disabled>اختار</option>
              {v.status === 'PENDING_REVIEW' && <option value="APPROVE">تم التحقق (الهوية فقط — ليس اعتمادًا للمتجر)</option>}
              {v.status === 'PENDING_REVIEW' && <option value="MORE_INFO_REQUIRED">مطلوب استكمال</option>}
              {v.status === 'PENDING_REVIEW' && <option value="REJECT">رفض</option>}
              {v.status === 'APPROVED' && <option value="REVERIFICATION_REQUIRED">طلب إعادة التحقق</option>}
            </Select>
          </Field>
          <Field label="السبب (يظهر للعميل — مطلوب لغير الموافقة)" htmlFor="id-reason"><Textarea id="id-reason" name="reason" rows={2} /></Field>
          <Field label="ملاحظة داخلية (لا تظهر للعميل)" htmlFor="id-note"><Textarea id="id-note" name="internalNote" rows={2} /></Field>
          <p className="text-xs text-muted">القرار يحتاج تحققًا ثنائيًا حديثًا ويُسجل باسمك. لا يمكنك مراجعة هويتك بنفسك.</p>
          <SubmitButton>تسجيل القرار</SubmitButton>
        </ActionForm>
      )}
      <section className="card p-4">
        <h2 className="mb-2 font-bold">السجل</h2>
        <Timeline items={c.history.map((h) => ({ title: `${h.action} — ${h.fromStatus ? statusLabel(h.fromStatus) : '∅'} ← ${statusLabel(h.toStatus)}`, time: formatDate(h.createdAt, true), body: h.reason }))} />
      </section>
    </div>
  );
}
