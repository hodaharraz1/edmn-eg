import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { PricingModelView } from '../_view';

export const metadata = { title: 'تسعير السوق' };

export default async function MarketplacePricing(props: PageProps<'/admin/finance/pricing/marketplace'>) {
  const { actor, allowed } = await adminWith('pricing.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  return <PricingModelView actor={actor} model="MARKETPLACE" selected={typeof sp.v === 'string' ? sp.v : undefined} />;
}
