import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { rangeFromPreset, sellerDashboard } from '@/server/modules/reports/service';
import { sellerContextForUser } from '@/server/modules/sellers/service';
import { requireUser } from '@/server/web/session';
import { PageHeader } from '@/ui/data';
import { SellerStatusGate } from '@/app/_components/seller-gate';

export const metadata = { title: 'صحة الحساب' };

/** Targets are operational guidelines (configurable policy later), shown transparently to sellers. */
const TARGETS = { cancellation: 0.025, returns: 0.1, onTime: 0.9, rating: 4 };

export default async function HealthPage() {
  const user = await requireUser('/seller');
  const ctx = (await sellerContextForUser(user.id))!;
  const d = await sellerDashboard(ctx.seller.id, rangeFromPreset('90d'));
  // Risk flags are internal Operations notes and are never shown to the seller.
  const rows = [
    { label: 'نسبة الإلغاء من البائع', value: d.cancellationRate, ok: d.cancellationRate <= TARGETS.cancellation, target: `أقل من ${TARGETS.cancellation * 100}%`, fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
    { label: 'نسبة المرتجعات', value: d.returnRate, ok: d.returnRate <= TARGETS.returns, target: `أقل من ${TARGETS.returns * 100}%`, fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
    { label: 'الشحن في الموعد', value: d.onTimeRate ?? 1, ok: (d.onTimeRate ?? 1) >= TARGETS.onTime, target: `أعلى من ${TARGETS.onTime * 100}%`, fmt: (v: number) => (d.onTimeRate === null ? '—' : `${(v * 100).toFixed(0)}%`) },
    { label: 'تقييم البائع', value: d.rating, ok: d.ratingCount === 0 || d.rating >= TARGETS.rating, target: `${TARGETS.rating} فأكثر`, fmt: (v: number) => (d.ratingCount ? v.toFixed(1) : 'لا توجد تقييمات') },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="صحة الحساب" description="مؤشرات آخر 90 يوماً. الحفاظ عليها يحمي متجرك من التقييد." />
      <SellerStatusGate seller={ctx.seller} />
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className={`card flex items-center gap-3 p-4 ${r.ok ? '' : 'border-amber-300'}`}>
            {r.ok ? <CheckCircle2 className="size-8 text-emerald-600" /> : <AlertTriangle className="size-8 text-amber-600" />}
            <div>
              <p className="text-sm text-muted">{r.label}</p>
              <p className="text-xl font-bold">{r.fmt(r.value)}</p>
              <p className="text-xs text-muted">الهدف: {r.target}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
