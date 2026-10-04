import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { SellerDocumentKind } from '@/domain/machines';
import { adminActor, customerActor, sellerActor } from '@/server/auth/actors';
import { hashPassword } from '@/server/auth/password';
import type { Actor } from '@/server/core/actor';
import { encrypt } from '@/server/core/crypto';
import { db } from '@/server/db/client';
import { addresses, brands, categories, cmsBlocks, governorates, paymentDestinations, paymentMethods, sellerShippingRates, stores, userRoles, users } from '@/server/db/schema';
import { saveBrand } from '@/server/modules/catalog/taxonomy';
import { addImages, createDraft, moderateProduct, saveVariants, submitForReview, updateDetails, updateLogistics } from '@/server/modules/catalog/products';
import { addToCart } from '@/server/modules/commerce/cart';
import { placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import { cartLines } from '@/server/modules/commerce/cart';
import { confirmPayment, startReview, submitProof } from '@/server/modules/payments/service';
import { confirmReceipt, confirmSellerOrder, markShipped, saveShipment } from '@/server/modules/commerce/fulfilment';
import { approveWithdrawal, markWithdrawalPaid, markWithdrawalProcessing, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { createProductReview, createSellerReview } from '@/server/modules/reviews/service';
import { requestReturn } from '@/server/modules/postpurchase/returns';
import { openDispute } from '@/server/modules/postpurchase/disputes';
import { openTicket } from '@/server/modules/support/service';
import { addPayoutMethod, decideSeller, saveBusiness, saveIdentity, saveStore, startApplication, submitApplication, uploadSellerDocument } from '@/server/modules/sellers/service';
import { createDeal, inviteSeller, saveDealStep, acceptInvitation, startDealPayment } from '@/server/modules/deals/service';
import { orderItems, sellerOrders, payments, paymentSubmissions, productVariants } from '@/server/db/schema';
import { demoDocument, demoImage } from './demo-images';

/** Development-only credentials for demo accounts (public in this repository). NEVER used in production or staging. */
export const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const DEMO_PASSWORD = 'Demo@12345';
export const DEMO_ADMIN_PASSWORD = 'Admin@Edmn#2026';

/**
 * Credentials used by the demo seed. On a public STAGING deployment the repository defaults above are
 * public knowledge, so staging must supply its own secrets through the hosting provider's
 * environment (STAGING_DEMO_PASSWORD, STAGING_ADMIN_PASSWORD, STAGING_TOTP_SECRET).
 */
export function demoCredentials(): { password: string; adminPassword: string; totpSecret: string; staging: boolean } {
  if (process.env.EDMN_ENVIRONMENT !== 'staging') return { password: DEMO_PASSWORD, adminPassword: DEMO_ADMIN_PASSWORD, totpSecret: DEMO_TOTP_SECRET, staging: false };
  const password = process.env.STAGING_DEMO_PASSWORD ?? '';
  const adminPassword = process.env.STAGING_ADMIN_PASSWORD ?? '';
  const totpSecret = (process.env.STAGING_TOTP_SECRET ?? '').toUpperCase();
  const problems: string[] = [];
  if (password.length < 10 || password === DEMO_PASSWORD) problems.push('STAGING_DEMO_PASSWORD (≥ 10 chars, not the repository default)');
  if (adminPassword.length < 14 || adminPassword === DEMO_ADMIN_PASSWORD) problems.push('STAGING_ADMIN_PASSWORD (≥ 14 chars, not the repository default)');
  if (!/^[A-Z2-7]{32,}$/.test(totpSecret) || totpSecret === DEMO_TOTP_SECRET) problems.push('STAGING_TOTP_SECRET (base32, ≥ 32 chars, not the repository default)');
  if (problems.length) throw new Error(`Staging demo seed needs its own secrets:\n- ${problems.join('\n- ')}`);
  return { password, adminPassword, totpSecret, staging: true };
}

async function user(email: string, fullName: string, phone: string, opts: { staff?: boolean; roles?: string[]; password?: string } = {}) {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing;
  const [u] = await db
    .insert(users)
    .values({
      email,
      fullName,
      phone,
      passwordHash: await hashPassword(opts.password ?? demoCredentials().password),
      passwordChangedAt: new Date(Date.now() - 86400_000),
      isStaff: !!opts.staff,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      ...(opts.staff ? { totpSecretEnc: encrypt(demoCredentials().totpSecret), totpEnabledAt: new Date() } : {}),
    })
    .returning();
  for (const r of opts.roles ?? []) await db.insert(userRoles).values({ userId: u.id, roleCode: r }).onConflictDoNothing();
  return u;
}

type Icon = Parameters<typeof demoImage>[1];
interface ProductSeed {
  cat: string;
  brand?: string;
  title: string;
  label: string;
  icon: Icon;
  condition?: 'NEW' | 'USED';
  desc: string;
  features: string[];
  attrs?: Record<string, string[]>;
  variants: { sku: string; options?: Record<string, string>; price: number; compareAt?: number; stock: number }[];
  used?: { grade: 'LIKE_NEW' | 'VERY_GOOD' | 'GOOD' | 'ACCEPTABLE'; notes: string; defects: string; accessories: string; usage: string };
  warranty?: string;
}

const egp = (v: number) => Math.round(v * 100);

const TECH: ProductSeed[] = [
  { cat: 'mobile-phones', brand: 'samsung', title: 'سامسونج جالاكسي A55 5G', label: 'Galaxy A55', icon: 'phone', desc: 'هاتف سامسونج جالاكسي A55 بشاشة Super AMOLED مقاس 6.6 بوصة وكاميرا 50 ميجابكسل مع مقاومة للماء IP67 وبطارية 5000 مللي أمبير.', features: ['شاشة 120Hz', 'كاميرا 50MP بتثبيت بصري', 'بطارية 5000mAh', 'ضمان الوكيل سنة'], attrs: { model: ['SM-A556'], ram: ['8GB'], dual_sim: ['true'], warranty: ['سنة ضمان الوكيل'] }, variants: [{ sku: 'TZ-A55-128-BLK', options: { storage: '128GB', color: 'black' }, price: egp(18999), compareAt: egp(20999), stock: 12 }, { sku: 'TZ-A55-256-BLU', options: { storage: '256GB', color: 'blue' }, price: egp(21499), stock: 6 }] },
  { cat: 'mobile-phones', brand: 'apple', title: 'آيفون 15 - 128 جيجا', label: 'iPhone 15', icon: 'phone', desc: 'آيفون 15 بشاشة Super Retina XDR وشريحة A16 Bionic وكاميرا رئيسية 48 ميجابكسل ومنفذ USB-C.', features: ['Dynamic Island', 'كاميرا 48MP', 'USB-C', 'ضمان سنة'], attrs: { model: ['A3090'], ram: ['6GB'], warranty: ['سنة'] }, variants: [{ sku: 'TZ-IP15-128-BLK', options: { storage: '128GB', color: 'black' }, price: egp(49999), compareAt: egp(54999), stock: 4 }] },
  { cat: 'mobile-phones', brand: 'xiaomi', title: 'شاومي ريدمي نوت 13', label: 'Redmi Note 13', icon: 'phone', desc: 'ريدمي نوت 13 بشاشة AMOLED وكاميرا 108 ميجابكسل وشحن سريع 33 وات.', features: ['شاشة AMOLED 6.67', 'كاميرا 108MP', 'شحن 33W'], attrs: { model: ['2312DRAABG'], ram: ['8GB'], dual_sim: ['true'] }, variants: [{ sku: 'TZ-RN13-256', options: { storage: '256GB', color: 'black' }, price: egp(10499), compareAt: egp(11499), stock: 20 }] },
  { cat: 'computers', brand: 'lenovo', title: 'لابتوب لينوفو IdeaPad Slim 3 - Core i5', label: 'IdeaPad Slim 3', icon: 'laptop', desc: 'لابتوب خفيف للعمل والدراسة بمعالج Intel Core i5 الجيل 12 وذاكرة 8 جيجا وتخزين SSD 512 جيجا وشاشة 15.6 FHD.', features: ['Core i5-12450H', 'SSD 512GB', 'شاشة 15.6 FHD', 'ويندوز 11'], attrs: { model: ['82XM'], processor: ['Intel Core i5-12450H'], ram: ['8GB'], storage: ['512GB'], screen_size: ['15.6'], warranty: ['سنتان'] }, variants: [{ sku: 'TZ-IPS3-I5', price: egp(27999), compareAt: egp(30999), stock: 7 }] },
  { cat: 'computers', brand: 'hp', title: 'لابتوب HP Victus 15 للألعاب - RTX 3050', label: 'HP Victus 15', icon: 'laptop', desc: 'لابتوب ألعاب بمعالج Ryzen 5 وكارت شاشة RTX 3050 وذاكرة 16 جيجا.', features: ['RTX 3050 4GB', 'Ryzen 5 7535HS', '16GB RAM', 'شاشة 144Hz'], attrs: { model: ['15-fb0'], processor: ['AMD Ryzen 5 7535HS'], ram: ['16GB'], storage: ['512GB'], screen_size: ['15.6'] }, variants: [{ sku: 'TZ-VICTUS-R5', price: egp(42999), stock: 3 }] },
  { cat: 'electronics-accessories', brand: 'anker', title: 'باور بانك أنكر 20000 مللي أمبير', label: 'Anker 20000', icon: 'box', desc: 'شاحن متنقل بسعة 20000 مللي أمبير يدعم الشحن السريع لهاتفين في نفس الوقت.', features: ['شحن سريع 22.5W', 'منفذين USB', 'حماية متعددة'], variants: [{ sku: 'TZ-ANK-20K', price: egp(1899), compareAt: egp(2299), stock: 40 }] },
  { cat: 'tvs', brand: 'samsung', title: 'شاشة سامسونج 55 بوصة 4K Crystal UHD سمارت', label: 'Samsung 55 4K', icon: 'tv', desc: 'تلفزيون سمارت 4K بمعالج Crystal ونظام Tizen ودعم HDR10+.', features: ['دقة 4K', 'HDR10+', 'نظام Tizen', 'ضمان سنتين'], attrs: { screen_size: ['55'], warranty: ['سنتان'] }, variants: [{ sku: 'TZ-SAM55-CU', price: egp(23999), compareAt: egp(26999), stock: 5 }] },
];

const FASHION: ProductSeed[] = [
  { cat: 'men', brand: 'cottonil', title: 'قميص رجالي قطن 100% كاجوال', label: 'Cotton Shirt', icon: 'shirt', desc: 'قميص قطن مصري مريح للخروج والعمل، قصة مستقيمة وأزرار عالية الجودة.', features: ['قطن مصري 100%', 'قابل للغسيل في الغسالة', 'صناعة مصرية'], attrs: { material: ['قطن'] }, variants: [{ sku: 'BA-SHIRT-M-WHT', options: { size: 'M', color: 'white' }, price: egp(599), stock: 15 }, { sku: 'BA-SHIRT-L-WHT', options: { size: 'L', color: 'white' }, price: egp(599), stock: 12 }, { sku: 'BA-SHIRT-L-BLU', options: { size: 'L', color: 'blue' }, price: egp(649), stock: 8 }] },
  { cat: 'women', title: 'عباية حريمي كريب مطرزة', label: 'Abaya', icon: 'shirt', desc: 'عباية كريب خفيفة بتطريز يدوي على الأكمام، مناسبة للمناسبات والاستخدام اليومي.', features: ['قماش كريب', 'تطريز يدوي', 'مقاسات متعددة'], attrs: { material: ['كريب'] }, variants: [{ sku: 'BA-ABAYA-M-BLK', options: { size: 'M', color: 'black' }, price: egp(1250), compareAt: egp(1500), stock: 10 }, { sku: 'BA-ABAYA-L-BLK', options: { size: 'L', color: 'black' }, price: egp(1250), compareAt: egp(1500), stock: 9 }] },
  { cat: 'shoes', brand: 'adidas', title: 'حذاء رياضي أديداس Runfalcon 3', label: 'Runfalcon 3', icon: 'shoe', desc: 'حذاء جري خفيف بنعل مريح مناسب للتمرين اليومي.', features: ['نعل Cloudfoam', 'خامة شبكية', 'أصلي من الوكيل'], variants: [{ sku: 'BA-RF3-42', options: { shoe_size: '42', color: 'black' }, price: egp(2799), compareAt: egp(3199), stock: 6 }, { sku: 'BA-RF3-43', options: { shoe_size: '43', color: 'black' }, price: egp(2799), compareAt: egp(3199), stock: 5 }] },
  { cat: 'watches', brand: 'casio', title: 'ساعة كاسيو رجالي كلاسيك ستانلس', label: 'Casio Classic', icon: 'box', desc: 'ساعة كاسيو أنالوج بسوار ستانلس ستيل ومقاومة للماء.', features: ['مقاومة للماء 50 متر', 'سوار ستانلس', 'ضمان سنة'], variants: [{ sku: 'BA-CASIO-MTP', price: egp(1899), stock: 11 }] },
];

const HOME: ProductSeed[] = [
  { cat: 'large-appliances', brand: 'tornado', title: 'غسالة تورنيدو فول أوتوماتيك 8 كيلو', label: 'Tornado Washer', icon: 'appliance', desc: 'غسالة أمامية فول أوتوماتيك سعة 8 كيلو مع 15 برنامج غسيل وموتور إنفرتر موفر.', features: ['سعة 8 كجم', 'موتور إنفرتر', '15 برنامج', 'ضمان 5 سنوات على الموتور'], attrs: { capacity_l: ['8'], warranty: ['5 سنوات على الموتور'] }, variants: [{ sku: 'HS-TOR-WM8', price: egp(17499), compareAt: egp(18999), stock: 4 }] },
  { cat: 'small-appliances', brand: 'tornado', title: 'كاتل كهربائي تورنيدو 1.7 لتر ستانلس', label: 'Tornado Kettle', icon: 'appliance', desc: 'غلاية مياه كهربائية ستانلس ستيل بقدرة 2200 وات مع فصل تلقائي.', features: ['1.7 لتر', '2200 وات', 'فصل تلقائي'], attrs: { power_w: ['2200'] }, variants: [{ sku: 'HS-TOR-KT17', price: egp(1149), stock: 25 }] },
  { cat: 'small-appliances', brand: 'fresh', title: 'خلاط فريش 600 وات مع مطحنة', label: 'Fresh Blender', icon: 'appliance', desc: 'خلاط كهربائي بقدرة 600 وات مع إبريق زجاج 1.5 لتر ومطحنة توابل.', features: ['600 وات', 'إبريق زجاج', 'مطحنة إضافية'], attrs: { power_w: ['600'] }, variants: [{ sku: 'HS-FR-BL600', price: egp(1599), compareAt: egp(1799), stock: 18 }] },
  { cat: 'kitchen', title: 'طقم حلل جرانيت 10 قطع', label: 'Granite Set', icon: 'home', desc: 'طقم حلل جرانيت بطبقة غير لاصقة آمنة، يتضمن 5 حلل بأغطية زجاج.', features: ['10 قطع', 'غير لاصق', 'مناسب لكل أنواع البوتاجاز'], variants: [{ sku: 'HS-GRANITE-10', price: egp(3299), compareAt: egp(3999), stock: 9 }] },
  { cat: 'home-decor', title: 'سجادة مودرن 160×230 سم', label: 'Modern Rug', icon: 'home', desc: 'سجادة بتصميم مودرن وخامة بوليستر سهلة التنظيف.', features: ['160×230 سم', 'سهلة التنظيف', 'ألوان ثابتة'], variants: [{ sku: 'HS-RUG-160', price: egp(2450), stock: 7 }] },
  { cat: 'perfumes', title: 'عطر عود شرقي 100 مل', label: 'Oud 100ml', icon: 'beauty', desc: 'عطر شرقي بنفحات العود والعنبر يدوم طويلاً.', features: ['100 مل', 'ثبات عالي', 'مناسب للجنسين'], variants: [{ sku: 'HS-OUD-100', price: egp(950), stock: 30 }] },
];

const USED: ProductSeed[] = [
  { cat: 'mobile-phones', brand: 'apple', condition: 'USED', title: 'آيفون 13 برو 256 جيجا مستعمل - بطارية 88%', label: 'iPhone 13 Pro', icon: 'phone', desc: 'آيفون 13 برو مستعمل بحالة ممتازة، تم فحصه بالكامل. البطارية 88% وكل الوظائف تعمل بكفاءة.', features: ['بطارية 88%', 'Face ID يعمل', 'بدون صيانة سابقة'], attrs: { model: ['A2638'], ram: ['6GB'] }, variants: [{ sku: 'UW-IP13P-256', options: { storage: '256GB', color: 'silver' }, price: egp(27500), stock: 1 }], used: { grade: 'VERY_GOOD', notes: 'خدوش خفيفة جداً على الإطار لا تظهر إلا عن قرب. الشاشة سليمة تماماً.', defects: 'خدش صغير على الإطار الجانبي الأيسر', accessories: 'العلبة الأصلية + كابل شحن', usage: 'استخدام سنة ونصف' } },
  { cat: 'computers', brand: 'dell', condition: 'USED', title: 'لابتوب ديل لاتيتيود 7490 مستعمل - Core i7', label: 'Latitude 7490', icon: 'laptop', desc: 'لابتوب أعمال قوي ومتين، مناسب للبرمجة والعمل المكتبي. تم تغيير المعجون الحراري حديثاً.', features: ['Core i7-8650U', '16GB RAM', 'SSD 512GB', 'شاشة 14 FHD'], attrs: { model: ['Latitude 7490'], processor: ['Intel Core i7-8650U'], ram: ['16GB'], storage: ['512GB'], screen_size: ['14'] }, variants: [{ sku: 'UW-DL7490-I7', price: egp(13500), stock: 2 }], used: { grade: 'GOOD', notes: 'الجهاز يعمل بكفاءة، علامات استخدام عادية على الغطاء.', defects: 'لمعان خفيف على بعض أزرار الكيبورد، والبطارية تكفي حوالي 3 ساعات', accessories: 'شاحن أصلي', usage: 'جهاز شركات مستعمل' } },
  { cat: 'game-consoles', brand: 'sony', condition: 'USED', title: 'بلايستيشن 5 ستاندرد مستعمل مع درعين', label: 'PlayStation 5', icon: 'box', desc: 'بلايستيشن 5 نسخة الديسك مستعمل بحالة شبه جديدة مع درعين أصليين.', features: ['نسخة الديسك', 'درعين DualSense', 'كل الكابلات'], variants: [{ sku: 'UW-PS5-DISC', price: egp(24000), stock: 1 }], used: { grade: 'LIKE_NEW', notes: 'استخدام خفيف جداً، بحالة شبه جديدة.', defects: 'لا يوجد', accessories: 'العلبة + درعين + كابل HDMI + كابل باور', usage: 'استخدام 6 شهور' } },
  { cat: 'cameras', brand: 'canon', condition: 'USED', title: 'كاميرا كانون EOS 250D مستعملة مع عدسة 18-55', label: 'Canon 250D', icon: 'box', desc: 'كاميرا كانون DSLR مناسبة للمبتدئين وصناع المحتوى، عدد اللقطات 8,000 فقط.', features: ['24.1 ميجابكسل', 'فيديو 4K', 'شاشة قلابة'], variants: [{ sku: 'UW-C250D', price: egp(16500), stock: 1 }], used: { grade: 'VERY_GOOD', notes: 'عدد لقطات 8000، العدسة نظيفة بدون فطريات.', defects: 'خدش بسيط على غطاء البطارية', accessories: 'شاحن + بطارية + شنطة', usage: 'سنة واحدة' } },
];

async function createProduct(seller: Actor, admin: Actor, p: ProductSeed, catIds: Map<string, string>, brandIds: Map<string, string>, approve = true) {
  const draft = await createDraft(seller, { categoryId: catIds.get(p.cat)!, titleAr: p.title, condition: p.condition ?? 'NEW' });
  await updateDetails(seller, draft.id, {
    titleAr: p.title,
    titleEn: p.label,
    brandId: p.brand ? brandIds.get(p.brand) ?? null : null,
    categoryId: catIds.get(p.cat)!,
    description: p.desc,
    keyFeatures: p.features,
    condition: p.condition ?? 'NEW',
    usedGrade: p.used?.grade ?? null,
    conditionNotes: p.used?.notes ?? '',
    defects: p.used?.defects ?? '',
    includedAccessories: p.used?.accessories ?? '',
    usageInfo: p.used?.usage ?? '',
    warrantyInfo: p.warranty ?? '',
    attributes: { ...(p.attrs ?? {}), ...Object.fromEntries(Object.entries(p.variants[0].options ?? {}).map(([k, v]) => [k, [v]])) },
  });
  await updateLogistics(seller, draft.id, { weightGrams: 800, lengthCm: 30, widthCm: 20, heightCm: 10, processingDays: 1, returnPolicyOverride: false, acceptsVoluntaryReturns: null, voluntaryReturnDays: null, seoTitle: '', seoDescription: '' });
  if (p.condition === 'USED') {
    await addImages(seller, draft.id, [{ data: await demoImage(p.label, p.icon, 1), name: 'a.png' }, { data: await demoImage(p.label, p.icon, 2), name: 'b.png' }, { data: await demoImage(p.label, p.icon, 3), name: 'c.png' }], true);
  } else {
    await addImages(seller, draft.id, [{ data: await demoImage(p.label, p.icon, 0), name: 'main.png' }, { data: await demoImage(`${p.label} `, p.icon, 0), name: 'side.png' }], false);
  }
  await saveVariants(seller, draft.id, p.variants.map((v) => ({ sku: v.sku, options: v.options ?? {}, price: v.price, compareAtPrice: v.compareAt ?? null, stockOnHand: v.stock, lowStockThreshold: 2, isActive: true })));
  await submitForReview(seller, draft.id);
  if (approve) await moderateProduct(admin, draft.id, 'APPROVE');
  return draft.id;
}

async function onboardSeller(
  u: { id: string; email: string | null; phone: string | null; fullName: string },
  admin: Actor,
  spec: { type: 'INDIVIDUAL' | 'BUSINESS'; store: string; description: string; nationalId: string; gov: number },
  approve = true,
) {
  const a = customerActor(u.id);
  await startApplication(a, spec.type);
  await saveIdentity(a, { type: spec.type, legalName: u.fullName, nationalId: spec.nationalId, mobile: u.phone!, email: u.email!, addressLine: 'شارع التسعين، التجمع الخامس', city: 'القاهرة الجديدة', governorateId: spec.gov });
  if (spec.type === 'BUSINESS') {
    await saveBusiness(a, { businessLegalName: `${spec.store} للتجارة`, commercialRegistrationNo: 'DEMO-CR-12345', taxRegistrationNo: 'DEMO-TAX-999', businessAddress: 'شارع التسعين، التجمع الخامس', authorizedRepresentative: u.fullName });
  }
  await saveStore(a, { name: spec.store, description: spec.description, returnAddress: 'شارع التسعين، التجمع الخامس، القاهرة الجديدة', returnGovernorateId: spec.gov, supportPhone: u.phone! });
  const kinds: SellerDocumentKind[] = ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', ...(spec.type === 'BUSINESS' ? (['COMMERCIAL_REGISTRATION', 'TAX_CARD'] as const) : [])];
  for (const kind of kinds) {
    await uploadSellerDocument(a, kind, { data: await demoDocument(kind), name: `${kind}.png` });
  }
  await addPayoutMethod(a, { type: 'INSTAPAY', holderName: u.fullName, instapayAddress: `${u.email!.split('@')[0]}@instapay` });
  await submitApplication(a, true);
  if (approve) await decideSeller(admin, (await sellerActor(u.id))!.sellerId!, 'APPROVE');
  const sa = (await sellerActor(u.id))!;
  if (approve) {
    const govs = await db.select().from(governorates);
    for (const g of govs) {
      const near = ['CAI', 'GIZ', 'QLY'].includes(g.code);
      const far = ['ASN', 'LXR', 'RSE', 'NVL', 'MTR', 'NSN', 'SSN'].includes(g.code);
      await db
        .update(sellerShippingRates)
        .set({ enabled: true, fee: near ? 5000 : far ? 12000 : 7500, etaMinDays: near ? 1 : far ? 4 : 2, etaMaxDays: near ? 3 : far ? 7 : 4 })
        .where(and(eq(sellerShippingRates.sellerId, sa.sellerId!), eq(sellerShippingRates.governorateId, g.id)));
    }
    await db.update(stores).set({ freeShippingThreshold: spec.type === 'BUSINESS' ? 500000 : null, acceptsVoluntaryReturns: true, voluntaryReturnDays: 14 }).where(eq(stores.sellerId, sa.sellerId!));
  }
  return sa;
}

export async function seedDemo() {
  const [already] = await db.select().from(users).where(eq(users.email, 'admin@edmn.local'));
  if (already) return { skipped: true };

  // ── Staff
  const admin = await user('admin@edmn.local', 'مدير النظام (تجريبي)', '+201000000001', { staff: true, roles: ['SUPER_ADMIN'], password: demoCredentials().adminPassword });
  await user('ops@edmn.local', 'مدير العمليات (تجريبي)', '+201000000002', { staff: true, roles: ['OPERATIONS_MANAGER'], password: demoCredentials().adminPassword });
  await user('payments@edmn.local', 'مراجع المدفوعات (تجريبي)', '+201000000003', { staff: true, roles: ['PAYMENT_REVIEWER'], password: demoCredentials().adminPassword });
  const checker = await user('checker@edmn.local', 'المراجع المالي (تجريبي)', '+201000000004', { staff: true, roles: ['FINANCE_CHECKER'], password: demoCredentials().adminPassword });
  const operator = await user('finance@edmn.local', 'المنفذ المالي (تجريبي)', '+201000000005', { staff: true, roles: ['FINANCE_OPERATOR'], password: demoCredentials().adminPassword });
  await user('support@edmn.local', 'خدمة العملاء (تجريبي)', '+201000000006', { staff: true, roles: ['CUSTOMER_SUPPORT'], password: demoCredentials().adminPassword });
  await user('catalog@edmn.local', 'مراجع المنتجات (تجريبي)', '+201000000007', { staff: true, roles: ['CATALOG_REVIEWER', 'SELLER_REVIEWER'], password: demoCredentials().adminPassword });
  const A = await adminActor(admin.id, { stepUpAt: new Date() });

  // ── Payment destinations: clearly-marked DEMO placeholders (replace from Admin → Payments before launch)
  await db.update(paymentMethods).set({ isEnabled: true });
  await db.insert(paymentDestinations).values([
    { methodCode: 'INSTAPAY', label: 'حساب إنستاباي تجريبي (DEMO)', details: { instapayAddress: 'edmn-demo@instapay', accountName: 'EDMN DEMO — NOT REAL' }, instructionsAr: 'بيانات تجريبية للتطوير فقط. لا تحوّل أي أموال حقيقية.', sortOrder: 1 },
    { methodCode: 'VODAFONE_CASH', label: 'محفظة فودافون كاش تجريبية (DEMO)', details: { walletNumber: '010XXXXXXXX (DEMO)', accountName: 'EDMN DEMO — NOT REAL' }, instructionsAr: 'بيانات تجريبية للتطوير فقط.', sortOrder: 2 },
    { methodCode: 'BANK_TRANSFER', label: 'حساب بنكي تجريبي (DEMO)', details: { bankName: 'DEMO BANK', accountName: 'EDMN DEMO — NOT REAL', accountNumber: '0000000000', iban: 'EG000000000000000000000000000' }, instructionsAr: 'بيانات تجريبية للتطوير فقط.', sortOrder: 3 },
  ]);

  // ── Brands
  const brandIds = new Map<string, string>();
  for (const [slug, name, nameAr] of [
    ['samsung', 'Samsung', 'سامسونج'], ['apple', 'Apple', 'أبل'], ['xiaomi', 'Xiaomi', 'شاومي'], ['lenovo', 'Lenovo', 'لينوفو'], ['hp', 'HP', 'إتش بي'], ['dell', 'Dell', 'ديل'],
    ['sony', 'Sony', 'سوني'], ['canon', 'Canon', 'كانون'], ['anker', 'Anker', 'أنكر'], ['tornado', 'Tornado', 'تورنيدو'], ['fresh', 'Fresh', 'فريش'], ['adidas', 'Adidas', 'أديداس'],
    ['casio', 'Casio', 'كاسيو'], ['cottonil', 'Cottonil', 'كوتونيل'],
  ]) {
    brandIds.set(slug, await saveBrand(A, null, { name, nameAr, slug, isActive: true }));
  }
  const cats = await db.select({ id: categories.id, slug: categories.slug }).from(categories);
  const catIds = new Map(cats.map((c) => [c.slug, c.id]));

  // ── Sellers
  const sTech = await user('techzone@demo.edmn.local', 'محمود عبد الله', '+201011111111');
  const sFashion = await user('anaqa@demo.edmn.local', 'سارة إبراهيم', '+201022222222');
  const sUsed = await user('used@demo.edmn.local', 'كريم مصطفى', '+201033333333');
  const sHome = await user('homestyle@demo.edmn.local', 'هبة السيد', '+201044444444');
  const sPending = await user('newseller@demo.edmn.local', 'يوسف حسن', '+201055555555');
  const tech = await onboardSeller(sTech, A, { type: 'BUSINESS', store: 'تك زون', description: 'موبايلات ولابتوبات وإكسسوارات أصلية بضمان الوكيل.', nationalId: '28501011234567', gov: 1 });
  const fashion = await onboardSeller(sFashion, A, { type: 'INDIVIDUAL', store: 'بيت الأناقة', description: 'أزياء رجالي وحريمي بخامات مصرية.', nationalId: '29203151234561', gov: 2 });
  const usedSeller = await onboardSeller(sUsed, A, { type: 'INDIVIDUAL', store: 'مستعمل بضمير', description: 'إلكترونيات مستعملة مفحوصة بصور حقيقية وعيوب واضحة.', nationalId: '29007221234562', gov: 3 });
  const homeSeller = await onboardSeller(sHome, A, { type: 'BUSINESS', store: 'هوم ستايل', description: 'أجهزة منزلية وأدوات مطبخ وديكور.', nationalId: '28811111234563', gov: 1 });
  await onboardSeller(sPending, A, { type: 'INDIVIDUAL', store: 'ركن الكتب', description: 'كتب جديدة ومستعملة.', nationalId: '29905051234564', gov: 5 }, false);

  const productIds: Record<string, string[]> = { tech: [], fashion: [], used: [], home: [] };
  for (const p of TECH) productIds.tech.push(await createProduct(tech, A, p, catIds, brandIds));
  for (const p of FASHION) productIds.fashion.push(await createProduct(fashion, A, p, catIds, brandIds));
  for (const p of USED) productIds.used.push(await createProduct(usedSeller, A, p, catIds, brandIds));
  for (const p of HOME) productIds.home.push(await createProduct(homeSeller, A, p, catIds, brandIds));
  // One listing left in the moderation queue for the demo
  await createProduct(homeSeller, A, { cat: 'small-appliances', brand: 'tornado', title: 'مكواة بخار تورنيدو 2400 وات', label: 'Steam Iron', icon: 'appliance', desc: 'مكواة بخار بقاعدة سيراميك وخاصية التنظيف الذاتي، قدرة 2400 وات.', features: ['2400 وات', 'قاعدة سيراميك'], attrs: { power_w: ['2400'] }, variants: [{ sku: 'HS-TOR-IRON', price: egp(1350), stock: 10 }] }, catIds, brandIds, false);

  // Featured sellers on the homepage
  const storeRows = await db.select({ slug: stores.slug }).from(stores);
  const [fs] = await db.select().from(cmsBlocks).where(eq(cmsBlocks.type, 'FEATURED_SELLERS'));
  if (fs) await db.update(cmsBlocks).set({ data: { storeSlugs: storeRows.map((s) => s.slug) } }).where(eq(cmsBlocks.id, fs.id));

  // ── Customers
  const c1 = await user('ahmed@demo.edmn.local', 'أحمد علي', '+201066666666');
  const c2 = await user('mona@demo.edmn.local', 'منى خالد', '+201077777777');
  const c3 = await user('omar@demo.edmn.local', 'عمر سمير', '+201088888888');
  const addr = async (uid: string, name: string, phone: string, gov: number, city: string) =>
    (await db.insert(addresses).values({ userId: uid, label: 'المنزل', recipientName: name, phone, governorateId: gov, city, street: 'شارع 9، المعادي', building: '12', floor: '3', apartment: '7', isDefault: true }).returning())[0];
  const a1 = await addr(c1.id, c1.fullName, c1.phone!, 1, 'المعادي');
  const a2 = await addr(c2.id, c2.fullName, c2.phone!, 3, 'سموحة');
  const a3 = await addr(c3.id, c3.fullName, c3.phone!, 2, 'الدقي');

  const firstVariant = async (productId: string) =>
    (await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, productId)).orderBy(productVariants.sortOrder).limit(1))[0].id;

  async function order(customer: typeof c1, address: typeof a1, items: [string, number][], method: 'INSTAPAY' | 'VODAFONE_CASH' | 'BANK_TRANSFER') {
    const ca = customerActor(customer.id);
    for (const [pid, q] of items) await addToCart({ userId: customer.id }, await firstVariant(pid), q);
    const lines = await cartLines(db, { userId: customer.id });
    const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), address.governorateId);
    const { order } = await placeOrder(ca, { addressId: address.id, paymentMethod: method, checkoutKey: randomUUID(), expectedTotal: priced.grandTotal });
    return { order, ca };
  }
  async function pay(ca: Actor, orderId: string, amount: number) {
    const [p] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    await submitProof(ca, p.id, { claimedAmount: String(amount / 100), reference: `TX${Math.floor(Math.random() * 1e8)}`, clientKey: randomUUID() }, { data: await demoDocument('Payment receipt'), name: 'receipt.png' });
    return p.id;
  }
  async function confirm(paymentId: string) {
    const [sub] = await db.select().from(paymentSubmissions).where(eq(paymentSubmissions.paymentId, paymentId));
    await startReview(A, paymentId);
    await confirmPayment(A, paymentId, sub.id);
  }
  const sellerFor = async (soId: string) => {
    const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, soId));
    return [tech, fashion, usedSeller, homeSeller].find((s) => s.sellerId === so.sellerId)!;
  };
  async function ship(soId: string, carrier = 'بوسطة') {
    const s = await sellerFor(soId);
    await confirmSellerOrder(s, soId);
    await saveShipment(s, soId, { carrierName: carrier, trackingNumber: `BST${Math.floor(Math.random() * 1e9)}`, shippedAt: new Date(), expectedDeliveryAt: new Date(Date.now() + 3 * 86400_000) }, { data: await demoDocument('Waybill'), name: 'waybill.png' });
    await markShipped(s, soId);
  }
  const sos = async (orderId: string) => db.select().from(sellerOrders).where(eq(sellerOrders.orderId, orderId)).orderBy(sellerOrders.suffix);

  // Order 1 — delivered & confirmed (funds available), reviewed
  const o1 = await order(c1, a1, [[productIds.tech[0], 1], [productIds.tech[5], 2]], 'INSTAPAY');
  await confirm(await pay(o1.ca, o1.order.id, o1.order.grandTotal));
  for (const so of await sos(o1.order.id)) {
    await ship(so.id);
    await confirmReceipt(o1.ca, so.id);
    const items = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
    await createProductReview(o1.ca, { orderItemId: items[0].id, rating: 5, title: 'منتج ممتاز', body: 'وصل بسرعة والمنتج أصلي ومطابق للوصف. أنصح بالتعامل مع المتجر.' });
    await createSellerReview(o1.ca, { sellerOrderId: so.id, rating: 5, deliveryRating: 5, packagingRating: 4, accuracyRating: 5, body: 'تعامل محترم وتغليف ممتاز.' });
  }
  // Order 2 — multi-seller, paid; one sub-order shipped, the other confirmed
  const o2 = await order(c2, a2, [[productIds.fashion[0], 2], [productIds.home[1], 1], [productIds.used[0], 1]], 'VODAFONE_CASH');
  await confirm(await pay(o2.ca, o2.order.id, o2.order.grandTotal));
  const o2s = await sos(o2.order.id);
  await ship(o2s[0].id, 'أرامكس');
  await confirmSellerOrder(await sellerFor(o2s[1].id), o2s[1].id);
  // Order 3 — payment proof submitted, waiting for verification
  const o3 = await order(c3, a3, [[productIds.tech[3], 1]], 'BANK_TRANSFER');
  await pay(o3.ca, o3.order.id, o3.order.grandTotal);
  // Order 4 — awaiting payment
  await order(c1, a1, [[productIds.home[0], 1]], 'INSTAPAY');
  // Order 5 — delivered to Omar from used seller + fashion, gives the used seller balance
  const o5 = await order(c3, a3, [[productIds.used[2], 1], [productIds.fashion[2], 1]], 'INSTAPAY');
  await confirm(await pay(o5.ca, o5.order.id, o5.order.grandTotal));
  for (const so of await sos(o5.order.id)) {
    await ship(so.id, 'J&T Express');
    await confirmReceipt(o5.ca, so.id);
  }

  // ── Post-purchase examples for the operations queues
  // Omar asks to return the fashion item from order 5 (change of mind, within the return window).
  const o5s = await sos(o5.order.id);
  const fashionSo = o5s.find((x) => x.sellerId === fashion.sellerId)!;
  const [fashionItem] = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, fashionSo.id));
  await requestReturn(o5.ca, { sellerOrderId: fashionSo.id, reason: 'CHANGED_MIND', description: 'المقاس أكبر من المتوقع وأرغب في إرجاع المنتج كما هو بحالته الأصلية.', items: [{ orderItemId: fashionItem.id, quantity: 1 }] });
  // Mona opens a dispute on the shipped (not yet received) part of order 2 → seller funds stay held.
  await openDispute(o2.ca, { sellerOrderId: o2s[0].id, reasonCode: 'ITEM_NOT_RECEIVED', description: 'رقم التتبع لا يظهر أي تحديث منذ أيام والبائع لا يرد على الرسائل.' });
  // A support ticket from Ahmed about his unpaid order.
  await openTicket(o1.ca, { type: 'PAYMENT', subject: 'استفسار عن طريقة الدفع بإنستاباي', body: 'هل يمكنني الدفع من حساب إنستاباي باسم زوجتي؟ وما المدة المتاحة للدفع؟', relatedType: 'order', relatedId: '' });

  // ── Withdrawals: one paid (maker/checker), one pending
  const checkerActor = await adminActor(checker.id, { stepUpAt: new Date() });
  const operatorActor = await adminActor(operator.id, { stepUpAt: new Date() });
  const w1 = await requestWithdrawal(tech, { amount: '1000', clientKey: randomUUID() });
  await approveWithdrawal(checkerActor, w1.withdrawal.id);
  await markWithdrawalProcessing(operatorActor, w1.withdrawal.id);
  await markWithdrawalPaid(operatorActor, w1.withdrawal.id, 'IPN-DEMO-778812');
  await requestWithdrawal(usedSeller, { amount: '5000', clientKey: randomUUID() });

  // ── External protected deals
  const buyer = customerActor(c2.id);
  const d1 = await createDeal(buyer, { title: 'موبايل سامسونج S23 مستعمل', description: 'لقيته على جروب فيسبوك، البائع في الإسكندرية، الجهاز بالعلبة.', condition: 'USED', quantity: 1, productCategory: 'موبايلات' });
  await saveDealStep(buyer, d1.id, 2, { sellerName: 'محمد صلاح', sellerPhone: '01099999999', sellerEmail: '' });
  await saveDealStep(buyer, d1.id, 3, { unitPrice: '21000' });
  await saveDealStep(buyer, d1.id, 4, { deliveryMethod: 'تسليم يد بيد في سموحة', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, d1.id, 5, { customTerms: 'الجهاز يكون بالعلبة والفاتورة، والبطارية فوق 85%.' });
  await inviteSeller(buyer, d1.id, true);
  // second deal accepted by an existing user (Omar acts as the external seller) and awaiting payment
  const d2 = await createDeal(customerActor(c1.id), { title: 'لابتوب ماك بوك إير M1', description: 'ماك بوك إير M1 رامات 8 تخزين 256 بحالة ممتازة.', condition: 'USED', quantity: 1, productCategory: 'لابتوب' });
  await saveDealStep(customerActor(c1.id), d2.id, 2, { sellerName: c3.fullName, sellerPhone: '01088888888', sellerEmail: '' });
  await saveDealStep(customerActor(c1.id), d2.id, 3, { unitPrice: '32000' });
  await saveDealStep(customerActor(c1.id), d2.id, 4, { deliveryMethod: 'شحن عبر بوسطة', deliveryDeadline: new Date(Date.now() + 7 * 86400_000), inspectionDays: 3 });
  const inv = await inviteSeller(customerActor(c1.id), d2.id, true);
  const token = inv.link.split('/').pop()!;
  await acceptInvitation(customerActor(c3.id), token, { type: 'MOBILE_WALLET', holderName: c3.fullName, walletProvider: 'فودافون كاش', walletNumber: '01088888888' }, true);
  await startDealPayment(customerActor(c1.id), d2.id, 'INSTAPAY');

  const brandCount = brandIds.size;
  void brands;
  return { skipped: false, staff: 7, sellers: 5, brands: brandCount };
}
