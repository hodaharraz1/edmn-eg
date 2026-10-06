import type { Metadata } from 'next';
import { ConversationList } from '@/app/_components/conversation';
import { listForUser } from '@/server/modules/messaging/service';
import { requireCustomer } from '@/server/web/session';
import { PageHeader } from '@/ui/data';

export const metadata: Metadata = { title: 'الرسائل', robots: { index: false } };

export default async function AccountMessagesPage() {
  const actor = await requireCustomer('/account/messages');
  const items = await listForUser(actor);
  return (
    <div className="space-y-4">
      <PageHeader title="الرسائل" description="تواصلك مع البائعين على طلباتك، ومع الطرف التاني في صفقاتك المحمية." />
      <ConversationList items={items} basePath="/account/messages" emptyText="التواصل مع البائع بيتفتح من صفحة الطلب بعد ما الدفع يتأكد، أو من صفحة الصفقة المحمية." />
    </div>
  );
}
