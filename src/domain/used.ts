import { z } from 'zod';

/**
 * EDMN Trusted Used Commerce — «سوق المستعمل المضمون».
 *
 * Everything category-specific is DATA (a per-category policy, stored in `used_category_policies` and editable by
 * catalog admins): the condition schema, required evidence, verification rules, inspection period, dispute
 * reasons and protection levels. V1 ships one configuration (used mobile phones); laptops, consoles or cameras
 * are added by inserting another policy, not by code.
 *
 * The four things a buyer can get are deliberately separate concepts, in the model and in the UI:
 *  - TRANSACTION protection  — the money stays with EDMN until receipt/inspection and an authorized release.
 *  - CONDITION verification  — EDMN staff reviewed the seller's documented condition and evidence (a document
 *                              review, NOT a technical inspection).
 *  - PROFESSIONAL inspection — a real, recorded inspection of the item by an inspector/provider.
 *  - WARRANTY                — only what the seller declares; EDMN does not warrant products.
 * Nothing here moves money: protection levels and the safety score are information, never release triggers.
 */

/* ───────── Category policy (configuration) ───────── */

export const USED_FIELD_TYPES = ['SELECT', 'BOOLEAN', 'NUMBER', 'TEXT'] as const;
export const USED_FIELD_GROUPS = ['IDENTITY', 'FUNCTION', 'BODY', 'HISTORY', 'CONTENTS'] as const;
export const USED_FIELD_GROUP_LABELS: Record<(typeof USED_FIELD_GROUPS)[number], string> = {
  IDENTITY: 'بيانات الجهاز',
  FUNCTION: 'التشغيل والوظائف',
  BODY: 'الحالة الخارجية',
  HISTORY: 'الصيانة والتاريخ',
  CONTENTS: 'محتويات العلبة والعيوب',
};

const code = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'كود غير صالح');

export const usedFieldSchema = z.object({
  code,
  label: z.string().trim().min(1).max(80),
  group: z.enum(USED_FIELD_GROUPS),
  type: z.enum(USED_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string().regex(/^[a-z0-9_]{1,30}$/), label: z.string().trim().min(1).max(60), defect: z.boolean().default(false) })).max(30).default([]),
  unit: z.string().max(10).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  hint: z.string().max(200).optional(),
  /** The device identifier (IMEI / serial): stored encrypted, shown masked, compared by keyed hash. */
  identifier: z.boolean().default(false),
  /** NUMBER below this value is a disclosed defect (e.g. battery health < 80%). */
  defectBelow: z.number().optional(),
  /** BOOLEAN answer that is a defect. */
  defectWhen: z.boolean().optional(),
  /** TEXT whose non-empty value is a seller-declared defect. */
  defectText: z.boolean().default(false),
});
export type UsedField = z.infer<typeof usedFieldSchema>;

export const usedEvidenceSlotSchema = z.object({
  code,
  label: z.string().trim().min(1).max(80),
  hint: z.string().max(200).optional(),
  required: z.boolean().default(false),
  /** Required only when the report declares at least one defect. */
  requiredWhenDefects: z.boolean().default(false),
  /** Never public (e.g. a photo showing the IMEI): parties of the transaction and authorized staff only. */
  private: z.boolean().default(false),
  maxFiles: z.number().int().min(1).max(6).default(2),
});
export type UsedEvidenceSlot = z.infer<typeof usedEvidenceSlotSchema>;

export const PROTECTION_LEVELS = ['PROTECTED', 'VERIFIED', 'INSPECTED'] as const;
export type ProtectionLevel = (typeof PROTECTION_LEVELS)[number];
export const PROTECTION_LEVEL_LABELS: Record<ProtectionLevel, string> = {
  PROTECTED: 'محمي من اضمن',
  VERIFIED: 'موثّق من اضمن',
  INSPECTED: 'مفحوص من اضمن',
};
export const PROTECTION_LEVEL_SUMMARY: Record<ProtectionLevel, string> = {
  PROTECTED: 'فلوسك محمية لحد ما تستلم وتتأكد. الحالة موصوفة من البائع ومثبتة في جواز المنتج.',
  VERIFIED: 'فلوسك محمية، وفريق اضمن راجع بيانات الحالة والصور اللي قدّمها البائع (مراجعة مستندات، مش فحص فني).',
  INSPECTED: 'فلوسك محمية، والمنتج اتفحص فعليًا وتقرير الفحص متسجّل في جواز المنتج.',
};

