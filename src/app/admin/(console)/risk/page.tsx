import Link from '@/ui/link';
import { desc, eq, sql } from 'drizzle-orm';
import { riskFlagAction } from '@/app/_actions/admin';
import { riskFlags } from '@/server/db/schema';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { ShieldAlert } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { formatDate, formatEGP } from '@/lib/format';
import { PageHeader } from '@/ui/data';
import { Badge, EmptyState } from '@/ui/feedback';

export const metadata = { title: 'مؤشرات المخاطر' };

type Flag = { severity: 'HIGH' | 'MEDIUM' | 'LOW'; rule: string; subject: string; detail: string; href: string; at: string | null };
const SEV = { HIGH: { label: 'مرتفع', tone: 'danger' }, MEDIUM: { label: 'متوسط', tone: 'warning' }, LOW: { label: 'منخفض', tone: 'neutral' } } as const;

/**
 * Rule-based risk signals computed live from operational data (read-only).
 * They are prompts for human review — never automatic decisions.
 */
const FLAG_LABEL: Record<string, string> = { DELIVERY_CONFLICT: 'تعارض في التسليم', DELIVERY_EXCEPTION: 'تعذر التحقق من التسليم', ADMIN_HOLD: 'إيقاف إداري', MANUAL: 'ملاحظة يدوية' };

