/**
 * EDMN fee engine — pure, deterministic, integer-only (BigInt). No floats anywhere.
 *
 * Canonical boundary convention (piastres): tier k covers the slice (lower_k, upper_k] of the fee base;
 * the first tier starts at 0 (0 <= amount <= 5,000.00 EGP is tier 1; 5,000.01 … is tier 2).
 * Progressive / marginal: each slice is charged at its own rate (never a cliff).
 *
 * Rounding (one rule everywhere):
 *   T = Σ slice × total_bps     B = Σ slice × buyer_bps      (exact, in piastre·bps)
 *   total = round_half_up(T / 10000)     buyer = round_half_up(B / 10000)     seller = total − buyer
 * Minimum: if total < min → total = min, buyer = round_half_up(min × B / T) (the split that would
 * otherwise apply; for a zero base the first tier's split), seller = min − buyer.
 * total is monotonic non-decreasing in the amount (T is, rounding preserves order, max(min, ·) too).
 */

export interface TierInput {
  lowerBound: number;
  upperBound: number | null;
  buyerBps: number;
  sellerBps: number;
  totalBps: number;
}

export interface FeeComponent {
  lowerBound: number;
  upperBound: number | null;
  amountInTier: number;
  buyerBps: number;
  sellerBps: number;
  totalBps: number;
}

export interface FeeResult {
  base: number;
  total: number;
  buyer: number;
  seller: number;
  minApplied: boolean;
  /** Exact numerators (piastre·bps) — kept as strings so snapshots are JSON-safe. */
  exactTotal: string;
  exactBuyer: string;
  components: FeeComponent[];
}

const TEN_K = 10000n;

/** round_half_up(n / d) for non-negative BigInts. */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error('divisor must be positive');
  if (n < 0n) throw new Error('negative numerator');
  return (n * 2n + d) / (2n * d);
}

function toMinor(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('amount out of range');
  return n;
}

function assertAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('fee base must be a non-negative integer number of piastres');
}

/** Sort and sanity-check tiers (the full publication validator is in validation.ts). */
export function orderedTiers(tiers: TierInput[]): TierInput[] {
  const t = [...tiers].sort((a, b) => a.lowerBound - b.lowerBound);
  if (!t.length) throw new Error('no tiers');
  for (const x of t) if (x.buyerBps + x.sellerBps !== x.totalBps) throw new Error('buyer + seller ≠ total');
  return t;
}

/** Exact progressive numerators for one fee base. */
export function progressiveExact(amount: number, tiers: TierInput[]): { T: bigint; B: bigint; components: FeeComponent[] } {
  assertAmount(amount);
  const ordered = orderedTiers(tiers);
  let T = 0n;
  let B = 0n;
  const components: FeeComponent[] = [];
  for (const tier of ordered) {
    if (amount <= tier.lowerBound) break;
    const top = tier.upperBound === null ? amount : Math.min(amount, tier.upperBound);
    const slice = top - tier.lowerBound;
    if (slice <= 0) continue;
    T += BigInt(slice) * BigInt(tier.totalBps);
    B += BigInt(slice) * BigInt(tier.buyerBps);
    components.push({ lowerBound: tier.lowerBound, upperBound: tier.upperBound, amountInTier: slice, buyerBps: tier.buyerBps, sellerBps: tier.sellerBps, totalBps: tier.totalBps });
  }
  return { T, B, components };
}

/** Apply rounding + minimum to exact numerators. */
export function finalizeFee(T: bigint, B: bigint, minFee: number, fallbackSplit: { buyerBps: number; totalBps: number }): { total: number; buyer: number; minApplied: boolean } {
  let total = divRoundHalfUp(T, TEN_K);
  let buyer = divRoundHalfUp(B, TEN_K);
  let minApplied = false;
  const min = BigInt(minFee);
  if (total < min) {
    minApplied = true;
    total = min;
    if (T > 0n) buyer = divRoundHalfUp(min * B, T);
    else if (fallbackSplit.totalBps > 0) buyer = divRoundHalfUp(min * BigInt(fallbackSplit.buyerBps), BigInt(fallbackSplit.totalBps));
    else buyer = 0n;
  }
  if (buyer > total) buyer = total;
  return { total: toMinor(total), buyer: toMinor(buyer), minApplied };
}

