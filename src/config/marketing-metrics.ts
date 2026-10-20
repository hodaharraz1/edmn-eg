/**
 * Homepage marketing metrics — the ONE place these numbers live.
 *
 * These are owner-supplied MARKETING VALUES for the staging visual presentation (owner instruction, 2026-10-16).
 * They are NOT computed from the database and must never be presented as live statistics.
 * Before any public launch, replace them with verified figures (or wire `source: 'database'` to real counts)
 * and set `verified: true`. While `verified` is false the strip is shown on staging only (see `metricsVisible`),
 * so unverified marketing claims cannot reach production users by accident.
 */
export const MARKETING_METRICS = {
  verified: false,
  source: 'marketing' as 'marketing' | 'database',
  users: 5000,
  stores: 500,
  products: 10000,
  satisfactionPercent: 95,
};

export type MetricKey = 'users' | 'stores' | 'products' | 'satisfaction';

/** UI formatting: counts render as "+5,000"; satisfaction as "95%". Latin digits, as in the approved reference. */
export function formatMetric(key: MetricKey, m = MARKETING_METRICS): string {
  if (key === 'satisfaction') return `${m.satisfactionPercent}%`;
  return `+${m[key].toLocaleString('en-US')}`;
}

export function metricsVisible(environment: string | undefined, m = MARKETING_METRICS): boolean {
  return m.verified || environment !== 'production';
}
