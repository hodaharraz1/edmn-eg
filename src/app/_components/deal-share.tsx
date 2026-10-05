'use client';

import { useState } from 'react';
import { Check, Copy, MessageCircle, Share2 } from 'lucide-react';

export const inviteMessage = (url: string) => `أنشأت طلب صفقة محمية على اضمن.\nراجع تفاصيل الصفقة وسجّل بياناتك للموافقة عليها من خلال الرابط التالي:\n${url}`;

/** Share screen after the deal request is created: copy / WhatsApp / native share (copy fallback). */
export function DealShare({ url, dealRef }: { url: string; dealRef: string }) {
  const [copied, setCopied] = useState(false);
  const text = inviteMessage(url);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the link is visible and selectable */
    }
  }
  async function share() {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title: `صفقة محمية ${dealRef}`, text });
        return;
      } catch {
        /* cancelled or unsupported → fall back to copy */
      }
    }
    await copy();
  }
  const btn = 'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold sm:w-auto sm:px-5';
  return (
    <section className="card space-y-4 border-emerald-200 p-5" data-testid="deal-share">
      <div>
        <h2 className="text-lg font-bold text-emerald-800">تم إنشاء طلب الصفقة</h2>
        <p className="mt-1 text-sm">رقم الصفقة: <span className="font-bold ltr" data-testid="deal-ref">{dealRef}</span></p>
      </div>
      <p className="text-sm text-muted">ابعت الرابط ده للبائع. هيسجل بياناته ويراجع الصفقة بنفسه. الرابط يظهر هنا مرة واحدة — احتفظ به أو أنشئ رابطاً جديداً لاحقاً.</p>
      <input readOnly value={url} aria-label="رابط الدعوة" data-testid="invite-link" className="w-full rounded-lg border border-line bg-page px-3 py-2 text-xs ltr" onFocus={(e) => e.currentTarget.select()} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={copy} className={`${btn} border border-line bg-white hover:bg-page`}>
          {copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? 'تم النسخ' : 'نسخ رابط الدعوة'}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
          <MessageCircle className="size-4" aria-hidden /> مشاركة عبر WhatsApp
        </a>
        <button type="button" onClick={share} className={`${btn} bg-brand-700 text-white hover:bg-brand-800`}>
          <Share2 className="size-4" aria-hidden /> مشاركة
        </button>
      </div>
    </section>
  );
}
