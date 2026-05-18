import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SITE_URL } from '@/lib/utils';
import Hero from '@/components/sections/Hero';
import TrustBar from '@/components/sections/TrustBar';
import Features from '@/components/sections/Features';
import HowItWorks from '@/components/sections/HowItWorks';
import Stats from '@/components/sections/Stats';
import Partners from '@/components/sections/Partners';
import FAQSection from '@/components/sections/FAQSection';
import CTABanner from '@/components/sections/CTABanner';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo' });
  return {
    title: t('homeTitle'),
    description: t('homeDesc'),
    alternates: {
      canonical: locale === 'ar' ? SITE_URL : `${SITE_URL}/en`,
      languages: { ar: SITE_URL, en: `${SITE_URL}/en` },
    },
  };
}

/* ─── Structured Data ─── */
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'إضمن EDMN',
  alternateName: 'EDMN EG',
  url: SITE_URL,
  logo: `${SITE_URL}/icons/logo.png`,
  description: 'تطبيق وساطة مالية يضمن عمليات البيع والشراء الآمنة في مصر',
  foundingLocation: { '@type': 'Place', name: 'Alexandria, Egypt' },
  contactPoint: {
    '@type': 'ContactPoint',
    telephone: '+20-1112345661',
    contactType: 'customer service',
    availableLanguage: ['Arabic', 'English'],
  },
  sameAs: [
    'https://www.facebook.com/share/1Ebp9L869e/',
    'https://www.linkedin.com/company/edmneg/',
  ],
};

const appSchema = {
  '@context': 'https://schema.org',
  '@type': 'MobileApplication',
  name: 'إضمن EDMN',
  operatingSystem: 'iOS, Android',
  applicationCategory: 'FinanceApplication',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'EGP',
  },
  description: 'تطبيق وساطة مالية يضمن عمليات البيع والشراء الآمنة',
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'ما هو تطبيق إضمن؟',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'إضمن هو تطبيق وساطة مالية يعمل كطرف ثالث موثوق بين البائع والمشتري لضمان أمان المعاملات.',
      },
    },
    {
      '@type': 'Question',
      name: 'ما هي رسوم إضمن؟',
      acceptedAnswer: {
        '@type': 'Answer',
        text: '5% للأفراد و3% للتجار من قيمة المعاملة. لا رسوم خفية.',
      },
    },
    {
      '@type': 'Question',
      name: 'هل إضمن متاح على iOS وAndroid؟',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'نعم، تطبيق إضمن متاح على iOS وAndroid في مرحلة Beta.',
      },
    },
  ],
};

export default function HomePage() {
  return (
    <>
      {/* Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <Hero />
      <TrustBar />
      <Features />
      <HowItWorks />
      <Stats />
      <Partners />
      <FAQSection />
      <CTABanner />
    </>
  );
}
