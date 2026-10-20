import { describe, expect, it } from 'vitest';
import {
  allocate,
  computeFee,
  computeMarketplaceFee,
  divRoundHalfUp,
  OWNER_APPROVED_DEAL_MIN_FEE as DEAL_MIN,
  OWNER_APPROVED_DEAL_TIERS as DEAL,
  OWNER_APPROVED_MARKETPLACE_MIN_FEE as MKT_MIN,
  OWNER_APPROVED_MARKETPLACE_TIERS as MKT,
  type TierInput,
} from '@/server/modules/pricing/engine';
import { batchSimulate, DEFAULT_ASSUMPTIONS, expectedMargin, simulate, validateVersionConfig, type VersionConfig } from '@/server/modules/pricing/validation';

const EGP = (n: number) => Math.round(n * 100);
const mkt = (amountEgp: number, cls: keyof typeof MKT) => computeMarketplaceFee([{ key: 'a', lineTotal: EGP(amountEgp), economicClass: cls }], MKT, MKT_MIN);
const deal = (amount: number) => computeFee(amount, DEAL, DEAL_MIN);
const cfgM: VersionConfig = { model: 'MARKETPLACE', currency: 'EGP', minFee: MKT_MIN, targetMarginBps: 5000, assumptions: DEFAULT_ASSUMPTIONS, tiersByClass: MKT };
const cfgD: VersionConfig = { model: 'PROTECTED_DEAL', currency: 'EGP', minFee: DEAL_MIN, targetMarginBps: 5000, assumptions: DEFAULT_ASSUMPTIONS, tiersByClass: { DEAL } };

