import { describe, expect, it } from 'vitest';
import { MARKETING_METRICS, formatMetric, metricsVisible } from '@/config/marketing-metrics';

describe('homepage marketing metrics (single configurable source)', () => {
  it('formats counts with a plus sign and grouping, satisfaction as a percentage', () => {
    const m = { ...MARKETING_METRICS, users: 5000, stores: 500, products: 10000, satisfactionPercent: 95 };
    expect(formatMetric('users', m)).toBe('+5,000');
    expect(formatMetric('stores', m)).toBe('+500');
    expect(formatMetric('products', m)).toBe('+10,000');
    expect(formatMetric('satisfaction', m)).toBe('95%');
  });
  it('unverified marketing values never reach production', () => {
    expect(metricsVisible('staging', { ...MARKETING_METRICS, verified: false })).toBe(true);
    expect(metricsVisible('production', { ...MARKETING_METRICS, verified: false })).toBe(false);
    expect(metricsVisible('production', { ...MARKETING_METRICS, verified: true })).toBe(true);
  });
});
