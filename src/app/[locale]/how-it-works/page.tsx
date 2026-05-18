import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { SITE_URL } from '@/lib/utils';
import CTABanner from '@/components/sections/CTABanner';
import { HandshakeIcon, ShieldCheck, PackageCheck, Banknote, CheckCircle } from 'lucide-react';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo' });
  return {
    title: t('howTitle'),
    description: t('howDesc'),
    alternates: {
      canonical: `${SITE_URL}/how-it-works`,
      languages: { ar: `${SITE_URL}/how-it-works`, en: `${SITE_URL}/en/how-it-works` },
    },
  };
}

const stepIcons = [HandshakeIcon, ShieldCheck, PackageCheck, Banknote];
const stepColors = ['#1A57A1', '#F0171A', '#16A34A', '#D97706'];
const stepKeys = ['s1', 's2', 's3', 's4'] as const;

const benefits = [
  'لا تدفع قبل الاستلام',
  'حماية ضد الاحتيال',
  'وسيط محايد وموثوق',
  'استرداد سهل في حالة النزاع',
  'دعم فني 24/7',
  'شفافية كاملة في التكاليف',
];

function HowContent() {
  const t = useTranslations('howItWorks');
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

      {/* Steps */}
      <section className="section-lg" style={{ background: 'white' }}>
        <div className="container" style={{ maxWidth: '760px' }}>
          {stepKeys.map((key, i) => {
            const Icon = stepIcons[i];
            const color = stepColors[i];
            const isLast = i === stepKeys.length - 1;
            return (
              <div key={key} style={{ display: 'flex', gap: '24px', marginBottom: isLast ? 0 : '8px' }}>
                {/* Line + Circle */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{
                    width: '52px', height: '52px', borderRadius: '50%',
                    background: `${color}12`, border: `2px solid ${color}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={22} color={color} />
                  </div>
                  {!isLast && (
                    <div style={{
                      width: '2px', flex: 1, minHeight: '32px',
                      background: 'linear-gradient(180deg, rgba(0,0,0,0.08) 0%, transparent 100%)',
                      margin: '8px 0',
                    }} />
                  )}
                </div>

                {/* Content */}
                <div style={{
                  flex: 1, paddingBottom: isLast ? 0 : '32px',
                  paddingTop: '12px',
                }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: '22px', height: '22px', borderRadius: '50%',
                    background: color, color: 'white',
                    fontSize: '11px', fontWeight: 900, marginBottom: '8px',
                  }}>{i + 1}</div>
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#1d1d1f', marginBottom: '8px' }}>
                    {t(`${key}Title` as any)}
                  </h3>
                  <p style={{ fontSize: '16px', color: '#6e6e73', lineHeight: 1.65 }}>
                    {t(`${key}Desc` as any)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Benefits */}
      <section className="section-md" style={{ background: '#f5f5f7' }}>
        <div className="container">
          <h2 className="text-display-md" style={{ color: '#1d1d1f', textAlign: 'center', marginBottom: '48px' }}>
            لماذا تستخدم إضمن؟
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '12px',
            maxWidth: '900px', margin: '0 auto',
          }}>
            {benefits.map((b) => (
              <div key={b} className="card-premium" style={{
                padding: '18px 22px',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}>
                <CheckCircle size={18} color="#16A34A" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '15px', fontWeight: 600, color: '#1d1d1f' }}>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CTABanner />
    </>
  );
}

export default function HowItWorksPage() {
  return <HowContent />;
}
