import { NotificationSettings } from '@/app/_components/notification-settings';
import { requireSellerActor, requireUser } from '@/server/web/session';

export const metadata = { title: 'إعدادات الإشعارات' };

export default async function SellerNotificationSettings() {
  await requireSellerActor('/seller/notifications/settings');
  const user = await requireUser('/seller/notifications/settings');
  return <NotificationSettings userId={user.id} crumbs={[{ label: 'مركز البائع', href: '/seller' }, { label: 'الإشعارات', href: '/seller/notifications' }, { label: 'الإعدادات' }]} />;
}
