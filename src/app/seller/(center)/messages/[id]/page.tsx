import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConversationList, MessagesWorkspace, ParticipantConversation } from '@/app/_components/conversation';
import { isDomainError } from '@/server/core/errors';
import { listForSeller, participantThread } from '@/server/modules/messaging/service';
import { requireSellerActor } from '@/server/web/session';

export const metadata: Metadata = { title: 'الرسائل' };

export default async function SellerConversationPage(props: PageProps<'/seller/messages/[id]'>) {
  const { id } = await props.params;
  const actor = await requireSellerActor(`/seller/messages/${id}`);
  let t;
  try {
    t = await participantThread(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const items = actor.sellerPermissions?.has('orders.communicate') ? await listForSeller(actor, { filter: 'all', q: '' }) : [];
  return (
    <MessagesWorkspace hasActive list={<ConversationList compact items={items} basePath="/seller/messages" activeId={t.conv.id} emptyText="" />}>
      <ParticipantConversation
        conversationId={t.conv.id}
        context={t.conv.context}
        ctx={t.context}
        side={t.side}
        surface="seller"
        messages={t.messages}
        cursor={t.cursor}
        write={t.write}
        backHref="/seller/messages"
      />
    </MessagesWorkspace>
  );
}
