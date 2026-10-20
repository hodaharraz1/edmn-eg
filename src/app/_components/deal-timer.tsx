'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/cn';

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60) };
}
const fmt = ({ d, h, m }: { d: number; h: number; m: number }) => [d ? `${d} يوم` : null, `${h} ساعة`, `${m} دقيقة`].filter(Boolean).join(' و');

/**
 * Countdown against an AUTHORITATIVE server deadline. The client clock is corrected by the server time at
 * render, so a wrong device clock cannot shift the deadline. Display only: reaching zero never moves money and
 * never changes the deal — the server applies its own rules.
 */
export function DealTimer({ deadline, serverNow, label, overdueLabel, actions, testid }: { deadline: string; serverNow: string; label: string; overdueLabel: string; actions?: { href: string; label: string }[]; testid: string }) {
  const [skew] = useState(() => new Date(serverNow).getTime() - Date.now());
  const [now, setNow] = useState(() => new Date(serverNow).getTime());
  useEffect(() => {
    const tick = () => setNow(Date.now() + skew);
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [skew]);
  const left = new Date(deadline).getTime() - now;
  const overdue = left <= 0;
  return (
    <section className={cn('card flex flex-wrap items-center justify-between gap-3 p-4', overdue ? 'border-red-200 bg-red-50' : 'border-brand-200')} data-testid={testid} data-overdue={overdue ? '1' : '0'} role="timer" aria-live="off">
      <div className="flex items-center gap-2">
        <Clock className={cn('size-5', overdue ? 'text-red-700' : 'text-brand-700')} aria-hidden />
        <div>
          <p className="font-semibold">{overdue ? overdueLabel : label}</p>
          <p className="text-sm tabular-nums">{overdue ? `منذ ${fmt(parts(-left))}` : fmt(parts(left))}</p>
          <p className="text-xs text-muted">الموعد: {new Date(deadline).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })} · العداد للتنبيه فقط ولا يحوّل أي مبلغ تلقائيًا.</p>
        </div>
      </div>
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => <a key={a.href} href={a.href} className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50">{a.label}</a>)}
        </div>
      )}
    </section>
  );
}
