'use client';

import { useTranslations } from 'next-intl';
import { motion, type Variants } from 'framer-motion';
import { Truck, CreditCard, Headphones, Zap, Percent, ShieldCheck } from 'lucide-react';
import SectionTag from '@/components/ui/SectionTag';

const icons = [Truck, CreditCard, Headphones, Zap, Percent, ShieldCheck];

const cards = [
  { bg: 'bg-blue-50',   icon: 'text-[#1A57A1]', border: 'hover:border-blue-200',   top: 'bg-[#1A57A1]' },
  { bg: 'bg-red-50',    icon: 'text-[#F0171A]',  border: 'hover:border-red-200',    top: 'bg-[#F0171A]'  },
  { bg: 'bg-green-50',  icon: 'text-green-600',  border: 'hover:border-green-200',  top: 'bg-green-500'  },
  { bg: 'bg-amber-50',  icon: 'text-amber-600',  border: 'hover:border-amber-200',  top: 'bg-amber-500'  },
  { bg: 'bg-purple-50', icon: 'text-purple-600', border: 'hover:border-purple-200', top: 'bg-purple-500' },
  { bg: 'bg-teal-50',   icon: 'text-teal-600',   border: 'hover:border-teal-200',   top: 'bg-teal-500'   },
];

const featureKeys = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const;

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, type: 'tween', ease: 'easeOut' } },
};

export default function Features() {
  const t = useTranslations('features');

  return (
    <section className="section-padding bg-white" id="features" aria-labelledby="features-heading">
      <div className="container">

        {/* Header */}
        <div className="text-center mb-12">
          <SectionTag>{t('tag')}</SectionTag>
          <h2 id="features-heading" className="text-[#1A57A1] mb-3">{t('title')}</h2>
          <p className="text-[#6B7280] text-lg max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>

        {/* Grid */}
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={container}
        >
          {featureKeys.map((key, i) => {
            const Icon = icons[i];
            const { bg, icon, border, top } = cards[i];
            return (
              <motion.article
                key={key}
                variants={item}
                className={`relative bg-white border border-[#E5E7EB] ${border} rounded-2xl p-6
                            hover:shadow-[0_8px_40px_rgba(0,0,0,.10)] hover:-translate-y-1
                            transition-all duration-300 overflow-hidden group`}
              >
                {/* Top accent line */}
                <div className={`absolute top-0 inset-x-0 h-1 ${top} rounded-t-2xl
                                 opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

                <div className={`inline-flex items-center justify-center w-12 h-12 ${bg}
                                 rounded-xl mb-4 transition-transform duration-300 group-hover:scale-110`}>
                  <Icon size={22} className={icon} />
                </div>

                <h3 className="font-bold text-[#1F2937] mb-2 text-lg">
                  {t(`${key}Title` as Parameters<typeof t>[0])}
                </h3>
                <p className="text-[#6B7280] leading-relaxed text-[15px]">
                  {t(`${key}Desc` as Parameters<typeof t>[0])}
                </p>
              </motion.article>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
