import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { dealsForUser } from '@/server/modules/deals/service';
import { requireUser } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { LinkButton } from '@/ui/button';
import { PageHeader } from '@/ui/data';
import { Badge, EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'الصفقات المحمية' };

export default async function DealsPage() {
  const user = await requireUser('/account');
  const list = await dealsForUser(user.id);
  return (
    <div>
      <PageHeader title="الصفقات المحمية" description="صفقاتك مع بائعين من خارج السوق، كمشترٍ أو كبائع." actions={<LinkButton href="/account/deals/new" variant="accent">صفقة جديدة</LinkButton>} />
      {list.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="لا توجد صفقات بعد" description="اشترِ من أي بائع خارج اضمن بأمان." action={<LinkButton href="/account/deals/new" variant="accent">ابدأ صفقة محمية</LinkButton>} />
      ) : (
        <ul className="space-y-3">
          {list.map((d) => (
            <li key={d.id}>
              <Link href={d.status === 'DRAFT' && d.buyerId === user.id ? `/account/deals/new?deal=${d.id}&step=${Math.min(d.wizardStep, 6)}` : `/account/deals/${d.id}`} className="card flex flex-wrap items-center justify-between gap-3 p-4 hover:shadow-[var(--shadow-pop)]">
                <div>
                  <p className="font-semibold">{d.title}</p>
                  <p className="text-xs text-muted">صفقة #{d.number} · {formatDate(d.createdAt)} · <Badge tone={d.buyerId === user.id ? 'brand' : 'accent'}>{d.buyerId === user.id ? 'أنت المشتري' : 'أنت البائع'}</Badge></p>
                </div>
                <div className="flex items-center gap-3"><span className="font-semibold">{formatEGP(d.totalAmount)}</span><StatusChip status={d.status === 'DELIVERED' ? 'DEAL_SHIPPED' : d.status} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
