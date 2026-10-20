import { BadgeCheck, Landmark, PackageCheck, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import Link from '@/ui/link';
import { cn } from '@/lib/cn';

/**
 * EDMN protection module (the platform's main differentiator), in the hero's visual language: deep navy,
 * blue shield, green "protected" state. Describes the real marketplace flow: payment to EDMN → delivery and
 * inspection → release to the seller only after confirmation (or the objection window) and admin approval.
 */
export function ProtectionPanel({ title = 'شراء محمي بواسطة اضمن', children, termsHref = '/legal/buyer-terms', compact, className }: { title?: string; children?: ReactNode; termsHref?: string; compact?: boolean; className?: string }) {
  return (
    <section aria-label={title} className={cn('relative isolate overflow-hidden rounded-2xl bg-brand-950 p-5 text-white shadow-[var(--shadow-pop)]', className)}>
      <div aria-hidden className="absolute -left-10 -top-10 -z-10 size-48 rounded-full bg-brand-500/30 blur-3xl" />
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 shadow-[0_8px_20px_-6px_rgb(59_130_246/0.8)] ring-1 ring-white/20">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-white/80">{children ?? 'يظل المبلغ محميًا لدى اضمن حتى استلام المنتج وتأكيد الاستلام وفق شروط الصفقة.'}</p>
        </div>
      </div>
      {!compact && (
        <ol className="mt-4 grid gap-2 sm:grid-cols-3">
          {[
            { icon: Landmark, text: 'تدفع لحساب اضمن' },
            { icon: PackageCheck, text: 'تستلم المنتج وتفحصه' },
            { icon: BadgeCheck, text: 'يتحول للبائع بعد التأكيد' },
          ].map((s, i) => (
            <li key={s.text} className="flex items-center gap-2 rounded-xl bg-white/[0.07] px-3 py-2.5 text-xs font-semibold ring-1 ring-white/10">
              <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', i === 0 ? 'bg-emerald-500' : 'bg-brand-500')}>
                <s.icon className="size-4" aria-hidden />
              </span>
              {s.text}
            </li>
          ))}
        </ol>
      )}
      <Link href={termsHref} className="mt-3 inline-flex min-h-10 items-center text-xs font-semibold text-sky-300 underline-offset-4 hover:text-white hover:underline">
        شروط الحماية والإرجاع والنزاعات
      </Link>
    </section>
  );
}

/** Slim reassurance line (cart, order summaries). */
export function ProtectionNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs leading-6 text-emerald-900 ring-1 ring-emerald-100', className)}>
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
