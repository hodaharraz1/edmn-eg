import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { Bell, Handshake, LifeBuoy, type LucideIcon, MessageSquareText, Package, Scale, Settings, ShieldCheck, Store, Wallet } from 'lucide-react';
import Link from '@/ui/link';
import { markNotificationReadAction } from '@/app/_actions/notifications';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';
import { db } from '@/server/db/client';
import { notifications } from '@/server/db/schema';
import { Button } from '@/ui/button';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { EmptyState } from '@/ui/feedback';

/**
 * Display group of an existing notification (from its stored category / event name — no new backend categories).
 * Only drives the icon and the small label; filtering and read state are unchanged.
 */
type Group = { label: string; icon: LucideIcon; tile: string };
const GROUPS: Record<string, Group> = {
  message: { label: 'رسالة', icon: MessageSquareText, tile: 'bg-brand-600 text-white' },
  deal: { label: 'صفقة محمية', icon: Handshake, tile: 'bg-brand-950 text-white' },
  order: { label: 'طلب', icon: Package, tile: 'bg-brand-50 text-brand-700' },
  money: { label: 'مدفوعات', icon: Wallet, tile: 'bg-emerald-50 text-emerald-700' },
  seller: { label: 'المتجر', icon: Store, tile: 'bg-sky-50 text-sky-700' },
  dispute: { label: 'نزاع', icon: Scale, tile: 'bg-amber-50 text-amber-700' },
  support: { label: 'الدعم', icon: LifeBuoy, tile: 'bg-soft text-brand-800' },
  security: { label: 'أمان الحساب', icon: ShieldCheck, tile: 'bg-red-50 text-red-700' },
  general: { label: 'تحديث', icon: Bell, tile: 'bg-soft text-muted' },
};
function groupOf(category: string, event: string): Group {
  if (category === 'MESSAGE' || event.startsWith('MESSAGE_')) return GROUPS.message;
  if (event.startsWith('EXTERNAL_DEAL_') || event.startsWith('DEAL_') || ['BUYER_RESPONSE_WINDOW_OPENED', 'BUYER_RECEIPT_CONFIRMED', 'TIMEOUT_ENTITLEMENT'].includes(event)) return GROUPS.deal;
  if (event.startsWith('DISPUTE_')) return GROUPS.dispute;
  if (event.startsWith('SUPPORT_')) return GROUPS.support;
  if (['ACCOUNT_SECURITY', 'IDENTITY_UPDATED', 'ACCOUNT_CLOSURE'].includes(event)) return GROUPS.security;
  if (/^(PAYMENT_|REFUND_|WITHDRAWAL_|FINANCE_)/.test(event) || ['SELLER_FUNDS_RELEASED', 'PAYOUT_METHOD_CHANGED', 'RECEIVING_DESTINATION_UPDATED'].includes(event)) return GROUPS.money;
  if (['SELLER_NEW_ORDER', 'SELLER_APPLICATION_SUBMITTED', 'REVIEW_RECEIVED', 'SELLER_DELIVERY_REPORT_DUE'].includes(event)) return GROUPS.seller;
  if (/^(ORDER_|SELLER_ORDER_|RETURN_)/.test(event) || ['DELIVERED', 'SHIPMENT_EXCEPTION', 'CANCELLATION_REQUESTED'].includes(event)) return GROUPS.order;
  return GROUPS.general;
}

const MESSAGE_EVENTS = sql`(${notifications.category} = 'MESSAGE' or ${notifications.event} in ('MESSAGE_FROM_SELLER','MESSAGE_FROM_BUYER'))`;

/**
 * Notification center (buyer account or Seller Center — same user identity). Opening an item marks only
 * that notification read; it never marks messages read and never changes anything financial.
 */
