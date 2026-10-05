import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  attributeOptions,
  attributes,
  categories,
  categoryAttributes,
  cmsBlocks,
  commissionRules,
  governorates,
  legalDocuments,
  listingPolicyRules,
  paymentMethods,
  rolePermissions,
  roles,
} from '@/server/db/schema';
import { DEFAULT_ROLES } from '@/server/rbac/permissions';
import { LEGAL_CODES } from '@/server/modules/cms/service';

/**
 * REFERENCE data — safe for every environment and idempotent (re-running never duplicates).
 * Contains NO commerce records, NO credentials and NO real financial account details.
 */

export const GOVERNORATES: [string, string, string][] = [
  ['CAI', 'القاهرة', 'Cairo'],
  ['GIZ', 'الجيزة', 'Giza'],
  ['ALX', 'الإسكندرية', 'Alexandria'],
  ['QLY', 'القليوبية', 'Qalyubia'],
  ['SHR', 'الشرقية', 'Sharqia'],
  ['DKH', 'الدقهلية', 'Dakahlia'],
  ['BHR', 'البحيرة', 'Beheira'],
  ['GHR', 'الغربية', 'Gharbia'],
  ['MNF', 'المنوفية', 'Monufia'],
  ['KFS', 'كفر الشيخ', 'Kafr El Sheikh'],
  ['DMT', 'دمياط', 'Damietta'],
  ['PTS', 'بورسعيد', 'Port Said'],
  ['ISM', 'الإسماعيلية', 'Ismailia'],
  ['SUZ', 'السويس', 'Suez'],
  ['FYM', 'الفيوم', 'Faiyum'],
  ['BNS', 'بني سويف', 'Beni Suef'],
  ['MNY', 'المنيا', 'Minya'],
  ['AST', 'أسيوط', 'Asyut'],
  ['SHG', 'سوهاج', 'Sohag'],
  ['QNA', 'قنا', 'Qena'],
  ['LXR', 'الأقصر', 'Luxor'],
  ['ASN', 'أسوان', 'Aswan'],
  ['RSE', 'البحر الأحمر', 'Red Sea'],
  ['NVL', 'الوادي الجديد', 'New Valley'],
  ['MTR', 'مطروح', 'Matrouh'],
  ['NSN', 'شمال سيناء', 'North Sinai'],
  ['SSN', 'جنوب سيناء', 'South Sinai'],
];

/**
 * Category tree. `bps` = INITIAL BENCHMARK commission (Amazon.eg-style category referral fees as
 * discussed by the business). These are editable business configuration, not fixed logic.
 */
