import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { SITE_URL } from '@/lib/utils';
import SectionTag from '@/components/ui/SectionTag';
import CTABanner from '@/components/sections/CTABanner';
import { Users, Percent, ShieldCheck, Headphones, Building2, Cpu } from 'lucide-react';

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

const reasonIcons = [Users, Percent, ShieldCheck, Headphones, Building2, Cpu];
const reasonKeys = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const;
const reasonColors = [
  'bg-[#EBF2FC] text-[#1A57A1]',
  'bg-green-50 text-green-600',
  'bg-red-50 text-[#F0171A]',
  'bg-amber-50 text-amber-600',
  'bg-purple-50 text-purple-600',
  'bg-teal-50 text-teal-600',
];

function WhyUsContent() {
  const t = useTranslations('whyUs');
  return (
    <>
      {/* Hero */}
      <section className="pt-32 pb-16 bg-gradient-to-br from-[#EBF2FC] to-white">
        <div className="container text-center">
          <SectionTag>{t('tag')}</SectionTag>
          <h1 className="text-[#1A57A1] mt-2 mb-4">{t('title')}</h1>
          <p className="text-lg text-[#4B5563] max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>
      </section>

      {/* Reasons */}
      <section className="section-padding bg-white">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {reasonKeys.map((key, i) => {
              const Icon = reasonIcons[i];
              return (
                <div
                  key={key}
                  className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl p-7 hover:shadow-[var(--shadow-lg)] hover:-translate-y-1 transition-all duration-300"
                >
                  <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-5 ${reasonColors[i]}`}>
                    <Icon size={26} />
                  </div>
                  <h3 className="font-bold text-[#1F2937] mb-3 text-xl">
                    {t(`${key}Title` as Parameters<typeof t>[0])}
                  </h3>
                  <p className="text-[#4B5563] leading-relaxed">
                    {t(`${key}Desc` as Parameters<typeof t>[0])}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Comparison */}
          <div className="mt-16">
            <h2 className="text-center text-[#1A57A1] mb-10">إضمن مقابل البدائل</h2>
            <div className="overflow-x-auto">
              <table className="w-full bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-[var(--shadow-sm)]">
                <thead>
                  <tr className="bg-[#1A57A1] text-white">
                    <th className="py-4 px-6 text-start font-bold">الميزة</th>
                    <th className="py-4 px-6 text-center font-bold">إضمن ✅</th>
                    <th className="py-4 px-6 text-center font-bold">التحويل المباشر ❌</th>
                    <th className="py-4 px-6 text-center font-bold">الدفع عند الاستلام ⚠️</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['حماية من الاحتيال', '✅', '❌', '⚠️'],
                    ['ضمان الاسترداد', '✅', '❌', '❌'],
                    ['وسيط محايد', '✅', '❌', '❌'],
                    ['دعم النزاعات', '✅', '❌', '⚠️'],
                    ['شفافية الرسوم', '✅', '✅', '❌'],
                  ].map(([feature, ...values], rowI) => (
                    <tr key={feature} className={rowI % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]'}>
                      <td className="py-3.5 px-6 font-bold text-[#1F2937] text-sm">{feature}</td>
                      {values.map((v, vi) => (
                        <td key={vi} className="py-3.5 px-6 text-center text-lg">{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
