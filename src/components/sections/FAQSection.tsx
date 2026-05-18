'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Plus, Minus, CircleHelp } from 'lucide-react';
import SectionTag from '@/components/ui/SectionTag';

const faqKeys = ['1', '2', '3', '4', '5', '6'] as const;

export default function FAQSection() {
  const t = useTranslations('faqSection');
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(null);
  const getLocalizedHref = (href: string) => locale === 'ar' ? href : `/en${href}`;

  return (
    <section
      className="section-padding bg-[#F4F3F3]"
      id="faq"
      aria-labelledby="faq-heading"
    >
      <div className="container">
        <div className="text-center mb-12">
          <SectionTag>{t('tag')}</SectionTag>
          <h2 id="faq-heading" className="text-[#1A57A1] mb-4">{t('title')}</h2>
          <p className="text-lg text-[#4B5563] max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>

        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          {faqKeys.map((key) => {
            const isOpen = open === key;
            return (
              <div
                key={key}
                className={`bg-white rounded-2xl border transition-all duration-200 ${
                  isOpen ? 'border-[#1A57A1]/40 shadow-[var(--shadow-sm)]' : 'border-[#E5E7EB] hover:border-[#1A57A1]/30'
                }`}
                data-open={isOpen}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : key)}
                  className="w-full flex items-center justify-between gap-4 p-5 text-start font-bold text-[#1F2937] hover:text-[#1A57A1] transition-colors"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${key}`}
                >
                  <span className="text-base leading-snug">
                    {t(`q${key}` as Parameters<typeof t>[0])}
                  </span>
                  <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                    isOpen ? 'bg-[#EBF2FC] text-[#1A57A1]' : 'bg-[#F3F4F6] text-[#6B7280]'
                  }`}>
                    {isOpen ? <Minus size={16} /> : <Plus size={16} />}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-answer-${key}`}
                      role="region"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-5 text-[#4B5563] leading-relaxed">
                        {t(`a${key}` as Parameters<typeof t>[0])}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="text-center mt-10">
          <Link
            href={getLocalizedHref('/faq')}
            className="inline-flex items-center gap-2 px-6 py-3 border-2 border-[#1A57A1] text-[#1A57A1] rounded-xl font-bold hover:bg-[#EBF2FC] transition-all hover:-translate-y-0.5"
          >
            <CircleHelp size={18} />
            {t('viewAll')}
          </Link>
        </div>
      </div>
    </section>
  );
}