interface CatSeed {
  slug: string;
  ar: string;
  en: string;
  icon?: string;
  bps?: number;
  restricted?: boolean;
  children?: CatSeed[];
}
export const CATEGORY_TREE: CatSeed[] = [
  {
    slug: 'electronics', ar: 'إلكترونيات', en: 'Electronics', icon: 'Cpu', bps: 800,
    children: [
      { slug: 'mobile-phones', ar: 'موبايلات', en: 'Mobile Phones', icon: 'Smartphone', bps: 450 },
      { slug: 'computers', ar: 'كمبيوتر ولابتوب', en: 'Computers & Laptops', icon: 'Laptop', bps: 400 },
      { slug: 'tablets', ar: 'تابلت', en: 'Tablets', icon: 'Tablet', bps: 400 },
      { slug: 'game-consoles', ar: 'أجهزة ألعاب', en: 'Game Consoles', icon: 'Gamepad2', bps: 400 },
      { slug: 'video-games', ar: 'ألعاب فيديو', en: 'Video Games', icon: 'Joystick', bps: 1000 },
      { slug: 'tvs', ar: 'تلفزيونات', en: 'TVs', icon: 'Tv', bps: 500 },
      { slug: 'home-entertainment', ar: 'صوتيات ومسرح منزلي', en: 'Home Entertainment', icon: 'Speaker', bps: 500 },
      { slug: 'cameras', ar: 'كاميرات', en: 'Cameras', icon: 'Camera', bps: 700 },
      { slug: 'electronics-accessories', ar: 'إكسسوارات إلكترونية', en: 'Consumer Electronics & Accessories', icon: 'Headphones', bps: 800 },
      { slug: 'software', ar: 'برمجيات', en: 'Software', icon: 'AppWindow', bps: 1000 },
    ],
  },
  {
    slug: 'appliances', ar: 'أجهزة منزلية', en: 'Appliances', icon: 'Refrigerator',
    children: [
      { slug: 'large-appliances', ar: 'أجهزة كبيرة', en: 'Large Appliances', icon: 'WashingMachine', bps: 500 },
      { slug: 'small-appliances', ar: 'أجهزة صغيرة', en: 'Small Appliances', icon: 'Blender', bps: 700 },
    ],
  },
  {
    slug: 'fashion', ar: 'أزياء', en: 'Fashion', icon: 'Shirt', bps: 1500,
    children: [
      { slug: 'men', ar: 'رجالي', en: 'Men', bps: 1500 },
      { slug: 'women', ar: 'حريمي', en: 'Women', bps: 1500 },
      { slug: 'kids-fashion', ar: 'أطفال', en: 'Kids', bps: 1500 },
      { slug: 'shoes', ar: 'أحذية', en: 'Shoes', icon: 'Footprints', bps: 1500 },
      { slug: 'watches', ar: 'ساعات', en: 'Watches', icon: 'Watch', bps: 1200 },
    ],
  },
  {
    slug: 'home', ar: 'المنزل والمطبخ', en: 'Home & Kitchen', icon: 'Sofa', bps: 1300,
    children: [
      { slug: 'furniture', ar: 'أثاث', en: 'Furniture', bps: 1300 },
      { slug: 'kitchen', ar: 'أدوات المطبخ', en: 'Kitchen', bps: 1300 },
      { slug: 'home-decor', ar: 'ديكور', en: 'Home Decor', bps: 1300 },
    ],
  },
  {
    slug: 'beauty', ar: 'الجمال والعناية', en: 'Beauty', icon: 'Sparkles', bps: 1200,
    children: [
      { slug: 'perfumes', ar: 'عطور', en: 'Perfumes', bps: 1300 },
      { slug: 'skincare', ar: 'العناية بالبشرة', en: 'Skincare', bps: 1200 },
    ],
  },
  { slug: 'baby', ar: 'مستلزمات الأطفال', en: 'Baby', icon: 'Baby', bps: 900 },
  { slug: 'toys', ar: 'ألعاب', en: 'Toys', icon: 'ToyBrick', bps: 1300 },
  { slug: 'sports', ar: 'رياضة ولياقة', en: 'Sports & Fitness', icon: 'Dumbbell' },
  { slug: 'automotive', ar: 'السيارات', en: 'Automotive', icon: 'Car', bps: 1200 },
  { slug: 'books', ar: 'كتب', en: 'Books', icon: 'BookOpen', bps: 700 },
  { slug: 'pet-supplies', ar: 'مستلزمات الحيوانات الأليفة', en: 'Pet Supplies', icon: 'PawPrint', bps: 1400 },
  { slug: 'health', ar: 'الصحة', en: 'Health', icon: 'HeartPulse', restricted: true },
];

