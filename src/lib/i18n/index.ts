/**
 * Minimal i18n layer. Arabic is the primary locale (RTL); English dictionary is prepared for the
 * shared chrome (navigation, common actions). Page-specific copy is Arabic in V1 — see
 * docs/ARCHITECTURE.md → Localization for the extraction plan.
 */
export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ar';

export const dir = (l: Locale) => (l === 'ar' ? 'rtl' : 'ltr');

const ar = {
  'nav.categories': 'التصنيفات',
  'nav.deals': 'العروض',
  'nav.bestSellers': 'الأكثر مبيعاً',
  'nav.stores': 'المتاجر',
  'nav.protectedDeal': 'اضمن صفقة خارج السوق',
  'nav.sell': 'بيع على اضمن',
  'nav.home': 'الرئيسية',
  'nav.edmn': 'اضمن',
  'nav.orders': 'طلباتي',
  'nav.account': 'حسابي',
  'nav.cart': 'السلة',
  'search.placeholder': 'ابحث عن منتج، علامة تجارية أو متجر…',
  'action.addToCart': 'ضيف للسلة',
  'action.buyNow': 'اشتري دلوقتي',
  'action.checkout': 'إتمام الشراء',
  'action.login': 'تسجيل الدخول',
  'action.register': 'إنشاء حساب',
  'action.logout': 'تسجيل الخروج',
  'deliverTo': 'التوصيل إلى',
} as const;
type Key = keyof typeof ar;
const en: Partial<Record<Key, string>> = {
  'nav.categories': 'Categories',
  'nav.deals': 'Deals',
  'nav.bestSellers': 'Best Sellers',
  'nav.stores': 'Stores',
  'nav.protectedDeal': 'Protected external deal',
  'nav.sell': 'Sell on EDMN',
  'nav.home': 'Home',
  'nav.edmn': 'EDMN',
  'nav.orders': 'Orders',
  'nav.account': 'Account',
  'nav.cart': 'Cart',
  'search.placeholder': 'Search products, brands or stores…',
  'action.addToCart': 'Add to cart',
  'action.buyNow': 'Buy now',
  'action.checkout': 'Checkout',
  'action.login': 'Sign in',
  'action.register': 'Create account',
  'action.logout': 'Sign out',
  deliverTo: 'Deliver to',
};

export function t(key: Key, locale: Locale = DEFAULT_LOCALE): string {
  return (locale === 'en' ? en[key] : undefined) ?? ar[key];
}
