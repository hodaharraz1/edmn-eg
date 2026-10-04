import type { MetadataRoute } from 'next';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/checkout', '/cart', '/seller', '/admin', '/api', '/deal-invite', '/search?'] }],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
