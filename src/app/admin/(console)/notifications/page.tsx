import { desc } from 'drizzle-orm';
import { templateAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { notificationTemplates, outboundMessages } from '@/server/db/schema';
import { EVENT_TEMPLATES, type EventName } from '@/server/modules/notifications/events';
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
  const E = env();
  const ov = (e: string, ch: string) => overrides.find((o) => o.event === e && o.channel === ch);
  return (
    <div className="space-y-4">
      <PageHeader title="الإشعارات" description="قوالب الرسائل داخل المنصة والبريد والرسائل النصية، وسجل الرسائل الصادرة." />
      <Alert tone={E.MAIL_DRIVER === 'smtp' && E.SMS_DRIVER === 'http' ? 'success' : 'warning'}>البريد: {E.MAIL_DRIVER === 'smtp' ? `SMTP (${E.SMTP_HOST})` : 'وضع السجل فقط — لم يُعد مزود SMTP'} · SMS: {E.SMS_DRIVER === 'http' ? 'HTTP مُعد' : 'وضع السجل فقط — لم يُعد مزود رسائل'}</Alert>
      <Tabs active={tab} tabs={[{ key: 'templates', label: 'القوالب', href: '/admin/notifications' }, { key: 'outbox', label: 'الرسائل الصادرة', href: '/admin/notifications?tab=outbox' }]} />
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
          { key: 's', header: 'الموضوع', cell: (m) => m.subject ?? m.body.slice(0, 50) },
          { key: 'a', header: 'محاولات', cell: (m) => `${m.attempts}${m.lastError ? ` · ${m.lastError.slice(0, 40)}` : ''}` },
          { key: 'd', header: 'التاريخ', cell: (m) => formatDate(m.sentAt ?? m.createdAt, true) },
          { key: 'st', header: 'الحالة', cell: (m) => <StatusChip status={m.status} /> },
        ]} />
      )}
    </div>
  );
}