/** Fee for one fee unit (a protected deal, or one class group when used directly). */
export function computeFee(amount: number, tiers: TierInput[], minFee: number): FeeResult {
  const { T, B, components } = progressiveExact(amount, tiers);
  const first = orderedTiers(tiers)[0];
  const f = finalizeFee(T, B, minFee, first);
  return { base: amount, total: f.total, buyer: f.buyer, seller: f.total - f.buyer, minApplied: f.minApplied, exactTotal: T.toString(), exactBuyer: B.toString(), components };
}

/**
 * Split an integer total into parts proportional to integer weights (largest remainder, ties by index).
 * Σ parts = total exactly. Zero weights receive 0 (unless every weight is 0 → all to index 0).
 */
export function allocate(total: number, weights: (number | bigint)[]): number[] {
  if (!weights.length) return [];
  const w = weights.map((x) => BigInt(x));
  const sum = w.reduce((a, b) => a + b, 0n);
  const T = BigInt(total);
  if (sum === 0n) return w.map((_, i) => (i === 0 ? total : 0));
  const floors = w.map((x) => (T * x) / sum);
  let rest = T - floors.reduce((a, b) => a + b, 0n);
  const order = w
    .map((x, i) => ({ i, rem: (T * x) % sum }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const o of order) {
    if (rest <= 0n) break;
    if (w[o.i] === 0n) continue;
    floors[o.i] += 1n;
    rest -= 1n;
  }
  return floors.map(toMinor);
}

/* ─────────────── Marketplace: one seller sub-order (fee unit) ─────────────── */

export interface MarketLineInput {
  key: string;
  lineTotal: number;
  economicClass: string;
}

export interface MarketGroupResult {
  economicClass: string;
  base: number;
  exactTotal: string;
  exactBuyer: string;
  components: FeeComponent[];
  total: number;
  buyer: number;
  seller: number;
}

export interface MarketLineFee {
  key: string;
  economicClass: string;
  total: number;
  buyer: number;
  seller: number;
}

export interface MarketFeeResult {
  base: number;
  total: number;
  buyer: number;
  seller: number;
  minApplied: boolean;
  groups: MarketGroupResult[];
  lines: MarketLineFee[];
}

/**
 * Marketplace fee for one seller sub-order. Lines are grouped by economic class; each class group is
 * priced progressively on its own subtotal (a mixed basket is never classified by one category);
 * the minimum applies to the whole sub-order. Group fees are allocated to lines by line value
 * (largest remainder), buyer shares by the line's fee. Σ lines = Σ groups = sub-order fee, exactly.
 */
export function computeMarketplaceFee(lines: MarketLineInput[], tiersByClass: Record<string, TierInput[]>, minFee: number): MarketFeeResult {
  const classes: string[] = [];
  for (const l of lines) {
    assertAmount(l.lineTotal);
    if (!tiersByClass[l.economicClass]?.length) throw new Error(`no tiers for class ${l.economicClass}`);
    if (!classes.includes(l.economicClass)) classes.push(l.economicClass);
  }
  const exact = classes.map((c) => {
    const base = lines.filter((l) => l.economicClass === c).reduce((a, l) => a + l.lineTotal, 0);
    return { c, base, ...progressiveExact(base, tiersByClass[c]) };
  });
  const base = exact.reduce((a, g) => a + g.base, 0);
  const sumT = exact.reduce((a, g) => a + g.T, 0n);
  const sumB = exact.reduce((a, g) => a + g.B, 0n);
  const firstClass = classes[0] ?? Object.keys(tiersByClass)[0];
  const fin = finalizeFee(sumT, sumB, minFee, orderedTiers(tiersByClass[firstClass])[0]);
  // Group totals: each group rounded on its own unless the minimum applies (then allocated by exact T).
  let groupTotals: number[];
  let groupBuyers: number[];
  if (!fin.minApplied) {
    groupTotals = exact.map((g) => toMinor(divRoundHalfUp(g.T, TEN_K)));
    groupBuyers = exact.map((g, i) => Math.min(toMinor(divRoundHalfUp(g.B, TEN_K)), groupTotals[i]));
  } else {
    groupTotals = allocate(fin.total, exact.map((g) => (sumT > 0n ? g.T : BigInt(g.base))));
    groupBuyers = allocate(fin.buyer, groupTotals);
  }
  const total = groupTotals.reduce((a, b) => a + b, 0);
  const buyer = groupBuyers.reduce((a, b) => a + b, 0);
  const groups: MarketGroupResult[] = exact.map((g, i) => ({
    economicClass: g.c,
    base: g.base,
    exactTotal: g.T.toString(),
    exactBuyer: g.B.toString(),
    components: g.components,
    total: groupTotals[i],
    buyer: groupBuyers[i],
    seller: groupTotals[i] - groupBuyers[i],
  }));
  const out: MarketLineFee[] = [];
  for (const g of groups) {
    const gl = lines.filter((l) => l.economicClass === g.economicClass);
    const totals = allocate(g.total, gl.map((l) => l.lineTotal));
    const buyers = allocate(g.buyer, totals);
    gl.forEach((l, i) => out.push({ key: l.key, economicClass: g.economicClass, total: totals[i], buyer: buyers[i], seller: totals[i] - buyers[i] }));
  }
  const ordered = lines.map((l) => out.find((o) => o.key === l.key)!);
  return { base, total, buyer, seller: total - buyer, minApplied: fin.minApplied, groups, lines: ordered };
}

/** Effective rate of a fee on a base, in bps, rounded half-up (display / legacy column only). */
export function effectiveBps(fee: number, base: number): number {
  if (base <= 0) return 0;
  return toMinor(divRoundHalfUp(BigInt(fee) * TEN_K, BigInt(base)));
}

/* ─────────────── Owner-approved initial configuration (seed data, not calculation logic) ─────────────── */

const EGP = (n: number) => Math.round(n * 100);

export const OWNER_APPROVED_MARKETPLACE_TIERS: Record<'LOW_MARGIN' | 'STANDARD' | 'HIGH_MARGIN', TierInput[]> = {
  LOW_MARGIN: [
    { lowerBound: 0, upperBound: EGP(5000), buyerBps: 200, sellerBps: 600, totalBps: 800 },
    { lowerBound: EGP(5000), upperBound: EGP(25000), buyerBps: 200, sellerBps: 450, totalBps: 650 },
    { lowerBound: EGP(25000), upperBound: null, buyerBps: 150, sellerBps: 350, totalBps: 500 },
  ],
  STANDARD: [
    { lowerBound: 0, upperBound: EGP(5000), buyerBps: 350, sellerBps: 850, totalBps: 1200 },
    { lowerBound: EGP(5000), upperBound: EGP(25000), buyerBps: 300, sellerBps: 700, totalBps: 1000 },
    { lowerBound: EGP(25000), upperBound: null, buyerBps: 250, sellerBps: 550, totalBps: 800 },
  ],
  HIGH_MARGIN: [
    { lowerBound: 0, upperBound: EGP(5000), buyerBps: 400, sellerBps: 1100, totalBps: 1500 },
    { lowerBound: EGP(5000), upperBound: EGP(25000), buyerBps: 350, sellerBps: 900, totalBps: 1250 },
    { lowerBound: EGP(25000), upperBound: null, buyerBps: 300, sellerBps: 700, totalBps: 1000 },
  ],
};
export const OWNER_APPROVED_MARKETPLACE_MIN_FEE = EGP(25);

/** 50/50 split per slice: 8% → 4% + 4%, 6% → 3% + 3%, 4% → 2% + 2%, 3% → 1.5% + 1.5%. */
export const OWNER_APPROVED_DEAL_TIERS: TierInput[] = [
  { lowerBound: 0, upperBound: EGP(5000), buyerBps: 400, sellerBps: 400, totalBps: 800 },
  { lowerBound: EGP(5000), upperBound: EGP(25000), buyerBps: 300, sellerBps: 300, totalBps: 600 },
  { lowerBound: EGP(25000), upperBound: EGP(100000), buyerBps: 200, sellerBps: 200, totalBps: 400 },
  { lowerBound: EGP(100000), upperBound: null, buyerBps: 150, sellerBps: 150, totalBps: 300 },
];
export const OWNER_APPROVED_DEAL_MIN_FEE = EGP(80);

/** Representative amounts (EGP) for simulations, governance and impact previews. */
export const SAMPLE_AMOUNTS_EGP = [100, 500, 1000, 2500, 5000, 5001, 10000, 25000, 25001, 50000, 100000, 100001];
