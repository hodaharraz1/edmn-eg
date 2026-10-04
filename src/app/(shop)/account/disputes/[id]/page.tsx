import { notFound } from 'next/navigation';
import { disputeMessageAction } from '@/app/_actions/account';
import { disputeGraph, DECISION_LABELS } from '@/server/modules/postpurchase/disputes';
import { isDomainError } from '@/server/core/errors';
import { requireCustomer } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Textarea } from '@/ui/form';

const ROLE: Record<string, string> = { CLAIMANT: 'المشتري', RESPONDENT: 'البائع', ADMIN: 'فريق اضمن' };

export default async function DisputeDetail(props: PageProps<'/account/disputes/[id]'>) {
  const actor = await requireCustomer('/account/disputes');
  let g;
  try {
    g = await disputeGraph(actor, (await props.params).id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const d = g.dispute;
  const open = ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'].includes(d.status);
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'النزاعات', href: '/account/disputes' }, { label: `#${d.number}` }]} />} title={`نزاع #${d.number}`} actions={<StatusChip status={d.status} />} />
      {d.status === 'AWAITING_INFORMATION' && <Alert tone="warning">فريق اضمن يطلب معلومات إضافية. يرجى الرد أدناه.</Alert>}
      {d.decision && (
        <Alert tone="success" title={`القرار: ${DECISION_LABELS[d.decision]}`}>
          {d.decisionNote} {d.decisionAmount ? `— المبلغ: ${formatEGP(d.decisionAmount)}` : ''}
        </Alert>
      )}
      <section className="card p-5 text-sm">
        <p className="mb-1 text-xs text-muted">الشكوى ({formatDate(d.createdAt, true)})</p>
        <p className="whitespace-pre-line">{d.description}</p>
        {g.evidence.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {g.evidence.map((e) => (
              <a key={e.id} href={`/api/files/${e.fileId}`} target="_blank" className="rounded-lg border border-line px-2 py-1 text-xs text-brand-700 underline">دليل مرفق</a>
            ))}
          </div>
        )}
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="font-bold">المحادثة</h2>
        {g.messages.length === 0 && <p className="text-sm text-muted">لا توجد رسائل بعد.</p>}
        {g.messages.map(({ m, author }) => (
          <div key={m.id} className={`rounded-xl p-3 text-sm ${m.authorRole === 'ADMIN' ? 'bg-brand-50' : 'bg-page'}`}>
            <p className="mb-1 flex items-center gap-2 text-xs text-muted"><Badge tone={m.authorRole === 'ADMIN' ? 'brand' : 'neutral'}>{ROLE[m.authorRole]}</Badge> {author} · {formatDate(m.createdAt, true)}</p>
            <p className="whitespace-pre-line">{m.body}</p>
          </div>
        ))}
        {open && (
          <ActionForm action={disputeMessageAction} className="space-y-2" resetOnSuccess encType="multipart/form-data">
            <input type="hidden" name="disputeId" value={d.id} />
            <Textarea name="body" required rows={3} placeholder="اكتب ردك أو معلومات إضافية…" aria-label="الرسالة" />
            <input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-xs" aria-label="مرفق" />
            <SubmitButton size="sm">إرسال</SubmitButton>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
