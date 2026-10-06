import Link from 'next/link';
import { MessagesSquare } from 'lucide-react';
import { resolveReportAction } from '@/app/_actions/messaging';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { formatDate } from '@/lib/format';
import { hasPermission } from '@/server/core/actor';
import { recentConversations, REPORT_REASON_LABELS, reportQueue } from '@/server/modules/messaging/service';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Alert, EmptyState, StatusChip } from '@/ui/feedback';
import { Input } from '@/ui/form';

export const metadata = { title: 'محادثات المشترين والبائعين' };

/**
 * Staff index: message reports to review, and recent conversations (metadata only).
 * Opening a conversation is audited per view.
 */
export default async function AdminMessages(props: PageProps<'/admin/messages'>) {
  const { actor, allowed } = await adminWith('messages.view');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'reports');
  const canModerate = hasPermission(actor, 'messages.moderate');
  const reports = tab === 'recent' ? [] : await reportQueue(actor, tab === 'closed' ? 'ACTIONED' : 'OPEN');
  const recent = tab === 'recent' ? await recentConversations(actor) : [];
  return (
    <div className="space-y-4">
      <PageHeader title="محادثات المشترين والبائعين" description="الرسائل دليل مساعد فقط: الحالة الرسمية للدفع والشحن والعرض المتفق عليه ورمز الاستلام وتأكيد الاستلام والقيود المالية تُؤخذ من سجلاتها الأصلية." />
      <Alert tone="info">فتح أي محادثة يُسجَّل في سجل التدقيق (المستخدم، المحادثة، الطلب/الصفقة، الوقت).</Alert>
      <Tabs
        active={tab}
        tabs={[
          { key: 'reports', label: 'بلاغات مفتوحة', href: '/admin/messages' },
          { key: 'closed', label: 'بلاغات تمت معالجتها', href: '/admin/messages?tab=closed' },
          { key: 'recent', label: 'أحدث المحادثات', href: '/admin/messages?tab=recent' },
        ]}
      />
      {tab === 'recent' ? (
        <DataTable
          rows={recent}
          rowKey={(r) => r.conv.id}
          empty={<EmptyState icon={MessagesSquare} title="لا توجد محادثات" />}
          columns={[
            { key: 'ref', header: 'السياق', cell: (r) => <Link className="font-semibold text-brand-700" href={`/admin/messages/${r.conv.id}?via=index`}>{r.context.ref}</Link> },
            { key: 'p', header: 'الأطراف', cell: (r) => `${r.context.buyerName} ↔ ${r.context.sellerName}` },
            { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.context.status} /> },
            { key: 'l', header: 'آخر رسالة', cell: (r) => formatDate(r.conv.lastMessageAt, true) },
          ]}
        />
      ) : (
        <DataTable
          rows={reports}
          rowKey={(r) => r.r.id}
          empty={<EmptyState icon={MessagesSquare} title="لا توجد بلاغات" />}
          columns={[
            { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.r.createdAt, true) },
            { key: 'why', header: 'السبب', cell: (r) => REPORT_REASON_LABELS[r.r.reason] },
            { key: 'by', header: 'المُبلِّغ', cell: (r) => r.reporter },
            { key: 'm', header: 'الرسالة', cell: (r) => <span className="line-clamp-2 max-w-xs break-words [overflow-wrap:anywhere]">{r.hiddenAt ? '(مخفية) ' : ''}{r.body}</span> },
            { key: 'c', header: '', cell: (r) => <Link className="text-brand-700 underline" href={`/admin/messages/${r.r.conversationId}?via=report`}>فتح المحادثة</Link> },
            ...(canModerate && tab === 'reports'
              ? [
                  {
                    key: 'a',
                    header: 'القرار',
                    cell: (r: (typeof reports)[number]) => (
                      <ActionForm action={resolveReportAction} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="reportId" value={r.r.id} />
                        <Input name="note" required minLength={3} placeholder="ملاحظة القرار" className="h-8 w-36 text-xs" aria-label="ملاحظة القرار" />
                        <SubmitButton size="sm" variant="outline" name="decision" value="DISMISSED">رفض البلاغ</SubmitButton>
                        <SubmitButton size="sm" variant="outline" name="decision" value="ACTIONED">تمت المعالجة</SubmitButton>
                      </ActionForm>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
