import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { claimInviteAction, rejectInviteAction } from '@/app/_actions/deals';
import { invitationByToken } from '@/server/modules/deals/service';
import { currentUser } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { LinkButton } from '@/ui/button';
import { DefinitionList } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { Field, Textarea } from '@/ui/form';

export const metadata: Metadata = { title: 'دعوة لصفقة محمية', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Seller-facing invitation. Opening it shows a SAFE summary only (no buyer name, phone, address or
 * coordinates) and changes nothing financial. "Accept and continue" binds the link to the signed-in
 * account (once); the seller then enters their own details and offer on the deal page.
 */
export default async function DealInvitePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const user = await currentUser();
  const inv = await invitationByToken(token, user?.id);
  if (!inv) {
    return <div className="container-page py-10"><Alert tone="danger" title="رابط غير صالح">تأكد من الرابط أو اطلب من المشتري إرسال رابط جديد.</Alert></div>;
  }
  const s = inv.summary;
  const here = `/deal/invite/${token}`;
  return (
    <div className="container-page max-w-2xl space-y-4 py-6">
      <div className="rounded-2xl bg-gradient-to-l from-accent-600 to-brand-900 p-5 text-white">
        <p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-5" aria-hidden /> طلب صفقة محمية عبر اضمن</p>
        <h1 className="mt-2 text-xl font-bold sm:text-2xl">مشترٍ يريد شراء «{s.title}» منك</h1>
        <p className="mt-1 text-sm text-white/85">رقم الصفقة: <span className="ltr">{s.ref}</span>. المشتري يدفع لاضمن أولاً، وبعد التسليم وتأكيد المشتري يتم تحويل مستحقك إليك.</p>
      </div>

      {inv.isBuyer && <Alert tone="info">هذا رابط الدعوة الخاص بصفقتك كمشترٍ. شاركه مع البائع.</Alert>}
      {inv.boundToViewer && <Alert tone="success" title="أنت مرتبط بهذه الصفقة"><LinkButton href={`/account/deals/${inv.dealId}`} size="sm">متابعة الصفقة</LinkButton></Alert>}
      {!inv.isBuyer && inv.boundToOther && <Alert tone="danger">هذه الدعوة مرتبطة بحساب آخر ولا يمكن استخدامها.</Alert>}
      {!inv.usable && !inv.boundToViewer && !inv.boundToOther && !inv.isBuyer && (
        <Alert tone="warning">{inv.expired ? 'انتهت صلاحية هذه الدعوة. اطلب من المشتري رابطاً جديداً.' : 'هذه الدعوة لم تعد متاحة.'}</Alert>
      )}

      <section className="card p-5">
        <DefinitionList items={[
          { label: 'المنتج', value: `${s.title} × ${s.quantity}` },
          { label: 'الحالة', value: s.condition === 'NEW' ? 'جديد' : 'مستعمل' },
          { label: 'السعر المطلوب', value: formatEGP(s.totalAmount) },
          { label: 'رسوم الخدمة', value: `${formatEGP(s.feeAmount)} (${s.feePayer === 'SELLER' ? 'تُخصم من مستحقك' : 'يتحملها المشتري'})` },
          { label: 'صافي ما ستستلمه (قبل الشحن)', value: formatEGP(s.sellerReceives) },
          { label: 'طريقة التسليم المتوقعة', value: s.deliveryMethod ?? '—' },
          { label: 'آخر موعد للتسليم', value: formatDate(s.deliveryDeadline) },
          { label: 'محافظة المشتري', value: s.destinationGovernorate ?? '—' },
          { label: 'مدة فحص المشتري', value: `${s.inspectionDays} يوم` },
          { label: 'شروط خاصة', value: s.customTerms ?? 'لا يوجد' },
        ]} />
        <p className="mt-3 whitespace-pre-line text-sm text-muted">{s.description}</p>
        <p className="mt-3 text-xs text-muted">بعد القبول هتضيف بياناتك (الاسم، موبايل مؤكد، عنوان الاستلام، وسيلة استلام المستحقات) وتحدد تكلفة الشحن وسياسة الاسترجاع، والمشتري هيراجع عرضك قبل أي دفع.</p>
      </section>

      {inv.usable && !inv.isBuyer && !inv.boundToViewer && (
        user ? (
          <div className="space-y-3">
            <ActionForm action={claimInviteAction}>
              <input type="hidden" name="token" value={token} />
              <SubmitButton variant="success" size="lg" className="w-full">قبول ومتابعة</SubmitButton>
            </ActionForm>
            <details className="card p-4">
              <summary className="cursor-pointer text-sm font-semibold">رفض</summary>
              <ActionForm action={rejectInviteAction} className="mt-3 space-y-3">
                <input type="hidden" name="token" value={token} />
                <Field label="سبب الرفض" htmlFor="reason" required><Textarea id="reason" name="reason" rows={3} required minLength={3} /></Field>
                <SubmitButton variant="outline">تأكيد الرفض</SubmitButton>
              </ActionForm>
            </details>
          </div>
        ) : (
          <div className="card space-y-3 p-5">
            <p className="text-sm">للمتابعة سجّل الدخول أو أنشئ حساباً مجانياً — مش لازم تكون بائع في المتجر.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <LinkButton href={`/register?next=${encodeURIComponent(here)}`} variant="success" size="lg">قبول ومتابعة (حساب جديد)</LinkButton>
              <LinkButton href={`/login?next=${encodeURIComponent(here)}`} variant="outline" size="lg">لدي حساب — تسجيل الدخول</LinkButton>
              <LinkButton href={`/login?next=${encodeURIComponent(here)}`} variant="ghost" size="lg">رفض</LinkButton>
            </div>
          </div>
        )
      )}
      <p className="text-xs text-muted"><Link href="/legal/protected-deal-terms" className="underline">شروط الصفقات المحمية</Link></p>
    </div>
  );
}
