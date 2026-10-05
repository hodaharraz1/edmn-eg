import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-page disabled:text-muted aria-[invalid=true]:border-red-500';

export function Field({ label, htmlFor, hint, error, required, children, className }: { label?: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string | string[]; required?: boolean; children: ReactNode; className?: string }) {
  const err = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
          {label}
          {required && <span className="text-red-700" aria-hidden> *</span>}
        </label>
      )}
      {children}
      {err ? (
        <p className="text-xs text-red-700" role="alert" id={htmlFor ? `${htmlFor}-error` : undefined}>
          {err}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-10', className)} {...props} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  return <textarea rows={rows} className={cn(control, 'py-2 leading-relaxed', className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(control, 'h-10 pe-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<'input'> & { label: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2 text-sm', className)}>
      <input type="checkbox" className="mt-1 size-4 rounded border-line accent-brand-700" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function Radio({ label, description, className, ...props }: ComponentProps<'input'> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-white p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50', className)}>
      <input type="radio" className="mt-1 size-4 accent-brand-700" {...props} />
      <span>
        <span className="block font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Accessible switch built on a native checkbox (works without JavaScript). */
export function Switch({ label, className, ...props }: ComponentProps<'input'> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-3 text-sm', className)}>
      <span className="relative inline-flex">
        <input type="checkbox" role="switch" className="peer sr-only" {...props} />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-300" />
        <span className="absolute top-0.5 start-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:-translate-x-5 ltr:peer-checked:translate-x-5" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function FormSection({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('card p-5 sm:p-6', className)}>
      <header className="mb-4">
        <h2 className="text-base font-bold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
