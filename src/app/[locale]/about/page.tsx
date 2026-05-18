import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { SITE_URL } from '@/lib/utils';
import SectionTag from '@/components/ui/SectionTag';
import CTABanner from '@/components/sections/CTABanner';
import { Target, Eye, Heart, Building2, MapPin, FileText } from 'lucide-react';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo' });
  return {
    title: t('aboutTitle'),
    description: t('aboutDesc'),
    alternates: {
      canonical: `${SITE_URL}/about`,
      languages: { ar: `${SITE_URL}/about`, en: `${SITE_URL}/en/about` },
    },
  };
}

function AboutContent() {
  const t = useTranslations('about');
  const values = ['v1', 'v2', 'v3', 'v4'] as const;
  const valueIcons = ['🔒', '🔍', '⚡', '❤️'];

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

      {/* Mission & Vision */}
      <section className="section-padding bg-white">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
            {/* Mission */}
            <div className="bg-[#EBF2FC] rounded-2xl p-8">
              <div className="w-14 h-14 bg-[#1A57A1] rounded-2xl flex items-center justify-center mb-5">
                <Target size={28} className="text-white" />
              </div>
              <h2 className="text-[#1A57A1] text-2xl mb-3">{t('mission')}</h2>
              <p className="text-[#4B5563] leading-relaxed">{t('missionText')}</p>
            </div>
            {/* Vision */}
            <div className="bg-gradient-to-br from-[#1A57A1] to-[#2B72D0] rounded-2xl p-8 text-white">
              <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mb-5">
                <Eye size={28} className="text-white" />
              </div>
              <h2 className="text-white text-2xl mb-3">{t('vision')}</h2>
              <p className="text-blue-100 leading-relaxed">{t('visionText')}</p>
            </div>
          </div>

          {/* Values */}
          <div className="text-center mb-10">
            <h2 className="text-[#1A57A1]">{t('values')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
            {values.map((key, i) => (
              <div key={key} className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl p-6 text-center hover:shadow-[var(--shadow-md)] hover:-translate-y-1 transition-all">
                <span className="text-3xl mb-3 block">{valueIcons[i]}</span>
                <p className="font-bold text-[#1F2937]">{t(key)}</p>
              </div>
            ))}
          </div>

          {/* Company Info */}
          <div className="bg-[#1F2937] rounded-2xl p-8 text-white">
            <h3 className="text-xl font-bold mb-6 text-amber-300">{t('companyTitle')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="flex items-start gap-3">
                <Building2 size={20} className="text-[#1A57A1] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-400 text-sm mb-0.5">
                    {t('tag') === 'نبذة عنا' ? 'الاسم العربي' : 'Arabic Name'}
                  </p>
                  <p className="font-bold">{t('companyName')}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Building2 size={20} className="text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-400 text-sm mb-0.5">English Name</p>
                  <p className="font-bold">{t('companyNameEn')}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin size={20} className="text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-400 text-sm mb-0.5">
                    {t('tag') === 'نبذة عنا' ? 'الموقع' : 'Location'}
                  </p>
                  <p className="font-bold">{t('companyLocation')}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FileText size={20} className="text-green-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-400 text-sm mb-0.5">
                    {t('tag') === 'نبذة عنا' ? 'السجل التجاري' : 'Commercial Register'}
                  </p>
                  <p className="font-bold">{t('companyCR')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CTABanner />
    </>
  );
}

export default function AboutPage() {
  return <AboutContent />;
}
