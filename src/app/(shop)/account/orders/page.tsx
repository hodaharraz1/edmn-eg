import Link from '@/ui/link';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { CircleCheck, Clock, Package, ShieldCheck, Store, type LucideIcon } from 'lucide-react';
import { db } from '@/server/db/client';
import { orders, sellerOrders, stores } from '@/server/db/schema';
import { requireUser } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { LinkButton } from '@/ui/button';
import { PageHeader, Pagination } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'طلباتي' };

/** Where the money is, per real order status (src/domain/machines.ts orderMachine). */
const ORDER_STATE: Partial<Record<string, { text: string; icon: LucideIcon; tone: string }>> = {
  PENDING_PAYMENT: { text: 'في انتظار الدفع لحساب اضمن', icon: Clock, tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  PAYMENT_UNDER_REVIEW: { text: 'بنراجع تحويلك — هنبلّغك أول ما يتأكد', icon: Clock, tone: 'border-sky-200 bg-sky-50 text-sky-900' },
  PAID: { text: 'المبلغ محفوظ لدى اضمن لحد الاستلام والتأكيد', icon: ShieldCheck, tone: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  COMPLETED: { text: 'الطلب اكتمل', icon: CircleCheck, tone: 'border-line bg-soft/50 text-ink' },
};

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
      <PageHeader title="طلباتي" description="تابع كل طلب: حالته، ومين بيشحنه، والمبلغ فين." />
      {list.length === 0 ? (
        <EmptyState icon={Package} title="لسه مفيش طلبات" description="طلباتك من المتاجر هتظهر هنا." action={<LinkButton href="/">ابدأ التسوق</LinkButton>} />
      ) : (
        <div className="space-y-3">
          {list.map((o) => {
            const state = ORDER_STATE[o.status];
            return (
              <article key={o.id} className="card relative overflow-hidden transition-shadow hover:shadow-[var(--shadow-pop)]">
                <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0">
                    <Link href={`/account/orders/${o.id}`} className="text-base font-bold text-brand-950 after:absolute after:inset-0 hover:text-brand-700">
                      طلب #{o.number}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">{formatDate(o.placedAt, true)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-brand-950">{formatEGP(o.grandTotal)}</span>
                    <StatusChip status={o.status} />
                  </div>
                </div>
                <ul className="divide-y divide-line border-t border-line">
                  {subs.filter((x) => x.so.orderId === o.id).map((x) => (
                    <li key={x.so.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Store className="size-3.5" aria-hidden /></span>
                        <span className="truncate font-medium">{x.store}</span>
                        <span className="text-xs text-muted ltr">{o.number}-{x.so.suffix}</span>
                      </span>
                      <StatusChip status={x.so.status} kind="sellerOrder" receiptBasis={x.so.receiptBasis} />
                    </li>
                  ))}
                </ul>
                {state && (
                  <div className={`relative z-10 flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs sm:px-5 ${state.tone}`}>
                    <span className="flex items-center gap-1.5 font-semibold">
                      <state.icon className="size-4" aria-hidden /> {state.text}
                    </span>
                    {o.status === 'PENDING_PAYMENT' && (
                      <Link href={`/account/orders/${o.id}/pay`} className="inline-flex min-h-10 items-center rounded-xl bg-brand-600 px-4 font-bold text-white hover:bg-brand-700">
                        ادفع دلوقتي
                      </Link>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          <Pagination page={page} pages={Math.ceil(n / 10)} hrefFor={(p) => `/account/orders?page=${p}`} />
        </div>
      )}
    </div>
  );
}