/** Structured reasons for a used-product dispute (a policy chooses which apply). */
export const USED_DISPUTE_REASONS = {
  NOT_AS_DESCRIBED: 'المنتج مش زي الوصف',
  UNDISCLOSED_DEFECT: 'عيب مكانش مذكور',
  DIFFERENT_IDENTIFIER: 'رقم IMEI / الرقم التسلسلي مختلف',
  MISSING_ACCESSORY: 'ملحقات ناقصة',
  WORSE_CONDITION: 'الحالة الخارجية أسوأ من المذكور',
  FUNCTION_NOT_WORKING: 'وظيفة مش شغالة',
  WRONG_PRODUCT: 'منتج مختلف',
  SHIPPING_DAMAGE: 'تلف أثناء الشحن',
  SUSPECTED_COUNTERFEIT: 'شك إنه مقلّد',
  OTHER: 'سبب تاني',
} as const;
export type UsedDisputeReason = keyof typeof USED_DISPUTE_REASONS;
export const USED_DISPUTE_REASON_CODES = Object.keys(USED_DISPUTE_REASONS) as UsedDisputeReason[];

export const usedPolicySchema = z
  .object({
    profile: code,
    title: z.string().trim().min(2).max(80),
    fields: z.array(usedFieldSchema).min(1).max(60),
    evidence: z.array(usedEvidenceSlotSchema).max(20),
    verification: z.object({
      /** VERIFIED needs the seller's identity to be approved. */
      requireIdentity: z.boolean().default(true),
      /** VERIFIED needs every required field and evidence slot. */
      requireComplete: z.boolean().default(true),
    }),
    inspection: z
      .object({ defaultDays: z.number().int().min(1).max(14), minDays: z.number().int().min(1).max(14), maxDays: z.number().int().min(1).max(14) })
      .refine((i) => i.minDays <= i.defaultDays && i.defaultDays <= i.maxDays, 'مدة الفحص الافتراضية لازم تكون بين الأقل والأقصى'),
    disputeReasons: z.array(z.enum(USED_DISPUTE_REASON_CODES as [UsedDisputeReason, ...UsedDisputeReason[]])).min(1),
    levels: z.array(z.enum(PROTECTION_LEVELS)).min(1),
    declaration: z.string().trim().min(10).max(600),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    for (const f of p.fields) {
      if (seen.has(f.code)) ctx.addIssue({ code: 'custom', message: `كود مكرر: ${f.code}`, path: ['fields'] });
      seen.add(f.code);
      if (f.type === 'SELECT' && f.options.length < 2) ctx.addIssue({ code: 'custom', message: `الحقل ${f.code} محتاج اختيارين على الأقل`, path: ['fields'] });
      if (f.identifier && f.type !== 'TEXT') ctx.addIssue({ code: 'custom', message: 'حقل المعرّف لازم يكون نص', path: ['fields'] });
    }
    if (p.fields.filter((f) => f.identifier).length > 1) ctx.addIssue({ code: 'custom', message: 'مسموح بحقل معرّف واحد فقط', path: ['fields'] });
    const slots = new Set<string>();
    for (const s of p.evidence) {
      if (slots.has(s.code)) ctx.addIssue({ code: 'custom', message: `دليل مكرر: ${s.code}`, path: ['evidence'] });
      slots.add(s.code);
    }
    if (!p.levels.includes('PROTECTED')) ctx.addIssue({ code: 'custom', message: 'مستوى «محمي» أساسي لكل فئة', path: ['levels'] });
  });
export type UsedPolicy = z.infer<typeof usedPolicySchema>;

const works = (label: string, c: string, hint?: string): z.input<typeof usedFieldSchema> => ({
  code: c,
  label,
  group: 'FUNCTION',
  type: 'SELECT',
  required: true,
  hint,
  options: [
    { value: 'works', label: 'شغالة' },
    { value: 'issue', label: 'فيها مشكلة', defect: true },
  ],
});

