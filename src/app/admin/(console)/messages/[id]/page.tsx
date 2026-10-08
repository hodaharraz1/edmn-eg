import { notFound } from 'next/navigation';
import { hideMessageAction, lockConversationAction } from '@/app/_actions/messaging';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { ConversationContextCard, toDTO } from '@/app/_components/conversation';
import { MessageBubble } from '@/app/_components/live/message-bubble';
import { formatDate } from '@/lib/format';
import { hasPermission } from '@/server/core/actor';
import { isDomainError } from '@/server/core/errors';
import { REPORT_REASON_LABELS, staffThread } from '@/server/modules/messaging/service';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert, Badge, EmptyState, StatusChip } from '@/ui/feedback';
import { Input } from '@/ui/form';

export const metadata = { title: 'محادثة' };

/** Read-only staff viewer (staff never post as a buyer/seller). Every view is audited by staffThread. */
export default async function AdminConversation(props: PageProps<'/admin/messages/[id]'>) {
  const { actor, allowed } = await adminWith('messages.view');
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  const via = String((await props.searchParams).via ?? 'direct').slice(0, 20);
  let t;
  try {
    t = await staffThread(actor, id, { via });
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const canModerate = hasPermission(actor, 'messages.moderate');
  const names = { BUYER: t.context.buyerName, SELLER: t.context.sellerName };
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'محادثات المشترين والبائعين', href: '/admin/messages' }, { label: t.context.ref }]} />}
        title={`محادثة ${t.context.ref}`}
        actions={t.conv.status === 'LOCKED' ? <Badge tone="danger">مقفولة</Badge> : <Badge tone="success">نشطة</Badge>}
      />
      <Alert tone="warning" title="دليل مساعد فقط">
        الرسائل لا تغيّر ولا تتجاوز السجلات الرسمية: تأكيد الدفع، نسخ العرض الرسمية والشروط المتفق عليها، بيانات الشحن، التحقق برمز الاستلام، تأكيد المشتري للاستلام، والقيود المالية. هذا العرض للقراءة فقط وتم تسجيله في سجل التدقيق.
      </Alert>
      <ConversationContextCard ctx={t.context} side="STAFF" context={t.conv.context} href={t.context.adminHref} />
      <section aria-label="الرسائل" className="rounded-2xl bg-white/60 p-3 ring-1 ring-line">
        {t.messages.length === 0 ? (
          <EmptyState title="لا توجد رسائل" />
        ) : (
          <ol className="space-y-3">
            {t.messages.map((m) => (
              <div key={m.id} className="space-y-1">
                <MessageBubble m={toDTO(m)} surface="admin" partyName={names} staff />
                {canModerate && !m.hidden && (
                  <details className={m.side === 'BUYER' ? 'text-start' : 'text-end'}>
                    <summary className="cursor-pointer text-xs text-muted">إخفاء الرسالة عن الطرفين</summary>
                    <ActionForm action={hideMessageAction} className="mt-1 inline-flex flex-wrap items-center gap-1">
                      <input type="hidden" name="messageId" value={m.id} />
                      <input type="hidden" name="conversationId" value={t.conv.id} />
                      <Input name="reason" required minLength={3} placeholder="سبب الإخفاء" className="h-8 w-48 text-xs" aria-label="سبب الإخفاء" />
                      <SubmitButton size="sm" variant="outline">إخفاء (الأصل محفوظ)</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </div>
            ))}
          </ol>
        )}
      </section>
      {t.reports.length > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="font-bold">البلاغات على هذه المحادثة</h2>
          <ul className="space-y-1 text-sm">
            {t.reports.map(({ r, reporter }) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <StatusChip status={r.status} /> {REPORT_REASON_LABELS[r.reason]} — {reporter} · {formatDate(r.createdAt, true)}
                {r.note && <span className="text-muted">«{r.note}»</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {canModerate && (
        <section className="card space-y-2 p-4">
          <h2 className="font-bold">{t.conv.status === 'LOCKED' ? 'إعادة فتح المحادثة' : 'قفل المحادثة (للقراءة فقط للطرفين)'}</h2>
          {t.conv.status === 'LOCKED' && <p className="text-sm text-muted">مقفولة منذ {formatDate(t.conv.lockedAt, true)} — {t.conv.lockedReason}</p>}
          <ActionForm action={lockConversationAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="conversationId" value={t.conv.id} />
            <input type="hidden" name="locked" value={t.conv.status === 'LOCKED' ? 'false' : 'true'} />
            <Input name="reason" required minLength={3} placeholder="السبب" className="h-9 w-64" aria-label="السبب" />
            <SubmitButton size="sm" variant="outline">{t.conv.status === 'LOCKED' ? 'إعادة فتح' : 'قفل'}</SubmitButton>
          </ActionForm>
        </section>
      )}
      {!t.write.canWrite && t.write.reason && <p className="text-xs text-muted">حالة الكتابة للطرفين: {t.write.reason}</p>}
    </div>
  );
}
