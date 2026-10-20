import Link from '@/ui/link';
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
    <div className="space-y-4">
      <PageHeader title="المخزون" description="المتاح = الكمية الفعلية − المحجوز لطلبات لم تُدفع بعد." />
      <Tabs active={tab} tabs={[{ key: 'all', label: 'الكل', href: '/seller/inventory' }, { key: 'low', label: 'مخزون منخفض', href: '/seller/inventory?tab=low' }, { key: 'out', label: 'نفدت الكمية', href: '/seller/inventory?tab=out' }]} />
      {rows.length === 0 ? <EmptyState icon={Boxes} title="لا توجد منتجات هنا" /> : (
        <ul className="space-y-2.5 lg:space-y-0 lg:overflow-hidden lg:rounded-2xl lg:bg-white lg:shadow-[var(--shadow-card)] lg:ring-1 lg:ring-line" data-testid="inventory-list">
          <li aria-hidden className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2.6fr)] gap-4 border-b border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted lg:grid">
            <span>المنتج</span><span>السعر</span><span>محجوز / متاح</span><span>تحديث الكمية</span>
          </li>
          {rows.map(({ v, p }) => {
            const avail = v.stockOnHand - v.reserved;
            const tone = avail <= 0 ? 'bg-red-50 text-red-700 ring-red-200' : avail <= v.lowStockThreshold ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-emerald-50 text-emerald-800 ring-emerald-200';
            return (
              <li key={v.id} className="card grid gap-3 p-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2.6fr)] lg:items-center lg:gap-4 lg:rounded-none lg:border-0 lg:border-b lg:shadow-none lg:last:border-b-0">
                <div className="min-w-0">
                  <Link href={`/seller/products/${p.id}?step=variants`} className="font-bold text-brand-950 hover:text-brand-700">{p.titleAr}</Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {v.label && <span>{v.label}</span>}
                    <span dir="ltr">{v.sku}</span>
                    {!v.isActive && <Badge>غير مفعّل</Badge>}
                  </p>
                </div>
                <p className="flex items-center justify-between text-sm lg:block"><span className="text-xs text-muted lg:hidden">السعر</span><span className="font-semibold">{formatEGP(v.price)}</span></p>
                <p className="flex items-center justify-between gap-2 text-sm lg:justify-start">
                  <span className="text-xs text-muted lg:hidden">محجوز / متاح</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-muted">{v.reserved} محجوز</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${tone}`}>{avail} متاح</span>
                  </span>
                </p>
                <ActionForm action={setStockAction} className="flex flex-wrap items-end gap-2 border-t border-line pt-3 lg:border-0 lg:pt-0">
                  <input type="hidden" name="variantId" value={v.id} />
                  <label className="grid flex-1 gap-1 text-xs font-semibold text-muted">
                    الكمية الفعلية
                    <input name="stockOnHand" type="number" min={v.reserved} defaultValue={v.stockOnHand} className="h-11 w-full min-w-20 rounded-xl border border-line px-3 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" aria-label="الكمية الفعلية" />
                  </label>
                  <label className="grid flex-1 gap-1 text-xs font-semibold text-muted">
                    حد التنبيه
                    <input name="lowStockThreshold" type="number" min={0} defaultValue={v.lowStockThreshold} className="h-11 w-full min-w-16 rounded-xl border border-line px-3 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" aria-label="حد التنبيه" title="حد التنبيه" />
                  </label>
                  <SubmitButton size="md" variant="outline">حفظ</SubmitButton>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
