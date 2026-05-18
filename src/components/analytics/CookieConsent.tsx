'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Cookie, X } from 'lucide-react';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('edmn-cookie-consent');
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    localStorage.setItem('edmn-cookie-consent', 'accepted');
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem('edmn-cookie-consent', 'declined');
    setVisible(false);
  };

  return (
    <div
      className={cn(
        'cookie-banner',
        visible && 'visible',
      )}
      role="dialog"
      aria-label="إشعار ملفات تعريف الارتباط"
    >
      <div className="flex items-start gap-3 mb-4">
        <Cookie size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-gray-300 leading-relaxed">
          نستخدم ملفات تعريف الارتباط لتحسين تجربتك. باستمرارك في استخدام الموقع، فأنت توافق على سياسة الخصوصية.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={accept}
          className="flex-1 py-2 px-4 bg-[#1A57A1] text-white rounded-lg text-sm font-bold hover:bg-[#164A8A] transition-colors"
        >
          أقبل
        </button>
        <button
          onClick={decline}
          className="flex-1 py-2 px-4 bg-white/10 text-gray-300 rounded-lg text-sm font-bold hover:bg-white/20 transition-colors"
        >
          أرفض
        </button>
      </div>
    </div>
  );
}
