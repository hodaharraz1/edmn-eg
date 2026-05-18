import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SITE_URL } from '@/lib/utils';
import CTABanner from '@/components/sections/CTABanner';
import FAQPageContent from './FAQPageContent';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo' });
  return {
    title: t('faqTitle'),
    description: t('faqDesc'),
    alternates: {
      canonical: `${SITE_URL}/faq`,
      languages: { ar: `${SITE_URL}/faq`, en: `${SITE_URL}/en/faq` },
    },
  };
}

export default function FAQPage() {
  return (
    <>
      <FAQPageContent />
      <CTABanner />
    </>
  );
}
