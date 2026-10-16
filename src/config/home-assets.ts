/**
 * Homepage marketing artwork. The approved seller banner (owner-supplied, 2026-10-16) is used exactly as delivered;
 * its painted «افتح متجرك الآن» button gets a real link positioned over it (`cta`, in % of the artwork).
 * `ready` flips to true once the delivered file and its generated responsive sizes are in public/brand/home/.
 */
export const SELLER_BANNER = {
  ready: false,
  width: 2000,
  height: 667,
  alt: 'تاجر مصري يستخدم اضمن لإدارة وبيع منتجاته بأمان',
  // Position of the painted CTA inside the artwork (measured on the approved 2000×667 image).
  cta: { left: 66.2, top: 73.9, width: 23.3, height: 16.7 },
  desktop: [
    { src: '/brand/home/seller-banner-1280.webp', w: 1280 },
    { src: '/brand/home/seller-banner-2000.webp', w: 2000 },
  ],
  // Mobile: the merchant side of the same artwork (text is rendered as HTML underneath).
  mobile: [
    { src: '/brand/home/seller-banner-mobile-600.webp', w: 600 },
    { src: '/brand/home/seller-banner-mobile-900.webp', w: 900 },
  ],
  mobileWidth: 900,
  mobileHeight: 675,
};
