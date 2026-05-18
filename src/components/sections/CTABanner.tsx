'use client';

import { useTranslations, useLocale } from 'next-intl';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { UserPlus, Mail } from 'lucide-react';

export default function CTABanner() {
  const t = useTranslations('cta');
  const locale = useLocale();
  const getHref = (href: string) => locale === 'ar' ? href : `/en${href}`;

  return (
    <section className="relative py-16 overflow-hidden" aria-labelledby="cta-heading">
      {/* BG */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1A57A1] to-[#0E3A72]" />
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-24 -start-24 w-80 h-80 bg-white/5 rounded-full" />
        <div className="absolute -bottom-24 -end-24 w-96 h-96 bg-[#F0171A]/10 rounded-full" />
      </div>

      <div className="container relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, type: 'tween' }}
        >
          {/* Tag */}
          <span className="inline-block px-4 py-1.5 bg-white/15 text-white text-sm font-bold rounded-full mb-5 border border-white/20">
            {t('tag')}
          </span>

          <h2 id="cta-heading" className="text-white font-extrabold mb-4 max-w-2xl mx-auto"
              style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)' }}>
            {t('title')}
          </h2>
          <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto leading-relaxed">
            {t('desc')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="#"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5
                         bg-white text-[#1A57A1] rounded-xl font-bold text-base
                         hover:bg-[#EBF2FC] hover:-translate-y-0.5 transition-all
                         shadow-[0_4px_20px_rgba(0,0,0,.2)] active:scale-95">
              <UserPlus size={18} />
              {t('primary')}
            </Link>
            <Link href={getHref('/contact')}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5
                         bg-transparent text-white border-2 border-white/40 rounded-xl font-bold text-base
                         hover:bg-white/10 hover:-translate-y-0.5 transition-all active:scale-95">
              <Mail size={18} />
              {t('secondary')}
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
