import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { acceptInviteAction, rejectInviteAction } from '@/app/_actions/deals';
import { invitationByToken } from '@/server/modules/deals/service';
import { currentUser } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { LinkButton } from '@/ui/button';
import { DefinitionList } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';

export const metadata: Metadata = { title: 'دعوة لصفقة محمية', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function DealInvitePage(props: PageProps<'/deal-invite/[token]'>) {
  const { token } = await props.params;
  const inv = await invitationByToken(token);
  if (!inv) {
    return <div className="container-page py-10"><Alert tone="danger" title="رابط غير صالح">تأكد من الرابط أو اطلب من المشتري إرسال دعوة جديدة.</Alert></div>;
  }
  const user = await currentUser();
  const { deal } = inv;
  return (
    <div className="container-page max-w-3xl space-y-5 py-8">
      <div className="rounded-2xl bg-gradient-to-l from-accent-600 to-brand-900 p-6 text-white">
        <p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-5" /> دعوة لصفقة محمية عبر اضمن</p>
        <h1 className="mt-2 text-2xl font-bold">{inv.buyerName} يريد شراء «{deal.title}» منك</h1>
        <p className="mt-1 text-sm text-white/85">سيدفع المشتري المبلغ لاضمن أولاً، وبعد التسليم وتأكيد المشتري يتم تحويل مستحقك إليك.</p>
      </div>
      {!inv.usable && <Alert tone="warning">{inv.expired ? 'انتهت صلاحية هذه الدعوة.' : 'تم الرد على هذه الدعوة بالفعل.'}</Alert>}
      <section className="card p-5">
        <DefinitionList items={[
          { label: 'المنتج', value: `${deal.title} × ${deal.quantity}` },
          { label: 'السعر المتفق عليه', value: formatEGP(deal.totalAmount) },
          { label: 'رسوم الخدمة', value: `${formatEGP(deal.feeAmount)} (${deal.feePayer === 'SELLER' ? 'تُخصم من مستحقك' : 'يتحملها المشتري'})` },
          { label: 'صافي ما ستستلمه', value: formatEGP(deal.sellerReceives) },
          { label: 'طريقة التسليم', value: deal.deliveryMethod },
          { label: 'آخر موعد للتسليم', value: formatDate(deal.deliveryDeadline) },
          { label: 'مدة فحص المشتري', value: `${deal.inspectionDays} يوم` },
          { label: 'شروط خاصة', value: deal.customTerms ?? 'لا يوجد' },
        ]} />
        <p className="mt-3 whitespace-pre-line text-sm text-muted">{deal.description}</p>
      </section>
      {inv.usable && !user && (
        <div className="card space-y-3 p-5 text-center">
          <p className="text-sm">للموافقة على الصفقة واستلام مستحقاتك بأمان، سجّل الدخول أو أنشئ حساباً مجانياً.</p>
          <div className="flex justify-center gap-2">
            <LinkButton href={`/login?next=/deal-invite/${token}`}>تسجيل الدخول</LinkButton>
            <LinkButton href={`/register?next=/deal-invite/${token}`} variant="outline">إنشاء حساب</LinkButton>
          </div>
        </div>
      )}
      {inv.usable && user && user.id !== deal.buyerId && (
        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <ActionForm action={acceptInviteAction} className="card space-y-3 p-5">
            <input type="hidden" name="token" value={token} />
            <h2 className="font-bold">الموافقة وبيانات استلام المستحقات</h2>
            <Field label="وسيلة الاستلام" htmlFor="payoutType"><Select id="payoutType" name="payoutType" defaultValue="INSTAPAY"><option value="INSTAPAY">إنستاباي</option><option value="MOBILE_WALLET">محفظة موبايل</option><option value="BANK_ACCOUNT">حساب بنكي</option></Select></Field>
            <Field label="اسم صاحب الحساب" htmlFor="holderName" required><Input id="holderName" name="holderName" defaultValue={user.fullName} required /></Field>
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
            <Checkbox name="acceptTerms" required label={<>أوافق على <Link href="/legal/protected-deal-terms" target="_blank" className="text-brand-700 underline">شروط الصفقات المحمية</Link></>} />
            <SubmitButton variant="success" size="lg">موافق على الصفقة</SubmitButton>
          </ActionForm>
          <ActionForm action={rejectInviteAction} className="card space-y-3 p-5">
            <input type="hidden" name="token" value={token} />
            <h2 className="font-bold">رفض الصفقة</h2>
            <Field label="السبب" htmlFor="reason" required><Textarea id="reason" name="reason" rows={3} required minLength={3} /></Field>
            <SubmitButton variant="outline">رفض</SubmitButton>
          </ActionForm>
        </div>
      )}
      {user && user.id === deal.buyerId && <Alert tone="info">هذه دعوتك كمشترٍ. شارك الرابط مع البائع.</Alert>}
    </div>
  );
}
