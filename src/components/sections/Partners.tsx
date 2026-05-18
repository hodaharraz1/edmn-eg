'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import Image from 'next/image';

const partners = [
  { nameAr: 'بنك مصر',  nameEn: 'Banque Misr', logo: '/partners/banque-misr.jpg' },
  { nameAr: 'فوري',     nameEn: 'Fawry',        logo: '/partners/fawry.jpg' },
  { nameAr: 'ValU',     nameEn: 'ValU',          logo: '/partners/valu.png' },
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

        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap' }}>
          {partners.map(({ nameAr, nameEn, logo }, i) => (
            <motion.div key={nameAr}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.1, type: 'tween' }}
              style={{
                background: '#f5f5f7', borderRadius: '20px',
                padding: '28px 40px',
                border: '1px solid rgba(0,0,0,0.05)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px',
                flex: '1 1 180px', maxWidth: '240px', minWidth: '180px',
                transition: 'all 0.3s ease',
              }}
              whileHover={{ y: -4, boxShadow: '0 12px 40px rgba(0,0,0,0.08)', backgroundColor: 'white' }}>
              <div style={{
                width: '80px', height: '48px', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Image
                  src={logo}
                  alt={nameAr}
                  fill
                  style={{ objectFit: 'contain' }}
                />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#1d1d1f' }}>{nameAr}</div>
                <div style={{ fontSize: '12px', color: '#86868b', marginTop: '2px' }}>{nameEn}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
