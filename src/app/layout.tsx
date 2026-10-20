import type { Metadata, Viewport } from 'next';
import { after, connection } from 'next/server';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource/ibm-plex-sans-arabic/latin-400.css';
import '@fontsource/ibm-plex-sans-arabic/latin-600.css';
import './globals.css';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
/** Staging deployments are public but must never be indexed and must be visibly marked as test environments. */
const IS_STAGING = process.env.EDMN_ENVIRONMENT === 'staging';

/** Every page reads the database or the session at request time; never prerender at build time. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: 'اضمن | EDMN — سوق موثوق للمنتجات الجديدة والمستعملة', template: '%s | اضمن EDMN' },
  description: 'تسوّق منتجات جديدة ومستعملة من بائعين موثّقين في مصر، مع دفع محمي حتى تأكيد الاستلام، وصفقات محمية لمشترياتك من خارج السوق.',
  applicationName: 'EDMN',
  openGraph: { type: 'website', locale: 'ar_EG', siteName: 'اضمن EDMN', images: [{ url: '/brand/edmn-logo.png', width: 752, height: 720, alt: 'اضمن EDMN' }] },
  robots: IS_STAGING ? { index: false, follow: false } : { index: true, follow: true },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Edge-to-edge on notched phones; containers and fixed bars pad themselves with env(safe-area-inset-*).
  viewportFit: 'cover',
  themeColor: '#0f3f8c',
};

/** Every page renders per request: the per-request nonce CSP (src/proxy.ts) can only stamp dynamically rendered HTML. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  // Serverless hosts have no long-running worker: process due jobs shortly after page renders.
  if (process.env.INLINE_WORKER === 'true') after(async () => (await import('@/server/jobs/tick')).maybeRunInlineTick());
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow">
          تخطَّ إلى المحتوى
        </a>
        {children}
      </body>
    </html>
  );
}
