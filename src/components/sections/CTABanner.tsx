'use client';

import { useTranslations, useLocale } from 'next-intl';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { UserPlus, Mail } from 'lucide-react';

export default function CTABanner() {
  const t    = useTranslations('cta');
  const locale = useLocale();
  const getHref = (h: string) => locale === 'ar' ? h : `/en${h}`;

  return (
    <section className="section-xl bg-brand-section" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Subtle radial gradient overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,255,255,0.07) 0%, transparent 70%)',
      }} aria-hidden="true" />

      <div className="container" style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, type: 'tween' }}>

          <div className="chip-dark" style={{ display: 'inline-flex', marginBottom: '24px' }}>{t('tag')}</div>

          <h2 className="text-display-md" style={{ color: 'white', marginBottom: '16px', maxWidth: '700px', margin: '0 auto 16px' }}>
            {t('title')}
          </h2>
          <p className="text-body-xl" style={{ color: 'rgba(255,255,255,0.65)', marginBottom: '40px', maxWidth: '500px', margin: '0 auto 40px' }}>
            {t('desc')}
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Link href="#" className="btn btn-lg" style={{
              background: 'white', color: '#1A57A1', fontWeight: 700,
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              borderRadius: '980px',
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '16px 36px', fontSize: '17px',
              transition: 'all 0.25s',
            }}>
              <UserPlus size={18} />
              {t('primary')}
            </Link>
            <Link href={getHref('/contact')} className="btn btn-lg btn-outline-light">
              <Mail size={18} />
              {t('secondary')}
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