export async function NotificationCenter({ userId, base, filter, crumbs }: { userId: string; base: '/account/notifications' | '/seller/notifications'; filter: string; crumbs: { label: string; href?: string }[] }) {
  const f = ['unread', 'messages'].includes(filter) ? filter : 'all';
  const where =
    f === 'unread' ? and(eq(notifications.userId, userId), isNull(notifications.readAt)) : f === 'messages' ? and(eq(notifications.userId, userId), MESSAGE_EVENTS) : eq(notifications.userId, userId);
  const list = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(100);
  const [{ n: unread }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), or(eq(notifications.category, 'GENERAL'), eq(notifications.category, 'MESSAGE'))));
  const now = new Date();
  const tabs = [
    { key: 'all', label: 'الكل' },
    { key: 'unread', label: 'غير المقروءة' },
    { key: 'messages', label: 'الرسائل' },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={crumbs} />}
        title="الإشعارات"
        description="تحديثات طلباتك وصفقاتك ورسائلك. عدّاد الجرس للتحديثات، وعدّاد «الرسائل» للرسائل غير المقروءة."
        className="mb-2"
        actions={
          <>
            <Link href={`${base}/settings`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold ring-1 ring-line hover:bg-soft" data-testid="notification-settings-link">
              <Settings className="size-4" aria-hidden /> إعدادات الإشعارات
            </Link>
            {unread > 0 && (
              <form action={markNotificationReadAction}>
                <Button type="submit" variant="outline" size="sm">
                  علّم الكل كمقروء
                </Button>
              </form>
            )}
          </>
        }
      />
      <nav aria-label="تصفية الإشعارات" className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {tabs.map((t) => (
          <Link key={t.key} href={t.key === 'all' ? base : `${base}?f=${t.key}`} aria-current={t.key === f ? 'page' : undefined} className={cn('inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ring-1', t.key === f ? 'bg-brand-950 text-white ring-brand-950' : 'bg-white ring-line hover:bg-soft')}>
            {t.label}
            {t.key === 'unread' && unread > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-accent-600 px-1.5 text-[11px] font-bold text-white">{unread}</span>}
          </Link>
        ))}
      </nav>
      {list.length === 0 ? (
        <EmptyState icon={Bell} title={f === 'all' ? 'مفيش إشعارات' : 'مفيش إشعارات هنا'} description="أي تحديث على طلباتك أو صفقاتك أو رسالة جديدة هيظهر هنا." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-card)] ring-1 ring-line" data-testid="notification-list">
          {list.map((n) => {
            const g = groupOf(n.category, n.event);
            const Icon = g.icon;
            const body = (
              <>
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', g.tile, n.readAt && 'opacity-70')} aria-hidden>
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-muted">
                    {g.label}
                    {!n.readAt && <span className="rounded-full bg-brand-600 px-1.5 py-px text-[10px] text-white">جديد</span>}
                  </span>
                  <span className={cn('block text-sm', n.readAt ? 'font-medium text-ink/80' : 'font-bold text-brand-950')} dir="auto">
                    {n.title}
                    {!n.readAt && <span className="sr-only"> (غير مقروء)</span>}
                  </span>
                  <span className="block text-sm text-muted" dir="auto">
                    {n.body}
                  </span>
                  <time className="mt-1 block text-xs text-muted" dateTime={n.createdAt.toISOString()} title={formatDate(n.createdAt, true)}>
                    {formatRelative(n.createdAt, now)}
                  </time>
                </span>
              </>
            );
            return (
              <li key={n.id} data-testid="notification-item" data-read={n.readAt ? '1' : '0'} className={cn('border-s-4', n.readAt ? 'border-transparent' : 'border-brand-600 bg-brand-50/40')}>
                {n.link ? (
                  <Link href={`${base}/open/${n.id}`} prefetch={false} className="flex items-start gap-3 p-4 transition-colors hover:bg-soft/60">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 p-4">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Internal path only (no scheme, no protocol-relative URL) — notification links are never open redirects. */
export function safeInternalPath(link: string | null | undefined, fallback: string): string {
  if (!link || !link.startsWith('/') || link.startsWith('//') || link.includes('\\') || /[\u0000-\u001f\u007f]/.test(link)) return fallback;
  return link;
}
