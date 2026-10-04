import { notFound } from 'next/navigation';
import { ticketAdminAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { isDomainError } from '@/server/core/errors';
import { ticketThread } from '@/server/modules/support/service';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/domain/machines';
import { formatDate } from '@/lib/format';
import { label, statusLabel } from '@/lib/i18n/labels';
import { cn } from '@/lib/cn';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';
import { Checkbox, Select, Textarea } from '@/ui/form';

export default async function AdminTicket(props: PageProps<'/admin/support/[id]'>) {
  const { actor, allowed } = await adminWith('support.manage');
  if (!allowed) return <Forbidden />;
  let g;
  try {
    g = await ticketThread(actor, (await props.params).id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const t = g.ticket;
  const hidden = <><input type="hidden" name="ticketId" value={t.id} /><input type="hidden" name="back" value={`/admin/support/${t.id}`} /></>;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الدعم', href: '/admin/support' }, { label: `#${t.number}` }]} />} title={t.subject} description={`${label('ticketType', t.type)} · ${formatDate(t.createdAt, true)}${t.relatedType ? ` · ${t.relatedType} ${t.relatedId}` : ''}`} actions={<StatusChip status={t.status} />} />
      <ActionForm action={ticketAdminAction} className="card flex flex-wrap items-center gap-2 p-4">
        {hidden}<input type="hidden" name="op" value="update" />
        <Select name="status" defaultValue="" className="w-auto" aria-label="الحالة"><option value="">— الحالة —</option>{TICKET_STATUSES.filter((s) => s !== t.status).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</Select>
        <Select name="priority" defaultValue={t.priority} className="w-auto" aria-label="الأولوية">{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{label('priority', p)}</option>)}</Select>
        {t.assigneeId !== actor.userId && <Checkbox name="assign" value="me" label="إسناد إليّ" />}
        <SubmitButton size="sm" variant="outline">تحديث</SubmitButton>
      </ActionForm>
      <section className="card p-5">
        <ul className="space-y-2">
          {g.messages.map(({ m, author }) => (
            <li key={m.id} className={cn('rounded-lg p-3 text-sm', m.isInternal ? 'border border-dashed border-warning-500 bg-warning-50' : m.isStaff ? 'bg-brand-50' : 'bg-page')}>
              <p className="mb-1 text-xs text-muted">{author} · {formatDate(m.createdAt, true)} {m.isInternal && <Badge tone="warning">داخلية</Badge>}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
              {m.attachmentFileId && <a href={`/api/files/${m.attachmentFileId}`} target="_blank" className="text-xs text-brand-700 underline">مرفق</a>}
            </li>
          ))}
        </ul>
        <ActionForm action={ticketAdminAction} className="mt-3 space-y-2" resetOnSuccess>
          {hidden}<input type="hidden" name="op" value="reply" />
          <Textarea name="body" required rows={3} aria-label="الرد" />
          <FileInput name="attachment" label="مرفق (اختياري)" accept="image/jpeg,image/png,image/webp,application/pdf" />
          <Checkbox name="internal" label="ملاحظة داخلية" />
          <SubmitButton size="sm">إرسال</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
