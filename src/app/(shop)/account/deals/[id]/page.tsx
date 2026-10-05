import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { Scale } from 'lucide-react';
import {
  buyerOfferResponseAction,
  cancelDealAction,
  dealConfirmAction,
  dealDeliveredAction,
  dealProofAction,
  refreshInviteAction,
  rejectInviteAction,
  revokeInviteAction,
  sellerChangeResponseAction,
  sellerOfferAction,
  startDealPaymentAction,
} from '@/app/_actions/deals';
import { dealGraph, termsHistory, type Terms } from '@/server/modules/deals/service';
import { enabledPaymentMethods, submissionsFor } from '@/server/modules/payments/service';
import { getSetting } from '@/server/modules/settings';
import type { StoredLocation } from '@/server/modules/locations';
import { isDomainError } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { disputes, governorates, users } from '@/server/db/schema';
import { requireCustomer } from '@/server/web/session';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { CopyButton, FileInput } from '@/ui/client';
import { buttonClass, LinkButton } from '@/ui/button';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Checkbox, Field, Input, Radio, Select, Textarea } from '@/ui/form';
import { TestBadge, TestMoneyNotice } from '@/app/_components/test-money';
import { DealShare } from '@/app/_components/deal-share';
import { LocationPicker } from '@/app/_components/location-picker';
import { ReturnPolicyFields } from '@/app/_components/return-policy-fields';
import { ReturnPolicyView } from '@/app/_components/return-policy-view';
import { ContactVerification } from '@/app/_components/contact-verification';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const NEGOTIATION = ['SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED'];
const BUYER_CANCELLABLE = ['DRAFT', 'INVITED', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED', 'ACCEPTED', 'PAYMENT_PENDING'];

export const metadata = { title: 'صفقة محمية', referrer: 'no-referrer' as const };

export default async function DealDetail(props: { params: Promise<{ id: string }> }) {
  const actor = await requireCustomer('/account/deals');
  const { id } = await props.params;
  let g;
  try {
    g = await dealGraph(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const { deal, role, payment } = g;
  const [subs, methods, [dispute], versions, govs, mandatoryNotice, [me]] = await Promise.all([
    payment ? submissionsFor(payment.id) : Promise.resolve([]),
    enabledPaymentMethods(),
    db.select().from(disputes).where(eq(disputes.dealId, deal.id)),
    termsHistory(actor, deal.id),
    db.select({ id: governorates.id, nameAr: governorates.nameAr }).from(governorates).orderBy(asc(governorates.sortOrder)),
    getSetting('returns.mandatoryRightsNotice'),
    db.select({ phone: users.phone, email: users.email, phoneVerifiedAt: users.phoneVerifiedAt, emailVerifiedAt: users.emailVerifiedAt, fullName: users.fullName }).from(users).where(eq(users.id, actor.userId!)),
  ]);
  const flash = role === 'BUYER' && deal.status === 'INVITED' ? (await cookies()).get(`edmn_inv_${deal.id}`)?.value : undefined;
  const inviteLink = flash && /^[A-Za-z0-9_-]{30,100}$/.test(flash) ? `${APP_URL}/deal/invite/${flash}` : null;
  const govName = (gid?: number | null) => govs.find((x) => x.id === gid)?.nameAr ?? '—';
  const open = [...versions].reverse().find((v) => v.status === 'PROPOSED');
  const openTerms = open?.terms as Terms | undefined;
  const lastSeller = [...versions].reverse().find((v) => v.proposedBy === 'SELLER');
  const agreed = deal.agreedTerms as Terms | null;
  const dests = (payment?.destinationSnapshot as { label: string; details: Record<string, string>; isTest?: boolean }[] | null) ?? [];
  const isSeller = role === 'SELLER';
  const isBuyer = role === 'BUYER';

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'الصفقات المحمية', href: '/account/deals' }, { label: g.ref }]} />}
        title={deal.title}
        description={`صفقة محمية · ${g.ref}`}
        actions={<><Badge tone={isBuyer ? 'brand' : 'accent'}>{isBuyer ? 'أنت المشتري' : 'أنت البائع'}</Badge><StatusChip status={deal.status} /></>}
      />

      {inviteLink && <DealShare url={inviteLink} dealRef={g.ref} />}
      {isBuyer && deal.status === 'DRAFT' && <Alert tone="info">طلب الصفقة لم يكتمل بعد. <Link href={`/account/deals/new?deal=${deal.id}&step=${Math.min(deal.wizardStep, 6)}`} className="underline">أكمل الطلب</Link></Alert>}
      {isBuyer && deal.status === 'INVITED' && (
        <div className="card space-y-3 p-4 text-sm">
          <p>بانتظار انضمام البائع عبر الرابط. لو ضاع الرابط أنشئ رابطاً جديداً (القديم يتوقف فوراً).</p>
          <div className="flex flex-wrap gap-2">
            <form action={refreshInviteAction}><input type="hidden" name="dealId" value={deal.id} /><button className={buttonClass('outline', 'sm')}>إنشاء رابط دعوة جديد</button></form>
            <form action={revokeInviteAction}><input type="hidden" name="dealId" value={deal.id} /><button className={buttonClass('ghost', 'sm')}>إلغاء الرابط وتعديل الطلب</button></form>
          </div>
        </div>
      )}

      <section className="card p-5">
        <h2 className="mb-3 font-bold">طلب المشتري</h2>
        <DefinitionList items={[
          { label: 'المنتج', value: `${deal.title} × ${deal.quantity}` },
          { label: 'الحالة', value: deal.condition === 'NEW' ? 'جديد' : 'مستعمل' },
          { label: 'المشتري', value: g.buyerName },
          { label: 'البائع', value: deal.sellerFullName ?? (isBuyer && deal.sellerName ? `${deal.sellerName} (لم ينضم بعد)` : 'لم ينضم بعد') },
          { label: 'السعر', value: formatEGP(deal.totalAmount) },
          { label: isBuyer ? 'المطلوب دفعه' : 'صافي مستحقك', value: formatEGP(isBuyer ? deal.buyerPays : deal.sellerReceives) },
          { label: 'التسليم المتوقع', value: `${deal.deliveryMethod ?? '—'} · قبل ${formatDate(deal.deliveryDeadline)}` },
          { label: 'مدة الفحص', value: `${deal.inspectionDays} يوم` },
          { label: 'شروط خاصة', value: deal.customTerms ?? 'لا يوجد' },
          ...(isSeller && deal.sellerPayoutMasked ? [{ label: 'وسيلة استلام مستحقاتك', value: deal.sellerPayoutMasked }] : []),
        ]} />
        <p className="mt-3 whitespace-pre-line text-sm text-muted">{deal.description}</p>
      </section>

      {(g.buyerLocation || g.sellerLocation) && (
        <section className="card grid gap-4 p-5 sm:grid-cols-2" data-testid="deal-locations">
          {g.buyerLocation && <LocationCard title={isBuyer ? 'عنوان الاستلام (عنوانك)' : 'عنوان المشتري'} loc={g.buyerLocation} gov={govName(g.buyerLocation.governorateId)} />}
          {g.sellerLocation && <LocationCard title={isSeller ? 'عنوان استلام الشحنة منك' : 'عنوان البائع'} loc={g.sellerLocation} gov={govName(g.sellerLocation.governorateId)} />}
          {!(g.buyerLocation && g.sellerLocation) && <p className="text-xs text-muted sm:col-span-2">عنوان الطرف الآخر يظهر بعد تأكيد الدفع فقط.</p>}
        </section>
      )}

      {/* ── Seller: first offer ── */}
      {isSeller && deal.status === 'SELLER_JOINED' && (
        <div className="space-y-4">
          {!me.phoneVerifiedAt && (
            <section className="card space-y-2 p-5">
              <h2 className="font-bold">أكّد رقم موبايلك</h2>
              <p className="text-sm text-muted">لازم رقم موبايل مؤكد قبل إرسال عرضك.</p>
              <ContactVerification user={me} only={['PHONE']} />
            </section>
          )}
          <div data-testid="seller-offer-form">
          <ActionForm action={sellerOfferAction} className="card space-y-4 p-5">
            <input type="hidden" name="dealId" value={deal.id} />
            <input type="hidden" name="first" value="1" />
            <h2 className="text-lg font-bold">بياناتك وعرضك</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="الاسم بالكامل" htmlFor="fullName" required><Input id="fullName" name="fullName" defaultValue={me.fullName} required minLength={3} /></Field>
              <Field label="البريد للتواصل (اختياري)" htmlFor="contactEmail"><Input id="contactEmail" name="contactEmail" type="email" dir="ltr" defaultValue={me.email ?? ''} /></Field>
            </div>
            <LocationPicker governorates={govs} title="عنوان استلام الشحنة منك" />
            <OfferFields condition={deal.condition} />
            <ReturnPolicyFields mandatoryNotice={mandatoryNotice} />
            <PayoutFields holder={me.fullName} />
            <Field label="رسالة للمشتري (اختياري)" htmlFor="message"><Textarea id="message" name="message" rows={2} maxLength={1000} /></Field>
            <Checkbox name="acceptTerms" required label={<>أوافق على <Link href="/legal/protected-deal-terms" target="_blank" className="text-brand-700 underline">شروط الصفقات المحمية</Link></>} />
            <SubmitButton variant="success" size="lg" className="w-full sm:w-auto">إرسال العرض للمشتري</SubmitButton>
          </ActionForm>
          </div>
          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-semibold">رفض الصفقة</summary>
            <ActionForm action={rejectInviteAction} className="mt-3 space-y-3">
              <input type="hidden" name="dealId" value={deal.id} />
              <Field label="سبب الرفض" htmlFor="reason" required><Textarea id="reason" name="reason" rows={2} required minLength={3} /></Field>
              <SubmitButton variant="outline">تأكيد الرفض</SubmitButton>
            </ActionForm>
          </details>
        </div>
      )}

      {/* ── Buyer: review seller offer ── */}
      {isBuyer && deal.status === 'OFFER_PENDING_BUYER' && open && openTerms && (
        <section className="card space-y-4 border-brand-200 p-5" data-testid="offer-review">
          <h2 className="text-lg font-bold">عرض البائع (نسخة {open.version})</h2>
          {open.message && <p className="rounded-lg bg-page p-2 text-sm">{open.message}</p>}
          <TermsTable t={openTerms} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <ActionForm action={buyerOfferResponseAction} className="sm:flex-1">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="version" value={open.version} />
              <input type="hidden" name="decision" value="ACCEPT" />
              <SubmitButton variant="success" size="lg" className="w-full">موافق على العرض</SubmitButton>
            </ActionForm>
            <ActionForm action={buyerOfferResponseAction} className="sm:flex-1">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="version" value={open.version} />
              <input type="hidden" name="decision" value="REJECT" />
              <ConfirmSubmit confirm="رفض العرض وإلغاء الصفقة؟" variant="outline" size="lg" className="w-full">رفض</ConfirmSubmit>
            </ActionForm>
          </div>
          <details className="rounded-xl border border-line p-4">
            <summary className="cursor-pointer text-sm font-semibold">طلب تعديل</summary>
            <ActionForm action={buyerOfferResponseAction} className="mt-3 space-y-3">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="version" value={open.version} />
              <input type="hidden" name="decision" value="REQUEST_CHANGE" />
              <ReturnPolicyFields defaults={openTerms.returnPolicy} mandatoryNotice={mandatoryNotice} title="سياسة الاسترجاع المطلوبة" />
              <Field label="اكتب التعديل المطلوب" htmlFor="change-message" required><Textarea id="change-message" name="message" rows={2} required minLength={3} /></Field>
              <SubmitButton variant="secondary">إرسال طلب التعديل</SubmitButton>
            </ActionForm>
          </details>
        </section>
      )}
      {isSeller && deal.status === 'OFFER_PENDING_BUYER' && <Alert tone="info">تم إرسال عرضك. بانتظار مراجعة المشتري.</Alert>}
      {isBuyer && deal.status === 'SELLER_JOINED' && <Alert tone="info">انضم البائع للصفقة ويجهز عرضه (الشحن وسياسة الاسترجاع).</Alert>}
      {isBuyer && deal.status === 'CHANGE_REQUESTED' && <Alert tone="info">تم إرسال طلب التعديل. بانتظار رد البائع.</Alert>}

      {/* ── Seller: answer a change request ── */}
      {isSeller && deal.status === 'CHANGE_REQUESTED' && open && openTerms && (
        <section className="card space-y-4 border-amber-200 p-5" data-testid="change-request">
          <h2 className="text-lg font-bold">المشتري طلب تعديل (نسخة {open.version})</h2>
          {open.message && <p className="rounded-lg bg-amber-50 p-2 text-sm">{open.message}</p>}
          <div><p className="text-sm font-semibold">سياسة الاسترجاع المطلوبة</p><ReturnPolicyView policy={openTerms.returnPolicy} mandatoryNotice={openTerms.mandatoryRightsNotice} /></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ActionForm action={sellerChangeResponseAction} className="sm:flex-1">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="version" value={open.version} />
              <input type="hidden" name="decision" value="ACCEPT" />
              <SubmitButton variant="success" size="lg" className="w-full">قبول التعديل</SubmitButton>
            </ActionForm>
            <ActionForm action={sellerChangeResponseAction} className="sm:flex-1">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="version" value={open.version} />
              <input type="hidden" name="decision" value="REJECT" />
              <SubmitButton variant="outline" size="lg" className="w-full">رفض التعديل (عرضي السابق قائم)</SubmitButton>
            </ActionForm>
          </div>
          <details className="rounded-xl border border-line p-4">
            <summary className="cursor-pointer text-sm font-semibold">عرض مقابل</summary>
            <ActionForm action={sellerOfferAction} className="mt-3 space-y-3">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="first" value="0" />
              <OfferFields condition={deal.condition} defaults={(lastSeller?.terms as Terms | undefined) ?? openTerms} />
              <ReturnPolicyFields defaults={openTerms.returnPolicy} mandatoryNotice={mandatoryNotice} />
              <Field label="رسالة للمشتري" htmlFor="counter-message"><Textarea id="counter-message" name="message" rows={2} maxLength={1000} /></Field>
              <Checkbox name="acceptTerms" required label="أؤكد صحة العرض وأوافق على شروط الصفقات المحمية" />
              <SubmitButton>إرسال العرض المقابل</SubmitButton>
            </ActionForm>
          </details>
        </section>
      )}

      {/* ── Agreed snapshot (immutable) ── */}
      {agreed && (
        <section className="card space-y-3 p-5" data-testid="agreed-terms">
          <h2 className="font-bold">الشروط المتفق عليها (نسخة {deal.agreedVersion}) <span className="text-xs font-normal text-muted">· {formatDate(deal.agreedAt, true)}</span></h2>
          <TermsTable t={agreed} />
        </section>
      )}

      {isBuyer && deal.status === 'PAYMENT_PENDING' && !payment && (
        <ActionForm action={startDealPaymentAction} className="card space-y-3 p-5">
          <input type="hidden" name="dealId" value={deal.id} />
          <h2 className="font-bold">اختر طريقة الدفع</h2>
          {methods.map((m, i) => <Radio key={m.code} name="method" value={m.code} defaultChecked={i === 0} label={m.nameAr} />)}
          <SubmitButton>متابعة</SubmitButton>
        </ActionForm>
      )}

      {isBuyer && payment && (payment.status === 'AWAITING_PAYMENT' || payment.status === 'REJECTED') && (
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
      {deal.status === 'ACTIVE' && isBuyer && (
        <Alert tone="success" title="الصفقة نشطة">
          تم تأكيد استلام اضمن للدفع. لن يُتاح مستحق البائع إلا بعد تأكيدك الاستلام أو انتهاء مدة الفحص المتفق عليها.
          {!dispute && <span className="mt-2 block"><Link href={`/account/disputes/new?deal=${deal.id}&reason=NOT_RECEIVED`} className="underline">لم أستلم حتى الآن</Link></span>}
        </Alert>
      )}

      {isSeller && deal.status === 'ACTIVE' && (
        <ActionForm action={dealDeliveredAction} className="card space-y-3 p-5" encType="multipart/form-data">
          <input type="hidden" name="dealId" value={deal.id} />
          <Alert tone="success">تم تأكيد دفع المشتري لدى اضمن. سلّم المنتج حسب الاتفاق ثم سجّل التسليم.</Alert>
          <Field label="تفاصيل التسليم" htmlFor="note"><Textarea id="note" name="note" rows={2} placeholder="تم الشحن عبر… رقم البوليصة…" /></Field>
          <FileInput name="proof" multiple label="إثبات التسليم (بوليصة / صورة)" accept="image/jpeg,image/png,image/webp,application/pdf" />
          <SubmitButton>تسجيل التسليم</SubmitButton>
        </ActionForm>
      )}

      {/* ── Buyer: delivery outcome (the return policy never blocks a problem report) ── */}
      {isBuyer && (deal.status === 'DELIVERED' || deal.status === 'BUYER_CONFIRMATION_PENDING') && !dispute && (
        <section className="card space-y-3 border-emerald-200 bg-emerald-50 p-5" data-testid="delivery-choice">
          <p className="text-sm">أعلن البائع التسليم في {formatDate(deal.deliveredAt, true)}. {deal.deliveryNote}</p>
          <p className="text-sm font-semibold">افحص المنتج خلال {deal.inspectionDays} يوم. عند التأكيد سيتم صرف المبلغ للبائع.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ActionForm action={dealConfirmAction} className="sm:flex-1">
              <input type="hidden" name="dealId" value={deal.id} />
              <SubmitButton variant="success" size="lg" className="w-full">استلمت والمنتج مطابق</SubmitButton>
            </ActionForm>
            <LinkButton href={`/account/disputes/new?deal=${deal.id}`} variant="outline" size="lg" className="sm:flex-1"><Scale className="size-4" aria-hidden /> استلمت ولكن توجد مشكلة</LinkButton>
            <LinkButton href={`/account/disputes/new?deal=${deal.id}&reason=NOT_RECEIVED`} variant="ghost" size="lg" className="sm:flex-1">لم أستلم</LinkButton>
          </div>
        </section>
      )}
      {['ACTIVE', 'DELIVERED', 'BUYER_CONFIRMATION_PENDING'].includes(deal.status) && !dispute && isSeller && (
        <LinkButton href={`/account/disputes/new?deal=${deal.id}`} variant="ghost" size="sm"><Scale className="size-4" aria-hidden /> الإبلاغ عن مشكلة</LinkButton>
      )}
      {dispute && <LinkButton href={`/account/disputes/${dispute.id}`} variant="secondary">متابعة النزاع #{dispute.number}</LinkButton>}
      {deal.status === 'COMPLETED' && <Alert tone="success" title="اكتملت الصفقة">{isSeller ? `سيتم تحويل مستحقك ${formatEGP(g.payout?.amount ?? deal.sellerReceives)} إلى ${deal.sellerPayoutMasked}. الحالة: ${g.payout?.status === 'PAID' ? 'تم التحويل' : 'قيد التحويل'}` : 'شكراً لاستخدامك اضمن.'}</Alert>}

      {versions.length > 0 && (
        <details className="card p-4" data-testid="terms-history">
          <summary className="cursor-pointer text-sm font-semibold">سجل نسخ الشروط ({versions.length})</summary>
          <ol className="mt-3 space-y-2 text-sm">
            {versions.map((v) => {
              const t = v.terms as Terms;
              return (
                <li key={v.id} className="rounded-lg border border-line p-2">
                  <span className="font-semibold">نسخة {v.version}</span> · {v.proposedBy === 'SELLER' ? 'عرض البائع' : 'طلب تعديل من المشتري'} · {VERSION_STATUS[v.status] ?? v.status} · {formatDate(v.createdAt, true)}
                  <div className="text-xs text-muted">الإجمالي {formatEGP(t.price.buyerPays)} · <ReturnPolicyView policy={t.returnPolicy} compact /></div>
                  {v.message && <p className="text-xs">{v.message}</p>}
                </li>
              );
            })}
          </ol>
        </details>
      )}

      {isBuyer && BUYER_CANCELLABLE.includes(deal.status) && (
        <form action={async (fd) => { 'use server'; await cancelDealAction({}, fd); }} className="flex items-end gap-2">
          <input type="hidden" name="dealId" value={deal.id} />
          <input type="hidden" name="reason" value="ألغى المشتري الصفقة قبل الدفع" />
          <ConfirmSubmit confirm="إلغاء الصفقة؟" variant="outline" size="sm">إلغاء الصفقة</ConfirmSubmit>
        </form>
      )}
      {NEGOTIATION.includes(deal.status) && <p className="text-xs text-muted">لا يتم أي دفع قبل موافقة الطرفين على نفس نسخة الشروط.</p>}
      <p className="text-xs text-muted"><Link href="/legal/protected-deal-terms" className="underline">شروط الصفقات المحمية</Link></p>
    </div>
  );
}

const VERSION_STATUS: Record<string, string> = { PROPOSED: 'بانتظار الرد', ACCEPTED: 'تم الاتفاق', REJECTED: 'مرفوضة', SUPERSEDED: 'استُبدلت' };

function TermsTable({ t }: { t: Terms }) {
  return (
    <DefinitionList items={[
      { label: 'السعر', value: formatEGP(t.price.goodsTotal) },
      { label: 'تكلفة الشحن', value: t.price.shippingFee ? formatEGP(t.price.shippingFee) : 'مجاناً / مشمول' },
      { label: 'طريقة الشحن', value: t.delivery.method ?? '—' },
      { label: 'مدة التجهيز', value: `${t.delivery.processingDays} يوم` },
      { label: 'موعد التسليم المتوقع', value: t.delivery.deadline ? `قبل ${formatDate(new Date(t.delivery.deadline))}` : '—' },
      { label: 'حالة المنتج', value: <span>{t.product.condition === 'NEW' ? 'جديد' : 'مستعمل'}{t.disclosure.defects ? ` · العيوب: ${t.disclosure.defects}` : ''}{t.disclosure.accessories ? ` · الملحقات: ${t.disclosure.accessories}` : ''}{t.disclosure.warranty ? ` · الضمان: ${t.disclosure.warranty}` : ''}</span> },
      { label: 'سياسة الاسترجاع', value: <ReturnPolicyView policy={t.returnPolicy} mandatoryNotice={t.mandatoryRightsNotice} /> },
      { label: 'الشروط الخاصة', value: t.customTerms ?? 'لا يوجد' },
      { label: `رسوم الخدمة (${t.price.feePayer === 'BUYER' ? 'على المشتري' : 'على البائع'})`, value: formatEGP(t.price.feeAmount) },
      { label: 'الإجمالي المطلوب من المشتري', value: <strong>{formatEGP(t.price.buyerPays)}</strong> },
      { label: 'صافي البائع', value: formatEGP(t.price.sellerReceives) },
    ]} />
  );
}

function OfferFields({ condition, defaults }: { condition: string | null; defaults?: Terms }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-line p-4">
      <legend className="px-1 text-sm font-bold">تفاصيل العرض</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="تكلفة الشحن (ج.م)" htmlFor="shippingFee" hint="0 لو الشحن مجاني أو تسليم يد بيد"><Input id="shippingFee" name="shippingFee" inputMode="decimal" dir="ltr" defaultValue={defaults ? toInputAmount(defaults.price.shippingFee) : '0'} /></Field>
        <Field label="مدة التجهيز (أيام)" htmlFor="processingDays" required><Input id="processingDays" name="processingDays" type="number" min={0} max={30} defaultValue={defaults?.delivery.processingDays ?? 1} required /></Field>
      </div>
      <Field label={condition === 'USED' ? 'العيوب المعروفة (مطلوب للمستعمل)' : 'العيوب المعروفة'} htmlFor="defects" required={condition === 'USED'}><Textarea id="defects" name="defects" rows={2} defaultValue={defaults?.disclosure.defects ?? ''} required={condition === 'USED'} placeholder='اكتب "لا يوجد" لو مفيش' /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الملحقات المرفقة" htmlFor="accessories"><Input id="accessories" name="accessories" defaultValue={defaults?.disclosure.accessories ?? ''} /></Field>
        <Field label="الضمان" htmlFor="warranty"><Input id="warranty" name="warranty" defaultValue={defaults?.disclosure.warranty ?? ''} placeholder="بدون / ضمان وكيل حتى…" /></Field>
      </div>
    </fieldset>
  );
}

