import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { Bell } from 'lucide-react';
import { markNotificationsReadAction } from '@/app/_actions/account';
import { db } from '@/server/db/client';
import { notifications } from '@/server/db/schema';
import { requireUser } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/data';
import { EmptyState } from '@/ui/feedback';

export const metadata = { title: 'الإشعارات' };

export default async function NotificationsPage() {
  const user = await requireUser('/account');
  const list = await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(100);
  return (
    <div>
      <PageHeader title="الإشعارات" actions={list.some((n) => !n.readAt) && <form action={markNotificationsReadAction}><Button type="submit" variant="outline" size="sm">علّم الكل كمقروء</Button></form>} />
      {list.length === 0 ? <EmptyState icon={Bell} title="مفيش إشعارات" /> : (
        <ul className="card divide-y divide-line">
          {list.map((n) => (
            <li key={n.id} className={`p-4 text-sm ${n.readAt ? '' : 'bg-brand-50/50'}`}>
              {n.link ? <Link href={n.link} className="font-semibold hover:text-brand-700">{n.title}</Link> : <p className="font-semibold">{n.title}</p>}
              <p className="text-muted">{n.body}</p>
              <p className="mt-1 text-xs text-muted">{formatDate(n.createdAt, true)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
