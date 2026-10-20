import type { Metadata } from 'next';
import { Listing, type SP } from '@/app/_components/listing';
import { Breadcrumbs, PageHeader } from '@/ui/data';

export async function generateMetadata(props: PageProps<'/search'>): Promise<Metadata> {
  const sp = await props.searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  return { title: q ? `نتائج البحث عن "${q}"` : 'تسوّق كل المنتجات', robots: { index: false, follow: true } };
}

export default async function SearchPage(props: PageProps<'/search'>) {
  const sp = (await props.searchParams) as SP;
  const q = typeof sp.q === 'string' ? sp.q : '';
  return (
    <div className="container-page py-6">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'الرئيسية', href: '/' }, { label: 'البحث' }]} />}
        title={q ? `نتائج البحث عن «${q}»` : sp.condition === 'USED' ? 'منتجات مستعملة بحالة موثّقة' : 'كل المنتجات'}
      />
      <Listing path="/search" sp={sp} />
    </div>
  );
}