/** V1 configuration: used mobile phones (category `mobile-phones`). Seeded once; edited from Admin afterwards. */
export const MOBILE_PHONE_POLICY: z.input<typeof usedPolicySchema> = {
  profile: 'mobile_phone',
  title: 'موبايلات مستعملة',
  fields: [
    { code: 'brand', label: 'الماركة', group: 'IDENTITY', type: 'TEXT', required: true },
    { code: 'model', label: 'الموديل', group: 'IDENTITY', type: 'TEXT', required: true },
    {
      code: 'storage',
      label: 'سعة التخزين',
      group: 'IDENTITY',
      type: 'SELECT',
      required: true,
      options: [
        { value: '64gb', label: '64 جيجا' },
        { value: '128gb', label: '128 جيجا' },
        { value: '256gb', label: '256 جيجا' },
        { value: '512gb', label: '512 جيجا' },
        { value: '1tb', label: '1 تيرا' },
        { value: 'other', label: 'سعة تانية' },
      ],
    },
    { code: 'color', label: 'اللون', group: 'IDENTITY', type: 'TEXT', required: true },
    { code: 'imei', label: 'رقم IMEI / الرقم التسلسلي', group: 'IDENTITY', type: 'TEXT', required: true, identifier: true, hint: 'اطلب *#06# من الموبايل. الرقم بيتخزن متشفّر، وبيظهر للمشتري مخفي ما عدا آخر 4 أرقام.' },
    { code: 'battery_health', label: 'صحة البطارية', group: 'FUNCTION', type: 'NUMBER', required: true, unit: '%', min: 1, max: 100, defectBelow: 80, hint: 'من إعدادات البطارية في الموبايل.' },
    {
      code: 'screen_condition',
      label: 'حالة الشاشة',
      group: 'FUNCTION',
      type: 'SELECT',
      required: true,
      options: [
        { value: 'perfect', label: 'سليمة بدون خدوش' },
        { value: 'light', label: 'خدوش خفيفة' },
        { value: 'heavy', label: 'خدوش واضحة', defect: true },
        { value: 'cracked', label: 'مشروخة أو مكسورة', defect: true },
      ],
    },
    {
      code: 'screen_original',
      label: 'الشاشة أصلية؟',
      group: 'FUNCTION',
      type: 'SELECT',
      required: true,
      options: [
        { value: 'original', label: 'أصلية' },
        { value: 'replaced', label: 'متغيّرة', defect: true },
        { value: 'unknown', label: 'مش معروف' },
      ],
    },
    {
      code: 'biometrics',
      label: 'بصمة الوجه / الإصبع',
      group: 'FUNCTION',
      type: 'SELECT',
      required: true,
      options: [
        { value: 'works', label: 'شغالة' },
        { value: 'issue', label: 'مش شغالة', defect: true },
        { value: 'none', label: 'مش موجودة في الموديل' },
      ],
    },
    works('الكاميرات', 'cameras'),
    works('السماعات', 'speakers'),
    works('المايك', 'microphone'),
    works('الشحن', 'charging'),
    works('الواي فاي', 'wifi'),
    works('البلوتوث', 'bluetooth'),
    works('الشبكة والمكالمات', 'cellular'),
    {
      code: 'scratches',
      label: 'الخدوش',
      group: 'BODY',
      type: 'SELECT',
      required: true,
      options: [
        { value: 'none', label: 'مفيش' },
        { value: 'light', label: 'خفيفة' },
        { value: 'heavy', label: 'واضحة', defect: true },
      ],
    },
    {
      code: 'dents',
      label: 'الخبطات',
      group: 'BODY',
      type: 'SELECT',
      required: true,
      options: [
        { value: 'none', label: 'مفيش' },
        { value: 'minor', label: 'بسيطة', defect: true },
        { value: 'major', label: 'واضحة', defect: true },
      ],
    },
    {
      code: 'cracks',
      label: 'شروخ في الضهر أو الإطار',
      group: 'BODY',
      type: 'SELECT',
      required: true,
      options: [
        { value: 'none', label: 'مفيش' },
        { value: 'yes', label: 'فيه شروخ', defect: true },
      ],
    },
    {
      code: 'opened',
      label: 'اتفتح أو اتصلّح قبل كده؟',
      group: 'HISTORY',
      type: 'SELECT',
      required: true,
      options: [
        { value: 'no', label: 'لأ' },
        { value: 'yes', label: 'أيوه', defect: true },
        { value: 'unknown', label: 'مش معروف' },
      ],
    },
    { code: 'replaced_parts', label: 'قطع اتغيّرت', group: 'HISTORY', type: 'TEXT', defectText: true, hint: 'مثلاً: البطارية، الشاشة، الضهر. سيبها فاضية لو مفيش.' },
    {
      code: 'water_damage',
      label: 'دخول مية',
      group: 'HISTORY',
      type: 'SELECT',
      required: true,
      options: [
        { value: 'none', label: 'مفيش على حد علمي' },
        { value: 'yes', label: 'حصل قبل كده', defect: true },
      ],
    },
    { code: 'box', label: 'العلبة موجودة', group: 'CONTENTS', type: 'BOOLEAN', required: true },
    { code: 'charger', label: 'الشاحن موجود', group: 'CONTENTS', type: 'BOOLEAN', required: true },
    { code: 'accessories', label: 'ملحقات تانية', group: 'CONTENTS', type: 'TEXT', hint: 'مثلاً: جراب، سماعة، كابل.' },
    { code: 'known_defects', label: 'عيوب تانية تعرفها', group: 'CONTENTS', type: 'TEXT', defectText: true, hint: 'اكتب أي عيب تعرفه حتى لو بسيط. العيب المذكور مش سبب للنزاع.' },
  ],
  evidence: [
    { code: 'front', label: 'صورة الوش', required: true },
    { code: 'back', label: 'صورة الضهر', required: true },
    { code: 'left', label: 'الجنب الشمال', required: true },
    { code: 'right', label: 'الجنب اليمين', required: true },
    { code: 'screen_on', label: 'الشاشة وهي شغالة', required: true },
    { code: 'battery', label: 'صفحة صحة البطارية', required: true },
    { code: 'imei', label: 'صورة رقم IMEI / الرقم التسلسلي', required: true, private: true, hint: 'الصورة دي مش بتظهر للعامة — للطرفين وفريق اضمن فقط.' },
    { code: 'defects', label: 'صور العيوب المذكورة', requiredWhenDefects: true, maxFiles: 6 },
    { code: 'accessories', label: 'الملحقات والعلبة', maxFiles: 4 },
  ],
  verification: { requireIdentity: true, requireComplete: true },
  inspection: { defaultDays: 3, minDays: 2, maxDays: 7 },
  disputeReasons: USED_DISPUTE_REASON_CODES,
  levels: ['PROTECTED', 'VERIFIED', 'INSPECTED'],
  declaration: 'أقر إن البيانات والصور دي بتمثل حالة المنتج الفعلية وقت العرض والاتفاق، وإن أي عيب أعرفه مذكور. أي اختلاف جوهري بيدّي المشتري حق فتح نزاع.',
};

