import { desc } from 'drizzle-orm';
import { SECRET_EVENTS } from '@/server/jobs/worker';

/** Codes are masked everywhere except staging verification codes (no SMS provider there; fake accounts only). */
const STAGING = process.env.EDMN_ENVIRONMENT === 'staging';
import { templateAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { notificationTemplates, outboundMessages } from '@/server/db/schema';
import { EVENT_TEMPLATES, type EventName } from '@/server/modules/notifications/events';
import { deliveryHealth } from '@/server/modules/notifications/message-alerts';
import { env } from '@/server/core/env';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';

export const metadata = { title: 'الإشعارات' };

export default async function Notifications(props: PageProps<'/admin/notifications'>) {
  const { allowed } = await adminWith('notifications.manage');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'templates');
  const overrides = await db.select().from(notificationTemplates);
  const outbox = tab === 'outbox' ? await db.select().from(outboundMessages).orderBy(desc(outboundMessages.createdAt)).limit(150) : [];
  const health = tab === 'health' ? await deliveryHealth(24) : null;
  const E = env();
  const ov = (e: string, ch: string) => overrides.find((o) => o.event === e && o.channel === ch);
  return (
    <div className="space-y-4">
      <PageHeader title="الإشعارات" description="قوالب الرسائل داخل المنصة والبريد والرسائل النصية، وسجل الرسائل الصادرة." />
      <Alert tone={E.MAIL_DRIVER === 'smtp' && E.SMS_DRIVER === 'http' ? 'success' : 'warning'}>البريد: {E.MAIL_DRIVER === 'smtp' ? `SMTP (${E.SMTP_HOST})` : 'وضع السجل فقط — لم يُعد مزود SMTP'} · SMS: {E.SMS_DRIVER === 'http' ? 'HTTP مُعد' : 'وضع السجل فقط — لم يُعد مزود رسائل'}</Alert>
      <Tabs active={tab} tabs={[{ key: 'templates', label: 'القوالب', href: '/admin/notifications' }, { key: 'outbox', label: 'الرسائل الصادرة', href: '/admin/notifications?tab=outbox' }, { key: 'health', label: 'صحة التوصيل', href: '/admin/notifications?tab=health' }]} />
      {health && <DeliveryHealth h={health} />}
      {tab === 'templates' && (
        <ul className="space-y-2">
          {(Object.keys(EVENT_TEMPLATES) as EventName[]).map((e) => {
            const t = EVENT_TEMPLATES[e];
            const o = ov(e, 'IN_APP') ?? ov(e, 'EMAIL') ?? ov(e, 'SMS');
            return (
              <li key={e}>
                <details className="card p-3">
                  <summary className="cursor-pointer text-sm"><b>{t.title}</b> <span className="ltr text-xs text-muted">{e}</span> {o && <Badge tone="info">مخصص</Badge>} {t.sms && <Badge tone="neutral">SMS</Badge>}</summary>
                  <p className="mt-2 rounded bg-page p-2 text-xs">النص الافتراضي: {t.body}</p>
                  <ActionForm action={templateAction} className="mt-2 grid gap-2 md:grid-cols-2">
                    <input type="hidden" name="event" value={e} />
                    <Field label="القناة"><Select name="channel" defaultValue={o?.channel ?? 'IN_APP'}><option value="IN_APP">داخل المنصة</option><option value="EMAIL">بريد</option><option value="SMS">SMS</option></Select></Field>
                    <Field label="العنوان"><Input name="subject" defaultValue={o?.subject ?? t.title} /></Field>
                    <Field label="النص (المتغيرات بصيغة {{var}})" className="md:col-span-2"><Textarea name="body" rows={2} defaultValue={o?.body ?? t.body} /></Field>
                    <Checkbox name="isEnabled" label="مفعّل" defaultChecked={o?.isEnabled ?? true} />
                    <SubmitButton size="sm">حفظ</SubmitButton>
                  </ActionForm>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {tab === 'outbox' && (
        <DataTable rows={outbox} rowKey={(m) => m.id} columns={[
          { key: 'c', header: 'القناة', cell: (m) => m.channel },
          { key: 'r', header: 'المستلم', cell: (m) => <span className="ltr text-xs">{m.recipient.replace(/^(.{3}).*(.{3})$/, '$1•••$2')}</span> },
          { key: 'e', header: 'الحدث', cell: (m) => <span className="text-xs">{m.event}</span> },
          { key: 's', header: 'الموضوع', cell: (m) => (SECRET_EVENTS.includes(m.event ?? '') && m.event !== 'ACCOUNT_SECURITY' ? <span className="text-muted">[محتوى أمني مخفي]</span> : m.event === 'ACCOUNT_SECURITY' ? (STAGING ? <span title="بيئة Staging فقط: لا يوجد مزود رسائل، فتُعرض رموز التحقق هنا لاختبار الحسابات الوهمية">{m.body.slice(0, 90)} <span className="text-[10px] text-amber-700">(Staging)</span></span> : <span className="text-muted">{m.body.replace(/\d{6}/g, '••••••').replace(/https?:\/\/\S+/g, '[رابط مخفي]').slice(0, 60)}</span>) : (m.subject ?? m.body.slice(0, 50))) },
          { key: 'a', header: 'محاولات', cell: (m) => `${m.attempts}${m.lastError ? ` · ${m.lastError.slice(0, 40)}` : ''}` },
          { key: 'd', header: 'التاريخ', cell: (m) => formatDate(m.sentAt ?? m.createdAt, true) },
          { key: 'st', header: 'الحالة', cell: (m) => <StatusChip status={m.status} /> },
        ]} />
      )}
    </div>
  );
}

const STATUS_AR: Record<string, string> = { QUEUED: 'في الطابور', SENT: 'اتبعت', FAILED: 'فشل', SUPPRESSED: 'اتمنع', OPENED: 'اتفتح' };

/**
 * Operational view of message-notification delivery (last 24 h). Read-only: no message content, no push
 * endpoints, and no way to send anything to a participant from here.
 */
function DeliveryHealth({ h }: { h: Awaited<ReturnType<typeof deliveryHealth>> }) {
  const channels = ['IN_APP', 'PUSH', 'EMAIL'];
  const statuses = ['QUEUED', 'SENT', 'OPENED', 'SUPPRESSED', 'FAILED'];
  const cell = (c: string, s: string) => h.byStatus.find((r) => r.channel === c && r.status === s)?.n ?? 0;
  return (
    <div className="space-y-4" data-testid="notification-health">
      <div className="grid gap-3 md:grid-cols-3">
        {Object.entries(h.providers).map(([ch, v]) => (
          <div key={ch} className="card p-3 text-sm">
            <p className="ltr text-xs text-muted">{ch}</p>
            <p className="font-semibold">{v}</p>
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto p-3">
        <table className="w-full text-sm">
          <caption className="mb-2 text-start font-bold">رسائل اضمن — آخر 24 ساعة</caption>
          <thead>
            <tr className="text-muted">
              <th className="p-2 text-start">القناة</th>
              {statuses.map((s) => (
                <th key={s} className="p-2 text-start">
                  {STATUS_AR[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c} className="border-t border-line">
                <td className="ltr p-2 font-semibold">{c}</td>
                {statuses.map((s) => (
                  <td key={s} className="p-2" data-testid={`health-${c}-${s}`}>
                    {cell(c, s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-3 text-sm">
          <p className="mb-2 font-bold">أسباب المنع والفشل</p>
          {h.reasons.length === 0 ? <p className="text-muted">لا يوجد</p> : (
            <ul className="space-y-1">
              {h.reasons.map((r, i) => (
                <li key={i} className="flex justify-between gap-2"><span className="ltr">{r.channel} · {r.reason}</span><span>{STATUS_AR[r.status]}: {r.n}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div className="card space-y-1 p-3 text-sm">
          <p className="mb-2 font-bold">الطابور واشتراكات الإشعارات</p>
          {h.queue.length === 0 ? <p className="text-muted">لا يوجد شيء في الطابور</p> : h.queue.map((q) => <p key={q.channel}><span className="ltr">{q.channel}</span>: {q.n} (أقدم موعد: {formatDate(q.oldest, true)})</p>)}
          <p>أجهزة Push نشطة: {h.subscriptions?.active ?? 0} · ملغاة: {h.subscriptions?.revoked ?? 0} (منتهية {h.subscriptions?.expired ?? 0}، متعثرة {h.subscriptions?.failing ?? 0})</p>
        </div>
      </div>
      <div className="card p-3 text-sm">
        <p className="mb-2 font-bold">آخر حالات الفشل</p>
        {h.failures.length === 0 ? <p className="text-muted">لا يوجد</p> : (
          <ul className="space-y-1">
            {h.failures.map((f) => (
              <li key={f.id} className="ltr text-xs">{f.created_at.slice(0, 19)} · {f.channel} · {f.event} · {f.reason ?? '-'} · attempts {f.attempts}</li>
            ))}
          </ul>
        )}
      </div>
      <Alert tone="info">هذه البيانات تشغيلية فقط: وصول الإشعار أو فتحه ليس دليل تسليم أو استلام ولا يغيّر أي حالة مالية.</Alert>
    </div>
  );
}
