import type { Metadata } from 'next';
import { ConversationList, InboxFilters } from '@/app/_components/conversation';
import { InboxAutoRefresh } from '@/app/_components/live/live-provider';
import { PushOptIn } from '@/app/_components/live/push-optin';
import { listForUser, type InboxFilter } from '@/server/modules/messaging/service';
import { vapidPublicKey } from '@/server/modules/notifications/push';
import { requireCustomer } from '@/server/web/session';
import { Breadcrumbs, PageHeader } from '@/ui/data';

export const metadata: Metadata = { title: 'الرسائل', robots: { index: false } };

const FILTERS: InboxFilter[] = ['all', 'unread', 'orders', 'deals'];

/** Central buyer inbox: every authorized order/deal conversation, newest activity first. */
export default async function AccountMessagesPage(props: PageProps<'/account/messages'>) {
  const actor = await requireCustomer('/account/messages');
  const sp = await props.searchParams;
  const f = (FILTERS.includes(String(sp.f) as InboxFilter) ? String(sp.f) : 'all') as InboxFilter;
  const q = String(sp.q ?? '').slice(0, 60);
  const items = await listForUser(actor, { filter: f, q });
  const filtered = f !== 'all' || !!q;
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'حسابي', href: '/account' }, { label: 'الرسائل' }]} />}
        title="الرسائل"
        description="تواصلك مع البائعين على طلباتك، ومع الطرف التاني في صفقاتك المحمية."
        className="mb-2"
      />
      <InboxAutoRefresh />
      <PushOptIn vapidKey={vapidPublicKey()} variant="banner" />
      <InboxFilters basePath="/account/messages" active={f} q={q} withDeals />
      <ConversationList
        items={items}
        basePath="/account/messages"
        emptyTitle={filtered ? 'مفيش محادثات مطابقة' : 'مفيش رسائل لسه'}
        emptyText={filtered ? 'جرّب فلتر تاني أو امسح البحث.' : 'لما تتواصل مع بائع بخصوص طلب أو صفقة هتظهر المحادثة هنا. التواصل بيتفتح من صفحة الطلب بعد ما الدفع يتأكد، أو من صفحة الصفقة المحمية.'}
      />
    </div>
  );
}
