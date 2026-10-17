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
              <Link href={`/account/support/${t.id}`} className="flex min-h-16 flex-wrap items-center justify-between gap-3 p-4 text-sm transition-colors hover:bg-soft/60">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><LifeBuoy className="size-5" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-brand-950">#{t.number} · {t.subject}</span>
                    <span className="block text-xs text-muted">{label('ticketType', t.type)} · آخر تحديث {formatDate(t.updatedAt)}</span>
                  </span>
                </span>
                <StatusChip status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
