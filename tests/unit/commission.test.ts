import { describe, expect, it } from 'vitest';
import { bpsForUnitPrice, computeLineCommission } from '@/server/modules/finance/commissions';

describe('commission engine', () => {
  const flat = { percentBps: 450, tiers: null, minFee: null };
  it('computes a flat category percentage on the line total', () => {
    expect(computeLineCommission(flat, 1_899_900, 1)).toEqual({ bps: 450, amount: 85_496 }); // 18,999 × 4.5% = 854.955 → 854.96
    expect(computeLineCommission(flat, 10_000, 3)).toEqual({ bps: 450, amount: 1_350 });
  });
  it('selects a price-band tier by unit price', () => {
    const tiered = { percentBps: 1500, tiers: [{ upTo: 30_000, bps: 500 }, { upTo: null, bps: 1500 }], minFee: null };
    expect(bpsForUnitPrice(tiered, 20_000)).toBe(500);
    expect(bpsForUnitPrice(tiered, 30_000)).toBe(500);
    expect(bpsForUnitPrice(tiered, 30_001)).toBe(1500);
  });
  it('applies a minimum fee but never more than the line total', () => {
    const withMin = { percentBps: 100, tiers: null, minFee: 500 };
    expect(computeLineCommission(withMin, 1_000, 1).amount).toBe(500);
    expect(computeLineCommission(withMin, 300, 1).amount).toBe(300);
  });
  it('is deterministic', () => {
    const a = computeLineCommission(flat, 123_456, 7);
    const b = computeLineCommission(flat, 123_456, 7);
    expect(a).toEqual(b);
  });
});
