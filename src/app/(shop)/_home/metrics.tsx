import { Package, ShieldCheck, Store, Users } from 'lucide-react';
import { MARKETING_METRICS, formatMetric, metricsVisible, type MetricKey } from '@/config/marketing-metrics';

/**
 * Metrics strip (approved reference). Values come ONLY from src/config/marketing-metrics.ts — owner-supplied
 * marketing figures, not live database statistics. Hidden in production until they are marked verified.
 */
export function MetricsStrip() {
  if (!metricsVisible(process.env.EDMN_ENVIRONMENT, MARKETING_METRICS)) return null;
  const items: { key: MetricKey; icon: typeof Users; label: string }[] = [
    { key: 'users', icon: Users, label: 'مستخدم' },
    { key: 'stores', icon: Store, label: 'متجر' },
    { key: 'products', icon: Package, label: 'منتج' },
    { key: 'satisfaction', icon: ShieldCheck, label: 'رضا العملاء' },
  ];
  return (
    <section aria-label="اضمن بالأرقام" className="rounded-2xl bg-gradient-to-l from-brand-50 via-[#f3f8ff] to-sky-50 ring-1 ring-brand-100">
      <ul className="grid grid-cols-2 lg:grid-cols-4">
        {items.map((it, i) => (
          <li key={it.key} className={`flex items-center justify-center gap-3 px-3 py-5 sm:gap-4 sm:py-6 ${i % 2 === 1 ? 'border-s border-brand-100' : ''} ${i >= 2 ? 'border-t border-brand-100 lg:border-t-0' : ''} ${i === 2 ? 'lg:border-s' : ''}`}>
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-brand-600 shadow-[var(--shadow-card)] ring-1 ring-brand-100 sm:size-14">
              <it.icon className="size-6 sm:size-7" aria-hidden />
            </span>
            <span className="leading-tight">
              <span dir="ltr" className="block text-2xl font-bold text-brand-700 sm:text-3xl">
                {formatMetric(it.key, MARKETING_METRICS)}
              </span>
              <span className="mt-1 block text-sm font-medium text-muted">{it.label}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