interface AttrSeed {
  code: string;
  ar: string;
  en: string;
  type: 'TEXT' | 'NUMBER' | 'SELECT' | 'MULTI_SELECT' | 'BOOLEAN';
  unit?: string;
  options?: [string, string][];
}
export const ATTRIBUTES: AttrSeed[] = [
  { code: 'model', ar: 'الموديل', en: 'Model', type: 'TEXT' },
  { code: 'storage', ar: 'سعة التخزين', en: 'Storage', type: 'SELECT', options: [['64GB', '64 جيجا'], ['128GB', '128 جيجا'], ['256GB', '256 جيجا'], ['512GB', '512 جيجا'], ['1TB', '1 تيرا']] },
  { code: 'ram', ar: 'الرامات', en: 'RAM', type: 'SELECT', options: [['4GB', '4 جيجا'], ['6GB', '6 جيجا'], ['8GB', '8 جيجا'], ['12GB', '12 جيجا'], ['16GB', '16 جيجا'], ['32GB', '32 جيجا']] },
  { code: 'color', ar: 'اللون', en: 'Color', type: 'SELECT', options: [['black', 'أسود'], ['white', 'أبيض'], ['silver', 'فضي'], ['gold', 'ذهبي'], ['blue', 'أزرق'], ['red', 'أحمر'], ['green', 'أخضر'], ['gray', 'رمادي'], ['beige', 'بيج']] },
  { code: 'warranty', ar: 'الضمان', en: 'Warranty', type: 'TEXT' },
  { code: 'screen_size', ar: 'حجم الشاشة', en: 'Screen size', type: 'NUMBER', unit: 'بوصة' },
  { code: 'processor', ar: 'المعالج', en: 'Processor', type: 'TEXT' },
  { code: 'dual_sim', ar: 'شريحتين', en: 'Dual SIM', type: 'BOOLEAN' },
  { code: 'size', ar: 'المقاس', en: 'Size', type: 'SELECT', options: [['XS', 'XS'], ['S', 'S'], ['M', 'M'], ['L', 'L'], ['XL', 'XL'], ['XXL', 'XXL']] },
  { code: 'shoe_size', ar: 'مقاس الحذاء', en: 'Shoe size', type: 'SELECT', options: [['38', '38'], ['39', '39'], ['40', '40'], ['41', '41'], ['42', '42'], ['43', '43'], ['44', '44'], ['45', '45']] },
  { code: 'material', ar: 'الخامة', en: 'Material', type: 'TEXT' },
  { code: 'capacity_l', ar: 'السعة', en: 'Capacity', type: 'NUMBER', unit: 'لتر' },
  { code: 'power_w', ar: 'القدرة', en: 'Power', type: 'NUMBER', unit: 'وات' },
];

/** [category slug, attribute code, required, filterable, variantAxis] */
export const CATEGORY_ATTRIBUTES: [string, string, boolean, boolean, boolean][] = [
  ['mobile-phones', 'model', true, false, false],
  ['mobile-phones', 'storage', true, true, true],
  ['mobile-phones', 'ram', false, true, false],
  ['mobile-phones', 'color', false, true, true],
  ['mobile-phones', 'dual_sim', false, true, false],
  ['mobile-phones', 'warranty', false, false, false],
  ['computers', 'model', true, false, false],
  ['computers', 'processor', true, false, false],
  ['computers', 'ram', true, true, false],
  ['computers', 'storage', true, true, false],
  ['computers', 'screen_size', false, true, false],
  ['computers', 'warranty', false, false, false],
  ['tablets', 'storage', false, true, true],
  ['tvs', 'screen_size', true, true, false],
  ['tvs', 'warranty', false, false, false],
  ['fashion', 'color', false, true, true],
  ['fashion', 'material', false, false, false],
  ['men', 'size', false, true, true],
  ['women', 'size', false, true, true],
  ['kids-fashion', 'size', false, true, true],
  ['shoes', 'shoe_size', false, true, true],
  ['large-appliances', 'capacity_l', false, true, false],
  ['large-appliances', 'warranty', false, false, false],
  ['small-appliances', 'power_w', false, true, false],
  ['small-appliances', 'warranty', false, false, false],
];

