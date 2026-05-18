'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { UserPlus } from 'lucide-react';

export default function MobileCTA() {
  const t = useTranslations('cta');
  return (
    <div className="mobile-cta gap-3" aria-label="Call to Action">
      <Link
        href="#"
        className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#F0171A] text-white rounded-xl font-bold text-sm shadow-[0_4px_14px_rgba(240,23,26,.3)] hover:bg-[#C8141C] transition-all active:scale-95"
        aria-label="سجل الآن مجاناً"
      >
        <UserPlus size={16} />
        {t('primary')}
      </Link>
    </div>
  );
}
