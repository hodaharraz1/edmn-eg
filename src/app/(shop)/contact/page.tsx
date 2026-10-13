import type { Metadata } from 'next';
import { Clock, LifeBuoy, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import Link from '@/ui/link';
import { getAllSettings } from '@/server/modules/settings';
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
  const rows = [
    s['marketplace.supportEmail'] && { icon: Mail, label: 'البريد الإلكتروني', value: <a href={`mailto:${s['marketplace.supportEmail']}`} className="ltr text-brand-700 underline">{s['marketplace.supportEmail']}</a> },
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
