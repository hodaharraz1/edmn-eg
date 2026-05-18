'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Users, ShieldCheck, Percent, Headphones } from 'lucide-react';

const icons = [Users, ShieldCheck, Percent, Headphones];
const accents = ['text-yellow-300', 'text-green-300', 'text-blue-200', 'text-pink-300'];

export default function Stats() {
  const t = useTranslations('stats');
  const statKeys = ['s1', 's2', 's3', 's4'] as const;

  return (
    <section className="py-14 bg-gradient-to-br from-[#1A57A1] to-[#0E3A72]" aria-label="إحصائيات إضمن">
      <div className="container">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-10">
          {statKeys.map((key, i) => {
            const Icon = icons[i];
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08, type: 'tween' }}
                className="text-center text-white"
              >
                <div className={`inline-flex items-center justify-center w-12 h-12
                                 bg-white/10 rounded-2xl mb-3`}>
                  <Icon size={24} className={accents[i]} />
                </div>
                <div className="text-3xl lg:text-4xl font-extrabold mb-1">
                  {t(`${key}Value` as Parameters<typeof t>[0])}
                </div>
                <div className="text-sm text-blue-200 leading-snug">
                  {t(`${key}Label` as Parameters<typeof t>[0])}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
