import type { Metadata } from 'next';
import { ConversationList, InboxFilters } from '@/app/_components/conversation';
import { InboxAutoRefresh } from '@/app/_components/live/live-provider';
import { PushOptIn } from '@/app/_components/live/push-optin';
import { listForSeller, type InboxFilter } from '@/server/modules/messaging/service';
import { vapidPublicKey } from '@/server/modules/notifications/push';
import { requireSellerActor } from '@/server/web/session';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';

export const metadata: Metadata = { title: 'الرسائل' };

/** Central seller inbox: every buyer conversation of the store, newest activity first. */
export default async function SellerMessagesPage(props: PageProps<'/seller/messages'>) {
  const actor = await requireSellerActor('/seller/messages');
  if (!actor.sellerPermissions?.has('orders.communicate')) {
    return <Alert tone="warning" title="مش متاح لحسابك">صلاحيتك في المتجر مش بتشمل التواصل مع المشترين. اطلبها من صاحب المتجر.</Alert>;
  }
  const sp = await props.searchParams;
  const f = (String(sp.f) === 'unread' ? 'unread' : 'all') as InboxFilter;
  const q = String(sp.q ?? '').slice(0, 60);
  const items = await listForSeller(actor, { filter: f, q });
  const filtered = f !== 'all' || !!q;
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'مركز البائع', href: '/seller' }, { label: 'الرسائل' }]} />}
        title="الرسائل"
        description="تواصل المشترين معاك على طلبات متجرك. كل محادثة مرتبطة بطلب واحد."
        className="mb-2"
      />
      <InboxAutoRefresh />
      <PushOptIn vapidKey={vapidPublicKey()} variant="banner" />
      <InboxFilters basePath="/seller/messages" active={f} q={q} withDeals={false} />
      <ConversationList
        items={items}
        basePath="/seller/messages"
        emptyTitle={filtered ? 'مفيش محادثات مطابقة' : 'مفيش رسائل لسه'}
        emptyText={filtered ? 'جرّب فلتر تاني أو امسح البحث.' : 'لما مشتري يبعتلك على طلب مدفوع هتلاقي المحادثة هنا. وتقدر تبدأ من صفحة الطلب: «تواصل مع المشتري».'}
      />
    </div>
  );
}
