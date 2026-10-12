import { notFound } from 'next/navigation';
import { ticketAdminAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { isDomainError } from '@/server/core/errors';
import { ESCALATION_TARGETS, ticketSlaCycles, ticketThread } from '@/server/modules/support/service';
import { adminReopenTicketAction, escalateTicketAction, qaTicketAction } from '@/app/_actions/identity';
import { hasPermission } from '@/server/core/actor';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/domain/machines';
import { formatDate } from '@/lib/format';
import { label, statusLabel } from '@/lib/i18n/labels';
import { cn } from '@/lib/cn';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/ui/form';

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
  const cycles = await ticketSlaCycles(t.id);
  const canEscalate = hasPermission(actor, 'support.escalate');
  const canQa = hasPermission(actor, 'support.qa');
  const closedLike = t.status === 'RESOLVED' || t.status === 'CLOSED';
  const hidden = <><input type="hidden" name="ticketId" value={t.id} /><input type="hidden" name="back" value={`/admin/support/${t.id}`} /></>;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الدعم', href: '/admin/support' }, { label: `#${t.number}` }]} />} title={t.subject} description={`${label('ticketType', t.type)} · ${formatDate(t.createdAt, true)}${t.relatedType ? ` · ${t.relatedType} ${t.relatedId}` : ''}`} actions={<StatusChip status={t.status} />} />
      <ActionForm action={ticketAdminAction} className="card flex flex-wrap items-center gap-2 p-4">
        {hidden}<input type="hidden" name="op" value="update" />
        <Select name="status" defaultValue="" className="w-auto" aria-label="الحالة"><option value="">— الحالة —</option>{TICKET_STATUSES.filter((s) => s !== t.status && s !== 'OPEN').map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</Select>
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
      <section className="card space-y-2 p-5" data-testid="ticket-sla">
        <h2 className="font-bold">دورات الخدمة (SLA)</h2>
        <p className="text-xs text-muted">مواعيد الـ SLA تُضبط من الإعدادات لكل أولوية؛ لو مش مضبوطة لا تُحسب مواعيد. إعادة الفتح تبدأ دورة جديدة وتحفظ القديمة كما هي.</p>
        <ul className="space-y-1 text-sm">
          {cycles.map((c) => (
            <li key={c.id} className="rounded bg-page p-2">
              دورة {c.cycle} ({c.trigger.startsWith('REOPENED') ? `إعادة فتح: ${c.reopenReason ?? ''}` : 'فتح'}) · بدأت {formatDate(c.startedAt, true)}
              {c.firstResponseDueAt && ` · أول رد قبل ${formatDate(c.firstResponseDueAt, true)}`}{c.firstRespondedAt && ` · رُد ${formatDate(c.firstRespondedAt, true)}`}
              {c.resolutionDueAt && ` · الحل قبل ${formatDate(c.resolutionDueAt, true)}`}{c.resolvedAt && ` · حُلّت ${formatDate(c.resolvedAt, true)}`}{c.closedAt && ` · أُغلقت ${formatDate(c.closedAt, true)}`}
              {(c.firstResponseBreached || c.resolutionBreached) && <Badge tone="danger" className="ms-1">تجاوز SLA</Badge>}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">مرات إعادة الفتح: {t.reopenCount}{t.rating ? ` · تقييم العميل: ${t.rating}/5${t.ratingComment ? ` — ${t.ratingComment}` : ''}` : ''}{t.qaScore ? ` · جودة: ${t.qaScore}/5` : ''}{t.specialistTeam ? ` · مُصعّدة إلى: ${t.specialistTeam}` : ''}{t.linkedType ? ` · مرتبطة بـ ${t.linkedType}` : ''}</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {canEscalate && !closedLike && (
          <ActionForm action={escalateTicketAction} className="card space-y-2 p-5" data-testid="ticket-escalate">
            {hidden}
            <h2 className="font-bold">تصعيد لفريق متخصص</h2>
            <Select name="team" required defaultValue="" aria-label="الفريق"><option value="" disabled>الفريق</option><option value="FINANCE">المالية</option><option value="DISPUTES">النزاعات</option><option value="IDENTITY">التحقق من الهوية</option><option value="OPERATIONS">العمليات</option><option value="RISK">المخاطر</option><option value="TECHNICAL">الدعم التقني</option></Select>
            <Select name="linkedType" defaultValue="" aria-label="ربط بحالة"><option value="">بدون ربط</option>{ESCALATION_TARGETS.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
            <Input name="linkedId" placeholder="معرّف الحالة المرتبطة (اختياري)" aria-label="معرّف الحالة" className="ltr" />
            <Textarea name="note" required minLength={5} rows={2} placeholder="سبب التصعيد" aria-label="سبب التصعيد" />
            <p className="text-xs text-muted">التصعيد لا يمنح أي صلاحية مالية؛ القرارات المالية تمر بمساراتها المعتمدة.</p>
            <SubmitButton size="sm" variant="outline">تصعيد</SubmitButton>
          </ActionForm>
        )}
        {closedLike && (
          <ActionForm action={adminReopenTicketAction} className="card space-y-2 p-5" data-testid="ticket-reopen">
            {hidden}
            <h2 className="font-bold">إعادة فتح التذكرة</h2>
            <Textarea name="reason" required minLength={5} rows={2} placeholder="سبب إعادة الفتح" aria-label="سبب إعادة الفتح" />
            <SubmitButton size="sm" variant="outline">إعادة فتح (دورة SLA جديدة)</SubmitButton>
          </ActionForm>
        )}
        {canQa && closedLike && (
          <ActionForm action={qaTicketAction} className="card space-y-2 p-5" data-testid="ticket-qa">
            {hidden}
            <h2 className="font-bold">مراجعة الجودة</h2>
            <Select name="score" required defaultValue="" aria-label="الدرجة"><option value="" disabled>الدرجة</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</Select>
            <Textarea name="note" required minLength={5} rows={2} placeholder="ملاحظات الجودة" aria-label="ملاحظات الجودة" />
            <SubmitButton size="sm" variant="outline">حفظ (2FA)</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