/* ───────── Condition report validation ───────── */

export type UsedAnswers = Record<string, string | number | boolean>;
export type Defect = { code: string; label: string; detail: string };

/** IMEI (15 digits, Luhn) or a manufacturer serial (6–20 letters/digits). Normalized: upper-case, no spaces/dashes. */
export function normalizeIdentifier(raw: string): string | null {
  const v = raw.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{15}$/.test(v)) return luhn(v) ? v : null;
  if (/^[A-Z0-9]{6,20}$/.test(v) && !/^\d{15}$/.test(v)) return v;
  return null;
}
function luhn(d: string) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}
export function maskIdentifier(v: string): string {
  return `${'•'.repeat(Math.max(4, v.length - 4))}${v.slice(-4)}`;
}

/** Coerces raw form values to the field types; unknown keys and the identifier (handled separately) are dropped. */
export function coerceAnswers(policy: UsedPolicy, raw: Record<string, unknown>): UsedAnswers {
  const out: UsedAnswers = {};
  for (const f of policy.fields) {
    if (f.identifier) continue;
    const v = raw[f.code];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'BOOLEAN') out[f.code] = v === true || v === 'true' || v === 'on' || v === 'yes';
    else if (f.type === 'NUMBER') {
      const n = Number(String(v).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))));
      if (Number.isFinite(n)) out[f.code] = n;
    } else if (f.type === 'SELECT') {
      const s = String(v);
      if (f.options.some((o) => o.value === s)) out[f.code] = s;
    } else out[f.code] = String(v).trim().slice(0, 500);
  }
  return out;
}

export function fieldDisplay(f: UsedField, v: string | number | boolean | undefined): string {
  if (v === undefined || v === '') return '—';
  if (f.type === 'BOOLEAN') return v ? 'أيوه' : 'لأ';
  if (f.type === 'SELECT') return f.options.find((o) => o.value === v)?.label ?? String(v);
  if (f.type === 'NUMBER') return `${v}${f.unit ?? ''}`;
  return String(v);
}

