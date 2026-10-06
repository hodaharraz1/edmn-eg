import type { Metadata } from 'next';
import { ConversationList } from '@/app/_components/conversation';
import { listForSeller } from '@/server/modules/messaging/service';
import { requireSellerActor } from '@/server/web/session';
import { PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';

export const metadata: Metadata = { title: 'الرسائل' };

export default async function SellerMessagesPage() {
  const actor = await requireSellerActor('/seller/messages');
  if (!actor.sellerPermissions?.has('orders.communicate')) {
    return <Alert tone="warning" title="مش متاح لحسابك">صلاحيتك في المتجر مش بتشمل التواصل مع المشترين. اطلبها من صاحب المتجر.</Alert>;
  }
  const items = await listForSeller(actor);
  return (
    <div className="space-y-4">
      <PageHeader title="الرسائل" description="تواصل المشترين معاك على طلبات متجرك. كل محادثة مرتبطة بطلب واحد." />
      <ConversationList items={items} basePath="/seller/messages" emptyText="لما مشتري يبعتلك على طلب مدفوع هتلاقي المحادثة هنا. وتقدر تبدأ من صفحة الطلب: «تواصل مع المشتري»." />
    </div>
  );
}
