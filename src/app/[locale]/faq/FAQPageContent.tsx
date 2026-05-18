'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import SectionTag from '@/components/ui/SectionTag';
import { Plus, Minus } from 'lucide-react';

const faqKeys = ['1', '2', '3', '4', '5', '6'] as const;

const categories = ['all', 'security', 'fees', 'process', 'disputes'] as const;

export default function FAQPageContent() {
  const t = useTranslations('faqSection');
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filteredFaqs = faqKeys.filter((key) => {
    const q = t(`q${key}` as Parameters<typeof t>[0]).toLowerCase();
    const a = t(`a${key}` as Parameters<typeof t>[0]).toLowerCase();
    return q.includes(search.toLowerCase()) || a.includes(search.toLowerCase());
  });

  return (
    <>
      {/* Hero */}
      <section className="pt-32 pb-16 bg-gradient-to-br from-[#EBF2FC] to-white">
        <div className="container text-center">
          <SectionTag>{t('tag')}</SectionTag>
          <h1 className="text-[#1A57A1] mt-2 mb-4">{t('title')}</h1>
          <p className="text-lg text-[#4B5563] max-w-2xl mx-auto mb-8">{t('subtitle')}</p>
          {/* Search */}
          <div className="max-w-xl mx-auto relative">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث في الأسئلة..."
              className="w-full px-5 py-4 ps-12 bg-white border border-[#E5E7EB] rounded-2xl text-[#1F2937] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1A57A1] shadow-[var(--shadow-sm)]"
              aria-label="البحث في الأسئلة الشائعة"
            />
            <span className="absolute top-4 start-4 text-[#9CA3AF]">🔍</span>
          </div>
        </div>
      </section>

      {/* FAQ List */}
      <section className="section-padding bg-white">
        <div className="container max-w-3xl">
          {filteredFaqs.length === 0 ? (
            <div className="text-center py-16 text-[#9CA3AF]">
              <p className="text-xl">لم يتم العثور على نتائج</p>
              <p className="text-sm mt-2">جرب كلمات بحث مختلفة</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredFaqs.map((key) => {
                const isOpen = open === key;
                return (
                  <div
                    key={key}
                    className={`bg-white rounded-2xl border transition-all duration-200 ${
                      isOpen ? 'border-[#1A57A1]/40 shadow-[var(--shadow-sm)]' : 'border-[#E5E7EB] hover:border-[#1A57A1]/30'
                    }`}
                  >
                    <button
                      onClick={() => setOpen(isOpen ? null : key)}
                      className="w-full flex items-center justify-between gap-4 p-5 text-start font-bold text-[#1F2937] hover:text-[#1A57A1] transition-colors"
                      aria-expanded={isOpen}
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
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3 }}
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
          )}

          {/* Contact Prompt */}
          <div className="mt-12 bg-[#EBF2FC] rounded-2xl p-8 text-center">
            <p className="text-[#1A57A1] font-bold text-lg mb-2">لم تجد ما تبحث عنه؟</p>
            <p className="text-[#4B5563] mb-4">تواصل معنا وسنجيب على سؤالك</p>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#1A57A1] text-white rounded-xl font-bold hover:bg-[#164A8A] transition-all"
            >
              تواصل معنا
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
