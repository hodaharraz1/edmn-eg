import Link from '@/ui/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { customerStatusAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { addresses, auditLogs, disputes, externalDeals, governorates, orders, payments, productReviews, returns, supportTickets, users } from '@/server/db/schema';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, DataTable, DefinitionList, PageHeader } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';
import { Input } from '@/ui/form';

export default async function Customer360(props: PageProps<'/admin/customers/[id]'>) {
  const { actor, allowed } = await adminWith('customers.view');
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u || u.isStaff) notFound();
  const [addr, ords, pays, deals, rets, revs, tickets, disps, activity] = await Promise.all([
    db.select({ a: addresses, g: governorates.nameAr }).from(addresses).innerJoin(governorates, eq(governorates.id, addresses.governorateId)).where(and(eq(addresses.userId, id), isNull(addresses.archivedAt))),
    db.select().from(orders).where(eq(orders.customerId, id)).orderBy(desc(orders.placedAt)).limit(20),
    db.select().from(payments).where(eq(payments.payerUserId, id)).orderBy(desc(payments.createdAt)).limit(20),
    db.select().from(externalDeals).where(or(eq(externalDeals.buyerId, id), eq(externalDeals.sellerUserId, id))).orderBy(desc(externalDeals.createdAt)).limit(10),
    db.select().from(returns).where(eq(returns.customerId, id)).orderBy(desc(returns.createdAt)).limit(10),
    db.select().from(productReviews).where(eq(productReviews.customerId, id)).orderBy(desc(productReviews.createdAt)).limit(10),
    db.select().from(supportTickets).where(eq(supportTickets.requesterUserId, id)).orderBy(desc(supportTickets.createdAt)).limit(10),
    db.select().from(disputes).where(or(eq(disputes.claimantUserId, id), eq(disputes.respondentUserId, id))).orderBy(desc(disputes.createdAt)).limit(10),
    db.select().from(auditLogs).where(or(eq(auditLogs.actorUserId, id), and(eq(auditLogs.entityType, 'user'), eq(auditLogs.entityId, id)))).orderBy(desc(auditLogs.createdAt)).limit(30),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'العملاء', href: '/admin/customers' }, { label: u.fullName }]} />} title={u.fullName} description={`عميل منذ ${formatDate(u.createdAt)}`} actions={<Badge tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>{u.status}</Badge>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card p-4"><DefinitionList items={[
          { label: 'البريد', value: <span className="ltr">{u.email} {u.emailVerifiedAt && '✓'}</span> },
          { label: 'الهاتف', value: <span className="ltr">{u.phone} {u.phoneVerifiedAt && '✓'}</span> },
          { label: 'آخر دخول', value: formatDate(u.lastLoginAt, true) },
          { label: 'العناوين', value: addr.map((a) => `${a.g}، ${a.a.city}`).join(' · ') || '—' },
        ]} /></section>
        {hasPermission(actor, 'customers.manage') && (
          <ActionForm action={customerStatusAction} className="card space-y-2 p-4">
            <input type="hidden" name="userId" value={u.id} />
            <input type="hidden" name="status" value={u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'} />
            <Input name="reason" placeholder="السبب (إلزامي)" required aria-label="السبب" />
            <SubmitButton variant={u.status === 'ACTIVE' ? 'danger' : 'success'} size="sm">{u.status === 'ACTIVE' ? 'تعطيل الحساب' : 'إعادة تفعيل الحساب'}</SubmitButton>
          </ActionForm>
        )}
      </div>
      <DataTable rows={ords} rowKey={(r) => r.id} columns={[{ key: 'n', header: 'الطلب', cell: (r) => <Link href={`/admin/orders/${r.id}`} className="text-brand-700">#{r.number}</Link> }, { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.placedAt) }, { key: 't', header: 'الإجمالي', cell: (r) => formatEGP(r.grandTotal) }, { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.status} /> }]} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section title="المدفوعات">{pays.map((p) => <p key={p.id}><Link href={`/admin/payments/${p.id}`} className="text-brand-700">{label('paymentMethod', p.method)} {formatEGP(p.amountDue)}</Link> <StatusChip status={p.status} /></p>)}</Section>
        <Section title="الصفقات الخارجية">{deals.map((d) => <p key={d.id}><Link href={`/admin/deals/${d.id}`} className="text-brand-700">#{d.number} {d.title}</Link> <StatusChip status={d.status} /></p>)}</Section>
        <Section title="المرتجعات">{rets.map((r) => <p key={r.id}>#{r.number} <StatusChip status={r.status} /></p>)}</Section>
        <Section title="النزاعات">{disps.map((d) => <p key={d.id}><Link href={`/admin/disputes/${d.id}`} className="text-brand-700">#{d.number}</Link> <StatusChip status={d.status} /></p>)}</Section>
        <Section title="التقييمات">{revs.map((r) => <p key={r.id}>{r.rating}★ {r.title ?? r.body?.slice(0, 40)}</p>)}</Section>
        <Section title="تذاكر الدعم">{tickets.map((t) => <p key={t.id}><Link href={`/admin/support/${t.id}`} className="text-brand-700">#{t.number} {t.subject}</Link></p>)}</Section>
      </div>
      <Section title="سجل النشاط">{activity.map((a) => <p key={a.id} className="text-xs"><code>{a.action}</code> · {formatDate(a.createdAt, true)} {a.ip && <span className="text-muted ltr">({a.ip})</span>}</p>)}</Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card p-4 text-sm"><h2 className="mb-2 font-bold">{title}</h2>{children}</section>;
}
