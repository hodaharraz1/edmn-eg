import { useTranslations } from 'next-intl';
import { ShieldCheck, Lock, Headphones, Building2, RotateCcw } from 'lucide-react';

const icons = [ShieldCheck, Lock, Headphones, Building2, RotateCcw];
const keys  = ['item1','item2','item3','item4','item5'] as const;

export default function TrustBar() {
  const t = useTranslations('trust');
  return (
    <div style={{ background: 'white', borderTop: '1px solid rgba(0,0,0,0.06)', borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '18px 0' }}>
      <div className="container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '0' }}>
          {keys.map((key, i) => {
            const Icon = icons[i];
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 24px', borderInlineEnd: i < keys.length - 1 ? '1px solid rgba(0,0,0,0.08)' : 'none' }}>
                <Icon size={14} color="#1A57A1" />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#3a3a3c', whiteSpace: 'nowrap' }}>{t(key)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
