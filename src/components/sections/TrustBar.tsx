import { useTranslations } from 'next-intl';
import { ShieldCheck, Lock, Headphones, Building2, RotateCcw } from 'lucide-react';

const icons = [ShieldCheck, Lock, Headphones, Building2, RotateCcw];

export default function TrustBar() {
  const t = useTranslations('trust');
  const items = ['item1', 'item2', 'item3', 'item4', 'item5'] as const;

  return (
    <div className="bg-white border-b border-[#E5E7EB] py-3">
      <div className="container">
        <div className="flex items-center justify-center flex-wrap gap-x-6 gap-y-2">
          {items.map((key, i) => {
            const Icon = icons[i];
            return (
              <div key={key} className="flex items-center gap-1.5 text-[13px] font-semibold text-[#4B5563]">
                <Icon size={14} className="text-[#1A57A1] flex-shrink-0" />
                <span>{t(key)}</span>
                {i < items.length - 1 && (
                  <span className="hidden sm:block text-[#D1D5DB] ms-4">|</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
