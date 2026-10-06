import Link from 'next/link';
import { desc, sql } from 'drizzle-orm';
import { closeDayAction, killSwitchAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { financialCloses } from '@/server/db/schema';
import { controlBalances, financialInvariants, goLiveGate, killSwitchStates } from '@/server/modules/finance/controls';
import { recentApprovals } from '@/server/modules/finance/approvals';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DefinitionList, PageHeader } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Input } from '@/ui/form';

export const metadata = { title: 'مركز الرقابة المالية' };

export default async function FinanceControl() {
  const { actor, allowed } = await adminWith(['finance.view', 'finance.controls']);
  if (!allowed) return <Forbidden />;
  const [bal, inv, switches, gate, approvals, closes] = await Promise.all([
    controlBalances(),
    financialInvariants(),
    killSwitchStates(),
    goLiveGate(),
    recentApprovals(30),
    db.select().from(financialCloses).orderBy(desc(financialCloses.businessDate)).limit(10),
  ]);
  const jobs = (await db.execute<{ failed: string; pending_old: string }>(sql`select
    (select count(*) from jobs where status = 'FAILED')::text failed,
    (select count(*) from jobs where status = 'PENDING' and run_at < now() - interval '1 hour')::text pending_old`)).rows[0];
  const outbound = (await db.execute<{ failed: string }>(sql`select count(*)::text failed from outbound_messages where status = 'FAILED'`)).rows[0];
  const canControl = hasPermission(actor, 'finance.controls');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(new Date().getTime() - 86400_000));
  return (
    <div className="space-y-4">
      <PageHeader title="مركز الرقابة المالية" description="أرصدة الرقابة من دفتر الأستاذ، اختبارات السلامة المالية، مفاتيح الإيقاف، الإقفال اليومي وبوابة تفعيل الأموال الحقيقية. لا يتم إصلاح أي فرق تلقائيًا." />
      {!inv.ok || inv.totals.difference !== 0 ? (
        <Alert tone="danger" title="تنبيه عالي الخطورة: مخالفات مالية">راجع البنود أدناه. لم يتم تعديل أي قيد أو رصيد.</Alert>
      ) : (
        <Alert tone="success" title="دفتر الأستاذ متوازن">الفرق 0.00 ج.م ولا توجد مخالفات.</Alert>
      )}
      <section className="card p-4">
        <h2 className="mb-2 font-bold">أرصدة الرقابة</h2>
        <DefinitionList
          items={[
            { label: 'LEDGER BALANCED', value: <b data-testid="ledger-balanced">{inv.totals.difference === 0 ? 'YES' : 'NO'}</b> },
            { label: 'إجمالي المدين / الدائن', value: `${formatEGP(inv.totals.debits)} / ${formatEGP(inv.totals.credits)}` },
            { label: 'الفرق', value: formatEGP(inv.totals.difference) },
            { label: 'النقدية المتوقعة (PLATFORM CASH)', value: formatEGP(bal.platformCash) },
            { label: 'التزام معلق للبائعين', value: formatEGP(bal.sellerPending) },
            { label: 'التزام متاح للبائعين', value: formatEGP(bal.sellerAvailable) },
            { label: 'محجوز للسحب', value: formatEGP(bal.withdrawalReserved) },
            { label: 'التزام استردادات للعملاء', value: formatEGP(bal.refundLiability) },
            { label: 'رسوم مؤجلة', value: formatEGP(bal.commissionDeferred) },
            { label: 'إيراد الرسوم', value: formatEGP(bal.commissionRevenue) },
            { label: 'أموال صفقات محجوزة / مستحقات بائعيها', value: `${formatEGP(bal.dealFundsHeld)} / ${formatEGP(bal.dealPayoutsPayable)}` },
            { label: 'مدفوعات غير مطابقة مع كشف', value: `${bal.unreconciledPayments.count} (${formatEGP(bal.unreconciledPayments.total)})` },
            { label: 'صرف غير مطابق مع كشف', value: `${bal.unreconciledPayouts.count} (${formatEGP(bal.unreconciledPayouts.total)})` },
            { label: 'مهام خلفية فاشلة / متأخرة', value: `${jobs.failed} / ${jobs.pending_old}` },
            { label: 'رسائل خارجية فاشلة', value: outbound.failed },
          ]}
        />
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">اختبارات السلامة المالية (Invariants)</h2>
        <ul className="space-y-1 text-sm">
          {inv.checks.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center gap-2" data-testid={`inv-${c.code}`}>
              <Badge tone={c.count ? 'danger' : 'success'}>{c.count}</Badge> {c.label} <span className="ltr text-xs text-muted">{c.code}</span>
              {c.count > 0 && <code className="ltr block w-full overflow-x-auto rounded bg-page p-2 text-[11px]">{JSON.stringify(c.sample).slice(0, 800)}</code>}
            </li>
          ))}
        </ul>
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">مفاتيح الإيقاف المالية</h2>
        <p className="mb-2 text-xs text-muted">توقف العمليات الجديدة فقط (لا تمس أي سجل قديم). تغييرها يتطلب تحققًا ثنائيًا وسببًا ويُسجل.</p>
        <ul className="space-y-2">
          {switches.map((k) => (
            <li key={k.key} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={k.paused ? 'danger' : 'success'}>{k.paused ? 'موقوف' : 'يعمل'}</Badge> {k.label}
              {canControl && (
                <ActionForm action={killSwitchAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="key" value={k.key} /><input type="hidden" name="paused" value={k.paused ? 'false' : 'true'} /><input type="hidden" name="back" value="/admin/finance-control" />
                  <Input name="reason" required minLength={3} placeholder="السبب" className="w-40" aria-label={`سبب تغيير ${k.label}`} />
                  <SubmitButton size="sm" variant="outline">{k.paused ? 'إعادة التشغيل' : 'إيقاف'}</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">الإقفال المالي اليومي</h2>
        {canControl && (
          <ActionForm action={closeDayAction} className="mb-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="back" value="/admin/finance-control" />
            <Input name="date" type="date" defaultValue={today} required aria-label="يوم العمل" className="w-44" />
            <SubmitButton size="sm">إقفال اليوم وحفظ تقرير الرقابة</SubmitButton>
          </ActionForm>
        )}
        <ul className="text-sm">{closes.map((c) => <li key={c.id}>{c.businessDate} · <Badge tone={c.balanced ? 'success' : 'danger'}>{c.balanced ? 'متوازن' : `${c.issues} مخالفة`}</Badge> · {formatDate(c.createdAt, true)}</li>)}</ul>
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">بوابة تفعيل الأموال الحقيقية</h2>
        <p className="mb-2 text-sm">النتيجة: <b data-testid="go-live">{gate.pass ? 'كل الشروط متحققة — ما زال يلزم قرار المالك' : 'مرفوض (Fail closed)'}</b> · الإتاحة التلقائية للبائعين: معطلة دائمًا.</p>
        <ul className="list-disc ps-5 text-sm">{gate.blockers.map((b) => <li key={b.code}>{b.label} <span className="ltr text-xs text-muted">{b.code}</span></li>)}</ul>
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">آخر الموافقات المالية</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted"><tr><th className="p-1 text-start">العملية</th><th className="p-1 text-start">الكيان</th><th className="p-1 text-start">المبلغ</th><th className="p-1 text-start">الحالة</th><th className="p-1 text-start">رقابة مزدوجة</th><th className="p-1 text-start">الوقت</th></tr></thead>
            <tbody>{approvals.map((a) => <tr key={a.id} className="border-t border-line"><td className="p-1">{label('financialAction', a.action)}</td><td className="ltr p-1">{a.entityType}:{a.entityId.slice(0, 8)}</td><td className="p-1">{formatEGP(a.amount)}</td><td className="p-1"><StatusChip status={a.status} /></td><td className="p-1">{a.dualControl ? 'نعم' : '—'}</td><td className="p-1">{formatDate(a.createdAt, true)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <p className="text-sm"><Link className="text-brand-700" href="/admin/reconciliation">المطابقة مع كشوف الحسابات</Link> · <Link className="text-brand-700" href="/admin/releases">إتاحة أرباح البائعين</Link> · <Link className="text-brand-700" href="/admin/refunds">الاستردادات</Link> · <Link className="text-brand-700" href="/admin/operations">طوابير العمليات</Link></p>
    </div>
  );
}
