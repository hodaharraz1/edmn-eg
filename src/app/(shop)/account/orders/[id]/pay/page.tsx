import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { Clock, Landmark, ShieldCheck } from 'lucide-react';
import { orderForCustomer } from '@/server/modules/commerce/orders';
import { submissionsFor } from '@/server/modules/payments/service';
import { submitProofAction } from '@/app/_actions/checkout';
import { isDomainError } from '@/server/core/errors';
import { requireCustomer } from '@/server/web/session';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, FieldError, SubmitButton } from '@/ui/action-form';
import { CopyButton, FileInput } from '@/ui/client';
import { LinkButton } from '@/ui/button';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';
import { TestBadge, TestMoneyNotice } from '@/app/_components/test-money';
import { Field, Input, Textarea } from '@/ui/form';

const FIELD_LABELS: Record<string, string> = { bankName: 'البنك', accountName: 'اسم الحساب', accountNumber: 'رقم الحساب', iban: 'IBAN', instapayAddress: 'عنوان إنستاباي', walletNumber: 'رقم المحفظة' };

export default async function PayPage(props: PageProps<'/account/orders/[id]/pay'>) {
  const actor = await requireCustomer('/account/orders');
  const { id } = await props.params;
  let g;
  try {
    g = await orderForCustomer(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const p = g.payment;
  if (!p) notFound();
  const subs = await submissionsFor(p.id);
  const dests = (p.destinationSnapshot as { label: string; details: Record<string, string>; instructions: string | null; isTest?: boolean }[]) ?? [];
  const isTest = p.isTest || dests.some((d) => d.isTest !== false);
  const canSubmit = p.status === 'AWAITING_PAYMENT' || p.status === 'REJECTED';
  const lastRejected = subs.find((s) => s.status === 'REJECTED' || s.status === 'NEW_PROOF_REQUESTED');
  return (
    <div className="space-y-5">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'طلباتي', href: '/account/orders' }, { label: `#${g.order.number}`, href: `/account/orders/${id}` }, { label: 'الدفع' }]} />} title={`دفع الطلب #${g.order.number}`} actions={<StatusChip status={p.status} />} />
      {p.status === 'CONFIRMED' && <Alert tone="success" title="الدفع اتأكد" action={<LinkButton href={`/account/orders/${id}`} size="sm">تابع طلبك</LinkButton>}>شكراً! البائع هيبدأ يجهّز طلبك.</Alert>}
      {(p.status === 'PAYMENT_SUBMITTED' || p.status === 'UNDER_REVIEW') && <Alert tone="info" title="بنراجع إثبات الدفع">فريق اضمن هيراجع التحويل ويبلغك. مش محتاج ترفع إثبات تاني.</Alert>}
      {p.status === 'EXPIRED' && <Alert tone="danger" title="مهلة الدفع خلصت">الطلب اتلغى، والمنتجات رجعت متاحة لعملاء تانيين.</Alert>}
      {p.status === 'REJECTED' && lastRejected && <Alert tone="danger" title="إثبات الدفع اللي فات اترفض">{lastRejected.reviewReason}. تقدر ترفع إثبات جديد قبل {formatDate(p.dueAt, true)}.</Alert>}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-4 p-5">
          <div className="rounded-xl bg-brand-50 p-4 text-center">
            <p className="text-sm text-brand-800">حوّل المبلغ ده بالظبط</p>
            <p className="text-3xl font-bold text-brand-900">{formatEGP(p.amountDue, { fixed: true })}</p>
            <p className="mt-1 text-xs text-muted">طريقة الدفع: {label('paymentMethod', p.method)} · رقم الطلب للمرجع: <span className="font-semibold ltr">{g.order.number}</span></p>
          </div>
          {canSubmit && <p className="flex items-center gap-2 text-sm text-amber-800"><Clock className="size-4" /> آخر موعد للدفع: {formatDate(p.dueAt, true)}</p>}
          <h2 className="flex items-center gap-2 font-bold"><Landmark className="size-5 text-brand-600" /> بيانات التحويل</h2>
          {isTest && <TestMoneyNotice />}
          {dests.map((d, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-line p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">{d.label} {d.isTest !== false && <TestBadge />}</p>
              <dl className="space-y-1">
                {Object.entries(d.details).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <dt className="text-muted">{FIELD_LABELS[k] ?? k}</dt>
                    <dd className="flex items-center gap-2 font-semibold ltr">{v} <CopyButton value={v} /></dd>
                  </div>
                ))}
              </dl>
              {d.instructions && <p className="text-xs text-muted">{d.instructions}</p>}
            </div>
          ))}
          <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="size-4 shrink-0 text-emerald-600" /> متحوّلش لأي حساب غير اللي مكتوب هنا. اضمن عمره ما هيطلب منك تحوّل لحساب شخصي لبائع.</p>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-bold">رفع إثبات الدفع</h2>
          {canSubmit ? (
            <ActionForm action={submitProofAction} className="space-y-4">
              <input type="hidden" name="paymentId" value={p.id} />
              <input type="hidden" name="clientKey" value={randomUUID()} />
              <input type="hidden" name="back" value={`/account/orders/${id}`} />
              <FileInput name="proof" label="صورة إيصال التحويل أو لقطة الشاشة" hint="JPG / PNG / PDF حتى 10 ميجابايت" accept="image/jpeg,image/png,image/webp,application/pdf" required maxMb={10} />
              <FieldError name="proof" />
              <Field label="المبلغ المحوّل (ج.م)" htmlFor="claimedAmount" required>
                <Input id="claimedAmount" name="claimedAmount" inputMode="decimal" defaultValue={toInputAmount(p.amountDue)} required dir="ltr" className="text-start" />
                <FieldError name="claimedAmount" />
              </Field>
              <Field label="رقم العملية / المرجع" htmlFor="reference" hint="هتلاقيه في رسالة التأكيد من البنك أو التطبيق">
                <Input id="reference" name="reference" dir="ltr" className="text-start" />
              </Field>
              <Field label="اسم صاحب التحويل (زي ما هو ظاهر في التحويل)" htmlFor="payerName"><Input id="payerName" name="payerName" /></Field>
              <Field label="ملاحظات" htmlFor="notes"><Textarea id="notes" name="notes" rows={2} /></Field>
              <SubmitButton size="lg" className="w-full" pendingText="بنرفع الإثبات…">رفع إثبات الدفع</SubmitButton>
              <p className="text-xs text-muted">رفع الإثبات مش معناه إن الدفع اتأكد. الدفع بيتأكد بس بعد ما فريق اضمن يتحقق إن المبلغ وصل.</p>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">مينفعش ترفع إثبات في الحالة دي.</p>
          )}
          {subs.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-sm font-semibold">الإثباتات اللي رفعتها قبل كده</p>
              <ul className="space-y-2 text-xs">
                {subs.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-page p-2">
                    <span>{formatDate(s.createdAt, true)} · {formatEGP(s.claimedAmount)} {s.reference && <span className="ltr">· {s.reference}</span>}</span>
                    <span className="flex items-center gap-2"><StatusChip status={s.status} /> <a href={`/api/files/${s.proofFileId}`} target="_blank" className="text-brand-700 underline">الإثبات</a></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
