import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { SITE_URL } from '@/lib/utils';
import CTABanner from '@/components/sections/CTABanner';
import { ShieldCheck, Percent, Lock, Headphones, Building2, Cpu } from 'lucide-react';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo' });
  return {
    title: `${locale === 'ar' ? 'لماذا إضمن؟' : 'Why EDMN?'} | إضمن EDMN`,
    description: t('homeDesc'),
    alternates: {
      canonical: `${SITE_URL}/why-us`,
      languages: { ar: `${SITE_URL}/why-us`, en: `${SITE_URL}/en/why-us` },
    },
  };
}

const icons = [ShieldCheck, Percent, Lock, Headphones, Building2, Cpu];
const colors = ['#1A57A1', '#16A34A', '#F0171A', '#D97706', '#7C3AED', '#0891B2'];
const keys = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const;

function WhyUsContent() {
  const t = useTranslations('whyUs');
  return (
    <>
      {/* Hero */}
      <section style={{
        paddingTop: '100px', paddingBottom: '64px',
        background: 'linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%)',
        textAlign: 'center',
      }}>
        <div className="container-tight">
          <span className="chip-blue" style={{ display: 'inline-flex', marginBottom: '20px' }}>{t('tag')}</span>
          <h1 className="text-display-md" style={{ color: '#1d1d1f', marginBottom: '16px' }}>{t('title')}</h1>
          <p className="text-body-xl" style={{ color: '#6e6e73', maxWidth: '520px', margin: '0 auto' }}>{t('subtitle')}</p>
        </div>
      </section>

      {/* Reasons Grid */}
      <section className="section-lg" style={{ background: 'white' }}>
        <div className="container">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '20px',
          }}>
            {keys.map((key, i) => {
              const Icon = icons[i];
              return (
                <div key={key} className="card-premium" style={{ padding: '32px' }}>
                  <div style={{
                    width: '52px', height: '52px', borderRadius: '16px', marginBottom: '20px',
                    background: `${colors[i]}12`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={24} color={colors[i]} />
                  </div>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1d1d1f', marginBottom: '10px' }}>
                    {t(`${key}Title` as any)}
                  </h3>
                  <p style={{ fontSize: '15px', color: '#6e6e73', lineHeight: 1.65 }}>
                    {t(`${key}Desc` as any)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <CTABanner />
    </>
  );
}

export default function WhyUsPage() {
  return <WhyUsContent />;
}
