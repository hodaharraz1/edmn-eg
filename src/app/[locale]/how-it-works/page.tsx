import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations, useLocale } from 'next-intl';
import { SITE_URL } from '@/lib/utils';
import SectionTag from '@/components/ui/SectionTag';
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

const howItWorksSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'كيف يعمل تطبيق إضمن للوساطة المالية',
  description: 'خطوات استخدام تطبيق إضمن لضمان عمليات البيع والشراء',
  step: [
    { '@type': 'HowToStep', name: 'اتفق على الشروط', text: 'يتفق البائع والمشتري على تفاصيل الصفقة' },
    { '@type': 'HowToStep', name: 'ادفع بأمان', text: 'يودع المشتري المبلغ في حساب الضمان' },
    { '@type': 'HowToStep', name: 'استلم ما اشتريته', text: 'يستلم المشتري المنتج ويؤكد الاستلام' },
    { '@type': 'HowToStep', name: 'يحصل البائع على ماله', text: 'يتم تحويل المبلغ للبائع بعد التأكيد' },
  ],
};

const stepIcons = [HandshakeIcon, ShieldCheck, PackageCheck, Banknote];
const stepKeys = ['s1', 's2', 's3', 's4'] as const;
const stepColors = [
  { bg: 'bg-[#EBF2FC]', icon: 'text-[#1A57A1]', num: 'bg-[#1A57A1]', border: 'border-[#1A57A1]/20' },
  { bg: 'bg-red-50', icon: 'text-[#F0171A]', num: 'bg-[#F0171A]', border: 'border-red-200' },
  { bg: 'bg-green-50', icon: 'text-green-600', num: 'bg-green-600', border: 'border-green-200' },
  { bg: 'bg-amber-50', icon: 'text-amber-600', num: 'bg-amber-600', border: 'border-amber-200' },
];

function HowItWorksContent() {
  const t = useTranslations('howItWorks');

  const benefits = [
    'لا تدفع قبل الاستلام',
    'حماية ضد الاحتيال',
    'وسيط محايد وموثوق',
    'استرداد سهل في حالة النزاع',
    'دعم فني 24/7',
    'شفافية كاملة في التكاليف',
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howItWorksSchema) }}
      />

      {/* Hero */}
      <section className="pt-32 pb-16 bg-gradient-to-br from-[#EBF2FC] to-white">
        <div className="container text-center">
          <SectionTag>{t('tag')}</SectionTag>
          <h1 className="text-[#1A57A1] mt-2 mb-4">{t('title')}</h1>
          <p className="text-lg text-[#4B5563] max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>
      </section>

      {/* Steps */}
      <section className="section-padding bg-white">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            {stepKeys.map((key, i) => {
              const Icon = stepIcons[i];
              const { bg, icon, num, border } = stepColors[i];
              const isLast = i === stepKeys.length - 1;
              return (
                <div key={key} className="flex gap-6 mb-0">
                  {/* Left: Number + Line */}
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className={`w-12 h-12 ${num} text-white rounded-full flex items-center justify-center text-lg font-extrabold shadow-md z-10`}>
                      {i + 1}
                    </div>
                    {!isLast && (
                      <div className="w-0.5 flex-1 bg-gradient-to-b from-[#1A57A1]/30 to-transparent my-2" />
                    )}
                  </div>

                  {/* Right: Content */}
                  <div className={`flex-1 bg-white border ${border} rounded-2xl p-6 mb-8 hover:shadow-[var(--shadow-md)] transition-all`}>
                    <div className={`inline-flex items-center justify-center w-12 h-12 ${bg} rounded-xl mb-4`}>
                      <Icon size={24} className={icon} />
                    </div>
                    <h3 className="font-bold text-[#1F2937] mb-2 text-xl">
                      {t(`${key}Title` as Parameters<typeof t>[0])}
                    </h3>
                    <p className="text-[#4B5563] leading-relaxed">
                      {t(`${key}Desc` as Parameters<typeof t>[0])}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="section-padding bg-[#F4F3F3]">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-[#1A57A1]">لماذا تستخدم إضمن؟</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl mx-auto">
            {benefits.map((b) => (
              <div key={b} className="flex items-center gap-3 bg-white rounded-xl p-4 border border-[#E5E7EB]">
                <CheckCircle size={20} className="text-green-500 flex-shrink-0" />
                <span className="font-bold text-[#1F2937] text-sm">{b}</span>
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
  return <HowItWorksContent />;
}
