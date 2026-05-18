'use client';

import { useTranslations, useLocale } from 'next-intl';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ShieldCheck, UserPlus, PlayCircle, BadgeCheck, Lock, Star, ArrowLeft, ArrowRight } from 'lucide-react';

export default function Hero() {
  const t = useTranslations('hero');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const Arrow = isAr ? ArrowLeft : ArrowRight;

  return (
    <section
      style={{
        background: 'linear-gradient(135deg, #EBF2FC 0%, #F0F7FF 40%, #ffffff 100%)',
        paddingTop: '130px',
        paddingBottom: '80px',
        position: 'relative',
        overflow: 'hidden',
      }}
      aria-labelledby="hero-heading"
    >
      {/* Subtle grid pattern */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(#1A57A1 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }} aria-hidden="true" />

      {/* Blue glow top-right */}
      <div style={{
        position: 'absolute', top: '-100px', right: '-100px',
        width: '500px', height: '500px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(26,87,161,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} aria-hidden="true" />

      <div className="container" style={{ position: 'relative', zIndex: 1 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '60px',
          alignItems: 'center',
        }}>

          {/* ── CONTENT ── */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{ order: isAr ? 2 : 1 }}
          >
            {/* Badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '6px 16px',
              background: 'rgba(26,87,161,0.08)', border: '1px solid rgba(26,87,161,0.2)',
              borderRadius: '100px', marginBottom: '20px',
              color: '#1A57A1', fontSize: '13px', fontWeight: 700,
            }}>
              <ShieldCheck size={14} />
              {t('badge')}
            </div>

            {/* H1 */}
            <h1
              id="hero-heading"
              style={{
                fontSize: 'clamp(2.1rem, 5vw, 3.4rem)',
                fontWeight: 900,
                lineHeight: 1.15,
                color: '#0F172A',
                marginBottom: '20px',
              }}
            >
              {t('title')}{' '}
              <span style={{ color: '#F0171A' }}>{t('titleHighlight')}</span>
              <br />
              <span style={{
                background: 'linear-gradient(135deg, #1A57A1, #2B72D0)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                {t('titleEnd')}
              </span>
            </h1>

            {/* Description */}
            <p style={{
              fontSize: '17px', lineHeight: 1.75,
              color: '#475569', marginBottom: '32px', maxWidth: '480px',
            }}>
              {t('desc')}
            </p>

            {/* CTAs */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '32px' }}>
              <Link href="#" style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                padding: '14px 28px',
                background: '#F0171A',
                color: 'white', borderRadius: '12px',
                fontWeight: 700, fontSize: '15px',
                boxShadow: '0 4px 20px rgba(240,23,26,0.35)',
                textDecoration: 'none', transition: 'all 0.2s',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = '#C8141C')}
                onMouseLeave={e => (e.currentTarget.style.background = '#F0171A')}
              >
                <UserPlus size={17} />
                {t('cta')}
              </Link>
              <Link href={isAr ? '/how-it-works' : '/en/how-it-works'} style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                padding: '14px 28px',
                background: 'white', color: '#1A57A1',
                border: '2px solid #1A57A1', borderRadius: '12px',
                fontWeight: 700, fontSize: '15px',
                textDecoration: 'none', transition: 'all 0.2s',
              }}>
                <PlayCircle size={17} />
                {t('ctaSecondary')}
              </Link>
            </div>

            {/* App Badges */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '32px', flexWrap: 'wrap' }}>
              {[
                { icon: '🍎', label: 'App Store', sub: isAr ? 'متاح على' : 'Available on' },
                { icon: '▶', label: 'Google Play', sub: isAr ? 'حمّل من' : 'Get it on' },
              ].map(({ icon, label, sub }) => (
                <Link key={label} href="#" style={{
                  display: 'inline-flex', alignItems: 'center', gap: '10px',
                  padding: '10px 18px',
                  background: '#1F2937', color: 'white',
                  borderRadius: '12px', textDecoration: 'none',
                  minWidth: '145px', transition: 'background 0.2s',
                }}>
                  <span style={{ fontSize: '20px' }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: '10px', color: '#9CA3AF', lineHeight: 1 }}>{sub}</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px' }}>{label}</div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Stats Row */}
            <div style={{
              display: 'flex', gap: '28px',
              paddingTop: '20px', borderTop: '1px solid #E2E8F0',
            }}>
              {[
                { v: '5% / 3%', l: isAr ? 'أفراد / تجار' : 'Ind. / Business' },
                { v: '3+', l: isAr ? 'شركاء' : 'Partners' },
                { v: '100%', l: isAr ? 'حماية' : 'Protection' },
              ].map(({ v, l }) => (
                <div key={l}>
                  <div style={{ fontSize: '20px', fontWeight: 900, color: '#1A57A1' }}>{v}</div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>{l}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── VISUAL ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
            style={{
              order: isAr ? 1 : 2,
              display: 'flex', justifyContent: 'center', alignItems: 'center',
            }}
          >
            {/* Card-based visual instead of phone mockup */}
            <div style={{ position: 'relative', width: '340px', maxWidth: '100%' }}>

              {/* Main card */}
              <div style={{
                background: 'white',
                borderRadius: '24px',
                padding: '28px',
                boxShadow: '0 20px 60px rgba(26,87,161,0.15)',
                border: '1px solid rgba(26,87,161,0.08)',
              }}>
                {/* Card header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div>
                    <div style={{ fontSize: '13px', color: '#64748B' }}>{isAr ? 'رصيد الضمان' : 'Escrow Balance'}</div>
                    <div style={{ fontSize: '28px', fontWeight: 900, color: '#0F172A' }}>5,000 ج</div>
                  </div>
                  <div style={{
                    width: '48px', height: '48px',
                    background: 'linear-gradient(135deg, #1A57A1, #2B72D0)',
                    borderRadius: '16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Lock size={22} color="white" />
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748B', marginBottom: '8px' }}>
                    <span>{isAr ? 'تقدم الصفقة' : 'Deal Progress'}</span>
                    <span style={{ color: '#1A57A1', fontWeight: 700 }}>75%</span>
                  </div>
                  <div style={{ height: '8px', background: '#F1F5F9', borderRadius: '100px', overflow: 'hidden' }}>
                    <div style={{
                      width: '75%', height: '100%',
                      background: 'linear-gradient(90deg, #1A57A1, #2B72D0)',
                      borderRadius: '100px',
                    }} />
                  </div>
                </div>

                {/* Steps */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {[
                    { label: isAr ? 'الاتفاق على الشروط' : 'Agreement', state: 'done' },
                    { label: isAr ? 'إيداع المبلغ' : 'Deposit Funds', state: 'done' },
                    { label: isAr ? 'التسليم والاستلام' : 'Delivery', state: 'active' },
                    { label: isAr ? 'تحويل للبائع' : 'Release to Seller', state: 'pending' },
                  ].map(({ label, state }, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', fontWeight: 800,
                        background: state === 'done' ? '#DCFCE7' : state === 'active' ? '#EBF2FC' : '#F8FAFC',
                        color: state === 'done' ? '#16A34A' : state === 'active' ? '#1A57A1' : '#94A3B8',
                        border: state === 'active' ? '2px solid #1A57A1' : '2px solid transparent',
                      }}>
                        {state === 'done' ? '✓' : i + 1}
                      </div>
                      <span style={{
                        fontSize: '13px', fontWeight: state === 'active' ? 700 : 500,
                        color: state === 'done' ? '#16A34A' : state === 'active' ? '#1A57A1' : '#94A3B8',
                        textDecoration: state === 'done' ? 'line-through' : 'none',
                      }}>
                        {label}
                      </span>
                      {state === 'active' && (
                        <div style={{
                          marginRight: 'auto', marginLeft: 'auto',
                          fontSize: '10px', background: '#EBF2FC',
                          color: '#1A57A1', padding: '2px 8px',
                          borderRadius: '100px', fontWeight: 700,
                        }}>
                          {isAr ? 'جاري' : 'Active'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Action button */}
                <button style={{
                  width: '100%', marginTop: '20px',
                  padding: '13px', background: '#F0171A',
                  color: 'white', borderRadius: '12px',
                  fontWeight: 700, fontSize: '14px',
                  border: 'none', cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(240,23,26,0.3)',
                }}>
                  {isAr ? '✓ تأكيد الاستلام' : '✓ Confirm Receipt'}
                </button>
              </div>

              {/* Floating badge 1 */}
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute', top: '-16px',
                  [isAr ? 'left' : 'right']: '-16px',
                  background: 'white', borderRadius: '16px',
                  padding: '10px 14px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                  border: '1px solid #F0FDF4',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}
              >
                <div style={{
                  width: '32px', height: '32px', background: '#DCFCE7',
                  borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ShieldCheck size={16} color="#16A34A" />
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: '#64748B' }}>{isAr ? 'أموالك' : 'Your funds'}</div>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#0F172A' }}>
                    {isAr ? '100% محمية' : '100% Protected'}
                  </div>
                </div>
              </motion.div>

              {/* Floating badge 2 */}
              <motion.div
                animate={{ y: [0, 6, 0] }}
                transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                style={{
                  position: 'absolute', bottom: '-16px',
                  [isAr ? 'right' : 'left']: '-16px',
                  background: 'white', borderRadius: '16px',
                  padding: '10px 14px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                  border: '1px solid #EFF6FF',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}
              >
                <div style={{
                  width: '32px', height: '32px', background: '#EBF2FC',
                  borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <BadgeCheck size={16} color="#1A57A1" />
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: '#64748B' }}>{isAr ? 'تشفير' : 'Encryption'}</div>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#0F172A' }}>
                    {isAr ? 'بنكي آمن' : 'Bank-Grade'}
                  </div>
                </div>
              </motion.div>

            </div>
          </motion.div>

        </div>
      </div>
    </section>
  );
}
