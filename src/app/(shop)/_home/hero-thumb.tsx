'use client';

import { ImageOff } from 'lucide-react';
import { useState } from 'react';

/** Product image inside the hero mockup: falls back to a neutral tile if the stored file is missing. */
export function HeroThumb({ src, className }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className={`grid place-items-center bg-slate-100 text-slate-400 ${className ?? ''}`}>
        <ImageOff className="size-5" aria-hidden />
      </span>
    );
  }
  return <img src={src} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} className={`object-contain ${className ?? ''}`} />;
}
