import Link from 'next/link';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { Package } from 'lucide-react';
import { db } from '@/server/db/client';
import { orders, sellerOrders, stores } from '@/server/db/schema';
import { requireUser } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { LinkButton } from '@/ui/button';
import { PageHeader, Pagination } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'طلباتي' };

export default async function OrdersPage(props: PageProps<'/account/orders'>) {
  const user = await requireUser('/account');
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [list, [{ n }]] = await Promise.all([
    db.select().from(orders).where(eq(orders.customerId, user.id)).orderBy(desc(orders.placedAt)).limit(10).offset((page - 1) * 10),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.customerId, user.id)),
  ]);
  const subs = list.length
    ? await db.select({ so: sellerOrders, store: stores.name }).from(sellerOrders).innerJoin(stores, eq(stores.sellerId, sellerOrders.sellerId)).where(inArray(sellerOrders.orderId, list.map((o) => o.id)))
    : [];
  return (
    <div>
      <PageHeader title="طلباتي" />
      {list.length === 0 ? (
        <EmptyState icon={Package} title="لسه مفيش طلبات" description="طلباتك من المتاجر هتظهر هنا." action={<LinkButton href="/">ابدأ التسوق</LinkButton>} />
      ) : (
        <div className="space-y-3">
          {list.map((o) => (
            <Link key={o.id} href={`/account/orders/${o.id}`} className="card block p-4 transition-shadow hover:shadow-[var(--shadow-pop)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold">طلب #{o.number}</p>
                  <p className="text-xs text-muted">{formatDate(o.placedAt, true)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{formatEGP(o.grandTotal)}</span>
                  <StatusChip status={o.status} />
                </div>
              </div>
              <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                {subs.filter((s) => s.so.orderId === o.id).map((s) => (
                  <li key={s.so.id} className="flex items-center gap-1.5 rounded-full bg-page px-2.5 py-1">
                    {o.number}-{s.so.suffix} · {s.store} · <StatusChip status={s.so.status} />
                  </li>
                ))}
              </ul>
            </Link>
          ))}
          <Pagination page={page} pages={Math.ceil(n / 10)} hrefFor={(p) => `/account/orders?page=${p}`} />
        </div>
      )}
    </div>
  );
}
