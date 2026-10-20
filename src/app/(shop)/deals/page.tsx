import type { Metadata } from 'next';
import { Listing, type SP } from '@/app/_components/listing';
import { Breadcrumbs, PageHeader } from '@/ui/data';

export const metadata: Metadata = { title: 'العروض والخصومات', description: 'أفضل العروض والخصومات من بائعين موثّقين على اضمن.', alternates: { canonical: '/deals' } };

export default async function DealsPage(props: PageProps<'/deals'>) {
  const sp = (await props.searchParams) as SP;
  return (
    <div className="container-page py-6">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الرئيسية', href: '/' }, { label: 'العروض' }]} />} title="العروض" description="منتجات عليها خصم حقيقي عن سعرها قبل كده." />
      <Listing path="/deals" sp={sp} base={{ dealsOnly: true }} emptyHint="مفيش عروض دلوقتي. ارجع لنا قريب." />
    </div>
  );
}
