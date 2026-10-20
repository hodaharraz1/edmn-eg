import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  checkReport,
  coerceAnswers,
  coverage,
  declaredDefects,
  DEFAULT_SAFETY_RULES,
  inspectionDaysFor,
  maskIdentifier,
  MOBILE_PHONE_POLICY,
  normalizeIdentifier,
  protectionLevel,
  SAFETY_SCORE_DISCLAIMER,
  safetyScore,
  usedPolicySchema,
  type SafetyInputs,
} from '@/domain/used';

const policy = usedPolicySchema.parse(MOBILE_PHONE_POLICY);

describe('used domain — identifiers', () => {
  it('accepts a Luhn-valid IMEI or a serial, refuses junk; masks all but the last 4', () => {
    expect(normalizeIdentifier('49-015420-323751-8')).toBe('490154203237518');
    expect(normalizeIdentifier('490154203237519')).toBeNull(); // bad checksum
    expect(normalizeIdentifier('c02xk1abjhd2')).toBe('C02XK1ABJHD2');
    expect(normalizeIdentifier('12')).toBeNull();
    expect(normalizeIdentifier('<script>')).toBeNull();
    const m = maskIdentifier('490154203237518');
    expect(m.endsWith('7518')).toBe(true);
    expect(m).not.toContain('4901542');
  });
});

describe('used domain — condition checks', () => {
  it('coerces by field type, drops unknown keys and never keeps the identifier in answers', () => {
    const a = coerceAnswers(policy, { battery_health: '٨٥', box: 'on', storage: '128gb', bogus: 'x', imei: '490154203237518', screen_condition: 'nonsense' });
    expect(a).toEqual({ battery_health: 85, box: true, storage: '128gb' });
  });

  it('derives disclosed defects from the schema (select flags, thresholds, free text)', () => {
    const d = declaredDefects(policy, { battery_health: 75, screen_condition: 'cracked', known_defects: 'السماعة ضعيفة', replaced_parts: 'لا يوجد' });
    expect(d.map((x) => x.code).sort()).toEqual(['battery_health', 'known_defects', 'screen_condition']);
  });

  it('completeness counts required fields and required evidence (defect photos only when defects exist)', () => {
    const empty = checkReport(policy, {}, false, {});
    expect(empty.complete).toBe(false);
    expect(empty.conditionCompleteness).toBe(0);
    const required = policy.fields.filter((f) => f.required && !f.identifier);
    const answers = Object.fromEntries(required.map((f) => [f.code, f.type === 'SELECT' ? f.options.find((o) => !o.defect)!.value : f.type === 'BOOLEAN' ? true : f.type === 'NUMBER' ? 90 : 'x']));
    const slots = Object.fromEntries(policy.evidence.filter((s) => s.required).map((s) => [s.code, 1]));
    expect(checkReport(policy, answers, true, slots).complete).toBe(true);
    const withDefect = checkReport(policy, { ...answers, known_defects: 'خدش' }, true, slots);
    expect(withDefect.complete).toBe(false);
    expect(withDefect.problems.join()).toContain('صور العيوب');
  });
});

describe('used domain — protection levels are separate claims', () => {
  it('INSPECTED only with a passed inspection; VERIFIED only with staff review + complete + identity', () => {
    const base = { complete: true, identityApproved: true, staffVerified: false, inspectionPassed: false };
    expect(protectionLevel(policy, base)).toBe('PROTECTED');
    expect(protectionLevel(policy, { ...base, staffVerified: true })).toBe('VERIFIED');
    expect(protectionLevel(policy, { ...base, staffVerified: true, identityApproved: false })).toBe('PROTECTED');
    expect(protectionLevel(policy, { ...base, staffVerified: true, complete: false })).toBe('PROTECTED');
    expect(protectionLevel(policy, { ...base, inspectionPassed: true })).toBe('INSPECTED');
    expect(protectionLevel({ ...policy, levels: ['PROTECTED'] }, { ...base, staffVerified: true, inspectionPassed: true })).toBe('PROTECTED');
  });

  it('coverage always lists transaction protection, condition verification, inspection and warranty separately — never a 100% claim', () => {
    const c = coverage('VERIFIED', '');
    expect(c.map((x) => x.key)).toEqual(['TRANSACTION', 'CONDITION', 'INSPECTION', 'WARRANTY']);
    expect(c.find((x) => x.key === 'INSPECTION')!.covered).toBe(false);
    expect(c.find((x) => x.key === 'WARRANTY')!.covered).toBe(false);
    expect(c.find((x) => x.key === 'CONDITION')!.text).toContain('مش فحص فني');
    const all = JSON.stringify([coverage('PROTECTED', null), coverage('VERIFIED', 'x'), coverage('INSPECTED', 'ضمان 3 شهور')]) + SAFETY_SCORE_DISCLAIMER;
    expect(all).not.toMatch(/100\s*%|مستحيل|مضمون تماما|guaranteed/i);
  });

  it('inspection days are clamped to the policy range', () => {
    expect(inspectionDaysFor(policy, 1)).toBe(2);
    expect(inspectionDaysFor(policy, 30)).toBe(7);
    expect(inspectionDaysFor(policy, null)).toBe(3);
  });
});

describe('used domain — explainable safety score', () => {
  const strong: SafetyInputs = { identityApproved: true, phoneVerified: true, accountAgeDays: 400, completedDeals: 20, disputesLost: 0, conditionCompleteness: 1, evidenceCompleteness: 1, inspected: true, shippingEvidence: true, returnPolicy: 'VOLUNTARY', level: 'INSPECTED' };
  it('a fully documented, inspected deal from an established verified seller scores 100 / HIGH', () => {
    const s = safetyScore(DEFAULT_SAFETY_RULES, strong);
    expect(s.score).toBe(100);
    expect(s.level).toBe('HIGH');
    expect(s.factors).toHaveLength(10);
  });
  it('a new, undocumented seller scores LOW and every factor says why', () => {
    const s = safetyScore(DEFAULT_SAFETY_RULES, { identityApproved: false, phoneVerified: false, accountAgeDays: 0, completedDeals: 0, disputesLost: 0, conditionCompleteness: 0.2, evidenceCompleteness: 0, inspected: false, shippingEvidence: null, returnPolicy: null, level: 'PROTECTED' });
    expect(s.level).toBe('LOW');
    expect(s.factors.filter((f) => !f.applicable).map((f) => f.factor).sort()).toEqual(['RETURN_POLICY', 'SHIPPING_EVIDENCE']);
    expect(s.factors.every((f) => f.why)).toBe(true);
  });
  it('lost disputes pull the score down; weights of 0 drop a factor', () => {
    expect(safetyScore(DEFAULT_SAFETY_RULES, { ...strong, disputesLost: 3, completedDeals: 6 }).score).toBeLessThan(100);
    const r = { ...DEFAULT_SAFETY_RULES, weights: { ...DEFAULT_SAFETY_RULES.weights, INSPECTION: 0 } };
    expect(safetyScore(r, { ...strong, inspected: false, level: 'VERIFIED' }).factors.find((f) => f.factor === 'INSPECTION')!.applicable).toBe(false);
  });
});

describe('used domain — canonical JSON for snapshot hashes', () => {
  it('is independent of key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(canonicalJson({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });
});