export function declaredDefects(policy: UsedPolicy, answers: UsedAnswers): Defect[] {
  const out: Defect[] = [];
  for (const f of policy.fields) {
    const v = answers[f.code];
    if (v === undefined) continue;
    if (f.type === 'SELECT' && f.options.find((o) => o.value === v)?.defect) out.push({ code: f.code, label: f.label, detail: fieldDisplay(f, v) });
    else if (f.type === 'NUMBER' && f.defectBelow !== undefined && typeof v === 'number' && v < f.defectBelow) out.push({ code: f.code, label: f.label, detail: `${v}${f.unit ?? ''} (أقل من ${f.defectBelow}${f.unit ?? ''})` });
    else if (f.type === 'BOOLEAN' && f.defectWhen !== undefined && v === f.defectWhen) out.push({ code: f.code, label: f.label, detail: fieldDisplay(f, v) });
    else if (f.type === 'TEXT' && f.defectText && String(v).trim() && !/^(لا يوجد|لا|مفيش|none|no)$/i.test(String(v).trim())) out.push({ code: f.code, label: f.label, detail: String(v) });
  }
  return out;
}

export type ReportCheck = { problems: string[]; conditionCompleteness: number; evidenceCompleteness: number; defects: Defect[]; complete: boolean };

/** What is still missing, and how complete the documentation is (0..1 each). */
export function checkReport(policy: UsedPolicy, answers: UsedAnswers, hasIdentifier: boolean, evidence: Record<string, number>): ReportCheck {
  const problems: string[] = [];
  const required = policy.fields.filter((f) => f.required);
  let filled = 0;
  for (const f of required) {
    const ok = f.identifier ? hasIdentifier : answers[f.code] !== undefined && answers[f.code] !== '';
    if (ok) filled++;
    else problems.push(`ناقص: ${f.label}`);
    const v = answers[f.code];
    if (f.type === 'NUMBER' && typeof v === 'number' && ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max))) problems.push(`${f.label}: قيمة خارج المدى`);
  }
  const defects = declaredDefects(policy, answers);
  const slots = policy.evidence.filter((s) => s.required || (s.requiredWhenDefects && defects.length > 0));
  let have = 0;
  for (const s of slots) {
    if ((evidence[s.code] ?? 0) > 0) have++;
    else problems.push(`صورة ناقصة: ${s.label}`);
  }
  const conditionCompleteness = required.length ? filled / required.length : 1;
  const evidenceCompleteness = slots.length ? have / slots.length : 1;
  return { problems, conditionCompleteness, evidenceCompleteness, defects, complete: problems.length === 0 };
}

/* ───────── Protection level ───────── */

export function protectionLevel(policy: UsedPolicy, s: { complete: boolean; identityApproved: boolean; staffVerified: boolean; inspectionPassed: boolean }): ProtectionLevel {
  if (s.inspectionPassed && policy.levels.includes('INSPECTED')) return 'INSPECTED';
  const verified = s.staffVerified && (!policy.verification.requireComplete || s.complete) && (!policy.verification.requireIdentity || s.identityApproved);
  if (verified && policy.levels.includes('VERIFIED')) return 'VERIFIED';
  return 'PROTECTED';
}

export type Coverage = { key: 'TRANSACTION' | 'CONDITION' | 'INSPECTION' | 'WARRANTY'; title: string; covered: boolean; text: string };

/** The four protections, never merged into one claim. */
export function coverage(level: ProtectionLevel, warranty: string | null | undefined): Coverage[] {
  const w = warranty?.trim();
  return [
    { key: 'TRANSACTION', title: 'حماية الفلوس', covered: true, text: 'فلوسك بتفضل عند اضمن لحد ما تستلم وتتأكد، وإتاحتها للبائع بتتم بموافقة الإدارة فقط.' },
    {
      key: 'CONDITION',
      title: 'توثيق الحالة',
      covered: level !== 'PROTECTED',
      text: level !== 'PROTECTED' ? 'فريق اضمن راجع بيانات الحالة والصور اللي قدّمها البائع. دي مراجعة مستندات، مش فحص فني.' : 'الحالة موصوفة من البائع ومثبتة في جواز المنتج، ولسه فريق اضمن ما راجعهاش.',
    },
    { key: 'INSPECTION', title: 'فحص فني', covered: level === 'INSPECTED', text: level === 'INSPECTED' ? 'المنتج اتفحص فعليًا وتقرير الفحص متسجّل.' : 'المنتج ما اتفحصش فحص فني.' },
    { key: 'WARRANTY', title: 'الضمان', covered: !!w, text: w ? `ضمان من البائع: ${w}` : 'مفيش ضمان على المنتج. اضمن مش بتقدّم ضمان على المنتجات.' },
  ];
}

