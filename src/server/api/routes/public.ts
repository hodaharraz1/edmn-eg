import { z } from 'zod';
import { SORTS } from '@/server/modules/catalog/search';
import { publicCategoryTree, publicGovernorates, publicProductDetail, publicProductReviews, publicProductSearch, publicStoreView } from '@/server/modules/catalog/public-read';
import { publicAppConfig, publicLegalDocument } from '@/server/modules/mobile/app-config';
import { ApiError } from '../errors';
import { defineRoute } from '../http';
import { category, page, productCard, productDetail, review, slug, storeView } from '../schemas';

/** Public, READ-ONLY Customer App endpoints (no authentication; per-installation rate limits). */

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const appConfig = defineRoute({
  id: 'getAppConfig',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/app/config',
  summary: 'App bootstrap: minimum supported versions, locales, feature availability',
  tags: ['App'],
  auth: 'none',
  rate: 'read',
  cacheSeconds: 60,
  response: z
    .object({
      minSupportedVersion: z.object({ customer: z.string(), admin: z.string() }),
      defaultLocale: z.literal('ar'),
      locales: z.array(z.enum(['ar', 'en'])),
      currency: z.literal('EGP'),
      realMoneyEnabled: z.boolean().meta({ description: 'Read-only indicator. While false every payment is a labelled TEST.' }),
      maintenanceMode: z.boolean(),
      deliveryOtp: z.object({ inApp: z.boolean(), sms: z.boolean() }),
    })
    .meta({ id: 'AppConfig' }),
  handler: () => publicAppConfig(),
});

export const categories = defineRoute({
  id: 'listCategories',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/catalog/categories',
  summary: 'Active category tree (prohibited categories excluded)',
  tags: ['Catalog'],
  auth: 'none',
  rate: 'read',
  cacheSeconds: 300,
  response: z.object({ items: z.array(category) }),
  handler: async () => ({ items: await publicCategoryTree() }),
});

export const governorates = defineRoute({
  id: 'listGovernorates',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/governorates',
  summary: 'Egyptian governorates (for addresses and delivery filters)',
  tags: ['Catalog'],
  auth: 'none',
  rate: 'read',
  cacheSeconds: 3600,
  response: z.object({ items: z.array(z.object({ id: z.number().int(), code: z.string(), nameAr: z.string(), nameEn: z.string() })) }),
  handler: async () => ({ items: await publicGovernorates() }),
});

export const searchProducts = defineRoute({
  id: 'searchProducts',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/catalog/products',
  summary: 'Search and browse live products',
  tags: ['Catalog'],
  auth: 'none',
  rate: 'read',
  cacheSeconds: 30,
  query: z.object({
    q: z.string().trim().max(120).optional(),
    categoryId: z.uuid().optional(),
    brandIds: z
      .string()
      .max(400)
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
      .pipe(z.array(z.uuid()).max(10).optional())
      .meta({ description: 'Comma-separated brand ids' }),
    condition: z.enum(['NEW', 'USED']).optional(),
    minPrice: int(0, 1_000_000_000).optional().meta({ description: 'piastres' }),
    maxPrice: int(0, 1_000_000_000).optional().meta({ description: 'piastres' }),
    minRating: int(1, 5).optional(),
    inStock: bool.optional(),
    verifiedOnly: bool.optional(),
    dealsOnly: bool.optional(),
    governorateId: int(1, 1000).optional(),
    sort: z.enum(SORTS).optional(),
    page: int(1, 500).optional(),
    pageSize: int(1, 48).optional(),
  }),
  response: page(productCard),
  handler: ({ query }) => publicProductSearch({ ...query, pageSize: query.pageSize ?? 24 }),
});

export const productBySlug = defineRoute({
  id: 'getProduct',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/catalog/products/{slug}',
  summary: 'Product detail (publicly visible products only)',
  tags: ['Catalog'],
  auth: 'none',
  rate: 'read',
  cacheSeconds: 30,
  errors: ['not_found'],
  params: z.object({ slug }),
  response: productDetail,
  handler: async ({ params }) => {
    const p = await publicProductDetail(decodeURIComponent(params.slug));
    if (!p) throw new ApiError('not_found');
    return p;
  },
});

export const productReviews = defineRoute({
  id: 'listProductReviews',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/catalog/products/{slug}/reviews',
  summary: 'Published reviews of a product',
  tags: ['Catalog'],
  auth: 'none',
  rate: 'read',
  cacheSeconds: 60,
  errors: ['not_found'],
  params: z.object({ slug }),
  query: z.object({ limit: int(1, 50).optional() }),
  response: z.object({ items: z.array(review) }),
  handler: async ({ params, query }) => {
    const items = await publicProductReviews({ slug: decodeURIComponent(params.slug) }, query.limit ?? 20);
    if (!items) throw new ApiError('not_found');
    return { items };
  },
});

export const storeBySlug = defineRoute({
  id: 'getStore',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/stores/{slug}',
  summary: 'Public store profile',
  tags: ['Catalog'],
  auth: 'none',
  rate: 'read',
  cacheSeconds: 60,
  errors: ['not_found'],
  params: z.object({ slug }),
  response: storeView,
  handler: async ({ params }) => {
    const s = await publicStoreView(decodeURIComponent(params.slug));
    if (!s) throw new ApiError('not_found');
    return s;
  },
});

export const legalDocument = defineRoute({
  id: 'getLegalDocument',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/content/legal/{slug}',
  summary: 'Current version of a legal document (terms, privacy, returns…)',
  tags: ['Content'],
  auth: 'none',
  rate: 'read',
  cacheSeconds: 300,
  errors: ['not_found'],
  params: z.object({ slug: z.string().regex(/^[a-z-]{2,40}$/) }),
  response: z
    .object({
      code: z.string(),
      slug: z.string(),
      title: z.string(),
      version: z.string(),
      body: z.string(),
      approved: z.boolean().meta({ description: 'false = draft wording pending legal approval (show the draft notice).' }),
      updatedAt: z.string().meta({ format: 'date-time' }),
    })
    .meta({ id: 'LegalDocument' }),
  handler: async ({ params }) => {
    const d = await publicLegalDocument(params.slug);
    if (!d) throw new ApiError('not_found');
    return d;
  },
});

export const publicRoutes = [appConfig, categories, governorates, searchProducts, productBySlug, productReviews, storeBySlug, legalDocument];
