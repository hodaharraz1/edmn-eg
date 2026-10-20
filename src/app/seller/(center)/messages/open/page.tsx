import { redirect } from 'next/navigation';
import { isDomainError } from '@/server/core/errors';
import { openSellerOrderConversation } from '@/server/modules/messaging/service';
import { requireSellerActor } from '@/server/web/session';
import { LinkButton } from '@/ui/button';
import { Alert } from '@/ui/feedback';

export default async function SellerOpenConversationPage(props: PageProps<'/seller/messages/open'>) {
  const sp = await props.searchParams;
  const so = typeof sp.so === 'string' ? sp.so : '';
  const actor = await requireSellerActor(`/seller/messages/open?so=${so}`);
  let id: string | null = null;
  let error = 'ملقيناش المحادثة';
  try {
    id = (await openSellerOrderConversation(actor, so)).id;
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.message;
  }
  if (id) redirect(`/seller/messages/${id}`);
  return (
    <div className="space-y-4">
      <Alert tone="info" title="التواصل مش متاح دلوقتي">{error}</Alert>
      <LinkButton href={so ? `/seller/orders/${so}` : '/seller/orders'} variant="outline">ارجع للطلب</LinkButton>
    </div>
  );
}
