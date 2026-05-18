'use client';

import { useTranslations, useLocale } from 'next-intl';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { ShieldCheck, UserPlus, ChevronDown, BadgeCheck, Lock, TrendingUp } from 'lucide-react';

export default function Hero() {
  const t    = useTranslations('hero');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const getHref = (h: string) => isAr ? h : `/en${h}`;

  return (
    <section className="bg-hero relative overflow-hidden" style={{ paddingTop: '130px', paddingBottom: '80px' }}>

      {/* Subtle noise texture overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.015]"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\'/%3E%3C/filter%3E%3Crect width=\'200\' height=\'200\' filter=\'url(%23n)\' opacity=\'1\'/%3E%3C/svg%3E")' }}
        aria-hidden="true" />

      <div className="container" style={{ position: 'relative', zIndex: 1 }}>

        {/* ── Center Text Block ── */}
        <div className="text-center mb-16" style={{ maxWidth: '860px', margin: '0 auto 64px' }}>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="chip-blue mb-6"
            style={{ display: 'inline-flex' }}>
            <ShieldCheck size={13} />
            {t('badge')}
          </motion.div>

          <motion.h1
            id="hero-heading"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.08, ease: 'easeOut' }}
            className="text-display-xl text-[#1d1d1f] mb-6">
            {t('title')}{' '}
            <span style={{ color: '#F0171A' }}>{t('titleHighlight')}</span>
            <br />
            <span className="gradient-text-brand">{t('titleEnd')}</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.18, ease: 'easeOut' }}
            className="text-body-xl text-[#6e6e73] mb-10"
            style={{ maxWidth: '600px', margin: '0 auto 40px' }}>
            {t('desc')}
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.28, ease: 'easeOut' }}
            className="flex items-center justify-center gap-4 flex-wrap mb-12">
            <Link href={getHref('/how-it-works')} className="btn btn-lg btn-outline-dark">
              {t('ctaSecondary')} →
            </Link>
            <Link href={getHref('/contact')} className="btn btn-lg btn-primary">
              {t('cta')}
            </Link>
          </motion.div>

          {/* App Store Buttons */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.38, ease: 'easeOut' }}
            className="flex items-center justify-center gap-3 flex-wrap">
            {[
              {
                svg: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11"/>
                  </svg>
                ),
                big: 'App Store', small: isAr ? 'متاح على' : 'Available on',
              },
              {
                svg: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M3.18 23.76c.33.18.7.24 1.07.17L14.1 12 4.25.07C3.88 0 3.51.06 3.18.24 2.5.6 2 1.38 2 2.28v19.44c0 .9.5 1.68 1.18 2.04zM16.5 9.56L6.38 2.33l7.89 7.88 2.23-.65zM20.62 10.42l-2.4-1.38-2.5.72L18.43 12l-2.7 2.24 2.5.72 2.4-1.38c.68-.4 1.1-1.12 1.1-1.88s-.42-1.48-1.1-1.88zM6.38 21.67l10.12-7.23-2.23-.65-7.89 7.88z"/>
                  </svg>
                ),
                big: 'Google Play', small: isAr ? 'حمّل من' : 'Get it on',
              },
            ].map(({ svg, big, small }) => (
              <Link key={big} href="#"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '12px',
                  padding: '11px 24px', background: '#1d1d1f', color: 'white',
                  borderRadius: '12px', minWidth: '160px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  textDecoration: 'none',
                }}>
                <span style={{ flexShrink: 0 }}>{svg}</span>
                <div style={{ textAlign: isAr ? 'right' : 'left' }}>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', lineHeight: 1, letterSpacing: '0.02em' }}>{small}</div>
                  <div style={{ fontSize: '15px', fontWeight: 700, marginTop: '3px', letterSpacing: '-0.01em' }}>{big}</div>
                </div>
              </Link>
            ))}
          </motion.div>
        </div>

        {/* ── Dashboard Card ── */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ maxWidth: '900px', margin: '0 auto', position: 'relative' }}>

          {/* Main card */}
          <div style={{
            background: 'white',
            borderRadius: '28px',
            border: '1px solid rgba(0,0,0,0.07)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.10), 0 1px 0 rgba(255,255,255,0.8) inset',
            overflow: 'hidden',
          }}>
            {/* Card top bar */}
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid rgba(0,0,0,0.05)',
              display: 'flex', alignItems: 'center', gap: '8px',
              background: '#fafafa',
            }}>
              {['#FF5F57','#FEBC2E','#28C840'].map(c => (
                <div key={c} style={{ width: '12px', height: '12px', borderRadius: '50%', background: c }} />
              ))}
              <div style={{
                flex: 1, height: '28px', background: 'white',
                border: '1px solid rgba(0,0,0,0.08)', borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', color: '#86868b', maxWidth: '220px', margin: '0 auto',
              }}>
                🔒 app.edmneg.com
              </div>
            </div>

            {/* Dashboard content */}
            <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>

              {/* Balance card */}
              <div style={{
                gridColumn: '1 / 2',
                background: 'linear-gradient(135deg, #1A57A1 0%, #0E3A72 100%)',
                borderRadius: '20px', padding: '24px', color: 'white',
              }}>
                <div style={{ fontSize: '11px', opacity: 0.65, marginBottom: '8px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {isAr ? 'رصيد الضمان' : 'Escrow Balance'}
                </div>
                <div style={{ fontSize: '32px', fontWeight: 900, letterSpacing: '-0.02em' }}>5,000</div>
                <div style={{ fontSize: '14px', opacity: 0.6, marginBottom: '16px' }}>{isAr ? 'جنيه مصري' : 'EGP'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', opacity: 0.8 }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ADE80', animation: 'gentle-float 2s ease-in-out infinite' }} />
                  {isAr ? 'محفوظ وآمن' : 'Secured & Protected'}
                </div>
              </div>

              {/* Progress + Steps */}
              <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Steps */}
                <div style={{ background: '#f5f5f7', borderRadius: '16px', padding: '20px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#86868b', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '16px' }}>
                    {isAr ? 'حالة الصفقة' : 'Deal Status'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {[
                      { label: isAr ? 'الاتفاق على الشروط' : 'Terms Agreement', state: 'done' },
                      { label: isAr ? 'إيداع المبلغ'       : 'Funds Deposited',  state: 'done' },
                      { label: isAr ? 'التسليم والاستلام'  : 'Delivery',         state: 'active' },
                      { label: isAr ? 'تحويل للبائع'       : 'Release to Seller', state: 'pending' },
                    ].map(({ label, state }, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '10px', fontWeight: 800,
                          background: state === 'done' ? '#DCFCE7' : state === 'active' ? '#EBF2FC' : '#F1F5F9',
                          color: state === 'done' ? '#16A34A' : state === 'active' ? '#1A57A1' : '#94A3B8',
                          border: state === 'active' ? '2px solid #1A57A1' : '2px solid transparent',
                        }}>
                          {state === 'done' ? '✓' : i + 1}
                        </div>
                        <span style={{
                          fontSize: '13px',
                          fontWeight: state === 'active' ? 700 : 500,
                          color: state === 'done' ? '#86868b' : state === 'active' ? '#1d1d1f' : '#94A3B8',
                          textDecoration: state === 'done' ? 'line-through' : 'none',
                        }}>
                          {label}
                        </span>
                        {state === 'active' && (
                          <span style={{
                            marginInlineStart: 'auto', fontSize: '10px', fontWeight: 700,
                            background: '#1A57A1', color: 'white',
                            padding: '2px 10px', borderRadius: '100px',
                          }}>
                            {isAr ? 'جاري' : 'Active'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Confirm button */}
                <button style={{
                  padding: '14px', background: '#F0171A', color: 'white',
                  borderRadius: '14px', fontWeight: 700, fontSize: '14px',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 4px 16px rgba(240,23,26,0.3)',
                  transition: 'all 0.2s',
                }}>
                  {isAr ? '✓ تأكيد الاستلام' : '✓ Confirm Receipt'}
                </button>
              </div>
            </div>
          </div>

          {/* Floating trust badges */}
          <motion.div className="animate-float"
            style={{
              position: 'absolute', top: '-16px',
              [isAr ? 'left' : 'right']: '32px',
              background: 'white', borderRadius: '16px',
              padding: '12px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              border: '1px solid rgba(0,0,0,0.05)',
              display: 'flex', alignItems: 'center', gap: '10px',
            }}>
            <div style={{ width: '36px', height: '36px', background: '#DCFCE7', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={18} color="#16A34A" />
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#86868b', lineHeight: 1 }}>{isAr ? 'أموالك' : 'Your funds'}</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#1d1d1f', marginTop: '3px' }}>{isAr ? '100% محمية' : '100% Protected'}</div>
            </div>
          </motion.div>

          <motion.div
            style={{
              position: 'absolute', bottom: '-16px',
              [isAr ? 'right' : 'left']: '32px',
              background: 'white', borderRadius: '16px',
              padding: '12px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              border: '1px solid rgba(0,0,0,0.05)',
              display: 'flex', alignItems: 'center', gap: '10px',
            }}>
            <div style={{ width: '36px', height: '36px', background: '#EBF2FC', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Lock size={18} color="#1A57A1" />
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#86868b', lineHeight: 1 }}>{isAr ? 'تشفير' : 'Encryption'}</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#1d1d1f', marginTop: '3px' }}>{isAr ? 'بنكي 256-bit' : '256-bit Bank'}</div>
            </div>
          </motion.div>

        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          style={{
            display: 'flex', justifyContent: 'center', gap: '48px',
            marginTop: '64px', flexWrap: 'wrap',
          }}>
          {[
            { v: '5% / 3%', l: isAr ? 'أفراد / تجار' : 'Ind. / Business' },
            { v: '3+',      l: isAr ? 'شركاء استراتيجيون' : 'Strategic Partners' },
            { v: '100%',    l: isAr ? 'حماية مضمونة' : 'Guaranteed Protection' },
            { v: '24/7',    l: isAr ? 'دعم فني' : 'Technical Support' },
          ].map(({ v, l }) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: 900, color: '#1d1d1f', letterSpacing: '-0.02em' }}>{v}</div>
              <div style={{ fontSize: '13px', color: '#86868b', marginTop: '4px' }}>{l}</div>
            </div>
          ))}
        </motion.div>

      </div>

      {/* Scroll cue */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: '48px', color: '#86868b', fontSize: '12px' }}>
        <span>{t('scrollMore')}</span>
        <ChevronDown size={14} style={{ animation: 'gentle-float 2s ease-in-out infinite' }} />
      </div>
    </section>
  );
}
