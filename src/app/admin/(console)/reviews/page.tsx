import { desc, eq, inArray } from 'drizzle-orm';
import { Star } from 'lucide-react';
import { reviewModerationAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { productReviews, products, reviewReports, sellerReviews, stores, users } from '@/server/db/schema';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Stars } from '@/ui/commerce';
import { PageHeader, Tabs } from '@/ui/data';
import { Badge, EmptyState, StatusChip } from '@/ui/feedback';
import { Input, Select } from '@/ui/form';

export const metadata = { title: 'إدارة التقييمات' };

type Row = { id: string; type: 'PRODUCT' | 'SELLER'; rating: number; body: string | null; title: string | null; status: string; subject: string; author: string; createdAt: Date; reports: string[]; sellerResponse: string | null };

export default async function AdminReviews(props: PageProps<'/admin/reviews'>) {
  const { allowed } = await adminWith('reviews.moderate');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'reported');
  const reports = await db.select().from(reviewReports).where(eq(reviewReports.status, 'OPEN'));
  const reportedIds = [...new Set(reports.map((r) => r.reviewId))];
  const pWhere = tab === 'reported' ? (reportedIds.length ? inArray(productReviews.id, reportedIds) : inArray(productReviews.id, ['00000000-0000-0000-0000-000000000000'])) : tab === 'hidden' ? inArray(productReviews.status, ['HIDDEN', 'REMOVED']) : undefined;
  const sWhere = tab === 'reported' ? (reportedIds.length ? inArray(sellerReviews.id, reportedIds) : inArray(sellerReviews.id, ['00000000-0000-0000-0000-000000000000'])) : tab === 'hidden' ? inArray(sellerReviews.status, ['HIDDEN', 'REMOVED']) : undefined;
  const pr = await db.select({ r: productReviews, subject: products.titleAr, author: users.fullName }).from(productReviews).innerJoin(products, eq(products.id, productReviews.productId)).innerJoin(users, eq(users.id, productReviews.customerId)).where(pWhere).orderBy(desc(productReviews.createdAt)).limit(100);
  const sr = await db.select({ r: sellerReviews, subject: stores.name, author: users.fullName }).from(sellerReviews).innerJoin(stores, eq(stores.sellerId, sellerReviews.sellerId)).innerJoin(users, eq(users.id, sellerReviews.customerId)).where(sWhere).orderBy(desc(sellerReviews.createdAt)).limit(100);
  const rows: Row[] = [
    ...pr.map(({ r, subject, author }) => ({ id: r.id, type: 'PRODUCT' as const, rating: r.rating, body: r.body, title: r.title, status: r.status, subject, author, createdAt: r.createdAt, sellerResponse: r.sellerResponse, reports: reports.filter((x) => x.reviewId === r.id).map((x) => x.reason) })),
    ...sr.map(({ r, subject, author }) => ({ id: r.id, type: 'SELLER' as const, rating: r.rating, body: r.body, title: null, status: r.status, subject, author, createdAt: r.createdAt, sellerResponse: r.sellerResponse, reports: reports.filter((x) => x.reviewId === r.id).map((x) => x.reason) })),
  ].sort((a, b) => +b.createdAt - +a.createdAt);
  return (
    <div>
      <PageHeader title="إدارة التقييمات" description="التقييمات تُقبل فقط من مشترين أكدوا الاستلام. الإخفاء أو الحذف يتطلب سبباً ويُسجّل." />
      <Tabs active={tab} tabs={[{ key: 'reported', label: 'مبلّغ عنها', href: '/admin/reviews', count: reportedIds.length }, { key: 'all', label: 'الأحدث', href: '/admin/reviews?tab=all' }, { key: 'hidden', label: 'مخفية/محذوفة', href: '/admin/reviews?tab=hidden' }]} />
      {rows.length === 0 ? <EmptyState icon={Star} title="لا توجد تقييمات هنا" /> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm"><Badge tone="neutral">{r.type === 'PRODUCT' ? 'منتج' : 'بائع'}</Badge><b>{r.subject}</b> · {r.author} · {formatDate(r.createdAt)}</span>
                <span className="flex items-center gap-2"><Stars value={r.rating} /><StatusChip status={r.status} /></span>
              </div>
              {r.title && <p className="font-semibold">{r.title}</p>}
              <p className="text-sm">{r.body ?? '—'}</p>
              {r.sellerResponse && <p className="rounded bg-page p-2 text-xs">رد البائع: {r.sellerResponse}</p>}
              {r.reports.length > 0 && <p className="text-xs text-danger-700">بلاغات: {r.reports.join(' · ')}</p>}
              <ActionForm action={reviewModerationAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="type" value={r.type} /><input type="hidden" name="reviewId" value={r.id} />
                <Select name="status" className="w-auto" aria-label="الإجراء" defaultValue={r.status === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED'}><option value="PUBLISHED">نشر / إبقاء</option><option value="HIDDEN">إخفاء</option><option value="REMOVED">حذف</option></Select>
                <Input name="reason" required minLength={3} placeholder="السبب" className="w-64" aria-label="السبب" />
                <SubmitButton size="sm" variant="outline">تطبيق</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
