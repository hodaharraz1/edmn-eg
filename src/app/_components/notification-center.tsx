import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { Bell, MessageSquareText, Settings } from 'lucide-react';
import Link from 'next/link';
import { markNotificationReadAction } from '@/app/_actions/notifications';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';
import { db } from '@/server/db/client';
import { notifications } from '@/server/db/schema';
import { Button } from '@/ui/button';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { EmptyState } from '@/ui/feedback';

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
        description="تحديثات طلباتك وصفقاتك ورسايلك. عدّاد الجرس للتحديثات، وعدّاد «الرسائل» للرسائل غير المقروءة."
        className="mb-2"
        actions={
          <>
            <Link href={`${base}/settings`} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm ring-1 ring-line hover:bg-page" data-testid="notification-settings-link">
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
      <nav aria-label="تصفية الإشعارات" className="flex gap-1.5">
        {tabs.map((t) => (
          <Link key={t.key} href={t.key === 'all' ? base : `${base}?f=${t.key}`} aria-current={t.key === f ? 'page' : undefined} className={cn('rounded-full px-3 py-1.5 text-sm ring-1', t.key === f ? 'bg-brand-700 font-semibold text-white ring-brand-700' : 'bg-white ring-line hover:bg-page')}>
            {t.label}
          </Link>
        ))}
      </nav>
      {list.length === 0 ? (
        <EmptyState icon={Bell} title={f === 'all' ? 'مفيش إشعارات' : 'مفيش إشعارات هنا'} description="أي تحديث على طلباتك أو صفقاتك أو رسالة جديدة هيظهر هنا." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white ring-1 ring-line" data-testid="notification-list">
          {list.map((n) => {
            const isMsg = n.category === 'MESSAGE' || n.event.startsWith('MESSAGE_');
            const Icon = isMsg ? MessageSquareText : Bell;
            const body = (
              <>
                <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', isMsg ? 'bg-brand-50 text-brand-700' : 'bg-page text-muted')} aria-hidden>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm', n.readAt ? 'font-medium' : 'font-bold')} dir="auto">
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
                {!n.readAt && <span className="mt-1 size-2.5 shrink-0 rounded-full bg-accent-600" aria-hidden />}
              </>
            );
            return (
              <li key={n.id} data-testid="notification-item" data-read={n.readAt ? '1' : '0'} className={cn(!n.readAt && 'bg-brand-50/50')}>
                {n.link ? (
                  <Link href={`${base}/open/${n.id}`} prefetch={false} className="flex items-start gap-3 p-4 hover:bg-page">
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
  if (!link || !link.startsWith('/') || link.startsWith('//') || link.includes('\\') || /[\r\n]/.test(link)) return fallback;
  return link;
}
