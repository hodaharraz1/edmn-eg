/**
 * Homepage marketing artwork. The approved seller banner (owner-supplied, final 2026-10-17) is used exactly as delivered;
 * its painted «افتح متجرك الآن» button gets a real link positioned over it (`cta`, in % of the artwork).
 * `ready` flips to true once the delivered file and its generated responsive sizes are in public/brand/home/.
 */
export const SELLER_BANNER = {
  ready: true,
  width: 2000,
  height: 667,
  alt: 'تاجر مصري يستخدم اضمن لإدارة وبيع منتجاته بأمان',
  // Position of the painted CTA inside the artwork (measured from its pixels on the approved 2000×667 master).
  cta: { left: 66.3, top: 74.1, width: 24.4, height: 16.3 },
  desktop: [
    { src: '/brand/home/seller-banner-1280.webp', w: 1280 },
    { src: '/brand/home/seller-banner-2000.webp', w: 2000 },
  ],
  // Mobile: the merchant side of the same artwork (text is rendered as HTML underneath).
  mobile: [
    { src: '/brand/home/seller-banner-mobile-600.webp', w: 600 },
    { src: '/brand/home/seller-banner-mobile-900.webp', w: 900 },
  ],
  // Mobile crop: x 100–989 of the 2000×667 master (centred on the merchant).
  mobileWidth: 900,
  mobileHeight: 675,
};
