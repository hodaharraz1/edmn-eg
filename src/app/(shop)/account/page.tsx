import Link from '@/ui/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Clock, Package, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { db } from '@/server/db/client';
import { externalDeals, orders, payments, sellerOrders } from '@/server/db/schema';
import { requireUser } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { LinkButton } from '@/ui/button';
import { PageHeader, StatCard } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';
import { LogOut } from 'lucide-react';
import { logoutAction } from '@/app/_actions/shop';

export default async function AccountDashboard() {
  const user = await requireUser('/account');
  const [recent, awaitingPay, toConfirm, deals] = await Promise.all([
    db.select().from(orders).where(eq(orders.customerId, user.id)).orderBy(desc(orders.placedAt)).limit(5),
    db.select({ o: orders, p: payments }).from(orders).innerJoin(payments, eq(payments.orderId, orders.id)).where(and(eq(orders.customerId, user.id), inArray(payments.status, ['AWAITING_PAYMENT', 'REJECTED']), eq(orders.status, 'PENDING_PAYMENT'))),
    db.select({ so: sellerOrders, number: orders.number }).from(sellerOrders).innerJoin(orders, eq(orders.id, sellerOrders.orderId)).where(and(eq(orders.customerId, user.id), eq(sellerOrders.status, 'SHIPPED'))),
    db.select().from(externalDeals).where(eq(externalDeals.buyerId, user.id)).orderBy(desc(externalDeals.createdAt)).limit(3),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title={`أهلاً، ${user.fullName.split(' ')[0]}`} description="تابع طلباتك ومدفوعاتك وصفقاتك المحمية من مكان واحد." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="طلبات بانتظار الدفع" value={awaitingPay.length} icon={<Wallet className="size-5" />} tone={awaitingPay.length ? 'warning' : 'neutral'} href="/account/orders" />
        <StatCard label="شحنات بانتظار تأكيد الاستلام" value={toConfirm.length} icon={<Truck className="size-5" />} tone={toConfirm.length ? 'brand' : 'neutral'} href="/account/orders" />
        <StatCard label="الصفقات المحمية" value={deals.length} icon={<ShieldCheck className="size-5" />} href="/account/deals" />
      </div>
      {awaitingPay.map(({ o, p }) => (
        <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <span className="flex items-center gap-2"><Clock className="size-4 text-amber-700" /> الطلب #{o.number} بانتظار الدفع ({formatEGP(o.grandTotal)}) — آخر موعد {formatDate(p.dueAt, true)}</span>
          <LinkButton href={`/account/orders/${o.id}/pay`} size="sm">ادفع دلوقتي</LinkButton>
        </div>
      ))}
      {toConfirm.map(({ so, number }) => (
        <div key={so.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm">
          <span className="flex items-center gap-2"><Truck className="size-4 text-brand-700" /> الشحنة #{number}-{so.suffix} في الطريق ليك. أكّد الاستلام بعد ما تفحص المنتج.</span>
          <LinkButton href={`/account/orders/${so.orderId}`} size="sm" variant="secondary">شوف الطلب</LinkButton>
        </div>
      ))}
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">آخر طلباتك</h2>
          <Link href="/account/orders" className="text-sm text-brand-700 hover:underline">كل الطلبات</Link>
        </div>
        {recent.length ? (
          <ul className="divide-y divide-line">
            {recent.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${o.id}`} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-brand-700">
                  <span>#{o.number} · {formatDate(o.placedAt)}</span>
                  <span className="flex items-center gap-3"><span className="font-semibold">{formatEGP(o.grandTotal)}</span><StatusChip status={o.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Package} title="لسه مفيش طلبات" action={<LinkButton href="/">ابدأ التسوق</LinkButton>} />
        )}
      </section>
      <form action={logoutAction} className="lg:hidden">
        <button className="flex items-center gap-2 text-sm text-red-700"><LogOut className="size-4" /> تسجيل الخروج</button>
      </form>
    </div>
  );
}
