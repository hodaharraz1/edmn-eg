import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/utils';
import '../globals.css';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import MobileCTA from '@/components/layout/MobileCTA';
import ScrollTop from '@/components/layout/ScrollTop';
import Analytics from '@/components/analytics/Analytics';
import CookieConsent from '@/components/analytics/CookieConsent';

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo' });

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t('homeTitle'),
      template: `%s | إضمن EDMN`,
    },
    description: t('homeDesc'),
    keywords: [
      'إضمن', 'EDMN', 'تطبيق وسيط مالي', 'حماية المشتري',
      'حماية البائع', 'escrow Egypt', 'secure payment Egypt',
      'وساطة مالية مصر', 'شراء آمن', 'دفع إلكتروني آمن',
    ],
    authors: [{ name: 'EDMN EG', url: SITE_URL }],
    creator: 'EDMN EG',
    publisher: 'EDMN EG LLC',
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    openGraph: {
      type: 'website',
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      alternateLocale: locale === 'ar' ? 'en_US' : 'ar_EG',
      siteName: 'إضمن EDMN',
      title: t('homeTitle'),
      description: t('homeDesc'),
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: 'إضمن EDMN — منصة الوساطة المالية الآمنة',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('homeTitle'),
      description: t('homeDesc'),
      images: ['/og-image.png'],
    },
    alternates: {
      canonical: SITE_URL,
      languages: {
        ar: `${SITE_URL}/ar`,
        en: `${SITE_URL}/en`,
      },
    },
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_VERIFICATION || '',
    },
    manifest: '/manifest.json',
    icons: {
      icon: [
        { url: '/icons/favicon-16x16.png', sizes: '16x16' },
        { url: '/icons/favicon-32x32.png', sizes: '32x32' },
      ],
      apple: '/icons/apple-touch-icon.png',
      other: [
        { rel: 'mask-icon', url: '/icons/safari-pinned-tab.svg', color: '#1A57A1' },
      ],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'إضمن EDMN',
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#1A57A1',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const isRTL = locale === 'ar';

  return (
    <html
      lang={locale}
      dir={isRTL ? 'rtl' : 'ltr'}
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Almarai:wght@300;400;700;800&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <Analytics />
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:start-4 focus:z-50 focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-lg">
            {isRTL ? 'انتقل للمحتوى الرئيسي' : 'Skip to main content'}
          </a>
          <Navbar />
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          <Footer />
          <MobileCTA />
          <ScrollTop />
          <CookieConsent />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
