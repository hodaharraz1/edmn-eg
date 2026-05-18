'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Truck, CreditCard, Headphones, Zap, Percent, ShieldCheck } from 'lucide-react';

const icons  = [Truck, CreditCard, Headphones, Zap, Percent, ShieldCheck];
const colors = ['#1A57A1','#F0171A','#16A34A','#D97706','#7C3AED','#0891B2'];
const keys   = ['f1','f2','f3','f4','f5','f6'] as const;

export default function Features() {
  const t = useTranslations('features');
  return (
    <section className="section-lg" style={{ background: '#f5f5f7' }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: '64px' }}>
          <div className="chip-blue" style={{ display: 'inline-flex', marginBottom: '20px' }}>{t('tag')}</div>
          <h2 className="text-display-md" style={{ color: '#1d1d1f', marginBottom: '16px' }}>{t('title')}</h2>
          <p className="text-body-xl" style={{ color: '#6e6e73', maxWidth: '560px', margin: '0 auto' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {keys.map((key, i) => {
            const Icon = icons[i];
            return (
              <motion.div key={key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, delay: i * 0.07, type: 'tween' }}
                className="card-premium"
                style={{ padding: '32px' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '14px', marginBottom: '20px',
                  background: `${colors[i]}14`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={22} color={colors[i]} />
                </div>
                <h3 className="text-headline" style={{ color: '#1d1d1f', marginBottom: '10px', fontSize: '18px' }}>
                  {t(`${key}Title` as any)}
                </h3>
                <p className="text-body" style={{ color: '#6e6e73' }}>
                  {t(`${key}Desc` as any)}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
