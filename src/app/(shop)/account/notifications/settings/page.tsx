import { NotificationSettings } from '@/app/_components/notification-settings';
import { requireUser } from '@/server/web/session';

export const metadata = { title: 'إعدادات الإشعارات' };

export default async function AccountNotificationSettings() {
  const user = await requireUser('/account/notifications/settings');
  return <NotificationSettings userId={user.id} crumbs={[{ label: 'حسابي', href: '/account' }, { label: 'الإشعارات', href: '/account/notifications' }, { label: 'الإعدادات' }]} />;
}
