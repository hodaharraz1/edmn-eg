'use client';

import { Package } from 'lucide-react';
import { useState } from 'react';

/** Product image that degrades to a quiet neutral tile when the file is missing (never a broken-image icon). */
export function SafeImg({ src, alt = '', className, eager }: { src: string | null; alt?: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span role={alt ? 'img' : undefined} aria-label={alt || undefined} className={`grid place-items-center bg-gradient-to-b from-slate-50 to-slate-100 text-slate-300 ${className ?? ''}`}>
        <Package className="size-1/4 min-h-5 min-w-5" strokeWidth={1.25} aria-hidden />
      </span>
    );
  }
  return <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} className={`object-contain ${className ?? ''}`} />;
}
