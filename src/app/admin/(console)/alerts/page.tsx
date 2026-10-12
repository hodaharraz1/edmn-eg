import { desc, isNull } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { alertStates } from '@/server/db/schema';
import { alertInventory } from '@/server/modules/alerts/engine';
import { getSetting } from '@/server/modules/settings';
import { formatDate, formatNumber } from '@/lib/format';
import { PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';

export const metadata = { title: 'التنبيهات الاستباقية' };

const STAGE = { PRE_DEADLINE: 'تذكير قبل الموعد', DUE: 'مطلوب الآن', OVERDUE: 'متأخر', RESOLVED: 'انتهى' } as const;

export default async function AlertsInventory() {
  const { allowed } = await adminWith(['notifications.manage', 'settings.manage']);
  if (!allowed) return <Forbidden />;
  const rules = alertInventory();
  const overrides = await getSetting('alerts.rules');
  const open = await db.select().from(alertStates).where(isNull(alertStates.resolvedAt)).orderBy(desc(alertStates.updatedAt)).limit(100);
  const byRule = new Map<string, number>();
  for (const a of open) byRule.set(a.rule, (byRule.get(a.rule) ?? 0) + 1);
  return (
    <div className="space-y-4">
      <PageHeader title="التنبيهات الاستباقية" description="تنبيهات قبل المواعيد وعند حلولها وبعد التأخر، مع منع التكرار وفترات تهدئة، وتنتهي تلقائيًا لما الحالة تتحل. التنبيهات تُعلم الناس فقط ولا تحرك أي مبلغ ولا تغير أي حالة." />
      <Alert tone="info">القنوات: داخل التطبيق + البريد الإلكتروني (لو مضبوط) + إشعارات المتصفح حسب تفضيلات المستخدم. لا توجد رسائل SMS. نص التنبيه يحتوي مرجع فقط — بدون بيانات هوية أو حسابات أو رموز.</Alert>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="جدول قواعد التنبيهات">
        <table className="w-full min-w-[720px] text-sm" data-testid="alert-inventory">
          <thead><tr className="text-start text-xs text-muted"><th className="p-2 text-start">القاعدة</th><th className="p-2 text-start">الفئة</th><th className="p-2 text-start">المستلمون</th><th className="p-2 text-start">قبل الموعد / تهدئة / تقادم (ساعات)</th><th className="p-2 text-start">مفتوحة الآن</th></tr></thead>
          <tbody>
            {rules.map((r) => {
              const o = overrides[r.code] ?? {};
              return (
                <tr key={r.code} className="border-t border-line">
                  <td className="p-2"><b>{r.title}</b><span className="block text-xs text-muted ltr">{r.code}</span>{o.enabled === false && <Badge tone="danger">معطلة</Badge>}</td>
                  <td className="p-2">{r.category}</td>
                  <td className="p-2 text-xs">{r.staffPermission ? `فريق بصلاحية ${r.staffPermission}` : 'أطراف المعاملة'}</td>
                  <td className="p-2 tabular-nums">{o.preHours ?? r.defaults.preHours} / {o.cooldownHours ?? r.defaults.cooldownHours} / {o.agingHours ?? r.defaults.agingHours ?? '—'}</td>
                  <td className="p-2 tabular-nums">{formatNumber(byRule.get(r.code) ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">آخر التنبيهات المفتوحة</h2>
        <ul className="space-y-1 text-sm">
          {open.slice(0, 30).map((a) => <li key={a.id}><Badge>{STAGE[a.stage]}</Badge> {a.rule} · {String((a.metadata as { ref?: string }).ref ?? '')} · أُرسلت {a.sentCount} مرة · {formatDate(a.lastSentAt, true)}</li>)}
        </ul>
      </section>
    </div>
  );
}
