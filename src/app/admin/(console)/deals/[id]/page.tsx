import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { isDomainError } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { dealInvitations, disputes, statusHistory } from '@/server/db/schema';
import { dealGraph } from '@/server/modules/deals/service';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { Breadcrumbs, DefinitionList, PageHeader, Timeline } from '@/ui/data';
import { StatusChip } from '@/ui/feedback';

export default async function AdminDeal(props: PageProps<'/admin/deals/[id]'>) {
  const { actor, allowed } = await adminWith('deals.view');
  if (!allowed) return <Forbidden />;
  let g;
  try {
    g = await dealGraph(actor, (await props.params).id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const d = g.deal;
  const invites = await db.select().from(dealInvitations).where(eq(dealInvitations.dealId, d.id)).orderBy(asc(dealInvitations.createdAt));
  const disp = await db.select().from(disputes).where(eq(disputes.dealId, d.id));
  const history = await db.select().from(statusHistory).where(eq(statusHistory.entityId, d.id)).orderBy(asc(statusHistory.createdAt));
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الصفقات', href: '/admin/deals' }, { label: `#${d.number}` }]} />} title={`صفقة #${d.number}: ${d.title}`} description={`المشتري: ${g.buyerName}`} actions={<StatusChip status={d.status} />} />
      <section className="card p-5">
        <DefinitionList items={[
          { label: 'البائع', value: `${d.sellerName ?? '—'} · ${d.sellerPhone ?? ''} ${d.sellerEmail ?? ''}` },
          { label: 'الكمية / الحالة', value: `${d.quantity} · ${d.condition ?? '—'}` },
          { label: 'إجمالي السعر', value: d.totalAmount != null ? formatEGP(d.totalAmount) : '—' },
          { label: 'رسوم الحماية', value: `${formatEGP(d.feeAmount)} (${(d.feeBps / 100).toFixed(2)}%) يتحملها ${d.feePayer === 'BUYER' ? 'المشتري' : 'البائع'}` },
          { label: 'يدفع المشتري', value: d.buyerPays != null ? formatEGP(d.buyerPays) : '—' },
          { label: 'يستلم البائع', value: d.sellerReceives != null ? formatEGP(d.sellerReceives) : '—' },
          { label: 'التسليم', value: `${d.deliveryMethod ?? '—'} · قبل ${formatDate(d.deliveryDeadline)} · فحص ${d.inspectionDays} يوم` },
          { label: 'حساب صرف البائع', value: d.sellerPayoutMasked ? `${label('payoutType', d.sellerPayoutType)} ${d.sellerPayoutMasked}` : '—' },
          { label: 'شروط إضافية', value: d.customTerms ?? '—' },
          { label: 'رابط المصدر', value: d.sourceUrl ? <span className="ltr break-all">{d.sourceUrl}</span> : '—' },
          { label: 'الدفع', value: g.payment ? <Link className="text-brand-700" href={`/admin/payments/${g.payment.id}`}><StatusChip status={g.payment.status} /></Link> : '—' },
          { label: 'المستحق للبائع', value: g.payout ? <span>{formatEGP(g.payout.amount)} <StatusChip status={g.payout.status} /> {g.payout.paidReference && `· ${g.payout.paidReference}`} {g.payout.status === 'PENDING' && <Link className="text-brand-700" href="/admin/refunds?tab=deals">صرف</Link>}</span> : '—' },
        ]} />
        {d.deliveryNote && <p className="mt-3 rounded bg-page p-3 text-sm">ملاحظة التسليم: {d.deliveryNote}</p>}
        {g.evidence.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{g.evidence.map((e) => <a key={e.id} href={`/api/files/${e.fileId}`} target="_blank" className="size-20 overflow-hidden rounded-lg border border-line" title={e.kind}><img src={`/api/files/${e.fileId}`} alt={e.kind} className="size-full object-cover" /></a>)}</div>}
      </section>
      {disp.length > 0 && <section className="card p-5"><h2 className="mb-2 font-bold">النزاعات</h2>{disp.map((x) => <Link key={x.id} href={`/admin/disputes/${x.id}`} className="block text-brand-700">نزاع #{x.number} <StatusChip status={x.status} /></Link>)}</section>}
      <section className="card p-5">
        <h2 className="mb-2 font-bold">الدعوات</h2>
        <ul className="text-sm">{invites.map((i) => <li key={i.id}><StatusChip status={i.status} /> أُنشئت {formatDate(i.createdAt, true)} · تنتهي {formatDate(i.expiresAt, true)} {i.rejectReason && `· سبب الرفض: ${i.rejectReason}`}</li>)}</ul>
        <p className="mt-2 text-xs text-muted">روابط الدعوة لا تُخزَّن كنص صريح (تُحفظ بصمة SHA-256 فقط) ولا يمكن عرضها هنا.</p>
      </section>
      <section className="card p-5"><h2 className="mb-2 font-bold">سجل الحالات</h2><Timeline items={history.map((h) => ({ title: `${h.fromStatus ?? '∅'} ← ${h.toStatus}`, time: `${formatDate(h.createdAt, true)} · ${h.actorType}`, body: h.reason }))} /></section>
    </div>
  );
}
