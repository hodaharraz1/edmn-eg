export interface BlogPost {
  slug: string;
  titleAr: string;
  titleEn: string;
  excerptAr: string;
  excerptEn: string;
  contentAr: string;
  contentEn: string;
  category: string;
  tags: string[];
  readTimeAr: number;
  readTimeEn: number;
  publishedAt: string;
  featured: boolean;
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'what-is-escrow',
    titleAr: 'ما هي خدمة الوساطة المالية (Escrow) وكيف تحميك؟',
    titleEn: 'What is Escrow and How Does It Protect You?',
    excerptAr: 'تعرف على مفهوم الوساطة المالية وكيف يحمي إضمن أموالك في المعاملات الإلكترونية',
    excerptEn: 'Learn about the concept of escrow and how EDMN protects your money in online transactions',
    contentAr: `
# ما هي خدمة الوساطة المالية؟

الوساطة المالية أو "Escrow" هي خدمة يقوم فيها طرف ثالث موثوق بالاحتفاظ بالأموال بين طرفين (بائع ومشتري) حتى يتم استيفاء شروط الصفقة المتفق عليها.

## كيف تعمل؟

1. **يتفق البائع والمشتري** على شروط الصفقة
2. **يودع المشتري** المبلغ في حساب الوساطة
3. **يرسل البائع** المنتج أو الخدمة
4. **يؤكد المشتري** الاستلام
5. **يحصل البائع** على ماله

## لماذا تحتاج إضمن؟

- حماية كاملة من الاحتيال
- ضمان استرداد الأموال عند الحاجة
- وسيط محايد وموثوق
- دعم فني متواصل
    `,
    contentEn: `
# What is Escrow?

Escrow is a service where a trusted third party holds funds between two parties (buyer and seller) until the agreed conditions of the deal are met.

## How Does It Work?

1. **Buyer and seller agree** on deal terms
2. **Buyer deposits** the amount in the escrow account
3. **Seller sends** the product or service
4. **Buyer confirms** receipt
5. **Seller receives** payment

## Why Use EDMN?

- Complete fraud protection
- Easy refunds when needed
- Neutral and trusted intermediary
- 24/7 technical support
    `,
    category: 'education',
    tags: ['escrow', 'وساطة مالية', 'حماية المشتري'],
    readTimeAr: 4,
    readTimeEn: 3,
    publishedAt: '2025-01-15',
    featured: true,
  },
  {
    slug: 'how-escrow-protects-buyers',
    titleAr: 'كيف يحمي إضمن أموالك كمشترٍ؟',
    titleEn: 'How EDMN Protects Your Money as a Buyer',
    excerptAr: 'دليل شامل لحماية أموالك عند الشراء أونلاين مع إضمن',
    excerptEn: 'A comprehensive guide to protecting your money when buying online with EDMN',
    contentAr: `
# حماية المشتري مع إضمن

عند الشراء عبر الإنترنت، المخاطر كثيرة. إضمن يضمن لك تجربة آمنة ومحمية بالكامل.

## الحماية التي تحصل عليها

### 1. حساب ضمان آمن
أموالك محفوظة في حساب ضمان مشفر لا يمكن الوصول إليه إلا بعد تأكيدك.

### 2. مراجعة النزاعات
في حالة أي خلاف، يتدخل فريق إضمن لحل النزاع بشكل عادل.

### 3. استرداد مضمون
إذا لم تستلم ما اشتريته، تسترد أموالك بالكامل.
    `,
    contentEn: `
# Buyer Protection with EDMN

When shopping online, risks are numerous. EDMN ensures you have a fully safe and protected experience.

## Protection You Get

### 1. Secure Escrow Account
Your money is held in an encrypted escrow account accessible only after your confirmation.

### 2. Dispute Review
In case of any conflict, EDMN's team intervenes to resolve it fairly.

### 3. Guaranteed Refund
If you don't receive what you bought, you get a full refund.
    `,
    category: 'buyer-guide',
    tags: ['حماية المشتري', 'buyer protection', 'استرداد'],
    readTimeAr: 5,
    readTimeEn: 4,
    publishedAt: '2025-02-01',
    featured: true,
  },
  {
    slug: 'safe-payment-methods-egypt',
    titleAr: 'أفضل طرق الدفع الآمن في مصر 2025',
    titleEn: 'Best Safe Payment Methods in Egypt 2025',
    excerptAr: 'مقارنة شاملة لأفضل طرق الدفع الإلكتروني الآمن في مصر',
    excerptEn: 'A comprehensive comparison of the best secure electronic payment methods in Egypt',
    contentAr: `
# أفضل طرق الدفع الآمن في مصر

مع تزايد التجارة الإلكترونية في مصر، أصبح اختيار طريقة الدفع المناسبة أمراً بالغ الأهمية.

## الخيارات المتاحة

### 1. إضمن (الأفضل)
- وسيط موثوق بين البائع والمشتري
- حماية كاملة للأموال
- دعم فني 24/7

### 2. الدفع عند الاستلام
- آمن للمشتري
- خطر على البائع
- محدود في التجارة الرقمية

### 3. التحويل البنكي
- سريع
- لا حماية للمشتري
- خطر مرتفع

## لماذا إضمن هو الأفضل؟

إضمن يجمع بين سرعة التحويل البنكي وأمان الدفع عند الاستلام، مع إضافة طبقة إضافية من الحماية.
    `,
    contentEn: `
# Best Safe Payment Methods in Egypt

With e-commerce growing rapidly in Egypt, choosing the right payment method has become crucial.

## Available Options

### 1. EDMN (Best Choice)
- Trusted intermediary between buyer and seller
- Full fund protection
- 24/7 technical support

### 2. Cash on Delivery
- Safe for buyer
- Risky for seller
- Limited for digital commerce

### 3. Bank Transfer
- Fast
- No buyer protection
- High risk

## Why EDMN is the Best?

EDMN combines the speed of bank transfers with the safety of cash on delivery, with an added layer of protection.
    `,
    category: 'payments',
    tags: ['دفع إلكتروني', 'payment methods', 'مصر'],
    readTimeAr: 6,
    readTimeEn: 5,
    publishedAt: '2025-03-10',
    featured: false,
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getAllSlugs(): string[] {
  return blogPosts.map((p) => p.slug);
}