/* ───────── Deal Safety Score (explainable, configurable) ───────── */

export const SAFETY_FACTORS = [
  'SELLER_VERIFICATION',
  'ACCOUNT_HISTORY',
  'COMPLETED_DEALS',
  'DISPUTE_HISTORY',
  'CONDITION_COMPLETENESS',
  'EVIDENCE_COMPLETENESS',
  'INSPECTION',
  'SHIPPING_EVIDENCE',
  'RETURN_POLICY',
  'PROTECTION_LEVEL',
] as const;
export type SafetyFactor = (typeof SAFETY_FACTORS)[number];
export const SAFETY_FACTOR_LABELS: Record<SafetyFactor, string> = {
  SELLER_VERIFICATION: 'توثيق البائع',
  ACCOUNT_HISTORY: 'عمر الحساب',
  COMPLETED_DEALS: 'عمليات مكتملة',
  DISPUTE_HISTORY: 'سجل النزاعات',
  CONDITION_COMPLETENESS: 'اكتمال بيانات الحالة',
  EVIDENCE_COMPLETENESS: 'اكتمال الصور',
  INSPECTION: 'الفحص الفني',
  SHIPPING_EVIDENCE: 'إثبات الشحن',
  RETURN_POLICY: 'سياسة الإرجاع',
  PROTECTION_LEVEL: 'مستوى الحماية',
};

export const safetyRulesSchema = z
  .object({
    weights: z.object(Object.fromEntries(SAFETY_FACTORS.map((f) => [f, z.number().int().min(0).max(50)])) as Record<SafetyFactor, z.ZodNumber>),
    thresholds: z.object({ high: z.number().int().min(1).max(100), medium: z.number().int().min(0).max(99) }),
    /** Saturation points: account age (days) and completed transactions that earn the full factor. */
    fullAccountAgeDays: z.number().int().min(1).max(3650),
    fullCompletedDeals: z.number().int().min(1).max(1000),
  })
  .refine((r) => r.thresholds.medium < r.thresholds.high, 'حد «متوسط» لازم يكون أقل من «مرتفع»')
  .refine((r) => Object.values(r.weights).some((w) => w > 0), 'لازم عامل واحد على الأقل بوزن');
export type SafetyRules = z.infer<typeof safetyRulesSchema>;

export const DEFAULT_SAFETY_RULES: SafetyRules = {
  weights: {
    SELLER_VERIFICATION: 20,
    ACCOUNT_HISTORY: 8,
    COMPLETED_DEALS: 12,
    DISPUTE_HISTORY: 10,
    CONDITION_COMPLETENESS: 15,
    EVIDENCE_COMPLETENESS: 15,
    INSPECTION: 5,
    SHIPPING_EVIDENCE: 5,
    RETURN_POLICY: 5,
    PROTECTION_LEVEL: 5,
  },
  thresholds: { high: 75, medium: 50 },
  fullAccountAgeDays: 180,
  fullCompletedDeals: 10,
};

export type SafetyInputs = {
  identityApproved: boolean;
  phoneVerified: boolean;
  accountAgeDays: number;
  completedDeals: number;
  disputesLost: number;
  conditionCompleteness: number;
  evidenceCompleteness: number;
  inspected: boolean;
  /** null = not applicable yet (nothing shipped). */
  shippingEvidence: boolean | null;
  /** null = not set. */
  returnPolicy: 'VOLUNTARY' | 'NONE' | null;
  level: ProtectionLevel;
};

export type SafetyScore = {
  score: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  levelLabel: string;
  factors: { factor: SafetyFactor; label: string; earned: number; max: number; applicable: boolean; why: string }[];
};

export const SAFETY_SCORE_DISCLAIMER = 'المؤشر ده تقييم استرشادي مبني على البيانات المتاحة لاضمن. مش احتمال نجاح الصفقة ولا ضمان للمنتج، وفلوسك محمية في كل الحالات بنفس القواعد.';

