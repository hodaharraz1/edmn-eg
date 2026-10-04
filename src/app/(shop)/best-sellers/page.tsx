import type { Metadata } from 'next';
import { Listing, type SP } from '@/app/_components/listing';
import { Breadcrumbs, PageHeader } from '@/ui/data';

export const metadata: Metadata = { title: 'الأكثر مبيعاً', alternates: { canonical: '/best-sellers' } };

export default async function BestSellersPage(props: PageProps<'/best-sellers'>) {
  const sp = (await props.searchParams) as SP;
  return (
    <div className="container-page py-6">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الرئيسية', href: '/' }, { label: 'الأكثر مبيعاً' }]} />} title="الأكثر مبيعاً" description="المنتجات الأكثر طلباً من عملاء اضمن." />
      <Listing path="/best-sellers" sp={sp} base={{ sort: 'best_selling' }} />
    </div>
  );
}
