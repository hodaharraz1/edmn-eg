import { ledgerHealthAction, requeueDeadLetterAction } from '@/app/_actions/admin';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { outboundMessages } from '@/server/db/schema';
import { SECRET_EVENTS } from '@/server/modules/notifications/outbox';
import { Input } from '@/ui/form';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { deepHealth } from '@/server/ops/health';
import { formatDate, formatNumber } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DefinitionList, PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';

export const metadata = { title: 'صحة التشغيل' };
export const dynamic = 'force-dynamic';

const TONE = { OK: 'success', RUNNING: 'neutral', STALE: 'warning', FAILING: 'danger', NEVER_RAN: 'warning' } as const;
const when = (d: Date | string | null) => (d ? formatDate(d, true) : '—');

/** Admin/Ops deep health (Batch 2): environment, fingerprint, jobs, outbox, ledger health, providers. Read-only. */
export default async function OpsHealth() {
  const { actor, allowed } = await adminWith(['settings.manage', 'finance.controls', 'notifications.manage']);
  if (!allowed) return <Forbidden />;
  const h = await deepHealth();
  const canRequeue = hasPermission(actor, 'notifications.manage');
  const dead = canRequeue ? await db.select({ id: outboundMessages.id, channel: outboundMessages.channel, event: outboundMessages.event, attempts: outboundMessages.attempts, lastError: outboundMessages.lastError, deadLetteredAt: outboundMessages.deadLetteredAt }).from(outboundMessages).where(eq(outboundMessages.status, 'FAILED')).orderBy(desc(outboundMessages.createdAt)).limit(20) : [];
  return (
    <div className="space-y-4">
      <PageHeader title="صحة التشغيل" description="فحص عميق للبيئة والمهام المجدولة والرسائل وسلامة الدفتر ومزودي الخدمات. للقراءة فقط — مفيش أي حاجة هنا بتحرك فلوس." />
      {h.alerts.length > 0 ? (
        <Alert tone="danger" title="تنبيهات تشغيل">
          <ul className="list-inside list-disc" data-testid="ops-alerts">{h.alerts.map((a) => <li key={a}>{a}</li>)}</ul>
        </Alert>
      ) : (
        <Alert tone="success">لا توجد تنبيهات تشغيل فوق الحدود المضبوطة.</Alert>
      )}
      <section className="card p-4" data-testid="ops-environment">
        <h2 className="mb-2 font-bold">البيئة</h2>
        <DefinitionList
          items={[
            { label: 'نوع البيئة', value: <Badge tone={h.environment === 'PRODUCTION' ? 'danger' : 'neutral'}>{h.environment}</Badge> },
            { label: 'الجاهزية', value: <Badge tone={h.ready.ready ? 'success' : 'danger'}>{h.ready.ready ? 'جاهز' : 'غير جاهز'}</Badge> },
            { label: 'بصمة البيئة', value: <span><Badge tone={h.fingerprint.status === 'OK' ? 'success' : 'danger'}>{h.fingerprint.status}</Badge> <span className="ltr text-xs">db={String(h.fingerprint.database)} · {h.fingerprint.storage} · key={h.fingerprint.key}</span></span> },
            { label: 'الترحيلات', value: <span className="ltr">{h.migrations.applied} / {h.migrations.expected} ({h.migrations.latest})</span> },
          ]}
        />
        {h.fingerprint.reasons.length > 0 && <Alert tone="danger" className="mt-2">{h.fingerprint.reasons.join(' · ')}</Alert>}
        {(h.configuration.errors.length > 0 || h.configuration.warnings.length > 0) && (
          <ul className="mt-2 space-y-1 text-xs ltr">{[...h.configuration.errors.map((e) => `ERROR ${e}`), ...h.configuration.warnings.map((w) => `WARN ${w}`)].map((x) => <li key={x}>{x}</li>)}</ul>
        )}
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer">متغيرات البيئة (أسماء وتصنيف فقط — بدون أي قيمة)</summary>
          <table className="mt-2 w-full ltr"><tbody>{h.configuration.variables.map((v) => <tr key={v.name} className="border-t border-line"><td className="p-1">{v.name}</td><td className="p-1">{v.classification}{v.secret ? ' · SECRET' : ''}</td><td className="p-1">{v.present ? 'set' : v.requiredHere ? 'MISSING' : '—'}</td></tr>)}</tbody></table>
        </details>
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">المهام المجدولة</h2>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="المهام المجدولة">
          <table className="w-full min-w-[640px] text-sm" data-testid="ops-jobs">
            <thead><tr className="text-xs text-muted"><th className="p-2 text-start">المهمة</th><th className="p-2 text-start">الحالة</th><th className="p-2 text-start">آخر نجاح</th><th className="p-2 text-start">المتوقع التالي</th><th className="p-2 text-start">إخفاقات متتالية</th></tr></thead>
            <tbody>{h.jobs.map((j) => <tr key={j.name} className="border-t border-line"><td className="p-2 ltr">{j.name}</td><td className="p-2"><Badge tone={TONE[j.health]}>{j.health}</Badge></td><td className="p-2">{when(j.lastSucceededAt)}</td><td className="p-2">{when(j.nextExpectedAt)}</td><td className="p-2 tabular-nums">{j.consecutiveFailures}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">على Vercel Hobby المجدول اليومي مرة واحدة والباقي بيشتغل مع الزيارات — «STALE» هنا متوقعة على Staging ومش دليل على تشغيل إنتاج.</p>
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">الرسائل والمزودون</h2>
        <DefinitionList
          items={[
            { label: 'في الطابور / مستحقة', value: `${formatNumber(h.outbox.pending)} / ${formatNumber(h.outbox.due)}` },
            { label: 'فشل نهائي (dead letter)', value: formatNumber(h.outbox.deadLetters) },
            { label: 'اتسلمت للمزود (24 ساعة)', value: formatNumber(h.outbox.sent24h) },
            { label: 'اتأكد وصولها من المزود (24 ساعة)', value: formatNumber(h.outbox.delivered24h) },
            { label: 'البريد', value: h.providers.email },
            { label: 'SMS', value: h.providers.sms },
            { label: 'إشعارات المتصفح', value: h.providers.push },
            { label: 'فحص الفيروسات', value: h.providers.malwareScanner },
            { label: 'تتبع الأخطاء', value: `${h.errors.tracking} — آخر ساعة: ${h.errors.lastHour}` },
          ]}
        />
      </section>
      {canRequeue && dead.length > 0 && (
        <section className="card p-4" data-testid="ops-dead-letters">
          <h2 className="mb-2 font-bold">رسائل فشلت نهائيًا (آخر 20)</h2>
          <p className="mb-2 text-xs text-muted">الرسائل الأمنية (رموز وروابط) محتواها اتمسح ومش بترجع للطابور — المستخدم يطلب رمز جديد.</p>
          <ul className="space-y-2 text-sm">
            {dead.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                <span className="ltr text-xs">{m.channel} · {m.event} · {m.attempts}×</span>
                <span className="ltr min-w-0 flex-1 break-all text-xs text-muted">{m.lastError}</span>
                {!SECRET_EVENTS.includes(m.event ?? '') && (
                  <ActionForm action={requeueDeadLetterAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={m.id} /><input type="hidden" name="back" value="/admin/ops" />
                    <Input name="reason" required minLength={3} placeholder="السبب" className="w-32" aria-label="سبب إعادة الإرسال" />
                    <SubmitButton size="sm" variant="outline">إعادة للطابور</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card p-4" data-testid="ops-ledger">
        <h2 className="mb-2 font-bold">سلامة دفتر الأستاذ (قراءة فقط)</h2>
        {h.ledger ? (
          <DefinitionList
            items={[
              { label: 'الحالة', value: <Badge tone={h.ledger.status === 'OK' ? 'success' : h.ledger.status === 'WARNING' ? 'warning' : 'danger'}>{h.ledger.status}</Badge> },
              { label: 'مدين / دائن / فرق', value: <span className="ltr tabular-nums">{h.ledger.debits} / {h.ledger.credits} / {h.ledger.difference}</span> },
              { label: 'مخالفات حرجة', value: <span className="ltr">{JSON.stringify(h.ledger.criticalChecks)}</span> },
              { label: 'تنبيهات', value: <span className="ltr">{JSON.stringify(h.ledger.warningChecks)}</span> },
              { label: 'وقت الفحص', value: when(h.ledger.checkedAt) },
            ]}
          />
        ) : (
          <p className="text-sm text-muted">لم يتم أي فحص بعد.</p>
        )}
        {hasPermission(actor, 'finance.controls') && (
          <ActionForm action={ledgerHealthAction} className="mt-2">
            <input type="hidden" name="back" value="/admin/ops" />
            <SubmitButton size="sm" variant="outline">شغّل فحص الآن</SubmitButton>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
