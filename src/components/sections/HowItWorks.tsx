'use client';

import { useTranslations, useLocale } from 'next-intl';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { HandshakeIcon, ShieldCheck, PackageCheck, Banknote } from 'lucide-react';

const icons  = [HandshakeIcon, ShieldCheck, PackageCheck, Banknote];
const colors = ['#1A57A1','#F0171A','#16A34A','#D97706'];
const keys   = ['s1','s2','s3','s4'] as const;

export default function HowItWorks() {
  const t    = useTranslations('howItWorks');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const getHref = (h: string) => isAr ? h : `/en${h}`;

  return (
    <section className="section-xl" style={{ background: 'white' }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: '80px' }}>
          <div className="chip-blue" style={{ display: 'inline-flex', marginBottom: '20px' }}>{t('tag')}</div>
          <h2 className="text-display-md" style={{ color: '#1d1d1f', marginBottom: '16px' }}>{t('title')}</h2>
          <p className="text-body-xl" style={{ color: '#6e6e73', maxWidth: '520px', margin: '0 auto' }}>{t('subtitle')}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '24px', position: 'relative' }}>
          {keys.map((key, i) => {
            const Icon = icons[i];
            return (
              <motion.div key={key}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.5, delay: i * 0.1, type: 'tween' }}
                style={{ textAlign: 'center', position: 'relative' }}>

                {/* Connector line */}
                {i < keys.length - 1 && (
                  <div style={{
                    position: 'absolute', top: '28px',
                    [isAr ? 'left' : 'right']: '-12px',
                    width: '24px', height: '1px',
                    background: 'linear-gradient(90deg, rgba(0,0,0,0.15), transparent)',
                    display: 'none',
                  }} className="hidden lg:block" />
                )}

                {/* Step number */}
                <div style={{
                  width: '56px', height: '56px', borderRadius: '18px', margin: '0 auto 20px',
                  background: `${colors[i]}12`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative',
                }}>
                  <Icon size={26} color={colors[i]} />
                  <div style={{
                    position: 'absolute', top: '-6px', insetInlineEnd: '-6px',
                    width: '22px', height: '22px', borderRadius: '50%',
                    background: colors[i], color: 'white',
                    fontSize: '11px', fontWeight: 900,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: `0 2px 8px ${colors[i]}40`,
                  }}>
                    {i + 1}
                  </div>
                </div>

                <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#1d1d1f', marginBottom: '10px' }}>
                  {t(`${key}Title` as any)}
                </h3>
                <p style={{ fontSize: '14px', color: '#6e6e73', lineHeight: 1.65 }}>
                  {t(`${key}Desc` as any)}
                </p>
              </motion.div>
            );
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: '56px' }}>
          <Link href={getHref('/how-it-works')} className="btn btn-md btn-ghost-blue">
            {t('cta')} →
          </Link>
        </div>
      </div>
    </section>
  );
}
