import type { MetadataRoute } from 'next';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  if (process.env.EDMN_ENVIRONMENT === 'staging') return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/checkout', '/cart', '/seller', '/admin', '/api', '/deal-invite', '/deal/', '/search?'] }],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
