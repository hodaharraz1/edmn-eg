import { ShieldCheck } from 'lucide-react';
import { submitIdentityAction } from '@/app/_actions/identity';
import { requireCustomer } from '@/server/web/session';
import { IDENTITY_LABELS, myIdentity } from '@/server/modules/identity/service';
import { formatDate } from '@/lib/format';
import { ActionForm, FieldError, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Field, Input } from '@/ui/form';

export const metadata = { title: 'التحقق من الهوية' };

const TONE = { APPROVED: 'success', PENDING_REVIEW: 'warning', REJECTED: 'danger', MORE_INFO_REQUIRED: 'warning', REVERIFICATION_REQUIRED: 'warning', INCOMPLETE: 'neutral' } as const;

export default async function IdentityPage() {
  const actor = await requireCustomer('/account/identity');
  const me = await myIdentity(actor);
  const canSubmit = ['INCOMPLETE', 'MORE_INFO_REQUIRED', 'REVERIFICATION_REQUIRED'].includes(me.status);
  return (
    <div className="space-y-5">
      <PageHeader title="التحقق من الهوية" description="تحقق واحد لحسابك كله: للشراء، وللبيع في السوق، وللبيع في الصفقات المحمية. بياناتك وصور بطاقتك خاصة ولا تظهر لأي مستخدم آخر." />
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4" data-testid="identity-status">
        <span className="flex items-center gap-2"><ShieldCheck className="size-5 text-brand-700" aria-hidden /> حالة التحقق</span>
        <Badge tone={TONE[me.status]}>{IDENTITY_LABELS[me.status]}</Badge>
      </section>
      {me.status === 'APPROVED' && <Alert tone="success" title="تم التحقق من هويتك">تقدر تشتري وتبيع وتعمل صفقات محمية. التحقق من الهوية لا يعني اعتماد متجر ولا اعتماد بيانات استلام الأموال — كل واحدة لها مراجعتها.</Alert>}
      {me.status === 'PENDING_REVIEW' && <Alert tone="info" title="بياناتك قيد المراجعة">هنبلغك أول ما يتم القرار. لحد كده تقدر تتابع طلباتك والدعم والنزاعات واستلام أي مبالغ مستحقة لك عادي.</Alert>}
      {me.reason && <Alert tone="warning" title="ملاحظة فريق المراجعة">{me.reason}</Alert>}
      {me.legalName && (
        <section className="card space-y-1 p-4 text-sm">
          <p>الاسم كما في البطاقة: <b>{me.legalName}</b></p>
          <p>الرقم القومي: <span className="ltr">•••••••••• {me.last4}</span></p>
          <p className="text-muted">آخر تقديم: {formatDate(me.submittedAt, true)}{me.reviewedAt && ` · آخر قرار: ${formatDate(me.reviewedAt, true)}`}</p>
        </section>
      )}
      {canSubmit && (
        <ActionForm action={submitIdentityAction} encType="multipart/form-data" className="card space-y-4 p-5" data-testid="identity-form">
          <h2 className="font-bold">{me.status === 'INCOMPLETE' ? 'ابدأ التحقق' : 'حدّث بياناتك'}</h2>
          <Field label="الاسم بالكامل كما في البطاقة" htmlFor="legalName" required><Input id="legalName" name="legalName" required minLength={6} defaultValue={me.legalName ?? ''} autoComplete="name" /><FieldError name="legalName" /></Field>
          <Field label="الرقم القومي (14 رقم)" htmlFor="nationalId" required><Input id="nationalId" name="nationalId" required inputMode="numeric" pattern="[0-9٠-٩]{14}" maxLength={14} className="ltr" autoComplete="off" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <FileInput name="front" label="صورة وجه البطاقة" required={!me.hasFront} hint={me.hasFront ? 'مرفوعة — ارفع صورة جديدة فقط لو مطلوب' : 'صورة واضحة كاملة'} />
            <FileInput name="back" label="صورة ظهر البطاقة" required={!me.hasBack} hint={me.hasBack ? 'مرفوعة — ارفع صورة جديدة فقط لو مطلوب' : 'صورة واضحة كاملة'} />
          </div>
          <p className="text-xs text-muted">الصور تُحفظ بشكل خاص ولا يراها إلا فريق المراجعة المختص، وكل اطلاع مسجل.</p>
          <SubmitButton>إرسال للمراجعة</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
