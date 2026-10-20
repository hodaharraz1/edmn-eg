import { NotificationCenter } from '@/app/_components/notification-center';
import { requireUser } from '@/server/web/session';

export const metadata = { title: 'الإشعارات' };

export default async function NotificationsPage(props: PageProps<'/account/notifications'>) {
  const user = await requireUser('/account/notifications');
  const f = String((await props.searchParams).f ?? 'all');
  return <NotificationCenter userId={user.id} base="/account/notifications" filter={f} crumbs={[{ label: 'حسابي', href: '/account' }, { label: 'الإشعارات' }]} />;
}
