import { ShieldCheck } from 'lucide-react';
import Link from '@/ui/link';
import { activeBlocks, LEGAL_CODES } from '@/server/modules/cms/service';
import { getAllSettings } from '@/server/modules/settings';
import { LogoImage } from '@/ui/logo';

export async function ShopFooter() {
  const footer = (await activeBlocks('HOME')).find((b) => b.type === 'FOOTER');
  const data = (footer?.data ?? {}) as { about?: string; links?: { label: string; href: string }[] };
  // Customer-facing policies (seller agreement and fees are in the sellers column; everything is on /legal).
  const legal = (['TERMS_OF_USE', 'PRIVACY_POLICY', 'BUYER_TERMS', 'RETURNS_POLICY', 'SHIPPING_POLICY', 'EXTERNAL_DEAL_TERMS', 'DISPUTE_POLICY', 'PROHIBITED_PRODUCTS', 'COOKIE_POLICY'] as const).map((c) => LEGAL_CODES[c]);
  const s = await getAllSettings();
  const company = [s['company.legalName'], s['company.commercialRegistration'] && `سجل تجاري ${s['company.commercialRegistration']}`, s['company.taxId'] && `رقم ضريبي ${s['company.taxId']}`, s['company.address']].filter(Boolean).join(' · ');
  return (
    <footer className="mt-16 bg-brand-950 pb-24 text-white/80 lg:pb-0">
      <div className="container-page grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div className="space-y-4">
          {/* The transparent official logo needs a light surface: same white plate as the header. */}
          <Link href="/" aria-label="اضمن — الرئيسية" className="inline-grid h-12 place-items-center rounded-xl bg-white px-2 shadow-[0_6px_20px_-8px_rgb(59_130_246/0.7)]">
            <LogoImage variant="sidebar" />
          </Link>
          <p className="text-sm leading-7 text-white/70">
            {data.about || 'اضمن سوق مصري للمنتجات الجديدة والمستعملة من بائعين تمت مراجعتهم. بتدفع لاضمن، ومستحقات البائع مش بتتاح له غير بعد الاستلام وموافقة الإدارة. وتقدر كمان تعمل صفقة محمية لأي حاجة بتشتريها من برّه السوق.'}
          </p>
          <p className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs leading-6 text-emerald-200">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> البائع ما بياخدش فلوسه قبل ما الطلب يتسلّم، وتأكد الاستلام أو تعدّي مهلة الاعتراض، وتوافق الإدارة
          </p>
        </div>
        <div>
          <h2 className="mb-3 text-sm font-bold text-white">تسوّق</h2>
          <ul className="space-y-0.5 text-sm">
            <li><Link href="/categories" className="inline-flex min-h-10 items-center hover:text-white">كل التصنيفات</Link></li>
            <li><Link href="/deals" className="inline-flex min-h-10 items-center hover:text-white">العروض</Link></li>
            <li><Link href="/best-sellers" className="inline-flex min-h-10 items-center hover:text-white">الأكثر مبيعاً</Link></li>
            <li><Link href="/stores" className="inline-flex min-h-10 items-center hover:text-white">المتاجر</Link></li>
            <li><Link href="/used" className="inline-flex min-h-10 items-center hover:text-white">سوق المستعمل المضمون</Link></li>
            <li><Link href="/protected-deal" className="inline-flex min-h-10 items-center hover:text-white">اضمن صفقة خارج السوق</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-sm font-bold text-white">للبائعين</h2>
          <ul className="space-y-0.5 text-sm">
            <li><Link href="/sell" className="inline-flex min-h-10 items-center hover:text-white">بيع على اضمن</Link></li>
            <li><Link href="/seller" className="inline-flex min-h-10 items-center hover:text-white">مركز البائع</Link></li>
            <li><Link href="/legal/seller-agreement" className="inline-flex min-h-10 items-center hover:text-white">اتفاقية البائع</Link></li>
            <li><Link href="/legal/fees" className="inline-flex min-h-10 items-center hover:text-white">الرسوم والعمولات</Link></li>
            {(data.links ?? []).map((l) => (
              <li key={l.href}><Link href={l.href} className="inline-flex min-h-10 items-center hover:text-white">{l.label}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-sm font-bold text-white">السياسات والمساعدة</h2>
          <ul className="grid grid-cols-1 gap-0.5 text-sm">
            <li><Link href="/contact" className="inline-flex min-h-10 items-center hover:text-white">تواصل معانا</Link></li>
            {legal.map((l) => (
              <li key={l.slug}><Link href={`/legal/${l.slug}`} className="inline-flex min-h-10 items-center hover:text-white">{l.title}</Link></li>
            ))}
            <li><Link href="/legal" className="inline-flex min-h-10 items-center hover:text-white">كل السياسات</Link></li>
          </ul>
        </div>
      </div>
      <div className="space-y-1 border-t border-white/10 px-4 py-4 text-center text-xs text-white/50">
        {company && <p data-testid="company-details">{company}</p>}
        {s['company.socialLinks'].length > 0 && (
          <p className="flex flex-wrap justify-center gap-3">{s['company.socialLinks'].map((l) => <a key={l.href} href={l.href} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-10 items-center hover:text-white">{l.label}</a>)}</p>
        )}
        <p>© {new Date().getFullYear()} اضمن. جميع الحقوق محفوظة.</p>
      </div>
    </footer>
  );
}
