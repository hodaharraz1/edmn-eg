import Link from '@/ui/link';
import { LifeBuoy } from 'lucide-react';
import { myTickets } from '@/server/modules/support/service';
import { requireUser } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { LinkButton } from '@/ui/button';
import { PageHeader } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'الدعم الفني' };

export default async function SupportPage() {
  const user = await requireUser('/account');
  const list = await myTickets(user.id);
  return (
    <div>
      <PageHeader title="الدعم الفني" actions={<LinkButton href="/account/support/new">تذكرة جديدة</LinkButton>} />
      {list.length === 0 ? <EmptyState icon={LifeBuoy} title="مفيش تذاكر" description="محتاج مساعدة؟ افتح تذكرة وهنرد عليك." action={<LinkButton href="/account/support/new">تواصل معانا</LinkButton>} /> : (
        <ul className="card divide-y divide-line">
          {list.map((t) => (
            <li key={t.id}>
              <Link href={`/account/support/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm hover:bg-page/50">
                <span>#{t.number} · {t.subject} <span className="text-xs text-muted">({label('ticketType', t.type)}) · {formatDate(t.updatedAt)}</span></span>
                <StatusChip status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
