import { NotificationCenter } from '@/app/_components/notification-center';
import { requireSellerActor, requireUser } from '@/server/web/session';

export const metadata = { title: 'الإشعارات' };

export default async function SellerNotificationsPage(props: PageProps<'/seller/notifications'>) {
  await requireSellerActor('/seller/notifications');
  const user = await requireUser('/seller/notifications');
  const f = String((await props.searchParams).f ?? 'all');
  return <NotificationCenter userId={user.id} base="/seller/notifications" filter={f} crumbs={[{ label: 'مركز البائع', href: '/seller' }, { label: 'الإشعارات' }]} />;
}
