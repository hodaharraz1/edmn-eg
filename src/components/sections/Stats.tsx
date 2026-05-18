'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';

export default function Stats() {
  const t    = useTranslations('stats');
  const keys = ['s1','s2','s3','s4'] as const;

  return (
    <section className="section-lg bg-dark-section">
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '2px' }}>
          {keys.map((key, i) => (
            <motion.div key={key}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.08, type: 'tween' }}
              style={{ textAlign: 'center', padding: '40px 24px', borderInlineEnd: i < keys.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
              <div style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 900, color: 'white', letterSpacing: '-0.03em', marginBottom: '10px', lineHeight: 1 }}>
                {t(`${key}Value` as any)}
              </div>
              <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>
                {t(`${key}Label` as any)}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
