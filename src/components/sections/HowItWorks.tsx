'use client';

import { useTranslations, useLocale } from 'next-intl';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { HandshakeIcon, ShieldCheck, PackageCheck, Banknote, CirclePlay, ArrowLeft, ArrowRight } from 'lucide-react';
import SectionTag from '@/components/ui/SectionTag';

const stepIcons = [HandshakeIcon, ShieldCheck, PackageCheck, Banknote];
const stepKeys = ['s1', 's2', 's3', 's4'] as const;
const stepColors = [
  { bg: 'bg-[#EBF2FC]', text: 'text-[#1A57A1]', num: 'bg-[#1A57A1]' },
  { bg: 'bg-red-50', text: 'text-[#F0171A]', num: 'bg-[#F0171A]' },
  { bg: 'bg-green-50', text: 'text-green-600', num: 'bg-green-600' },
  { bg: 'bg-amber-50', text: 'text-amber-600', num: 'bg-amber-600' },
];

export default function HowItWorks() {
  const t = useTranslations('howItWorks');
  const locale = useLocale();
  const ArrowIcon = locale === 'ar' ? ArrowLeft : ArrowRight;
  const getLocalizedHref = (href: string) => locale === 'ar' ? href : `/en${href}`;

  return (
    <section
      className="section-padding bg-[#F4F3F3]"
      id="how-it-works"
      aria-labelledby="how-heading"
    >
      <div className="container">
        {/* Header */}
        <div className="text-center mb-14">
          <SectionTag>{t('tag')}</SectionTag>
          <h2 id="how-heading" className="text-[#1A57A1] mb-4">{t('title')}</h2>
          <p className="text-lg text-[#4B5563] max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
          {/* Connector line (desktop) */}
          <div className="hidden lg:block absolute top-10 start-[12.5%] end-[12.5%] h-0.5 bg-gradient-to-r from-[#1A57A1]/20 via-[#1A57A1]/40 to-[#1A57A1]/20" aria-hidden="true" />

          {stepKeys.map((key, i) => {
            const Icon = stepIcons[i];
            const { bg, text, num } = stepColors[i];
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: "easeInOut" }}
                className="relative flex flex-col items-center text-center bg-white rounded-2xl p-7 shadow-[var(--shadow-sm)] border border-[#E5E7EB] hover:shadow-[var(--shadow-lg)] hover:-translate-y-1 transition-all duration-300"
              >
                {/* Step Number */}
                <div className={`absolute -top-4 w-8 h-8 ${num} text-white rounded-full flex items-center justify-center text-sm font-extrabold shadow-md`}>
                  {i + 1}
                </div>
                {/* Icon */}
                <div className={`w-16 h-16 ${bg} rounded-2xl flex items-center justify-center mb-5 mt-2`}>
                  <Icon size={28} className={text} />
                </div>
                <h4 className="font-bold text-[#1F2937] mb-2 text-lg">
                  {t(`${key}Title` as Parameters<typeof t>[0])}
                </h4>
                <p className="text-[#4B5563] text-sm leading-relaxed">
                  {t(`${key}Desc` as Parameters<typeof t>[0])}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <Link
            href={getLocalizedHref('/how-it-works')}
            className="inline-flex items-center gap-2 px-8 py-4 bg-[#1A57A1] text-white rounded-xl font-bold text-lg shadow-[0_4px_14px_rgba(26,87,161,.3)] hover:bg-[#164A8A] hover:shadow-[0_8px_24px_rgba(26,87,161,.4)] hover:-translate-y-0.5 transition-all"
          >
            <CirclePlay size={20} />
            {t('cta')}
            <ArrowIcon size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}