export const POLICY_RULES: ['BLOCK_KEYWORD' | 'REVIEW_KEYWORD', string, string][] = [
  ['BLOCK_KEYWORD', 'سلاح ناري', 'WEAPONS'],
  ['BLOCK_KEYWORD', 'مسدس', 'WEAPONS'],
  ['BLOCK_KEYWORD', 'ذخيرة', 'WEAPONS'],
  ['BLOCK_KEYWORD', 'مخدرات', 'DRUGS'],
  ['BLOCK_KEYWORD', 'حشيش', 'DRUGS'],
  ['BLOCK_KEYWORD', 'ترامادول', 'CONTROLLED_MEDICINE'],
  ['BLOCK_KEYWORD', 'بطاقة رقم قومي', 'IDENTITY_DOCUMENTS'],
  ['BLOCK_KEYWORD', 'عملات مزيفة', 'COUNTERFEIT_CURRENCY'],
  ['REVIEW_KEYWORD', 'كوبي', 'POSSIBLE_REPLICA'],
  ['REVIEW_KEYWORD', 'هاي كوبي', 'POSSIBLE_REPLICA'],
  ['REVIEW_KEYWORD', 'replica', 'POSSIBLE_REPLICA'],
  ['REVIEW_KEYWORD', 'مستورد بدون ضمان', 'WARRANTY_CHECK'],
  ['REVIEW_KEYWORD', 'دواء', 'MEDICAL'],
];

const LEGAL_PLACEHOLDER = (title: string) => `⚠️ مسودة غير معتمدة — هذا النص مؤقت لأغراض التطوير والعرض فقط، ولا يمثل الصيغة القانونية النهائية.
يجب مراجعة واعتماد "${title}" من المستشار القانوني لشركة اضمن قبل الإطلاق.

تُحدد هذه الوثيقة القواعد المنظمة لاستخدام منصة اضمن فيما يخص: ${title}.
لا تنتقص أي سياسة من سياسات البائعين أو المنصة من الحقوق المقررة للمستهلك بموجب القوانين المصرية النافذة، بما فيها قانون حماية المستهلك.

[يُستكمل النص النهائي بعد المراجعة القانونية]`;

