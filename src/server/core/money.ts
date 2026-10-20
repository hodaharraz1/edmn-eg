/**
 * Money primitives.
 *
 * ALL monetary values are integers in MINOR UNITS (piasters; 1 EGP = 100 piasters).
 * Binary floating point is never used for money. Percentages are expressed in BASIS POINTS
 * (1 bp = 0.01%, so 450 bps = 4.5%).
 */
export const CURRENCY = 'EGP' as const;
export type Currency = typeof CURRENCY;
export type Minor = number; // integer piasters — always validated with assertMinor

export class MoneyError extends Error {}

export function assertMinor(v: number, label = 'amount'): Minor {
  if (!Number.isSafeInteger(v)) throw new MoneyError(`${label} must be an integer number of minor units, got ${v}`);
  return v;
}

export function assertNonNegative(v: number, label = 'amount'): Minor {
  assertMinor(v, label);
  if (v < 0) throw new MoneyError(`${label} must not be negative`);
  return v;
}

export function sum(values: readonly number[]): Minor {
  let total = 0;
  for (const v of values) total += assertMinor(v);
  return assertMinor(total, 'sum');
}

export function multiply(unit: Minor, qty: number): Minor {
  assertMinor(unit, 'unit');
  if (!Number.isSafeInteger(qty)) throw new MoneyError('quantity must be an integer');
  return assertMinor(unit * qty, 'product');
}

/**
 * amount × bps / 10000, rounded half-up (away from zero for positive values).
 * Uses BigInt internally so intermediate products can never lose precision.
 */
export function applyBps(amount: Minor, bps: number): Minor {
  assertMinor(amount);
  if (!Number.isSafeInteger(bps) || bps < 0) throw new MoneyError('bps must be a non-negative integer');
  const neg = amount < 0;
  const a = BigInt(Math.abs(amount)) * BigInt(bps);
  const q = (a + 5000n) / 10000n;
  const r = Number(q);
  return neg ? -r : r;
}

/** Proportional share: total × part / whole, rounded half-up. Used for proportional commission reversals. */
export function proportion(total: Minor, part: Minor, whole: Minor): Minor {
  assertMinor(total);
  assertMinor(part);
  assertMinor(whole);
  if (whole === 0) return 0;
  const n = BigInt(total) * BigInt(part) * 2n + BigInt(whole);
  const d = BigInt(whole) * 2n;
  return Number(n / d);
}

/** Parse a user-entered EGP amount ("1,250.50", "١٢٥٠٫٥") into piasters. Rejects >2 decimals. */
export function parseEgp(input: string | number | null | undefined): Minor {
  if (input === null || input === undefined) throw new MoneyError('amount is required');
  let s = String(input).trim();
  s = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  s = s.replace(/٫/g, '.').replace(/[,،\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new MoneyError('invalid amount format');
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return assertMinor(neg ? -minor : minor);
}

/** Convert a percent string ("4.5") into basis points (450). Max 2 decimals. */
export function parsePercentToBps(input: string | number): number {
  const s = String(input).trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw new MoneyError('invalid percentage');
  const [w, f = ''] = s.split('.');
  const bps = Number(w) * 100 + Number((f + '00').slice(0, 2));
  if (bps > 10000) throw new MoneyError('percentage cannot exceed 100');
  return bps;
}

export function bpsToPercentString(bps: number): string {
  const w = Math.floor(bps / 100);
  const f = bps % 100;
  return f === 0 ? String(w) : `${w}.${String(f).padStart(2, '0').replace(/0$/, '')}`;
}

/** Plain decimal string for forms/exports, e.g. 125050 -> "1250.50" */
export function toDecimalString(minor: Minor): string {
  assertMinor(minor);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
