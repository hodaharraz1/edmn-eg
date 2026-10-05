import Link from 'next/link';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Boxes } from 'lucide-react';
import { setStockAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { productVariants, products } from '@/server/db/schema';
import { requireSellerActor } from '@/server/web/session';
import { formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader, Tabs } from '@/ui/data';
import { Badge, EmptyState } from '@/ui/feedback';

export const metadata = { title: 'المخزون' };

export default async function InventoryPage(props: PageProps<'/seller/inventory'>) {
  const actor = await requireSellerActor('/seller/inventory');
  const sp = await props.searchParams;
  const tab = typeof sp.tab === 'string' ? sp.tab : 'all';
  const cond = [eq(products.sellerId, actor.sellerId!), inArray(products.status, ['LIVE', 'APPROVED', 'DRAFT', 'REJECTED', 'SUBMITTED', 'UNDER_REVIEW'])];
  if (tab === 'low') cond.push(sql`${productVariants.stockOnHand} - ${productVariants.reserved} > 0 and ${productVariants.stockOnHand} - ${productVariants.reserved} <= ${productVariants.lowStockThreshold}`);
  if (tab === 'out') cond.push(sql`${productVariants.stockOnHand} - ${productVariants.reserved} <= 0`);
  const rows = await db.select({ v: productVariants, p: { id: products.id, titleAr: products.titleAr, status: products.status } }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(and(...cond)).orderBy(asc(products.titleAr)).limit(300);
  return (
    <div>
      <PageHeader title="المخزون" description="المتاح = الكمية الفعلية − المحجوز لطلبات لم تُدفع بعد." />
      <Tabs active={tab} tabs={[{ key: 'all', label: 'الكل', href: '/seller/inventory' }, { key: 'low', label: 'مخزون منخفض', href: '/seller/inventory?tab=low' }, { key: 'out', label: 'نفدت الكمية', href: '/seller/inventory?tab=out' }]} />
      {rows.length === 0 ? <EmptyState icon={Boxes} title="لا توجد منتجات هنا" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line bg-page/60 text-xs text-muted"><tr><th className="px-4 py-3 text-start">المنتج</th><th className="px-4 py-3 text-start">SKU</th><th className="px-4 py-3 text-start">السعر</th><th className="px-4 py-3 text-start">محجوز</th><th className="px-4 py-3 text-start">متاح</th><th className="px-4 py-3 text-start">تحديث الكمية</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ v, p }) => {
                const avail = v.stockOnHand - v.reserved;
                return (
                  <tr key={v.id}>
                    <td className="px-4 py-3"><Link href={`/seller/products/${p.id}?step=variants`} className="hover:text-brand-700">{p.titleAr}</Link>{v.label && <span className="block text-xs text-muted">{v.label}</span>}{!v.isActive && <Badge>غير مفعّل</Badge>}</td>
                    <td className="px-4 py-3 ltr text-xs">{v.sku}</td>
                    <td className="px-4 py-3">{formatEGP(v.price)}</td>
                    <td className="px-4 py-3">{v.reserved}</td>
                    <td className="px-4 py-3"><span className={avail <= 0 ? 'font-bold text-red-600' : avail <= v.lowStockThreshold ? 'font-bold text-amber-600' : ''}>{avail}</span></td>
                    <td className="px-4 py-3">
                      <ActionForm action={setStockAction} className="flex items-center gap-2">
                        <input type="hidden" name="variantId" value={v.id} />
                        <input name="stockOnHand" type="number" min={v.reserved} defaultValue={v.stockOnHand} className="h-8 w-20 rounded border border-line px-2" aria-label="الكمية الفعلية" />
                        <input name="lowStockThreshold" type="number" min={0} defaultValue={v.lowStockThreshold} className="h-8 w-14 rounded border border-line px-2" aria-label="حد التنبيه" title="حد التنبيه" />
                        <SubmitButton size="sm" variant="outline">حفظ</SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