export async function seedReference() {
  // Governorates
  for (const [i, [code, ar, en]] of GOVERNORATES.entries()) {
    await db.insert(governorates).values({ id: i + 1, code, nameAr: ar, nameEn: en, sortOrder: i }).onConflictDoUpdate({ target: governorates.id, set: { code, nameAr: ar, nameEn: en } });
  }
  // Roles & permissions
  for (const [code, r] of Object.entries(DEFAULT_ROLES)) {
    await db.insert(roles).values({ code, nameAr: r.nameAr, nameEn: r.nameEn, isSystem: true }).onConflictDoNothing();
    const existing = await db.select().from(rolePermissions).where(eq(rolePermissions.roleCode, code));
    if (!existing.length || code === 'SUPER_ADMIN') {
      for (const p of r.permissions) await db.insert(rolePermissions).values({ roleCode: code, permission: p }).onConflictDoNothing();
    }
  }
  // Payment methods (disabled until an admin configures destinations)
  const methods: [string, string, string, number][] = [
    ['INSTAPAY', 'إنستاباي', 'InstaPay', 1],
    ['VODAFONE_CASH', 'فودافون كاش', 'Vodafone Cash', 2],
    ['BANK_TRANSFER', 'تحويل بنكي', 'Bank transfer', 3],
  ];
  for (const [code, ar, en, sort] of methods) {
    await db
      .insert(paymentMethods)
      .values({ code: code as 'INSTAPAY', nameAr: ar, nameEn: en, sortOrder: sort, isEnabled: false, instructionsAr: 'حوّل المبلغ المطلوب بالضبط ثم ارفع صورة إيصال التحويل مع رقم العملية.' })
      .onConflictDoNothing();
  }
  // Categories
  const ids = new Map<string, string>();
  async function upsertCat(c: CatSeed, parent: { id: string; path: string[] } | null, sort: number) {
    let [row] = await db.select().from(categories).where(eq(categories.slug, c.slug));
    if (!row) {
      [row] = await db
        .insert(categories)
        .values({ slug: c.slug, nameAr: c.ar, nameEn: c.en, icon: c.icon ?? null, parentId: parent?.id ?? null, sortOrder: sort, isRestricted: !!c.restricted })
        .returning();
      const path = [...(parent?.path ?? []), row.id];
      await db.update(categories).set({ path, depth: path.length - 1 }).where(eq(categories.id, row.id));
      row.path = path;
    }
    ids.set(c.slug, row.id);
    for (const [i, ch] of (c.children ?? []).entries()) await upsertCat(ch, { id: row.id, path: row.path }, i);
  }
  for (const [i, c] of CATEGORY_TREE.entries()) await upsertCat(c, null, i);

  // Attributes
  const attrIds = new Map<string, string>();
  for (const a of ATTRIBUTES) {
    let [row] = await db.select().from(attributes).where(eq(attributes.code, a.code));
    if (!row) [row] = await db.insert(attributes).values({ code: a.code, nameAr: a.ar, nameEn: a.en, type: a.type, unit: a.unit ?? null }).returning();
    attrIds.set(a.code, row.id);
    for (const [i, [value, label]] of (a.options ?? []).entries()) {
      await db.insert(attributeOptions).values({ attributeId: row.id, value, labelAr: label, labelEn: value, sortOrder: i }).onConflictDoNothing();
    }
  }
  for (const [i, [cat, attr, req, filt, axis]] of CATEGORY_ATTRIBUTES.entries()) {
    await db
      .insert(categoryAttributes)
      .values({ categoryId: ids.get(cat)!, attributeId: attrIds.get(attr)!, isRequired: req, isFilterable: filt, isVariantAxis: axis, sortOrder: i })
      .onConflictDoNothing();
  }

  // Commission rules (benchmark seed; append-only, editable via admin)
  const [def] = await db.select().from(commissionRules).where(isNull(commissionRules.categoryId));
  const effective = new Date('2024-01-01T00:00:00Z');
  if (!def) {
    await db.insert(commissionRules).values({ categoryId: null, label: 'Other / افتراضي (معيار مبدئي قابل للتعديل)', percentBps: 1000, effectiveFrom: effective, notes: 'Initial benchmark — editable business configuration' });
  }
  async function seedRules(list: CatSeed[]) {
    for (const c of list) {
      if (c.bps !== undefined) {
        const catId = ids.get(c.slug)!;
        const [exists] = await db.select({ id: commissionRules.id }).from(commissionRules).where(eq(commissionRules.categoryId, catId));
        if (!exists) {
          await db.insert(commissionRules).values({ categoryId: catId, label: `${c.en} — معيار مبدئي`, percentBps: c.bps, effectiveFrom: effective, notes: 'Initial benchmark (category referral-fee approach) — editable' });
        }
      }
      await seedRules(c.children ?? []);
    }
  }
  await seedRules(CATEGORY_TREE);

  // Listing policy
  for (const [kind, pattern, reasonCode] of POLICY_RULES) {
    const [exists] = await db.select({ id: listingPolicyRules.id }).from(listingPolicyRules).where(and(eq(listingPolicyRules.pattern, pattern), eq(listingPolicyRules.kind, kind)));
    if (!exists) await db.insert(listingPolicyRules).values({ kind, pattern, reasonCode });
  }

  // Legal documents — DRAFT placeholders only (never fabricated final legal text)
  for (const [code, meta] of Object.entries(LEGAL_CODES)) {
    const [exists] = await db.select({ id: legalDocuments.id }).from(legalDocuments).where(eq(legalDocuments.code, code));
    if (!exists) await db.insert(legalDocuments).values({ code, version: '0.1-draft', title: meta.title, body: LEGAL_PLACEHOLDER(meta.title), status: 'DRAFT', isCurrent: true });
  }

  // Homepage CMS defaults (editable from Admin → CMS)
  const [anyBlock] = await db.select({ id: cmsBlocks.id }).from(cmsBlocks).limit(1);
  if (!anyBlock) {
    // Order follows the homepage hierarchy. Wording about payment protection is a DRAFT pending counsel review.
    const blocks: (typeof cmsBlocks.$inferInsert)[] = [
      { type: 'HERO', title: 'الرئيسية', sortOrder: 0, data: { heading: 'كل اللي محتاجه من بائعين موثّقين', subheading: 'منتجات جديدة ومستعملة من متاجر مصرية تمت مراجعتها. ادفع لاضمن، والبائع يستلم مستحقاته بعد ما تأكد استلام طلبك.', ctaLabel: 'تسوّق العروض', ctaHref: '/deals' } },
      { type: 'FEATURED_CATEGORIES', title: 'تسوّق حسب التصنيف', sortOrder: 1, data: { categorySlugs: ['mobile-phones', 'computers', 'tvs', 'large-appliances', 'small-appliances', 'men', 'women', 'shoes', 'home', 'beauty', 'toys', 'sports'] } },
      { type: 'PRODUCT_RAIL', title: 'عروض اليوم', sortOrder: 2, data: { source: 'DEALS', limit: 8 } },
      { type: 'PRODUCT_RAIL', title: 'مقترحات لك', sortOrder: 3, data: { source: 'RECOMMENDED', limit: 8 } },
      { type: 'PRODUCT_RAIL', title: 'الأكثر مبيعاً', sortOrder: 4, data: { source: 'BEST_SELLERS', limit: 8 } },
      { type: 'PRODUCT_RAIL', title: 'مستعمل بحالة ممتازة', sortOrder: 5, data: { source: 'USED', limit: 8 } },
      { type: 'FEATURED_SELLERS', title: 'متاجر موثّقة', sortOrder: 6, data: { storeSlugs: [] } },
      { type: 'DEAL_CTA', title: 'صفقة خارج السوق', sortOrder: 7, data: { heading: 'لقيت حاجة برّه اضمن؟ اشتريها بأمان أكتر', body: 'لو اتفقت مع بائع على فيسبوك أو أي مكان، اعمل صفقة محمية: تدفع لاضمن، والبائع يستلم مستحقاته بعد ما تأكد الاستلام أو بعد انتهاء مدة الفحص المتفق عليها.', ctaLabel: 'ابدأ صفقة محمية' } },
      { type: 'TRUST', title: 'ليه تشتري من اضمن؟', sortOrder: 8, data: { items: [
        { title: 'بائعون تمت مراجعتهم', body: 'كل بائع يمر بمراجعة الهوية والمستندات قبل ما يبدأ البيع.' },
        { title: 'صور حقيقية للمستعمل', body: 'المنتج المستعمل يُعرض بصور القطعة نفسها مع حالتها وعيوبها.' },
        { title: 'شحن لكل المحافظات', body: 'كل بائع يحدد سعر ومدة الشحن لكل محافظة قبل الشراء.' },
        { title: 'دعم ونزاعات', body: 'فريق اضمن يراجع الشكاوى والنزاعات وفق سياسة النزاعات المعلنة.' },
      ] } },
      { type: 'TRUST', title: 'إزاي بنحمي مشترياتك؟', sortOrder: 9, data: { items: [
        { title: '١. تدفع لاضمن', body: 'التحويل يكون لحسابات اضمن المعلنة فقط، وفريقنا يتحقق من الدفع يدوياً.' },
        { title: '٢. البائع يشحن', body: 'البائع يرفع بوليصة الشحن، ورفعها لا يعني تحويل أي مستحقات له.' },
        { title: '٣. تستلم وتأكد', body: 'بعد ما تأكد الاستلام فقط يصبح صافي مستحق البائع متاحاً للسحب.' },
        { title: '٤. مشكلة؟', body: 'تقدر تطلب إرجاع أو تفتح نزاع حسب السياسات قبل تأكيد الاستلام أو خلال المدة المحددة.' },
      ] } },
    ];
    await db.insert(cmsBlocks).values(blocks.map((b) => ({ ...b, placement: 'HOME' })));
  }
  return { categories: ids.size, attributes: attrIds.size };
}