export default async function RiskFlags() {
  const { allowed } = await adminWith(['audit.view', 'finance.view']);
  const openFlags = allowed ? await db.select().from(riskFlags).where(eq(riskFlags.status, 'OPEN')).orderBy(desc(riskFlags.createdAt)).limit(200) : [];
  if (!allowed) return <Forbidden />;
  const [payoutChange, lockouts, rejectedProofs, holds, disputes, unconfirmed] = await Promise.all([
    db.execute<{ id: string; store: string | null; amount: string; at: string; method_at: string }>(sql`
      select w.id::text, st.name store, w.amount::text, w.created_at::text at, pm.created_at::text method_at
      from withdrawal_requests w join seller_payout_methods pm on pm.id = w.payout_method_id left join stores st on st.seller_id = w.seller_id
      where w.status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING') and w.created_at - pm.created_at < interval '72 hours'`),
    db.execute<{ key: string; count: number; at: string }>(sql`
      select key, max(count) count, max(window_start)::text at from rate_limits
      where window_start > now() - interval '24 hours' and ((key like 'login-id:%' and count >= 10) or (key like 'totp:%' and count >= 8))
      group by key order by at desc limit 50`),
    db.execute<{ user_id: string; name: string; n: string; at: string }>(sql`
      select u.id::text user_id, u.full_name name, count(*)::text n, max(s.created_at)::text at
      from payment_submissions s join users u on u.id = s.submitted_by
      where s.status = 'REJECTED' and s.created_at > now() - interval '90 days' group by u.id, u.full_name having count(*) >= 2`),
    db.execute<{ id: string; number: string; store: string | null; net: string; at: string }>(sql`
      select so.id::text, o.number::text, st.name store, so.seller_net::text net, so.updated_at::text at
      from seller_orders so join orders o on o.id = so.order_id left join stores st on st.seller_id = so.seller_id where so.financial_hold`),
    db.execute<{ seller_id: string; store: string | null; n: string; at: string }>(sql`
      select d.respondent_seller_id::text seller_id, st.name store, count(*)::text n, max(d.created_at)::text at
      from disputes d left join stores st on st.seller_id = d.respondent_seller_id
      where d.respondent_seller_id is not null and d.created_at > now() - interval '90 days' group by d.respondent_seller_id, st.name having count(*) >= 2`),
    db.execute<{ id: string; number: string; store: string | null; at: string }>(sql`
      select so.id::text, o.number::text, st.name store, coalesce(so.delivered_at, so.shipped_at)::text at
      from seller_orders so join orders o on o.id = so.order_id left join stores st on st.seller_id = so.seller_id
      where so.status in ('SHIPPED','DELIVERED') and coalesce(so.delivered_at, so.shipped_at) < now() - interval '10 days'`),
  ]);
  const flags: Flag[] = [
    ...payoutChange.rows.map((r) => ({ severity: 'HIGH' as const, rule: 'سحب بعد تغيير وسيلة الاستلام بأقل من 72 ساعة', subject: r.store ?? 'بائع', detail: `${formatEGP(Number(r.amount))} — الوسيلة أضيفت ${formatDate(r.method_at, true)}`, href: '/admin/withdrawals', at: r.at })),
    ...lockouts.rows.map((r) => ({ severity: 'HIGH' as const, rule: r.key.startsWith('totp:') ? 'محاولات رمز 2FA متكررة لحساب موظف' : 'محاولات دخول فاشلة متكررة', subject: r.key.startsWith('totp:') ? 'حساب إداري' : 'معرّف دخول (مُخفى)', detail: `${r.count} محاولة خلال النافذة`, href: '/admin/audit', at: r.at })),
    ...rejectedProofs.rows.map((r) => ({ severity: 'MEDIUM' as const, rule: 'إثباتات دفع مرفوضة متكررة (90 يوماً)', subject: r.name, detail: `${r.n} إثباتات مرفوضة`, href: `/admin/customers/${r.user_id}`, at: r.at })),
    ...disputes.rows.map((r) => ({ severity: 'MEDIUM' as const, rule: 'نزاعات متعددة ضد البائع (90 يوماً)', subject: r.store ?? 'بائع', detail: `${r.n} نزاعات`, href: `/admin/sellers/${r.seller_id}`, at: r.at })),
    ...holds.rows.map((r) => ({ severity: 'MEDIUM' as const, rule: 'طلب عليه تجميد مالي', subject: `طلب #${r.number} — ${r.store ?? ''}`, detail: `صافي البائع ${formatEGP(Number(r.net))} محجوز`, href: '/admin/orders', at: r.at })),
    ...unconfirmed.rows.map((r) => ({ severity: 'LOW' as const, rule: 'شحنة بلا تأكيد استلام لأكثر من 10 أيام', subject: `طلب #${r.number} — ${r.store ?? ''}`, detail: 'تحتاج متابعة مع المشتري', href: '/admin/orders?tab=followup', at: r.at })),
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="مؤشرات المخاطر" description="قواعد تُحسب مباشرة من بيانات التشغيل لتنبيه الفريق. هي إشارات للمراجعة البشرية فقط ولا تتخذ أي قرار تلقائي." />
      {flags.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="لا توجد مؤشرات حالياً" description="سيظهر هنا أي نمط يستدعي المراجعة." />
      ) : (
        <ul className="space-y-2">
          {flags.map((f, i) => (
            <li key={i} className="card flex flex-wrap items-start gap-3 p-4">
              <Badge tone={SEV[f.severity].tone}>{SEV[f.severity].label}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{f.rule}</p>
                <p className="text-sm text-muted">{f.subject} · {f.detail}</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                {f.at && <span>{formatDate(f.at, true)}</span>}
                <Link href={f.href} className="text-sm text-brand-700 hover:underline">مراجعة</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <section className="card space-y-3 p-5" data-testid="risk-flag-queue">
        <h2 className="font-bold">مؤشرات مسجلة مفتوحة ({openFlags.length})</h2>
        {openFlags.length === 0 ? (
          <p className="text-sm text-muted">لا توجد مؤشرات مفتوحة.</p>
        ) : (
          <ul className="divide-y divide-line">
            {openFlags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <Badge tone={f.severity === 'HIGH' ? 'danger' : 'warning'}>{FLAG_LABEL[f.code] ?? f.code}</Badge>
                <span className="min-w-0 flex-1">{f.note} · {formatDate(f.createdAt, true)}</span>
                <Link href={f.entityType === 'external_deal' ? `/admin/deals/${f.entityId}` : `/admin/sellers/${f.entityId}`} className="text-brand-700 hover:underline">فتح</Link>
                <ActionForm action={riskFlagAction} className="flex items-center gap-1">
                  <input type="hidden" name="op" value="resolve" />
                  <input type="hidden" name="flagId" value={f.id} />
                  <input type="hidden" name="entityType" value={f.entityType} />
                  <input type="hidden" name="entityId" value={f.entityId} />
                  <input type="hidden" name="back" value="/admin/risk" />
                  <input name="reason" required minLength={3} placeholder="سبب الإغلاق" aria-label="سبب إغلاق المؤشر" className="h-8 rounded border border-line px-2 text-xs" />
                  <SubmitButton size="sm" variant="outline">إغلاق</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
