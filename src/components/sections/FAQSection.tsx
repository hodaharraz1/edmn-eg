'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { Plus, Minus } from 'lucide-react';

const keys = ['1','2','3','4','5','6'] as const;

export default function FAQSection() {
  const t    = useTranslations('faqSection');
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>('1');
  const getHref = (h: string) => locale === 'ar' ? h : `/en${h}`;

  return (
    <section className="section-xl" style={{ background: '#f5f5f7' }}>
      <div className="container-tight">
        <div style={{ textAlign: 'center', marginBottom: '64px' }}>
          <div className="chip-blue" style={{ display: 'inline-flex', marginBottom: '20px' }}>{t('tag')}</div>
          <h2 className="text-display-md" style={{ color: '#1d1d1f', marginBottom: '16px' }}>{t('title')}</h2>
          <p className="text-body-xl" style={{ color: '#6e6e73' }}>{t('subtitle')}</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {keys.map((key) => {
            const isOpen = open === key;
            return (
              <div key={key}
                data-open={isOpen}
                style={{
                  background: 'white', borderRadius: '16px',
                  border: `1px solid ${isOpen ? 'rgba(26,87,161,0.2)' : 'rgba(0,0,0,0.05)'}`,
                  overflow: 'hidden', transition: 'border-color 0.2s',
                }}>
                <button
                  onClick={() => setOpen(isOpen ? null : key)}
                  style={{
                    width: '100%', padding: '22px 24px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
                    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    textAlign: 'start',
                  }}
                  aria-expanded={isOpen}>
                  <span style={{ fontSize: '16px', fontWeight: isOpen ? 700 : 500, color: isOpen ? '#1d1d1f' : '#3a3a3c', lineHeight: 1.4 }}>
                    {t(`q${key}` as any)}
                  </span>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                    background: isOpen ? '#1A57A1' : 'rgba(0,0,0,0.05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}>
                    {isOpen ? <Minus size={13} color="white" /> : <Plus size={13} color="#86868b" />}
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.4,0,0.2,1] }}
                      style={{ overflow: 'hidden' }}>
                      <p style={{ padding: '0 24px 22px', fontSize: '15px', color: '#6e6e73', lineHeight: 1.7 }}>
                        {t(`a${key}` as any)}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: '40px' }}>
          <Link href={getHref('/faq')} className="btn btn-md btn-outline-dark">
            {t('viewAll')} →
          </Link>
        </div>
      </div>
    </section>
  );
}
