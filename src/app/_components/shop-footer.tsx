import { ShieldCheck } from 'lucide-react';
import Link from '@/ui/link';
import { activeBlocks, LEGAL_CODES } from '@/server/modules/cms/service';
import { getAllSettings } from '@/server/modules/settings';
import { Logo } from '@/ui/logo';

export async function ShopFooter() {
  const footer = (await activeBlocks('HOME')).find((b) => b.type === 'FOOTER');
  const data = (footer?.data ?? {}) as { about?: string; links?: { label: string; href: string }[] };
  // Customer-facing policies (seller agreement and fees are in the sellers column; everything is on /legal).
  const legal = (['TERMS_OF_USE', 'PRIVACY_POLICY', 'BUYER_TERMS', 'RETURNS_POLICY', 'SHIPPING_POLICY', 'EXTERNAL_DEAL_TERMS', 'DISPUTE_POLICY', 'PROHIBITED_PRODUCTS', 'COOKIE_POLICY'] as const).map((c) => LEGAL_CODES[c]);
  const s = await getAllSettings();
  const company = [s['company.legalName'], s['company.commercialRegistration'] && `سجل تجاري ${s['company.commercialRegistration']}`, s['company.taxId'] && `رقم ضريبي ${s['company.taxId']}`, s['company.address']].filter(Boolean).join(' · ');
  return (
    <footer className="mt-16 bg-brand-950 pb-24 text-white/85 lg:pb-0">
      {/* Light brand band so the transparent official logo keeps its contrast. */}
      <div className="border-t border-line bg-white">
        <div className="container-page flex items-center justify-center py-5 sm:justify-start">
          <Logo variant="sidebar" />
        </div>
      </div>
      <div className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-white/70">
            {data.about || 'اضمن سوق مصري للمنتجات الجديدة والمستعملة من بائعين تمت مراجعتهم. بتدفع لاضمن، ومستحقات البائع مش بتتاح له غير بعد الاستلام وموافقة الإدارة. وتقدر كمان تعمل صفقة محمية لأي حاجة بتشتريها من برّه السوق.'}
          </p>
          <p className="flex items-center gap-2 text-xs text-emerald-300">
            <ShieldCheck className="size-4" /> البائع ما بياخدش فلوسه قبل ما الطلب يتسلّم، وتأكد الاستلام أو تعدّي مهلة الاعتراض، وتوافق الإدارة
          </p>
        </div>
        <div>
          <h2 className="mb-3 font-semibold text-white">تسوّق</h2>
          <ul className="space-y-2 text-sm">
            <li><Link href="/categories" className="hover:text-white">كل التصنيفات</Link></li>
            <li><Link href="/deals" className="hover:text-white">العروض</Link></li>
            <li><Link href="/best-sellers" className="hover:text-white">الأكثر مبيعاً</Link></li>
            <li><Link href="/stores" className="hover:text-white">المتاجر</Link></li>
            <li><Link href="/protected-deal" className="hover:text-white">اضمن صفقة خارج السوق</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="mb-3 font-semibold text-white">للبائعين</h2>
          <ul className="space-y-2 text-sm">
            <li><Link href="/sell" className="hover:text-white">بيع على اضمن</Link></li>
            <li><Link href="/seller" className="hover:text-white">مركز البائع</Link></li>
            <li><Link href="/legal/seller-agreement" className="hover:text-white">اتفاقية البائع</Link></li>
            <li><Link href="/legal/fees" className="hover:text-white">الرسوم والعمولات</Link></li>
            {(data.links ?? []).map((l) => (
              <li key={l.href}><Link href={l.href} className="hover:text-white">{l.label}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-3 font-semibold text-white">السياسات والمساعدة</h2>
          <ul className="grid grid-cols-1 gap-2 text-sm">
            <li><Link href="/contact" className="hover:text-white">تواصل معانا</Link></li>
            {legal.map((l) => (
              <li key={l.slug}><Link href={`/legal/${l.slug}`} className="hover:text-white">{l.title}</Link></li>
            ))}
            <li><Link href="/legal" className="hover:text-white">كل السياسات</Link></li>
          </ul>
        </div>
      </div>
      <div className="space-y-1 border-t border-white/10 px-4 py-4 text-center text-xs text-white/50">
        {company && <p data-testid="company-details">{company}</p>}
        {s['company.socialLinks'].length > 0 && (
          <p className="flex flex-wrap justify-center gap-3">{s['company.socialLinks'].map((l) => <a key={l.href} href={l.href} rel="noopener noreferrer" target="_blank" className="hover:text-white">{l.label}</a>)}</p>
        )}
        <p>© {new Date().getFullYear()} اضمن. جميع الحقوق محفوظة.</p>
      </div>
    </footer>
  );
}
