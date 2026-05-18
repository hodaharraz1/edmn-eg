'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';

const partners = [
  { nameAr: 'بنك مصر',  nameEn: 'Banque Misr', emoji: '🏦' },
  { nameAr: 'فوري',     nameEn: 'Fawry',        emoji: '💳' },
  { nameAr: 'ValU',     nameEn: 'ValU',          emoji: '💎' },
];

export default function Partners() {
  const t = useTranslations('partners');
  return (
    <section className="section-md" style={{ background: 'white' }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <p className="text-eyebrow" style={{ color: '#86868b', marginBottom: '12px' }}>{t('tag')}</p>
          <h2 className="text-display-md" style={{ color: '#1d1d1f', marginBottom: '12px' }}>{t('title')}</h2>
          <p className="text-body-lg" style={{ color: '#6e6e73', maxWidth: '480px', margin: '0 auto' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {partners.map(({ nameAr, nameEn, emoji }, i) => (
            <motion.div key={nameAr}
              initial={{ opacity: 0, scale: 0.96 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.1, type: 'tween' }}
              style={{
                background: '#f5f5f7', borderRadius: '20px',
                padding: '32px 48px', textAlign: 'center',
                border: '1px solid rgba(0,0,0,0.05)',
                transition: 'all 0.3s ease', cursor: 'default',
                minWidth: '200px', flex: '1 1 180px', maxWidth: '280px',
              }}
              whileHover={{ y: -4, boxShadow: '0 12px 40px rgba(0,0,0,0.08)', backgroundColor: 'white' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>{emoji}</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#1d1d1f' }}>{nameAr}</div>
              <div style={{ fontSize: '13px', color: '#86868b', marginTop: '4px' }}>{nameEn}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
