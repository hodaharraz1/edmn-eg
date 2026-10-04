import { and, desc, eq, inArray } from 'drizzle-orm';
import { Star } from 'lucide-react';
import { productReviewAction, sellerReviewAction } from '@/app/_actions/account';
import { db } from '@/server/db/client';
import { orderItems, orders, productReviews, sellerOrders, sellerReviews, stores } from '@/server/db/schema';
import { requireUser } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Stars } from '@/ui/commerce';
import { PageHeader } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';
import { Field, Input, Select, Textarea } from '@/ui/form';

export const metadata = { title: 'تقييماتي' };

function RatingSelect({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <Field label={label} htmlFor={name} required={required}>
      <Select id={name} name={name} required={required} defaultValue={required ? '' : ''}>
        <option value="">{required ? 'اختر' : '—'}</option>
        {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)} ({n})</option>)}
      </Select>
    </Field>
  );
}

export default async function MyReviewsPage(props: PageProps<'/account/reviews'>) {
  const user = await requireUser('/account');
  const sp = await props.searchParams;
  const delivered = await db
    .select({ so: sellerOrders, number: orders.number, store: stores.name })
    .from(sellerOrders)
    .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
    .innerJoin(stores, eq(stores.sellerId, sellerOrders.sellerId))
    .where(and(eq(orders.customerId, user.id), inArray(sellerOrders.status, ['DELIVERED', 'COMPLETED'])))
    .orderBy(desc(sellerOrders.deliveredAt));
  const soIds = delivered.map((d) => d.so.id);
  const items = soIds.length ? await db.select().from(orderItems).where(inArray(orderItems.sellerOrderId, soIds)) : [];
  const myP = await db.select().from(productReviews).where(eq(productReviews.customerId, user.id)).orderBy(desc(productReviews.createdAt));
  const myS = await db.select().from(sellerReviews).where(eq(sellerReviews.customerId, user.id));
  const reviewedItems = new Set(myP.map((r) => r.orderItemId));
  const reviewedSo = new Set(myS.map((r) => r.sellerOrderId));
  const pendingItems = items.filter((i) => !reviewedItems.has(i.id));
  const pendingSo = delivered.filter((d) => !reviewedSo.has(d.so.id));
  const focusItem = typeof sp.item === 'string' ? sp.item : null;
  const focusSo = typeof sp.so === 'string' ? sp.so : null;
  return (
    <div className="space-y-6">
      <PageHeader title="تقييماتي" description="التقييم متاح فقط للمشتريات المؤكدة بعد الاستلام." />
      {pendingItems.length === 0 && pendingSo.length === 0 && myP.length === 0 && <EmptyState icon={Star} title="لا توجد مشتريات بانتظار التقييم" />}
      {pendingItems.map((it) => (
        <details key={it.id} open={focusItem === it.id} className="card p-4">
          <summary className="cursor-pointer font-semibold">قيّم المنتج: {it.titleSnapshot}</summary>
          <ActionForm action={productReviewAction} className="mt-3 grid gap-3 sm:grid-cols-2" encType="multipart/form-data">
            <input type="hidden" name="orderItemId" value={it.id} />
            <RatingSelect name="rating" label="تقييمك" required />
            <Field label="عنوان قصير" htmlFor={`t-${it.id}`}><Input id={`t-${it.id}`} name="title" /></Field>
            <Field label="رأيك في المنتج" htmlFor={`b-${it.id}`} className="sm:col-span-2"><Textarea id={`b-${it.id}`} name="body" rows={3} /></Field>
            <div className="sm:col-span-2 space-y-2"><input type="file" name="photos" multiple accept="image/jpeg,image/png,image/webp" className="text-xs" aria-label="صور" /><SubmitButton size="sm">نشر التقييم</SubmitButton></div>
          </ActionForm>
        </details>
      ))}
      {pendingSo.map(({ so, number, store }) => (
        <details key={so.id} open={focusSo === so.id} className="card p-4">
          <summary className="cursor-pointer font-semibold">قيّم البائع: {store} (طلب {number}-{so.suffix})</summary>
          <ActionForm action={sellerReviewAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="sellerOrderId" value={so.id} />
            <RatingSelect name="rating" label="التقييم العام" required />
            <RatingSelect name="deliveryRating" label="سرعة التوصيل" />
            <RatingSelect name="packagingRating" label="التغليف" />
            <RatingSelect name="accuracyRating" label="مطابقة الوصف" />
            <Field label="تعليقك" htmlFor={`s-${so.id}`} className="sm:col-span-2"><Textarea id={`s-${so.id}`} name="body" rows={2} /></Field>
            <div className="sm:col-span-2"><SubmitButton size="sm">نشر التقييم</SubmitButton></div>
          </ActionForm>
        </details>
      ))}
      {myP.length > 0 && (
        <section className="card divide-y divide-line">
          <h2 className="p-4 font-bold">تقييماتك المنشورة</h2>
          {myP.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
              <span><Stars value={r.rating} showValue={false} /> {r.title ?? r.body?.slice(0, 60)}</span>
              <span className="flex items-center gap-2 text-xs text-muted">{formatDate(r.createdAt)} <StatusChip status={r.status} /></span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
