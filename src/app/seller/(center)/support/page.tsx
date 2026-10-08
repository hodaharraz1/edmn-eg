import { desc, eq } from 'drizzle-orm';
import { sellerTicketAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { supportTickets } from '@/server/db/schema';
import { ticketThread } from '@/server/modules/support/service';
import { requireSellerActor } from '@/server/web/session';
import { TICKET_TYPES } from '@/domain/machines';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';
import { Field, Input, Select, Textarea } from '@/ui/form';
import Link from '@/ui/link';

export const metadata = { title: 'الدعم' };

export default async function SellerSupport(props: PageProps<'/seller/support'>) {
  const actor = await requireSellerActor('/seller/support');
  const sp = await props.searchParams;
  const list = await db.select().from(supportTickets).where(eq(supportTickets.sellerId, actor.sellerId!)).orderBy(desc(supportTickets.updatedAt));
  const openId = typeof sp.t === 'string' ? sp.t : null;
  const thread = openId ? await ticketThread(actor, openId).catch(() => null) : null;
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-3">
        <PageHeader title="دعم البائعين" />
        <ul className="card divide-y divide-line">
          {list.map((t) => (
            <li key={t.id}><Link href={`/seller/support?t=${t.id}`} className={`block p-3 text-sm hover:bg-page ${t.id === openId ? 'bg-brand-50' : ''}`}>#{t.number} {t.subject}<div className="mt-1 flex justify-between text-xs text-muted"><span>{formatDate(t.updatedAt)}</span><StatusChip status={t.status} /></div></Link></li>
          ))}
          {list.length === 0 && <li className="p-4 text-sm text-muted">لا توجد تذاكر</li>}
        </ul>
      </div>
      <div className="space-y-4">
        {thread ? (
          <>
            <h2 className="text-lg font-bold">{thread.ticket.subject}</h2>
            {thread.messages.map(({ m, author }) => (
              <div key={m.id} className={`card p-4 text-sm ${m.isStaff ? 'border-brand-200 bg-brand-50/40' : ''}`}>
                <p className="mb-1 text-xs text-muted">{m.isStaff ? <Badge tone="brand">فريق اضمن</Badge> : author} · {formatDate(m.createdAt, true)}</p>
                <p className="whitespace-pre-line">{m.body}</p>
              </div>
            ))}
            <ActionForm action={sellerTicketAction} className="card space-y-2 p-4" resetOnSuccess>
              <input type="hidden" name="ticketId" value={thread.ticket.id} />
              <Textarea name="body" required rows={3} aria-label="الرد" />
              <SubmitButton size="sm">إرسال</SubmitButton>
            </ActionForm>
          </>
        ) : (
          <ActionForm action={sellerTicketAction} className="card space-y-3 p-5" encType="multipart/form-data">
            <h2 className="font-bold">تذكرة جديدة</h2>
            <Field label="النوع" htmlFor="type"><Select id="type" name="type" defaultValue="SELLER">{TICKET_TYPES.map((t) => <option key={t} value={t}>{label('ticketType', t)}</option>)}</Select></Field>
            <Field label="العنوان" htmlFor="subject" required><Input id="subject" name="subject" required minLength={5} /></Field>
            <Field label="التفاصيل" htmlFor="body" required><Textarea id="body" name="body" rows={5} required minLength={10} /></Field>
            <input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-xs" aria-label="مرفق" />
            <SubmitButton>إرسال</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
