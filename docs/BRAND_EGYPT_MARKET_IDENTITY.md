# EDMN — Egyptian market identity (NON-NEGOTIABLE)

EDMN (اضمن إي جي) is an **Egyptian** marketplace for users in Egypt. Positioning: a modern Egyptian technology and fintech-commerce company. Global product quality, Egyptian market identity.

It must **never** look like a Saudi, Gulf, UAE or GCC marketplace. An Arabic interface is never a reason to use Gulf imagery.

This document binds every design, copy, imagery, seed-data and redesign change.

## 1. People and photography
- **Default: no human imagery.** Prefer, in this order:
  1. product UI
  2. typography
  3. icons
  4. illustration
  5. abstract security/trust visuals
  6. marketplace and product imagery
  7. EDMN branding

  Use these before any stock photography.
- **Major homepage banner with a person:** first build the section so it works without the person. The photo is an optional enhancement, approved separately.
- **When people are justified:**
  - Show modern Egyptian buyers, sellers, families, entrepreneurs and small-business owners.
  - Use contemporary Egyptian everyday or business clothing: shirts, polos, casual business wear, suits.
  - Show women naturally and respectfully, as appropriate to Egyptian society.
  - Use authentic Egyptian contexts: homes and modern apartments, local shops, electronics stores, clothing sellers, small businesses, online sellers, warehouses, delivery, Egyptian streets where relevant.
- **Never** (by default, and never "because it is Arabic"):
  - Saudi thobe, ghutra, shemagh, Gulf kandura, Emirati national dress
  - Gulf-specific architecture, Riyadh/Dubai skylines
  - desert-luxury clichés, GCC marketplace stereotypes
- **No symbol overuse:** EDMN feels Egyptian through product, language, commerce model, people and context, not through pyramids or flags on every screen.

## 2. Localization
- **Currency:** EGP (جنيه مصري) only.
  - Display through `formatEGP()` (`src/lib/format.ts`), e.g. `12,999 ج.م`. Never format prices by hand.
  - **No SAR, AED or USD** as a marketplace currency.
- **Locations:** always use the database governorates and cities, never hard-coded lists. When a static example is unavoidable, use Egyptian places: القاهرة، الجيزة، الإسكندرية، دمياط، دمياط الجديدة، المنصورة، بورسعيد، طنطا، الإسماعيلية، السويس، الشرقية، الدقهلية.
- **Shipping UX** follows EDMN's existing Egypt governorate shipping model.

## 3. Language
- Professional, clear Modern Arabic that feels natural to Egyptian consumers.
- No unnecessarily Gulf-specific expressions.
- No heavy Egyptian slang in product UI.
- Reference vocabulary: اشتري بأمان · بيع على اضمن · أضف إلى السلة · حالة المنتج · جديد · مستعمل · تكلفة الشحن · موعد التوصيل · تأكيد الاستلام · المبلغ محمي · فتح نزاع · طلب استرجاع · عرض البائع · تأكيد الصفقة.
- Copy rules already in force: `docs/ARABIC_COPY_AUDIT.md`.

## 4. Guardrails in the repository
`tests/unit/egypt-market-identity.test.ts` fails the build if:
- any non-EGP currency code or name appears in the application source;
- any Gulf city or country name appears in the application source;
- `formatEGP` stops producing `ج.م`;
- a raster image is added under `public/` without being listed in §5.

## 5. Approved raster assets in `public/`
Any new photo or illustration must be added here with a one-line justification confirming §1.

| Path | Content | Justification |
|---|---|---|
| `public/brand/edmn-logo.png` | EDMN logo | Brand mark; no people |
| `public/brand/home/egyptian-seller-700.webp` | Mobile size of the image below | Same image, responsive size |
| `public/brand/home/egyptian-seller.webp` | Homepage seller banner: a modern Egyptian merchant (about 30s, light-blue smart-casual shirt) working on a laptop in a small online-shop stockroom with parcels | Owner-approved person image (2026-10-16, §1 "approved separately"). Contemporary Egyptian business-casual clothing, no national costume, no Gulf architecture or skyline. AI-generated for EDMN (no stock licence); the banner also works without it |
| `public/brand/home/seller-banner-source.png` | Owner-approved FINAL homepage seller banner (2000×667): Egyptian merchant in a grey t-shirt carrying an EDMN parcel beside a delivery van and a stockroom; painted headline «ابدأ البيع على اضمن» and CTA «افتح متجرك الآن» | Owner-supplied 2026-10-17 as the final approved artwork; stored losslessly, never regenerated or edited. Egyptian everyday clothing, no national costume, no Gulf architecture or skyline |
| `public/brand/home/seller-banner-2000.webp` | Desktop size of the approved seller banner | Same artwork, resized only |
| `public/brand/home/seller-banner-1280.webp` | Desktop/tablet size of the approved seller banner | Same artwork, resized only |
| `public/brand/home/seller-banner-mobile-900.webp` | Mobile crop of the approved seller banner (merchant side; the text is real HTML underneath) | Same artwork, cropped and resized only |
| `public/brand/home/seller-banner-mobile-600.webp` | Smaller mobile crop of the approved seller banner | Same artwork, cropped and resized only |
| `public/brand/home/hero-source.webp` | Owner-approved homepage hero campaign artwork (2000×750, 2026-10-17): EDMN storefront on a smartphone, headphones, iPhone, controller, camera, smartwatch, sneaker, laptop and an EDMN-branded parcel on a desk; painted «دفع آمن» badge and protection card | Owner-supplied original, stored unmodified and never served directly. No people, no Gulf imagery; prices in ج.م |
| `public/brand/home/hero-visual-650.avif` | Hero visual (desktop/tablet crop x0–1300 of the master: product side only, painted headline/buttons removed) | Same artwork, cropped and resized only |
| `public/brand/home/hero-visual-650.webp` | Same, WebP fallback | Same artwork, cropped and resized only |
| `public/brand/home/hero-visual-975.avif` | Same, 975px | Same artwork, cropped and resized only |
| `public/brand/home/hero-visual-975.webp` | Same, WebP fallback | Same artwork, cropped and resized only |
| `public/brand/home/hero-visual-1300.avif` | Same, 1300px (high-DPI) | Same artwork, cropped and resized only |
| `public/brand/home/hero-visual-1300.webp` | Same, WebP fallback | Same artwork, cropped and resized only |
| `public/brand/home/hero-visual-m-420.avif` | Hero visual, phone crop (phone, EDMN parcel, controller, headphones) | Same artwork, cropped and resized only |
| `public/brand/home/hero-visual-m-420.webp` | Same, WebP fallback | Same artwork, cropped and resized only |
| `public/brand/home/hero-visual-m-785.avif` | Same, 785px (high-DPI phones) | Same artwork, cropped and resized only |
| `public/brand/home/hero-visual-m-785.webp` | Same, WebP fallback | Same artwork, cropped and resized only |

## 6. Audit status (2026-10-15)
- No human imagery anywhere in the product, except the owner-approved Egyptian seller in the homepage seller banner (2026-10-16, listed in §5). Product placeholders are generated abstract icons (`src/server/db/seed/demo-images.ts`).
- All prices use `formatEGP` (EGP, `ج.م`).
- Governorates come from the database (27 Egyptian governorates).
- No Gulf currencies, places or expressions were found in the source.
