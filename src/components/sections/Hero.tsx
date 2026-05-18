'use client';

import { useTranslations, useLocale } from 'next-intl';
import { motion, type Transition } from 'framer-motion';
import Link from 'next/link';
import { ShieldCheck, UserPlus, PlayCircle, ChevronDown, Star, Lock, BadgeCheck } from 'lucide-react';

const spring: Transition = { type: 'tween', duration: 0.55, ease: 'easeOut' };
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (d: number) => ({ opacity: 1, y: 0, transition: { ...spring, delay: d } }),
};
const fadeIn = {
  hidden: { opacity: 0 },
  visible: (d: number) => ({ opacity: 1, transition: { ...spring, delay: d, duration: 0.7 } }),
};

export default function Hero() {
  const t = useTranslations('hero');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const getHref = (href: string) => isAr ? href : `/en${href}`;

  return (
    <section
      className="relative overflow-hidden bg-gradient-to-br from-[#EBF2FC] via-[#F8FBFF] to-white"
      style={{ paddingTop: '130px', paddingBottom: '60px' }}
      aria-labelledby="hero-heading"
    >
      {/* BG Blobs */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -start-32 w-[500px] h-[500px] bg-[#1A57A1]/8 rounded-full blur-[100px]" />
        <div className="absolute -bottom-32 -end-32 w-[500px] h-[500px] bg-[#F0171A]/5 rounded-full blur-[100px]" />
      </div>

      <div className="container relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* ─── LEFT / Content ─── */}
          <div className={`flex flex-col ${isAr ? 'items-end text-end' : 'items-start text-start'} items-center text-center lg:items-start lg:text-start`}
               style={{ direction: isAr ? 'rtl' : 'ltr' }}>

            {/* Trust badge */}
            <motion.div custom={0} initial="hidden" animate="visible" variants={fadeIn}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-[#1A57A1]/20 rounded-full text-[#1A57A1] text-sm font-bold mb-6 shadow-sm">
              <ShieldCheck size={15} className="text-[#1A57A1]" />
              {t('badge')}
            </motion.div>

            {/* Headline */}
            <motion.h1 id="hero-heading" custom={0.1} initial="hidden" animate="visible" variants={fadeUp}
              className="font-extrabold text-[#1F2937] mb-5 leading-[1.15]"
              style={{ fontSize: 'clamp(2rem, 4.5vw, 3.2rem)' }}>
              {t('title')}{' '}
              <span className="text-[#F0171A]">{t('titleHighlight')}</span>
              <br />
              <span className="text-[#1A57A1]">{t('titleEnd')}</span>
              {isAr && <span className="ms-2">👌</span>}
            </motion.h1>

            {/* Description */}
            <motion.p custom={0.2} initial="hidden" animate="visible" variants={fadeUp}
              className="text-[#4B5563] text-lg leading-relaxed mb-8 max-w-md">
              {t('desc')}
            </motion.p>

            {/* CTA Buttons */}
            <motion.div custom={0.3} initial="hidden" animate="visible" variants={fadeUp}
              className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto mb-8">
              <Link href="#"
                className="flex items-center justify-center gap-2 px-7 py-3.5 bg-[#F0171A] text-white rounded-xl font-bold text-base
                           shadow-[0_4px_20px_rgba(240,23,26,.35)] hover:bg-[#C8141C] hover:-translate-y-0.5
                           hover:shadow-[0_8px_28px_rgba(240,23,26,.45)] transition-all active:scale-95">
                <UserPlus size={18} />
                {t('cta')}
              </Link>
              <Link href={getHref('/how-it-works')}
                className="flex items-center justify-center gap-2 px-7 py-3.5 bg-white text-[#1A57A1]
                           border-2 border-[#1A57A1] rounded-xl font-bold text-base
                           hover:bg-[#EBF2FC] hover:-translate-y-0.5 transition-all active:scale-95">
                <PlayCircle size={18} />
                {t('ctaSecondary')}
              </Link>
            </motion.div>

            {/* App Store badges */}
            <motion.div custom={0.4} initial="hidden" animate="visible" variants={fadeUp}
              className="flex gap-3 mb-8">
              {[
                { icon: '🍎', label: 'App Store', sub: t('availableOn') },
                { icon: '▶', label: 'Google Play', sub: t('downloadFrom') },
              ].map(({ icon, label, sub }) => (
                <Link key={label} href="#"
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#1F2937] text-white rounded-xl
                             hover:bg-[#374151] transition-all hover:-translate-y-0.5 shadow-md min-w-[140px]">
                  <span className="text-xl leading-none">{icon}</span>
                  <div>
                    <p className="text-[9px] text-gray-400 leading-none">{sub}</p>
                    <p className="font-bold text-sm leading-snug mt-0.5">{label}</p>
                  </div>
                </Link>
              ))}
            </motion.div>

            {/* Mini Stats */}
            <motion.div custom={0.5} initial="hidden" animate="visible" variants={fadeUp}
              className="flex items-center gap-6 pt-5 border-t border-gray-200">
              {[
                { v: '5%/3%', l: isAr ? 'أفراد / تجار' : 'Ind. / Business' },
                { v: '3+', l: isAr ? 'شركاء' : 'Partners' },
                { v: '100%', l: isAr ? 'حماية' : 'Protection' },
              ].map(({ v, l }) => (
                <div key={l} className="text-center">
                  <p className="text-xl font-extrabold text-[#1A57A1]">{v}</p>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">{l}</p>
                </div>
              ))}
            </motion.div>
          </div>

          {/* ─── RIGHT / Phone ─── */}
          <motion.div custom={0.1} initial="hidden" animate="visible" variants={fadeIn}
            className="flex items-center justify-center order-first lg:order-last"
            aria-hidden="true">

            <div className="relative" style={{ width: '260px' }}>
              {/* Glow */}
              <div className="absolute inset-4 bg-[#1A57A1]/20 rounded-full blur-3xl -z-10" />

              {/* Phone */}
              <div className="animate-float w-full" style={{ height: '520px' }}>
                <div className="w-full h-full bg-gradient-to-b from-[#1A57A1] to-[#0E3A72]
                                rounded-[40px] shadow-[0_20px_60px_rgba(26,87,161,.5)] p-[9px]">
                  <div className="w-full h-full bg-white rounded-[33px] overflow-hidden flex flex-col">

                    {/* Status bar */}
                    <div className="flex items-center justify-between px-5 pt-3.5 pb-1 flex-shrink-0">
                      <span className="text-[10px] font-bold text-[#1F2937]">9:41</span>
                      <div className="w-14 h-[18px] bg-black rounded-full" />
                      <div className="flex items-end gap-0.5">
                        {[6,8,10].map((h, i) => (
                          <div key={i} className="w-1 bg-[#1F2937] rounded-sm" style={{ height: h, opacity: 0.4 + i * 0.3 }} />
                        ))}
                      </div>
                    </div>

                    {/* App bar */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 flex-shrink-0">
                      <span className="font-extrabold text-[#1A57A1] text-[15px]">إضمن</span>
                      <span className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">Beta</span>
                    </div>

                    {/* Content */}
                    <div className="flex flex-col gap-3 p-4 flex-1 overflow-hidden">

                      {/* Balance */}
                      <div className="bg-gradient-to-br from-[#1A57A1] to-[#2B72D0] rounded-2xl p-4 text-white flex-shrink-0
                                      shadow-[0_4px_16px_rgba(26,87,161,.3)]">
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-[10px] opacity-70">رصيد الضمان</p>
                          <div className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center">
                            <Lock size={9} className="text-white" />
                          </div>
                        </div>
                        <p className="text-[22px] font-extrabold">5,000 ج</p>
                        <div className="flex items-center gap-1 mt-1">
                          <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                          <p className="text-[9px] opacity-70">محمي ومؤمّن</p>
                        </div>
                      </div>

                      {/* Steps */}
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <p className="text-[10px] font-bold text-[#6B7280]">حالة الصفقة</p>
                        {[
                          { label: 'الاتفاق على الشروط', state: 'done' },
                          { label: 'إيداع المبلغ', state: 'done' },
                          { label: 'التسليم والاستلام', state: 'active' },
                          { label: 'تحويل للبائع', state: 'pending' },
                        ].map(({ label, state }, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-extrabold flex-shrink-0
                              ${state === 'done' ? 'bg-green-100 text-green-600' :
                                state === 'active' ? 'bg-[#EBF2FC] text-[#1A57A1] ring-1 ring-[#1A57A1]' :
                                'bg-gray-100 text-gray-400'}`}>
                              {state === 'done' ? '✓' : i + 1}
                            </div>
                            <span className={`text-[10px] leading-none
                              ${state === 'done' ? 'text-green-600 line-through' :
                                state === 'active' ? 'text-[#1A57A1] font-bold' : 'text-gray-400'}`}>
                              {label}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Confirm button */}
                      <div className="mt-auto bg-[#F0171A] text-white rounded-xl py-2.5 text-center
                                      text-[11px] font-extrabold shadow-[0_4px_12px_rgba(240,23,26,.3)] flex-shrink-0">
                        تأكيد الاستلام ✓
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating badges */}
              <div className="absolute -top-2 -end-10 bg-white rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,.12)]
                              border border-gray-100 px-3 py-2 flex items-center gap-2">
                <div className="w-7 h-7 bg-green-50 rounded-xl flex items-center justify-center">
                  <ShieldCheck size={13} className="text-green-500" />
                </div>
                <div>
                  <p className="text-[8px] text-gray-400 leading-none">أموالك</p>
                  <p className="text-[10px] font-extrabold text-[#1F2937] leading-tight">100% محمية</p>
                </div>
              </div>

              <div className="absolute -bottom-2 -start-10 bg-white rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,.12)]
                              border border-gray-100 px-3 py-2 flex items-center gap-2">
                <div className="w-7 h-7 bg-[#EBF2FC] rounded-xl flex items-center justify-center">
                  <BadgeCheck size={13} className="text-[#1A57A1]" />
                </div>
                <div>
                  <p className="text-[8px] text-gray-400 leading-none">تشفير</p>
                  <p className="text-[10px] font-extrabold text-[#1F2937] leading-tight">بنكي آمن</p>
                </div>
              </div>

              <div className="absolute top-1/3 -start-14 bg-white rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,.12)]
                              border border-gray-100 px-3 py-2">
                <div className="flex gap-0.5 mb-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={8} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-[10px] font-extrabold text-[#1F2937]">5.0 ★</p>
              </div>
            </div>
          </motion.div>

        </div>
      </div>

      {/* Scroll indicator */}
      <div className="flex flex-col items-center gap-1 mt-12 text-[#9CA3AF] text-xs" aria-hidden="true">
        <span>{t('scrollMore')}</span>
        <ChevronDown size={14} className="animate-bounce" />
      </div>
    </section>
  );
}
