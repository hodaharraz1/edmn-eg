import type { Metadata, Viewport } from 'next';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource/ibm-plex-sans-arabic/latin-400.css';
import '@fontsource/ibm-plex-sans-arabic/latin-600.css';
import './globals.css';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: 'اضمن | EDMN — سوق موثوق للمنتجات الجديدة والمستعملة', template: '%s | اضمن EDMN' },
  description: 'تسوّق منتجات جديدة ومستعملة من بائعين موثّقين في مصر، مع دفع محمي حتى تأكيد الاستلام، وصفقات محمية لمشترياتك من خارج السوق.',
  applicationName: 'EDMN',
  openGraph: { type: 'website', locale: 'ar_EG', siteName: 'اضمن EDMN' },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f3f8c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
