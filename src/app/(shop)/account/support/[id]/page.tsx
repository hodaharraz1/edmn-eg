import { FileInput } from '@/ui/client';
import { notFound } from 'next/navigation';
import { replyTicketAction } from '@/app/_actions/account';
import { rateTicketAction, reopenTicketAction } from '@/app/_actions/identity';
import { ticketThread } from '@/server/modules/support/service';
import { isDomainError } from '@/server/core/errors';
import { requireCustomer } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';
import { Select, Textarea } from '@/ui/form';

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
      {(t.status === 'RESOLVED' || t.status === 'CLOSED') && (
        <div className="grid gap-3 md:grid-cols-2">
          <ActionForm action={reopenTicketAction} className="card space-y-2 p-4" data-testid="ticket-reopen">
            <input type="hidden" name="ticketId" value={t.id} />
            <h2 className="font-bold">المشكلة لسه موجودة؟</h2>
            <Textarea name="reason" required minLength={5} rows={2} placeholder="اكتب إيه اللي لسه محتاج حل" aria-label="سبب إعادة الفتح" />
            <SubmitButton size="sm" variant="outline">إعادة فتح التذكرة</SubmitButton>
          </ActionForm>
          {!t.rating ? (
            <ActionForm action={rateTicketAction} className="card space-y-2 p-4" data-testid="ticket-rate">
              <input type="hidden" name="ticketId" value={t.id} />
              <h2 className="font-bold">قيّم الخدمة</h2>
              <Select name="rating" required defaultValue="" aria-label="التقييم"><option value="" disabled>اختار</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</Select>
              <Textarea name="comment" rows={2} placeholder="تعليق (اختياري)" aria-label="تعليق" />
              <SubmitButton size="sm" variant="outline">إرسال التقييم</SubmitButton>
            </ActionForm>
          ) : <p className="card p-4 text-sm">تقييمك: {'★'.repeat(t.rating)} — شكرًا.</p>}
        </div>
      )}
      {t.status !== 'CLOSED' && t.status !== 'RESOLVED' && (
        <ActionForm action={replyTicketAction} className="card space-y-2 p-4" resetOnSuccess encType="multipart/form-data">
          <input type="hidden" name="ticketId" value={t.id} />
          <Textarea name="body" required rows={3} placeholder="اكتب ردك…" aria-label="الرد" />
          <FileInput name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf" label="مرفق (اختياري): صورة أو PDF" />
          <SubmitButton size="sm">ابعت</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
