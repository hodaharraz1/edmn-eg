import { notFound, redirect } from 'next/navigation';
import { productForSellerEdit } from '@/server/modules/catalog/products';
import { isDomainError } from '@/server/core/errors';
import { reportForProduct } from '@/server/modules/used/reports';
import { requireSellerActor } from '@/server/web/session';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { ConditionEditor } from '@/app/_components/condition-editor';

export const metadata = { title: 'جواز المنتج — توثيق الحالة' };

export default async function SellerProductCondition(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const actor = await requireSellerActor(`/seller/products/${id}/condition`);
  try {
    await productForSellerEdit(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const b = await reportForProduct(id);
  if (!b) redirect(`/seller/products/${id}`);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'المنتجات', href: '/seller/products' }, { label: 'المنتج', href: `/seller/products/${id}` }, { label: 'جواز المنتج' }]} />}
        title="جواز المنتج — توثيق الحالة"
        description="البيانات دي بتظهر للمشتري في صفحة المنتج وبتتثبت وقت الشراء. رقم الجهاز بيتخزن متشفّر وبيظهر مخفي."
      />
      <ConditionEditor b={b} mode="product" back={`/seller/products/${id}/condition`} />
    </div>
  );
}
