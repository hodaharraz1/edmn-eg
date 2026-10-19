import type { Metadata } from 'next';
import { Clock, LifeBuoy, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import Link from '@/ui/link';
import { getAllSettings } from '@/server/modules/settings';
import { supportEmail } from '@/config/support';
import { KeyRound } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { LinkButton } from '@/ui/button';

export const metadata: Metadata = {
  title: 'تواصل معانا',
  description: 'طرق التواصل مع فريق اضمن: تذكرة دعم من حسابك، والبريد والتليفون المعتمدين.',
  alternates: { canonical: '/contact' },
};

/**
 * Public contact page. Shows ONLY the contact details the owner configured in settings (nothing invented);
 * the support ticket from the account is always available.
 */
export default async function ContactPage() {
  const s = await getAllSettings();
  const wa = s['marketplace.whatsapp'].replace(/[^\d]/g, '');
  const email = supportEmail(s['marketplace.supportEmail']);
  const rows = [
    { icon: Mail, label: 'البريد الإلكتروني', value: <a href={`mailto:${email}`} className="ltr text-brand-700 underline">{email}</a> },
    s['marketplace.supportPhone'] && { icon: Phone, label: 'التليفون', value: <a href={`tel:${s['marketplace.supportPhone']}`} className="ltr text-brand-700 underline">{s['marketplace.supportPhone']}</a> },
    wa && { icon: MessageCircle, label: 'واتساب', value: <a href={`https://wa.me/${wa}`} rel="noopener noreferrer" target="_blank" className="ltr text-brand-700 underline">{s['marketplace.whatsapp']}</a> },
    s['marketplace.businessHours'] && { icon: Clock, label: 'مواعيد العمل', value: s['marketplace.businessHours'] },
    s['company.address'] && { icon: MapPin, label: 'العنوان', value: s['company.address'] },
  ].filter(Boolean) as { icon: typeof Mail; label: string; value: React.ReactNode }[];
  return (
    <div className="container-page max-w-3xl space-y-5 py-6">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'تواصل معانا' }]} />} title="تواصل معانا" description="لو عندك سؤال أو مشكلة في طلب أو صفقة، أسرع طريق هو تذكرة دعم من حسابك — بتوصل للفريق المختص ومعاها رقم الطلب." />
      <section className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <LifeBuoy className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
          <div>
            <h2 className="font-bold">تذكرة دعم</h2>
            <p className="text-sm text-muted">من حسابك، ولو المشكلة في طلب افتحها من صفحة الطلب نفسه.</p>
          </div>
        </div>
        <LinkButton href="/account/support/new">افتح تذكرة</LinkButton>
      </section>
      {/* Visitors who cannot sign in (forgotten password, lost phone, locked account): no login needed here. */}
      <section id="cant-sign-in" className="card scroll-mt-40 space-y-3 p-5" data-testid="guest-support">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><KeyRound className="size-5" aria-hidden /></span>
          <div className="space-y-1">
            <h2 className="font-bold text-brand-950">مش قادر تدخل حسابك؟</h2>
            <p className="text-sm leading-6 text-muted">جرّب الأول استعادة كلمة المرور. لو لسه مش قادر تدخل، ابعتلنا على البريد من نفس البريد أو اكتب رقم الموبايل المسجّل على حسابك ووصف المشكلة.</p>
            <p className="text-xs leading-5 text-muted">متبعتش كلمة المرور أو أي رمز تحقق أو بيانات بطاقتك أبدًا — فريق اضمن عمره ما هيطلبها منك.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <LinkButton href="/forgot-password" variant="outline">استعادة كلمة المرور</LinkButton>
          <a href={`mailto:${email}?subject=${encodeURIComponent('مش قادر أدخل حسابي')}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700" data-testid="guest-support-email">
            <Mail className="size-4" aria-hidden /> راسل الدعم: <span dir="ltr">{email}</span>
          </a>
        </div>
      </section>
      {rows.length > 0 && (
        <section className="card divide-y divide-line" data-testid="contact-details">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start gap-3 p-4">
              <r.icon className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
              <div><p className="text-sm text-muted">{r.label}</p><div>{r.value}</div></div>
            </div>
          ))}
        </section>
      )}
      <p className="text-sm text-muted">اقرأ كمان <Link href="/legal" className="text-brand-700 underline">السياسات والشروط</Link>.</p>
    </div>
  );
}
