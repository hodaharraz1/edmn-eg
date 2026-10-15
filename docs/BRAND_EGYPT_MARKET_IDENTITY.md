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

## 6. Audit status (2026-10-15)
- No human imagery anywhere in the product. Product placeholders are generated abstract icons (`src/server/db/seed/demo-images.ts`).
- All prices use `formatEGP` (EGP, `ج.م`).
- Governorates come from the database (27 Egyptian governorates).
- No Gulf currencies, places or expressions were found in the source.
