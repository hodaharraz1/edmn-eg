import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { disputeAdminAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { canViewConversations, conversationIdFor } from '@/server/modules/messaging/service';

import { isDomainError } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { orders, sellerOrders, users } from '@/server/db/schema';
import { DISPUTE_DECISIONS } from '@/domain/machines';
import { disputeGraph } from '@/server/modules/postpurchase/disputes';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { cn } from '@/lib/cn';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';

export default async function AdminDispute(props: PageProps<'/admin/disputes/[id]'>) {
  const { actor, allowed } = await adminWith('disputes.manage');
  if (!allowed) return <Forbidden />;
  let g;
  try {
    g = await disputeGraph(actor, (await props.params).id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const d = g.dispute;
  const convId = canViewConversations(actor) ? await conversationIdFor(d.sellerOrderId ? { sellerOrderId: d.sellerOrderId } : { dealId: d.dealId ?? undefined }) : null;
  let orderLink: { href: string; label: string } | null = null;
  if (d.sellerOrderId) {
    const [so] = await db.select({ orderId: sellerOrders.orderId, suffix: sellerOrders.suffix, number: orders.number }).from(sellerOrders).innerJoin(orders, eq(orders.id, sellerOrders.orderId)).where(eq(sellerOrders.id, d.sellerOrderId));
    if (so) orderLink = { href: `/admin/orders/${so.orderId}`, label: `طلب #${so.number}-${so.suffix}` };
  } else if (d.dealId) orderLink = { href: `/admin/deals/${d.dealId}`, label: 'الصفقة الخارجية' };
  const [assignee] = d.assignedTo ? await db.select({ name: users.fullName }).from(users).where(eq(users.id, d.assignedTo)) : [];
  const open = !['RESOLVED', 'CLOSED'].includes(d.status);
  const hidden = <><input type="hidden" name="disputeId" value={d.id} /><input type="hidden" name="back" value={`/admin/disputes/${d.id}`} /></>;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'النزاعات', href: '/admin/disputes' }, { label: `#${d.number}` }]} />} title={`نزاع #${d.number}`} description={d.reasonCode} actions={<StatusChip status={d.status} />} />
      {convId && (
        <p className="text-sm" data-testid="dispute-conversation-evidence">
          <Link href={`/admin/messages/${convId}?via=dispute`} className="font-semibold text-brand-700 underline">محادثة الطرفين (دليل مساعد)</Link>
          <span className="text-muted"> — الرسائل لا تتجاوز السجلات الرسمية للدفع والشحن والشروط المتفق عليها ورمز الاستلام وتأكيد الاستلام.</span>
        </p>
      )}
      <section className="card p-5">
        <DefinitionList items={[
          { label: 'المرجع', value: orderLink ? <Link className="text-brand-700" href={orderLink.href}>{orderLink.label}</Link> : '—' },
          { label: 'المبلغ المطالب', value: d.claimedAmount != null ? formatEGP(d.claimedAmount) : '—' },
          { label: 'المسؤول', value: assignee?.name ?? 'غير مسند' },
          { label: 'فُتح', value: formatDate(d.createdAt, true) },
          { label: 'الوصف', value: d.description },
          ...(d.decision ? [{ label: 'القرار', value: `${label('disputeDecision', d.decision)}${d.decisionAmount != null ? ` · ${formatEGP(d.decisionAmount)}` : ''} — ${d.decisionNote ?? ''}` }] : []),
        ]} />
        {g.evidence.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{g.evidence.map((e) => <a key={e.id} href={`/api/files/${e.fileId}`} target="_blank" className="rounded border border-line px-2 py-1 text-xs text-brand-700">دليل {e.note ?? ''}</a>)}</div>}
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-bold">المراسلات</h2>
        <ul className="space-y-2">
          {g.messages.map(({ m, author }) => (
            <li key={m.id} className={cn('rounded-lg p-3 text-sm', m.isInternal ? 'border border-dashed border-warning-500 bg-warning-50' : m.authorRole === 'ADMIN' ? 'bg-brand-50' : 'bg-page')}>
              <p className="mb-1 text-xs text-muted">{author} · {m.authorRole} · {formatDate(m.createdAt, true)} {m.isInternal && <Badge tone="warning">ملاحظة داخلية</Badge>}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
        {open && (
          <ActionForm action={disputeAdminAction} className="mt-3 space-y-2" resetOnSuccess>
            {hidden}<input type="hidden" name="op" value="message" />
            <Textarea name="body" required rows={3} aria-label="الرسالة" placeholder="اكتب رسالة للأطراف أو ملاحظة داخلية" />
            <FileInput name="attachment" label="مرفق (اختياري)" accept="image/jpeg,image/png,image/webp,application/pdf" />
            <Checkbox name="internal" label="ملاحظة داخلية (لا تظهر للأطراف)" />
            <SubmitButton size="sm">إرسال</SubmitButton>
          </ActionForm>
        )}
      </section>
      {open && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card space-y-3 p-5">
            <h2 className="font-bold">إدارة الحالة</h2>
            {d.assignedTo !== actor.userId && <ActionForm action={disputeAdminAction}>{hidden}<input type="hidden" name="op" value="assign" /><SubmitButton size="sm" variant="outline">إسناده إليّ</SubmitButton></ActionForm>}
            <ActionForm action={disputeAdminAction} className="flex flex-wrap gap-2">
              {hidden}<input type="hidden" name="op" value="status" />
              <Select name="status" className="w-auto" aria-label="الحالة"><option value="UNDER_REVIEW">قيد المراجعة</option><option value="AWAITING_INFORMATION">بانتظار معلومات</option></Select>
              <Input name="note" placeholder="ملاحظة" className="w-48" aria-label="ملاحظة" />
              <SubmitButton size="sm" variant="outline">تحديث</SubmitButton>
            </ActionForm>
          </div>
          <ActionForm action={disputeAdminAction} className="card space-y-2 p-5">
            {hidden}<input type="hidden" name="op" value="resolve" />
            <h2 className="font-bold">إصدار القرار</h2>
            <Alert tone="warning">القرار نهائي ويُنشئ القيود المحاسبية/سجلات الاسترداد المناسبة. راجع الأدلة أولاً.</Alert>
            <Field label="القرار" required><Select name="decision">{DISPUTE_DECISIONS.map((x) => <option key={x} value={x}>{label('disputeDecision', x)}</option>)}</Select></Field>
            <Field label="المبلغ (للاسترداد الجزئي)"><Input name="amount" inputMode="decimal" /></Field>
            <Field label="كود السبب" required><Input name="reasonCode" required minLength={3} placeholder="مثال: ITEM_NOT_AS_DESCRIBED" /></Field>
            <Field label="تسبيب القرار" required><Textarea name="note" required minLength={10} rows={3} /></Field>
            <SubmitButton>إصدار القرار</SubmitButton>
          </ActionForm>
        </div>
      )}
      {d.status === 'RESOLVED' && <ActionForm action={disputeAdminAction}>{hidden}<input type="hidden" name="op" value="close" /><SubmitButton variant="outline">إغلاق النزاع</SubmitButton></ActionForm>}
    </div>
  );
}
