import { describe, expect, it } from 'vitest';
import { applyBps, bpsToPercentString, MoneyError, parseEgp, parsePercentToBps, proportion, sum, toDecimalString } from '@/server/core/money';

describe('money (integer piasters, no floating point)', () => {
  it('parses EGP input including Arabic digits and separators', () => {
    expect(parseEgp('1250.5')).toBe(125050);
    expect(parseEgp('1,250.50')).toBe(125050);
    expect(parseEgp('١٢٥٠٫٥')).toBe(125050);
    expect(parseEgp('0.01')).toBe(1);
    expect(parseEgp(100)).toBe(10000);
  });
  it('rejects ambiguous / over-precise amounts', () => {
    expect(() => parseEgp('1.005')).toThrow(MoneyError);
    expect(() => parseEgp('abc')).toThrow(MoneyError);
    expect(() => parseEgp('')).toThrow(MoneyError);
  });
  it('applies basis points with half-up rounding', () => {
    expect(applyBps(10000, 450)).toBe(450); // 100 EGP × 4.5% = 4.50
    expect(applyBps(333, 1500)).toBe(50); // 49.95 → 50
    expect(applyBps(1, 5000)).toBe(1); // 0.5 → 1
    expect(applyBps(0, 1000)).toBe(0);
    expect(applyBps(9_000_000_000_000, 1300)).toBe(1_170_000_000_000); // large values stay exact
  });
  it('avoids the classic 0.1 + 0.2 float error', () => {
    expect(sum([10, 20])).toBe(30);
    expect(toDecimalString(sum([parseEgp('0.1'), parseEgp('0.2')]))).toBe('0.30');
  });
  it('computes proportional shares', () => {
    expect(proportion(1000, 50, 100)).toBe(500);
    expect(proportion(1001, 1, 3)).toBe(334);
    expect(proportion(0, 1, 3)).toBe(0);
  });
  it('converts percent strings to bps', () => {
    expect(parsePercentToBps('4.5')).toBe(450);
    expect(parsePercentToBps('13')).toBe(1300);
    expect(bpsToPercentString(450)).toBe('4.5');
    expect(bpsToPercentString(1300)).toBe('13');
    expect(() => parsePercentToBps('101')).toThrow();
  });
  it('rejects non-integer minor units', () => {
    expect(() => sum([1.5])).toThrow(MoneyError);
  });
});
