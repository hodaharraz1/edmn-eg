import type { Metadata } from 'next';
import Link from '@/ui/link';
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
    return <div className="container-page py-10"><Alert tone="danger" title="الرابط مش صالح">اتأكد من الرابط، أو اطلب من المشتري يبعتلك رابط جديد.</Alert></div>;
  }
  const s = inv.summary;
  const here = `/deal/invite/${token}`;
  return (
    <div className="container-page max-w-2xl space-y-4 py-6">
      <div className="rounded-2xl bg-gradient-to-l from-accent-600 to-brand-900 p-5 text-white">
        <p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-5" aria-hidden /> طلب صفقة محمية على اضمن</p>
        <h1 className="mt-2 text-xl font-bold sm:text-2xl">مشترٍ يريد شراء «{s.title}» منك</h1>
        <p className="mt-1 text-sm text-white/85">رقم الصفقة: <span className="ltr">{s.ref}</span>. المشتري بيدفع لاضمن الأول، وبعد التسليم وتأكيد المشتري بيتحوّل لك مستحقك.</p>
      </div>

      {inv.isBuyer && <Alert tone="info">ده رابط الدعوة بتاع صفقتك (انت المشتري). ابعته للبائع.</Alert>}
      {inv.boundToViewer && <Alert tone="success" title="انت مرتبط بالصفقة دي"><LinkButton href={`/account/deals/${inv.dealId}`} size="sm">افتح الصفقة</LinkButton></Alert>}
      {!inv.isBuyer && inv.boundToOther && <Alert tone="danger">الدعوة دي مرتبطة بحساب تاني، ومينفعش تستخدمها.</Alert>}
      {!inv.usable && !inv.boundToViewer && !inv.boundToOther && !inv.isBuyer && (
        <Alert tone="warning">{inv.expired ? 'الدعوة دي انتهت صلاحيتها. اطلب من المشتري رابط جديد.' : 'الدعوة دي مبقتش متاحة.'}</Alert>
      )}

      <section className="card p-5">
        <DefinitionList items={[
          { label: 'المنتج', value: `${s.title} × ${s.quantity}` },
          { label: 'الحالة', value: s.condition === 'NEW' ? 'جديد' : 'مستعمل' },
          { label: 'السعر اللي طلبه المشتري', value: formatEGP(s.totalAmount) },
          { label: 'رسوم الضمان عليك (تقديرية — النهائية تظهر في عرضك)', value: formatEGP((s.totalAmount ?? 0) - (s.sellerReceives ?? 0)) },
          { label: 'صافي اللي هتستلمه (قبل الشحن)', value: formatEGP(s.sellerReceives) },
          { label: 'طريقة التسليم المفضلة للمشتري', value: s.deliveryMethod ?? '—' },
          { label: 'المشتري يفضّل يستلم قبل', value: formatDate(s.deliveryDeadline) },
          { label: 'محافظة المشتري', value: s.destinationGovernorate ?? '—' },
          { label: 'مدة فحص المشتري', value: `${s.inspectionDays} يوم` },
          { label: 'شروط خاصة', value: s.customTerms ?? 'مفيش' },
        ]} />
        <p className="mt-3 whitespace-pre-line text-sm text-muted">{s.description}</p>
        <p className="mt-3 text-xs text-muted">بعد القبول هتضيف بياناتك (الاسم، موبايل مؤكد، عنوان استلام الشحنة منك، وسيلة استلام مستحقاتك)، وتحدد السعر النهائي ومصاريف وطريقة ومدة الشحن وسياسة الإرجاع. والمشتري هيراجع عرضك قبل أي دفع.</p>
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
            <p className="text-sm">عشان تكمّل، سجّل دخول أو اعمل حساب مجاني. مش لازم تكون بائع على اضمن.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <LinkButton href={`/register?next=${encodeURIComponent(here)}`} variant="success" size="lg">قبول ومتابعة (حساب جديد)</LinkButton>
              <LinkButton href={`/login?next=${encodeURIComponent(here)}`} variant="outline" size="lg">عندي حساب — سجّل دخول</LinkButton>
              <LinkButton href={`/login?next=${encodeURIComponent(here)}`} variant="ghost" size="lg">سجّل دخول لرفض الصفقة</LinkButton>
            </div>
          </div>
        )
      )}
      <p className="text-xs text-muted"><Link href="/legal/protected-deal-terms" className="underline">شروط الصفقات المحمية</Link></p>
    </div>
  );
}
