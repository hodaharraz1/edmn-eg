import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from '@/ui/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function PageHeader({ title, description, actions, breadcrumbs, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 space-y-2', className)}>
      {breadcrumbs}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="مسار التنقل" className="text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {it.href ? (
              <Link href={it.href} className="hover:text-brand-700 hover:underline">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {it.label}
              </span>
            )}
            {i < items.length - 1 && <ChevronLeft className="size-3 rtl:rotate-0 ltr:rotate-180" aria-hidden />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, empty, className }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode; className?: string }) {
  if (!rows.length) return <>{empty ?? <p className="p-6 text-center text-sm text-muted">مفيش بيانات</p>}</>;
  return (
    <div className={cn('card rtable overflow-x-auto', className)}>
      <table className="w-full text-sm md:min-w-[640px]">
        <thead className="border-b border-line bg-page/60 text-xs text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-4 py-3 text-start font-semibold', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-page/50">
              {columns.map((c) => (
                <td key={c.key} data-label={typeof c.header === 'string' && c.header ? c.header : undefined} className={cn('px-4 py-3 align-middle', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Link-based pagination (works without JS, SEO-friendly). */
export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (p: number) => string }) {
  if (pages <= 1) return null;
  const nums = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const list = [...nums].sort((a, b) => a - b);
  return (
    <nav aria-label="ترقيم الصفحات" className="mt-6 flex items-center justify-center gap-1">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className="grid size-9 place-items-center rounded-lg border border-line bg-white hover:bg-page" aria-label="السابق">
          <ChevronRight className="size-4 ltr:rotate-180" />
        </Link>
      )}
      {list.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && list[i - 1] !== n - 1 && <span className="px-1 text-muted">…</span>}
          <Link
            href={hrefFor(n)}
            aria-current={n === page ? 'page' : undefined}
            className={cn('grid size-9 place-items-center rounded-lg border text-sm', n === page ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white hover:bg-page')}
          >
            {n}
          </Link>
        </span>
      ))}
      {page < pages && (
        <Link href={hrefFor(page + 1)} className="grid size-9 place-items-center rounded-lg border border-line bg-white hover:bg-page" aria-label="التالي">
          <ChevronLeft className="size-4 ltr:rotate-180" />
        </Link>
      )}
    </nav>
  );
}

/** Link-based tabs (each tab is a URL — shareable and accessible). */
export function Tabs({ tabs, active, className }: { tabs: { key: string; label: ReactNode; href: string; count?: number }[]; active: string; className?: string }) {
  return (
    <div className={cn('scrollbar-none -mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1', className)} role="tablist">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          role="tab"
          aria-selected={t.key === active}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium',
            t.key === active ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-page px-1.5 text-xs text-muted">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'brand', href }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral'; href?: string }) {
  const tones = { brand: 'bg-brand-50 text-brand-700', success: 'bg-emerald-50 text-emerald-700', warning: 'bg-amber-50 text-amber-700', danger: 'bg-red-50 text-red-700', neutral: 'bg-slate-100 text-slate-700' };
  const body = (
    <div className="card flex h-full items-start gap-3 p-4">
      {icon && <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', tones[tone])}>{icon}</span>}
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="mt-0.5 truncate text-lg font-bold">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-transform hover:-translate-y-0.5">
      {body}
    </Link>
  ) : (
    body
  );
}

export function DefinitionList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2', className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words font-medium">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Lightweight bar chart rendered as accessible SVG-free HTML (no chart library). */
export function BarChart({ data, format, height = 160 }: { data: { label: string; value: number }[]; format: (v: number) => string; height?: number }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">مفيش بيانات للفترة دي</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }} role="img" aria-label="رسم بياني للمبيعات">
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 items-end">
            <div className="w-full rounded-t bg-brand-500/80 transition-colors group-hover:bg-brand-700" style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
            <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-white group-hover:block">{format(d.value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted" dir="ltr">
        <span>{data[0].label}</span>
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

export function Timeline({ items }: { items: { title: ReactNode; time?: ReactNode; body?: ReactNode; done?: boolean }[] }) {
  return (
    <ol className="relative space-y-4 border-s-2 border-line ps-5">
      {items.map((it, i) => (
        <li key={i} className="relative">
          <span className={cn('absolute -start-[27px] top-1 size-3 rounded-full ring-4 ring-white', it.done === false ? 'bg-slate-300' : 'bg-brand-600')} />
          <p className="text-sm font-semibold">{it.title}</p>
          {it.time && <p className="text-xs text-muted">{it.time}</p>}
          {it.body && <div className="mt-1 text-sm text-muted">{it.body}</div>}
        </li>
      ))}
    </ol>
  );
}
