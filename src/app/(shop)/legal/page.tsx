import Link from 'next/link';
import { LEGAL_CODES } from '@/server/modules/cms/service';
import { Breadcrumbs, PageHeader } from '@/ui/data';

export const metadata = { title: 'السياسات والشروط' };

export default function LegalIndex() {
  return (
    <div className="container-page py-6">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الرئيسية', href: '/' }, { label: 'السياسات' }]} />} title="السياسات والشروط" />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.values(LEGAL_CODES).map((l) => (
          <li key={l.slug}><Link href={`/legal/${l.slug}`} className="card block p-4 font-semibold hover:text-brand-700">{l.title}</Link></li>
        ))}
      </ul>
    </div>
  );
}