describe('A. marketplace progressive pricing (owner-approved rates)', () => {
  it('#1 LOW_MARGIN — each tier', () => {
    expect(mkt(1000, 'LOW_MARGIN')).toMatchObject({ total: EGP(80), buyer: EGP(20), seller: EGP(60) });
    // 10,000: 5,000×8% + 5,000×6.5% = 400 + 325 = 725 ; buyer 100 + 100 = 200
    expect(mkt(10000, 'LOW_MARGIN')).toMatchObject({ total: EGP(725), buyer: EGP(200), seller: EGP(525) });
    // 50,000: 400 + 20,000×6.5%=1,300 + 25,000×5%=1,250 = 2,950 ; buyer 100+400+375 = 875
    expect(mkt(50000, 'LOW_MARGIN')).toMatchObject({ total: EGP(2950), buyer: EGP(875), seller: EGP(2075) });
  });
  it('#2 STANDARD — each tier (10,000 → 1,100, never 1,000)', () => {
    expect(mkt(1000, 'STANDARD')).toMatchObject({ total: EGP(120), buyer: EGP(35), seller: EGP(85) });
    expect(mkt(10000, 'STANDARD')).toMatchObject({ total: EGP(1100), buyer: EGP(325), seller: EGP(775) });
    expect(mkt(10000, 'STANDARD').total).not.toBe(EGP(1000));
    // 50,000: 600 + 2,000 + 2,000 = 4,600 ; buyer 175 + 600 + 625 = 1,400
    expect(mkt(50000, 'STANDARD')).toMatchObject({ total: EGP(4600), buyer: EGP(1400), seller: EGP(3200) });
  });
  it('#3 HIGH_MARGIN — each tier', () => {
    expect(mkt(1000, 'HIGH_MARGIN')).toMatchObject({ total: EGP(150), buyer: EGP(40), seller: EGP(110) });
    expect(mkt(10000, 'HIGH_MARGIN')).toMatchObject({ total: EGP(1375), buyer: EGP(375), seller: EGP(1000) });
    // 50,000: 750 + 2,500 + 2,500 = 5,750 ; buyer 200 + 700 + 750 = 1,650
    expect(mkt(50000, 'HIGH_MARGIN')).toMatchObject({ total: EGP(5750), buyer: EGP(1650), seller: EGP(4100) });
  });
  it('#4 minimum 25 EGP per sub-order, split proportionally, exact', () => {
    const r = mkt(100, 'STANDARD'); // 12 EGP < 25
    expect(r.minApplied).toBe(true);
    expect(r.total).toBe(EGP(25));
    expect(r.buyer).toBe(729); // 25 × 3.5 / 12 = 7.2917 → 7.29
    expect(r.buyer + r.seller).toBe(r.total);
    expect(mkt(209, 'STANDARD').minApplied).toBe(false); // 25.08 ≥ 25
    expect(mkt(208, 'STANDARD').minApplied).toBe(true); // 24.96 < 25
  });
  it('#5 mixed-category sub-order: each class priced on its own subtotal, allocated to lines exactly', () => {
    const r = computeMarketplaceFee(
      [
        { key: 'phone', lineTotal: EGP(6000), economicClass: 'LOW_MARGIN' },
        { key: 'shirt', lineTotal: EGP(1000), economicClass: 'HIGH_MARGIN' },
        { key: 'shoes', lineTotal: EGP(500), economicClass: 'HIGH_MARGIN' },
      ],
      MKT,
      MKT_MIN,
    );
    // LOW 6,000: 400 + 65 = 465 ; HIGH 1,500: 225 → 690 total (not one category for the whole basket)
    expect(r.groups.map((g) => [g.economicClass, g.total])).toEqual([['LOW_MARGIN', EGP(465)], ['HIGH_MARGIN', EGP(225)]]);
    expect(r.total).toBe(EGP(690));
    expect(r.lines.reduce((a, l) => a + l.total, 0)).toBe(r.total);
    expect(r.lines.reduce((a, l) => a + l.buyer, 0)).toBe(r.buyer);
    expect(r.lines.find((l) => l.key === 'shirt')!.total).toBe(EGP(150));
    for (const l of r.lines) expect(l.buyer + l.seller).toBe(l.total);
  });
  it('#8/#9 exact boundaries and +1 piastre (4,999 / 5,000 / 5,001 / 24,999 / 25,000 / 25,001)', () => {
    expect(mkt(4999, 'STANDARD').total).toBe(EGP(599.88));
    expect(mkt(5000, 'STANDARD').total).toBe(EGP(600));
    expect(computeMarketplaceFee([{ key: 'a', lineTotal: EGP(5000) + 1, economicClass: 'STANDARD' }], MKT, MKT_MIN).total).toBe(EGP(600)); // +0.01 × 10% = 0.001 → rounds to 0
    expect(mkt(5001, 'STANDARD').total).toBe(EGP(600.1));
    expect(mkt(24999, 'STANDARD').total).toBe(EGP(2599.9));
    expect(mkt(25000, 'STANDARD').total).toBe(EGP(2600));
    expect(mkt(25001, 'STANDARD').total).toBe(EGP(2600.08));
  });
  it('#10 monotonic: the fee never decreases as the value grows (every class, boundary neighbourhoods)', () => {
    for (const cls of Object.keys(MKT) as (keyof typeof MKT)[]) {
      let prev = -1;
      const points: number[] = [];
      for (let p = 0; p <= EGP(60000); p += EGP(37.31)) points.push(p);
      for (const b of [EGP(5000), EGP(25000)]) for (let d = -300; d <= 300; d++) points.push(b + d);
      for (const p of points.sort((a, b) => a - b)) {
        const f = computeMarketplaceFee([{ key: 'a', lineTotal: p, economicClass: cls }], MKT, MKT_MIN).total;
        expect(f).toBeGreaterThanOrEqual(prev);
        prev = f;
      }
    }
  });
  it('#11/#12/#13 buyer + seller = total, integers only (no floats) — property check', () => {
    for (let p = 0; p < EGP(120000); p += 7919) {
      for (const cls of Object.keys(MKT)) {
        const r = computeMarketplaceFee([{ key: 'a', lineTotal: p, economicClass: cls }, { key: 'b', lineTotal: p % 9973, economicClass: 'STANDARD' }], MKT, MKT_MIN);
        expect(r.buyer + r.seller).toBe(r.total);
        for (const v of [r.total, r.buyer, r.seller, ...r.lines.flatMap((l) => [l.total, l.buyer, l.seller])]) {
          expect(Number.isSafeInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(4n, 10n)).toBe(0n);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(7, [0, 0])).toEqual([7, 0]);
  });
  it('#7 shipping is not part of the fee base', () => {
    const sim = simulate(cfgM, { amount: EGP(1000), shipping: EGP(75), economicClass: 'STANDARD' });
    expect(sim.totalFee).toBe(EGP(120)); // on 1,000 — not 1,075
    expect(sim.buyerPayable).toBe(EGP(1000) + EGP(75) + EGP(35)); // 1,110.00 as in the owner example
    expect(sim.sellerNetBeforePayout).toBe(EGP(1000) + EGP(75) - EGP(85));
  });
});

describe('B. protected deal progressive pricing (50/50, minimum 80)', () => {
  const cases: [number, number, number][] = [
    [1000, 80, 40],
    [5000, 400, 200],
    [10000, 700, 350],
    [20000, 1300, 650],
    [25000, 1600, 800],
    [50000, 2600, 1300],
    [100000, 4600, 2300],
    [150000, 6100, 3050],
  ];
  for (const [amount, total, buyer] of cases) {
    it(`#17-26 ${amount.toLocaleString('en-US')} EGP → ${total} (buyer ${buyer} / seller ${total - buyer})`, () => {
      const r = deal(EGP(amount));
      expect(r.total).toBe(EGP(total));
      expect(r.buyer).toBe(EGP(buyer));
      expect(r.seller).toBe(EGP(total - buyer));
    });
  }
  it('#16 minimum 80 EGP → 40 / 40', () => {
    const r = deal(EGP(300));
    expect(r).toMatchObject({ minApplied: true, total: EGP(80), buyer: EGP(40), seller: EGP(40) });
  });
  it('#19/#23/#26 just above the boundaries (5,001 / 25,001 / 100,001) and +1 piastre', () => {
    expect(deal(EGP(5001)).total).toBe(EGP(400.06));
    expect(deal(EGP(25001)).total).toBe(EGP(1600.04));
    expect(deal(EGP(100001)).total).toBe(EGP(4600.03)); // 3% only on the amount above 100,000
    expect(deal(EGP(100000) + 1).total).toBe(EGP(4600));
  });
  it('#27 50/50 invariant: buyer and seller differ by at most one piastre, sum exact', () => {
    for (let p = 0; p < EGP(300000); p += 12347) {
      const r = deal(p);
      expect(r.buyer + r.seller).toBe(r.total);
      expect(Math.abs(r.buyer - r.seller)).toBeLessThanOrEqual(1);
    }
  });
});

describe('C. publication validation (server-side, never the UI)', () => {
  const tiers = (over: Partial<TierInput>[]): TierInput[] => DEAL.map((t, i) => ({ ...t, ...(over[i] ?? {}) }));
  it('owner-approved configurations are valid', () => {
    expect(validateVersionConfig(cfgM)).toEqual([]);
    expect(validateVersionConfig(cfgD)).toEqual([]);
  });
  it('#32 overlapping tiers rejected', () => {
    const errs = validateVersionConfig({ ...cfgD, tiersByClass: { DEAL: tiers([{}, { lowerBound: EGP(4000) }]) } });
    expect(errs.join()).toMatch(/تداخل/);
  });
  it('#33 gap rejected', () => {
    const errs = validateVersionConfig({ ...cfgD, tiersByClass: { DEAL: tiers([{}, { lowerBound: EGP(6000) }]) } });
    expect(errs.join()).toMatch(/فجوة/);
  });
  it('#34 buyer + seller ≠ total rejected', () => {
    expect(validateVersionConfig({ ...cfgD, tiersByClass: { DEAL: tiers([{ buyerBps: 500 }]) } }).join()).toMatch(/لا تساوي الإجمالي/);
  });
  it('#35 negative rate / >100% rejected; currency and first-tier-at-0 enforced', () => {
    expect(validateVersionConfig({ ...cfgD, tiersByClass: { DEAL: tiers([{ buyerBps: -100, sellerBps: 900 }]) } }).join()).toMatch(/سالبة/);
    expect(validateVersionConfig({ ...cfgD, tiersByClass: { DEAL: tiers([{ buyerBps: 6000, sellerBps: 6000, totalBps: 12000 }]) } }).join()).toMatch(/100%/);
    expect(validateVersionConfig({ ...cfgD, currency: 'USD' }).join()).toMatch(/العملة/);
    expect(validateVersionConfig({ ...cfgD, tiersByClass: { DEAL: tiers([{ lowerBound: 100 }]) } }).join()).toMatch(/تبدأ من 0/);
    expect(validateVersionConfig({ ...cfgM, tiersByClass: { LOW_MARGIN: MKT.LOW_MARGIN, STANDARD: MKT.STANDARD } }).join()).toMatch(/HIGH_MARGIN/);
  });
  it('#40 simulation produces every representative amount for every class', () => {
    expect(batchSimulate(cfgM)).toHaveLength(3 * 12);
    expect(batchSimulate(cfgD)).toHaveLength(12);
  });
  it('#41 margin governance: owner rates meet the 50% target; heavy reserves fall below it', () => {
    expect(expectedMargin(cfgM).belowTarget).toBe(false);
    expect(expectedMargin(cfgD).belowTarget).toBe(false);
    const costly = { ...cfgM, assumptions: { ...DEFAULT_ASSUMPTIONS, refundReserveBps: 400, fraudReserveBps: 300 } };
    const g = expectedMargin(costly);
    expect(g.belowTarget).toBe(true);
    expect(g.samplesBelowTarget.length).toBeGreaterThan(0);
  });
  it('#70 zero revenue is handled (margin undefined, not NaN)', () => {
    const zero = { ...cfgD, minFee: 0, tiersByClass: { DEAL: DEAL.map((t) => ({ ...t, buyerBps: 0, sellerBps: 0, totalBps: 0 })) } };
    expect(simulate(zero, { amount: EGP(1000), shipping: 0 }).marginBps).toBeNull();
  });
});
