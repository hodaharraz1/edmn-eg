import { desc, eq } from 'drizzle-orm';
import { Star } from 'lucide-react';
import { respondReviewAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { productReviews, products, sellerReviews, users } from '@/server/db/schema';
import { reviewerDisplayName } from '@/server/modules/reviews/service';
import { requireSellerActor } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Stars } from '@/ui/commerce';
import { PageHeader, Tabs } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';
import { Textarea } from '@/ui/form';

export const metadata = { title: 'التقييمات' };

export default async function SellerReviewsPage(props: PageProps<'/seller/reviews'>) {
  const actor = await requireSellerActor('/seller/reviews');
  const tab = (await props.searchParams).tab === 'seller' ? 'seller' : 'product';
  const list =
    tab === 'product'
      ? (await db.select({ r: productReviews, author: users.fullName, title: products.titleAr }).from(productReviews).innerJoin(products, eq(products.id, productReviews.productId)).innerJoin(users, eq(users.id, productReviews.customerId)).where(eq(products.sellerId, actor.sellerId!)).orderBy(desc(productReviews.createdAt)).limit(100)).map((x) => ({ ...x, type: 'PRODUCT' as const }))
      : (await db.select({ r: sellerReviews, author: users.fullName }).from(sellerReviews).innerJoin(users, eq(users.id, sellerReviews.customerId)).where(eq(sellerReviews.sellerId, actor.sellerId!)).orderBy(desc(sellerReviews.createdAt)).limit(100)).map((x) => ({ ...x, title: 'تقييم المتجر', type: 'SELLER' as const }));
  return (
    <div>
      <PageHeader title="التقييمات" description="لا يمكن حذف التقييمات، لكن يمكنك الرد عليها بشكل مهني." />
      <Tabs active={tab} tabs={[{ key: 'product', label: 'تقييمات المنتجات', href: '/seller/reviews' }, { key: 'seller', label: 'تقييمات المتجر', href: '/seller/reviews?tab=seller' }]} />
      {list.length === 0 ? <EmptyState icon={Star} title="لا توجد تقييمات بعد" /> : (
        <div className="space-y-3">
          {list.map(({ r, author, title, type }) => (
            <article key={r.id} className="card space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{title}</span><StatusChip status={r.status} /></div>
              <p className="flex items-center gap-2"><Stars value={r.rating} showValue={false} /> <span className="text-xs text-muted">{reviewerDisplayName(author)} · {formatDate(r.createdAt)}</span></p>
              {r.body && <p>{r.body}</p>}
              {r.sellerResponse ? <p className="rounded-lg bg-page p-2 text-xs"><b>ردك:</b> {r.sellerResponse}</p> : (
                <ActionForm action={respondReviewAction} className="space-y-2">
                  <input type="hidden" name="reviewId" value={r.id} /><input type="hidden" name="type" value={type} />
                  <Textarea name="response" rows={2} placeholder="اكتب ردك…" aria-label="الرد" required />
                  <SubmitButton size="sm" variant="outline">نشر الرد</SubmitButton>
                </ActionForm>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
