import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MessageCircle, Scale } from 'lucide-react';
import { cancelDealAction, dealConfirmAction, dealDeliveredAction, dealProofAction, refreshInviteAction, startDealPaymentAction } from '@/app/_actions/deals';
import { dealGraph } from '@/server/modules/deals/service';
import { enabledPaymentMethods, submissionsFor } from '@/server/modules/payments/service';
import { isDomainError } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { disputes } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireCustomer } from '@/server/web/session';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { CopyButton, FileInput } from '@/ui/client';
import { buttonClass, LinkButton } from '@/ui/button';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { TestBadge, TestMoneyNotice } from '@/app/_components/test-money';
import { Field, Input, Radio, Textarea } from '@/ui/form';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export default async function DealDetail(props: PageProps<'/account/deals/[id]'>) {
  const actor = await requireCustomer('/account/deals');
  const { id } = await props.params;
  const sp = await props.searchParams;
  let g;
  try {
    g = await dealGraph(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const { deal, role, payment } = g;
  const subs = payment ? await submissionsFor(payment.id) : [];
  const methods = await enabledPaymentMethods();
  const [dispute] = await db.select().from(disputes).where(eq(disputes.dealId, deal.id));
  const inviteToken = typeof sp.invite === 'string' ? sp.invite : null;
  const inviteLink = inviteToken ? `${APP_URL}/deal-invite/${inviteToken}` : null;
  const dests = (payment?.destinationSnapshot as { label: string; details: Record<string, string>; isTest?: boolean }[] | null) ?? [];
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الصفقات المحمية', href: '/account/deals' }, { label: `#${deal.number}` }]} />} title={deal.title} description={`صفقة محمية #${deal.number}`} actions={<><Badge tone={role === 'BUYER' ? 'brand' : 'accent'}>{role === 'BUYER' ? 'أنت المشتري' : 'أنت البائع'}</Badge><StatusChip status={deal.status} /></>} />

      {inviteLink && (
        <Alert tone="success" title="تم إنشاء رابط الدعوة">
          <p>أرسلنا الدعوة للبائع برسالة. يمكنك أيضاً مشاركة الرابط مباشرة (يظهر مرة واحدة):</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded bg-white px-2 py-1 text-xs ltr">{inviteLink}</code>
            <CopyButton value={inviteLink} />
            <a href={`https://wa.me/?text=${encodeURIComponent(`دعوة لصفقة محمية عبر اضمن: ${inviteLink}`)}`} target="_blank" rel="noopener noreferrer" className={buttonClass('success', 'sm')}><MessageCircle className="size-4" /> واتساب</a>
          </div>
        </Alert>
      )}

      <section className="card p-5">
        <DefinitionList items={[
          { label: 'المنتج', value: `${deal.title} × ${deal.quantity}` },
          { label: 'المشتري', value: g.buyerName },
          { label: 'البائع', value: deal.sellerName },
          { label: 'قيمة الصفقة', value: formatEGP(deal.totalAmount) },
          { label: role === 'BUYER' ? 'المطلوب دفعه' : 'صافي مستحقك', value: formatEGP(role === 'BUYER' ? deal.buyerPays : deal.sellerReceives) },
          { label: 'التسليم', value: `${deal.deliveryMethod ?? '—'} · قبل ${formatDate(deal.deliveryDeadline)}` },
          { label: 'مدة الفحص', value: `${deal.inspectionDays} يوم` },
          { label: 'شروط خاصة', value: deal.customTerms ?? 'لا يوجد' },
          ...(role === 'SELLER' ? [{ label: 'وسيلة استلام مستحقاتك', value: deal.sellerPayoutMasked }] : []),
        ]} />
        <p className="mt-3 whitespace-pre-line text-sm text-muted">{deal.description}</p>
      </section>

      {role === 'BUYER' && deal.status === 'INVITED' && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>بانتظار موافقة البائع على الدعوة.</span>
          <form action={refreshInviteAction}><input type="hidden" name="dealId" value={deal.id} /><button className={buttonClass('outline', 'sm')}>إنشاء رابط دعوة جديد</button></form>
        </div>
      )}

      {role === 'BUYER' && deal.status === 'PAYMENT_PENDING' && !payment && (
        <ActionForm action={startDealPaymentAction} className="card space-y-3 p-5">
          <input type="hidden" name="dealId" value={deal.id} />
          <h2 className="font-bold">اختر طريقة الدفع</h2>
          {methods.map((m, i) => <Radio key={m.code} name="method" value={m.code} defaultChecked={i === 0} label={m.nameAr} />)}
          <SubmitButton>متابعة</SubmitButton>
        </ActionForm>
      )}

      {role === 'BUYER' && payment && (payment.status === 'AWAITING_PAYMENT' || payment.status === 'REJECTED') && (
        <section className="card grid gap-5 p-5 lg:grid-cols-2">
          <div className="space-y-3">
            <h2 className="font-bold">حوّل {formatEGP(payment.amountDue, { fixed: true })} إلى:</h2>
            {(payment.isTest || dests.some((d) => d.isTest !== false)) && <TestMoneyNotice />}
            {dests.map((d, i) => (
              <dl key={i} className="space-y-1 rounded-xl border border-line p-3 text-sm">
                <dt className="flex items-center gap-2 font-semibold">{d.label} {d.isTest !== false && <TestBadge />}</dt>
                {Object.entries(d.details).map(([k, v]) => <dd key={k} className="flex justify-between gap-2"><span className="text-muted">{k}</span><span className="flex items-center gap-2 ltr">{v} <CopyButton value={v} /></span></dd>)}
              </dl>
            ))}
            {payment.status === 'REJECTED' && <Alert tone="danger">لم يتم قبول الإثبات السابق: {subs[0]?.reviewReason}</Alert>}
          </div>
          <ActionForm action={dealProofAction} className="space-y-3" encType="multipart/form-data">
            <input type="hidden" name="dealId" value={deal.id} />
            <input type="hidden" name="paymentId" value={payment.id} />
            <input type="hidden" name="clientKey" value={randomUUID()} />
            <FileInput name="proof" label="إثبات التحويل" accept="image/jpeg,image/png,image/webp,application/pdf" required />
            <Field label="المبلغ المحوّل" htmlFor="claimedAmount"><Input id="claimedAmount" name="claimedAmount" defaultValue={toInputAmount(payment.amountDue)} dir="ltr" required /></Field>
            <Field label="رقم العملية" htmlFor="reference"><Input id="reference" name="reference" dir="ltr" /></Field>
            <SubmitButton>رفع إثبات الدفع</SubmitButton>
          </ActionForm>
        </section>
      )}
      {deal.status === 'PAYMENT_UNDER_REVIEW' && <Alert tone="info">إثبات الدفع قيد التحقق من فريق اضمن.</Alert>}
      {deal.status === 'ACTIVE' && role === 'BUYER' && <Alert tone="success" title="الصفقة نشطة">تم تأكيد استلام اضمن للدفع. لن يُتاح مستحق البائع إلا بعد تأكيدك الاستلام أو انتهاء مدة الفحص المتفق عليها. سيقوم البائع بالتسليم حسب الاتفاق.</Alert>}

      {role === 'SELLER' && deal.status === 'ACTIVE' && (
        <ActionForm action={dealDeliveredAction} className="card space-y-3 p-5" encType="multipart/form-data">
          <input type="hidden" name="dealId" value={deal.id} />
          <Alert tone="success">تم تأكيد دفع المشتري لدى اضمن. سلّم المنتج حسب الاتفاق ثم سجّل التسليم.</Alert>
          <Field label="تفاصيل التسليم" htmlFor="note"><Textarea id="note" name="note" rows={2} placeholder="تم الشحن عبر… رقم البوليصة…" /></Field>
          <FileInput name="proof" multiple label="إثبات التسليم (بوليصة / صورة)" accept="image/jpeg,image/png,image/webp,application/pdf" />
          <SubmitButton>تسجيل التسليم</SubmitButton>
        </ActionForm>
      )}

      {role === 'BUYER' && (deal.status === 'DELIVERED' || deal.status === 'BUYER_CONFIRMATION_PENDING') && (
        <ActionForm action={dealConfirmAction} className="card space-y-3 border-emerald-200 bg-emerald-50 p-5">
          <input type="hidden" name="dealId" value={deal.id} />
          <p className="text-sm">أعلن البائع التسليم في {formatDate(deal.deliveredAt, true)}. {deal.deliveryNote}</p>
          <p className="text-sm font-semibold">افحص المنتج خلال {deal.inspectionDays} يوم. عند التأكيد سيتم صرف المبلغ للبائع.</p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="success">تأكيد الاستلام وإتمام الصفقة</SubmitButton>
            <LinkButton href={`/account/disputes/new?deal=${deal.id}`} variant="outline"><Scale className="size-4" /> هناك مشكلة</LinkButton>
          </div>
        </ActionForm>
      )}
      {['ACTIVE', 'DELIVERED', 'BUYER_CONFIRMATION_PENDING'].includes(deal.status) && !dispute && role === 'SELLER' && (
        <LinkButton href={`/account/disputes/new?deal=${deal.id}`} variant="ghost" size="sm"><Scale className="size-4" /> الإبلاغ عن مشكلة</LinkButton>
      )}
      {dispute && <LinkButton href={`/account/disputes/${dispute.id}`} variant="secondary">متابعة النزاع #{dispute.number}</LinkButton>}
      {deal.status === 'COMPLETED' && <Alert tone="success" title="اكتملت الصفقة">{role === 'SELLER' ? `سيتم تحويل مستحقك ${formatEGP(g.payout?.amount ?? deal.sellerReceives)} إلى ${deal.sellerPayoutMasked}. الحالة: ${g.payout?.status === 'PAID' ? 'تم التحويل' : 'قيد التحويل'}` : 'شكراً لاستخدامك اضمن.'}</Alert>}

      {role === 'BUYER' && ['DRAFT', 'INVITED', 'ACCEPTED', 'PAYMENT_PENDING'].includes(deal.status) && (
        <form action={async (fd) => { 'use server'; await cancelDealAction({}, fd); }} className="flex items-end gap-2">
          <input type="hidden" name="dealId" value={deal.id} />
          <input type="hidden" name="reason" value="ألغى المشتري الصفقة قبل الدفع" />
          <ConfirmSubmit confirm="إلغاء الصفقة؟" variant="outline" size="sm">إلغاء الصفقة</ConfirmSubmit>
        </form>
      )}
      <p className="text-xs text-muted"><Link href="/legal/protected-deal-terms" className="underline">شروط الصفقات المحمية</Link></p>
    </div>
  );
}
