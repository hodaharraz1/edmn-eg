import Link from '@/ui/link';
import { ShieldCheck } from 'lucide-react';
import { dealsForUser } from '@/server/modules/deals/service';
import { requireUser } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { LinkButton } from '@/ui/button';
import { PageHeader } from '@/ui/data';
import { Badge, EmptyState, StatusChip } from '@/ui/feedback';
import { DealTurn } from '@/app/_components/deal-status';
import type { DealStatus } from '@/domain/machines';

export const metadata = { title: 'الصفقات المحمية' };

export default async function DealsPage() {
  const user = await requireUser('/account');
  const list = await dealsForUser(user.id);
  return (
    <div>
      <PageHeader title="الصفقات المحمية" description="صفقاتك مع بائعين برّه السوق، سواء انت المشتري أو البائع." actions={<LinkButton href="/account/deals/new" variant="accent">صفقة جديدة</LinkButton>} />
      {list.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="مفيش صفقات لسه" description="اشتري من أي بائع برّه اضمن وانت مطمّن." action={<LinkButton href="/account/deals/new" variant="accent">ابدأ صفقة محمية</LinkButton>} />
      ) : (
        <ul className="space-y-3">
          {list.map((d) => (
            <li key={d.id}>
              <Link href={d.status === 'DRAFT' && d.buyerId === user.id ? `/account/deals/new?deal=${d.id}&step=${Math.min(d.wizardStep, 6)}` : `/account/deals/${d.id}`} className="card flex flex-col gap-3 p-4 transition-shadow hover:shadow-[var(--shadow-pop)] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-950 text-white"><ShieldCheck className="size-5" aria-hidden /></span>
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-bold text-brand-950">{d.title}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">صفقة #{d.number} · {formatDate(d.createdAt)} <Badge tone={d.buyerId === user.id ? 'brand' : 'accent'}>{d.buyerId === user.id ? 'انت المشتري' : 'انت البائع'}</Badge></p>
                    <DealTurn status={d.status as DealStatus} role={d.buyerId === user.id ? 'BUYER' : 'SELLER'} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-line pt-3 sm:border-0 sm:pt-0"><span className="text-lg font-bold text-brand-950">{formatEGP(d.totalAmount)}</span><StatusChip status={d.status === 'DELIVERED' ? 'DEAL_SHIPPED' : d.status} kind="deal" /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
