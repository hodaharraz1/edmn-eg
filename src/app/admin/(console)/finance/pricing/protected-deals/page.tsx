import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { PricingModelView } from '../_view';

export const metadata = { title: 'تسعير الضمانة' };

export default async function DealPricing(props: PageProps<'/admin/finance/pricing/protected-deals'>) {
  const { actor, allowed } = await adminWith('pricing.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  return <PricingModelView actor={actor} model="PROTECTED_DEAL" selected={typeof sp.v === 'string' ? sp.v : undefined} />;
}
