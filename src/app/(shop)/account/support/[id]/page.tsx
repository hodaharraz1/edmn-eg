import { notFound } from 'next/navigation';
import { replyTicketAction } from '@/app/_actions/account';
import { ticketThread } from '@/server/modules/support/service';
import { isDomainError } from '@/server/core/errors';
import { requireCustomer } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';
import { Textarea } from '@/ui/form';

export default async function TicketPage(props: PageProps<'/account/support/[id]'>) {
  const actor = await requireCustomer('/account/support');
  let g;
  try {
    g = await ticketThread(actor, (await props.params).id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const t = g.ticket;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الدعم', href: '/account/support' }, { label: `#${t.number}` }]} />} title={t.subject} description={label('ticketType', t.type)} actions={<StatusChip status={t.status} />} />
      <div className="space-y-3">
        {g.messages.map(({ m, author }) => (
          <div key={m.id} className={`card p-4 text-sm ${m.isStaff ? 'border-brand-200 bg-brand-50/40' : ''}`}>
            <p className="mb-1 text-xs text-muted">{m.isStaff ? <Badge tone="brand">فريق اضمن</Badge> : author} · {formatDate(m.createdAt, true)}</p>
            <p className="whitespace-pre-line">{m.body}</p>
            {m.attachmentFileId && <a href={`/api/files/${m.attachmentFileId}`} target="_blank" className="mt-2 inline-block text-xs text-brand-700 underline">مرفق</a>}
          </div>
        ))}
      </div>
      {t.status !== 'CLOSED' && (
        <ActionForm action={replyTicketAction} className="card space-y-2 p-4" resetOnSuccess encType="multipart/form-data">
          <input type="hidden" name="ticketId" value={t.id} />
          <Textarea name="body" required rows={3} placeholder="اكتب ردك…" aria-label="الرد" />
          <input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-xs" aria-label="مرفق" />
          <SubmitButton size="sm">إرسال</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
