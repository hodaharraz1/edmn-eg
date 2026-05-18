import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SITE_URL } from '@/lib/utils';
import ContactForm from './ContactForm';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo' });
  return {
    title: t('contactTitle'),
    description: t('contactDesc'),
    alternates: {
      canonical: `${SITE_URL}/contact`,
      languages: { ar: `${SITE_URL}/contact`, en: `${SITE_URL}/en/contact` },
    },
  };
}

const contactSchema = {
  '@context': 'https://schema.org',
  '@type': 'ContactPage',
  name: 'تواصل مع إضمن EDMN',
  url: `${SITE_URL}/contact`,
};

export default function ContactPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(contactSchema) }}
      />
      <ContactForm />
    </>
  );
}
