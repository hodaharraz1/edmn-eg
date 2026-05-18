'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import SectionTag from '@/components/ui/SectionTag';

const partners = [
  { nameAr: 'بنك مصر',  nameEn: 'Banque Misr', emoji: '🏦', color: 'from-green-50 to-emerald-50', border: 'hover:border-green-200' },
  { nameAr: 'فوري',     nameEn: 'Fawry',        emoji: '💳', color: 'from-orange-50 to-amber-50',  border: 'hover:border-orange-200' },
  { nameAr: 'ValU',     nameEn: 'ValU',          emoji: '💎', color: 'from-purple-50 to-violet-50', border: 'hover:border-purple-200' },
];

export default function Partners() {
  const t = useTranslations('partners');

  return (
    <section className="section-padding bg-[#F9FAFB]" aria-labelledby="partners-heading">
      <div className="container">
        <div className="text-center mb-12">
          <SectionTag>{t('tag')}</SectionTag>
          <h2 id="partners-heading" className="text-[#1A57A1] mb-3">{t('title')}</h2>
          <p className="text-[#6B7280] text-lg max-w-xl mx-auto">{t('subtitle')}</p>
        </div>

        <div className="flex flex-wrap justify-center gap-5 max-w-3xl mx-auto">
          {partners.map(({ nameAr, nameEn, emoji, color, border }, i) => (
            <motion.div
              key={nameAr}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.1, type: 'tween' }}
              className={`flex flex-col items-center gap-3 px-10 py-7 flex-1 min-w-[180px]
                          bg-gradient-to-br ${color} border border-[#E5E7EB] ${border}
                          rounded-2xl hover:shadow-[0_8px_32px_rgba(0,0,0,.08)]
                          hover:-translate-y-1 transition-all duration-300 cursor-default`}
            >
              <span className="text-5xl">{emoji}</span>
              <div className="text-center">
                <p className="font-extrabold text-[#1F2937] text-lg leading-tight">{nameAr}</p>
                <p className="text-sm text-[#6B7280] mt-0.5">{nameEn}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <p className="text-center text-sm text-[#9CA3AF] mt-8">
          ✓ شراكات رسمية وموثقة
        </p>
      </div>
    </section>
  );
}