export function safetyScore(rules: SafetyRules, i: SafetyInputs): SafetyScore {
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const parts: Record<SafetyFactor, { ratio: number | null; why: string }> = {
    SELLER_VERIFICATION: {
      ratio: (i.identityApproved ? 0.75 : 0) + (i.phoneVerified ? 0.25 : 0),
      why: i.identityApproved ? (i.phoneVerified ? 'هوية البائع متحقق منها ورقم موبايله متأكد.' : 'هوية البائع متحقق منها.') : i.phoneVerified ? 'رقم موبايل البائع متأكد، والهوية لسه ما اتراجعتش.' : 'البائع لسه ما وثّقش هويته.',
    },
    ACCOUNT_HISTORY: { ratio: Math.min(i.accountAgeDays / rules.fullAccountAgeDays, 1), why: `عمر حساب البائع ${i.accountAgeDays} يوم.` },
    COMPLETED_DEALS: { ratio: Math.min(i.completedDeals / rules.fullCompletedDeals, 1), why: i.completedDeals ? `البائع كمّل ${i.completedDeals} عملية على اضمن.` : 'لسه مفيش عمليات مكتملة للبائع على اضمن.' },
    DISPUTE_HISTORY: {
      ratio: i.disputesLost === 0 ? 1 : Math.max(0, 1 - (i.disputesLost / Math.max(1, i.completedDeals)) * 4),
      why: i.disputesLost === 0 ? 'مفيش نزاعات اتحكمت ضد البائع.' : `${i.disputesLost} نزاع اتحكم ضد البائع.`,
    },
    CONDITION_COMPLETENESS: { ratio: i.conditionCompleteness, why: `بيانات الحالة مكتملة بنسبة ${pct(i.conditionCompleteness)}.` },
    EVIDENCE_COMPLETENESS: { ratio: i.evidenceCompleteness, why: `الصور المطلوبة مكتملة بنسبة ${pct(i.evidenceCompleteness)}.` },
    INSPECTION: { ratio: i.inspected ? 1 : 0, why: i.inspected ? 'فيه تقرير فحص فني متسجّل.' : 'المنتج ما اتفحصش فحص فني.' },
    SHIPPING_EVIDENCE: { ratio: i.shippingEvidence === null ? null : i.shippingEvidence ? 1 : 0, why: i.shippingEvidence === null ? 'لسه ما اتشحنش.' : i.shippingEvidence ? 'فيه إثبات شحن متسجّل.' : 'مفيش إثبات شحن.' },
    RETURN_POLICY: {
      ratio: i.returnPolicy === null ? null : i.returnPolicy === 'VOLUNTARY' ? 1 : 0.3,
      why: i.returnPolicy === null ? 'سياسة الإرجاع لسه ما اتحددتش.' : i.returnPolicy === 'VOLUNTARY' ? 'البائع بيقبل الإرجاع الاختياري.' : 'مفيش إرجاع اختياري (حقك في النزاع لو المنتج مش مطابق محفوظ).',
    },
    PROTECTION_LEVEL: { ratio: i.level === 'INSPECTED' ? 1 : i.level === 'VERIFIED' ? 0.8 : 0.4, why: `مستوى الحماية: ${PROTECTION_LEVEL_LABELS[i.level]}.` },
  };
  let earned = 0;
  let total = 0;
  const factors = SAFETY_FACTORS.map((f) => {
    const max = rules.weights[f];
    const { ratio, why } = parts[f];
    const applicable = ratio !== null && max > 0;
    const e = applicable ? Math.round(max * Math.max(0, Math.min(1, ratio!)) * 10) / 10 : 0;
    if (applicable) {
      earned += e;
      total += max;
    }
    return { factor: f, label: SAFETY_FACTOR_LABELS[f], earned: e, max, applicable, why };
  });
  const score = total ? Math.round((earned / total) * 100) : 0;
  const level = score >= rules.thresholds.high ? 'HIGH' : score >= rules.thresholds.medium ? 'MEDIUM' : 'LOW';
  return { score, level, levelLabel: level === 'HIGH' ? 'مرتفع' : level === 'MEDIUM' ? 'متوسط' : 'محدود', factors };
}

/** Inspection days for a used transaction: the requested value clamped to the category policy. */
export function inspectionDaysFor(policy: UsedPolicy, requested: number | null | undefined): number {
  const r = requested ?? policy.inspection.defaultDays;
  return Math.min(policy.inspection.maxDays, Math.max(policy.inspection.minDays, r));
}

/** Deterministic JSON (sorted keys) — the input of every snapshot hash. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}