function PayoutFields({ holder }: { holder: string }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-line p-4">
      <legend className="px-1 text-sm font-bold">وسيلة استلام مستحقاتك</legend>
      <Field label="الوسيلة" htmlFor="payoutType"><Select id="payoutType" name="payoutType" defaultValue="INSTAPAY"><option value="INSTAPAY">إنستاباي</option><option value="MOBILE_WALLET">محفظة موبايل</option><option value="BANK_ACCOUNT">حساب بنكي</option></Select></Field>
      <Field label="اسم صاحب الحساب" htmlFor="holderName" required><Input id="holderName" name="holderName" defaultValue={holder} required /></Field>
      <Field label="عنوان إنستاباي (لإنستاباي)" htmlFor="instapayAddress"><Input id="instapayAddress" name="instapayAddress" dir="ltr" /></Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="مزود المحفظة" htmlFor="walletProvider"><Input id="walletProvider" name="walletProvider" placeholder="فودافون كاش" /></Field>
        <Field label="رقم المحفظة" htmlFor="walletNumber"><Input id="walletNumber" name="walletNumber" dir="ltr" /></Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="البنك" htmlFor="bankName"><Input id="bankName" name="bankName" /></Field>
        <Field label="رقم الحساب" htmlFor="accountNumber"><Input id="accountNumber" name="accountNumber" dir="ltr" /></Field>
        <Field label="IBAN" htmlFor="iban"><Input id="iban" name="iban" dir="ltr" /></Field>
      </div>
    </fieldset>
  );
}

function LocationCard({ title, loc, gov }: { title: string; loc: StoredLocation; gov: string }) {
  const line = [gov, loc.city, loc.street, loc.building && `عمارة ${loc.building}`, loc.floor && `دور ${loc.floor}`, loc.apartment && `شقة ${loc.apartment}`].filter(Boolean).join('، ');
  return (
    <div className="space-y-1 text-sm">
      <p className="font-semibold">{title}</p>
      <p>{line}</p>
      {loc.landmark && <p className="text-muted">علامة مميزة: {loc.landmark}</p>}
      {loc.notes && <p className="text-muted">{loc.notes}</p>}
      {loc.gps && <p className="text-xs text-muted ltr" data-testid="gps-coords">GPS {loc.gps.lat}, {loc.gps.lng}{loc.gps.accuracy ? ` (±${loc.gps.accuracy}m)` : ''}</p>}
    </div>
  );
}
