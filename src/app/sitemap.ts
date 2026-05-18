import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/utils';
import { getAllSlugs } from '@/data/blog-posts';

const locales = ['ar', 'en'];

function localizedUrl(path: string, locale: string) {
  if (locale === 'ar') return `${SITE_URL}${path}`;
  return `${SITE_URL}/en${path}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' as const },
    { path: '/about', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/how-it-works', priority: 0.9, changeFrequency: 'monthly' as const },
    { path: '/why-us', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/faq', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/contact', priority: 0.7, changeFrequency: 'yearly' as const },
    { path: '/blog', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/privacy-policy', priority: 0.4, changeFrequency: 'yearly' as const },
    { path: '/terms', priority: 0.4, changeFrequency: 'yearly' as const },
    { path: '/refund-policy', priority: 0.4, changeFrequency: 'yearly' as const },
  ];

  const blogSlugs = getAllSlugs();

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const { path, priority, changeFrequency } of staticPages) {
      entries.push({
        url: localizedUrl(path, locale),
        lastModified: new Date(),
        changeFrequency,
        priority,
      });
    }

    for (const slug of blogSlugs) {
      entries.push({
        url: localizedUrl(`/blog/${slug}`, locale),
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }
  }

  return entries;
}
