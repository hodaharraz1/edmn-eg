import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ParticipantConversation } from '@/app/_components/conversation';
import { isDomainError } from '@/server/core/errors';
import { participantThread } from '@/server/modules/messaging/service';
import { requireCustomer } from '@/server/web/session';

export const metadata: Metadata = { title: 'الرسائل', robots: { index: false } };

export default async function AccountConversationPage(props: PageProps<'/account/messages/[id]'>) {
  const { id } = await props.params;
  const actor = await requireCustomer(`/account/messages/${id}`);
  let t;
  try {
    t = await participantThread(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  return (
    <ParticipantConversation
      conversationId={t.conv.id}
      context={t.conv.context}
      ctx={t.context}
      side={t.side}
      surface="account"
      messages={t.messages}
      write={t.write}
      backHref="/account/messages"
    />
  );
}
