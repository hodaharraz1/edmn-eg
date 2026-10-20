import { redirect } from 'next/navigation';
import { isDomainError } from '@/server/core/errors';
import { openDealConversation, openSellerOrderConversation } from '@/server/modules/messaging/service';
import { requireCustomer } from '@/server/web/session';
import { LinkButton } from '@/ui/button';
import { Alert } from '@/ui/feedback';

/** Opens the conversation bound to ONE seller sub-order (?so=) or ONE protected deal (?deal=). */
export default async function OpenConversationPage(props: PageProps<'/account/messages/open'>) {
  const sp = await props.searchParams;
  const so = typeof sp.so === 'string' ? sp.so : '';
  const deal = typeof sp.deal === 'string' ? sp.deal : '';
  const actor = await requireCustomer(`/account/messages/open?${so ? `so=${so}` : `deal=${deal}`}`);
  let id: string | null = null;
  let error = 'ملقيناش المحادثة';
  try {
    id = (so ? await openSellerOrderConversation(actor, so) : await openDealConversation(actor, deal)).id;
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.message;
  }
  if (id) redirect(`/account/messages/${id}`);
  return (
    <div className="space-y-4">
      <Alert tone="info" title="التواصل مش متاح دلوقتي">{error}</Alert>
      <LinkButton href={deal ? `/account/deals/${deal}` : '/account/orders'} variant="outline">ارجع</LinkButton>
    </div>
  );
}
