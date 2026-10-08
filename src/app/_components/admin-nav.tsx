'use client';

import Link from '@/ui/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const isActive = (href: string) => {
    const [p, q] = href.split('?');
    if (q) return path === p && search === q;
    if (href === '/admin') return path === '/admin';
    // A plain entry is active on its own sub-pages, but not when a query entry for the same page matches.
    const sibling = groups.some((g) => g.items.some((i) => i.href.startsWith(href + '?') && i.href.split('?')[1] === search));
    return !sibling && (path === href || path.startsWith(href + '/'));
  };
  return (
    <nav aria-label="قائمة الإدارة" className="space-y-4">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-white/65">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = isActive(it.href);
              return (
                <li key={it.href}>
                  <Link href={it.href} aria-current={active ? 'page' : undefined} className={cn('flex items-center justify-between rounded-lg px-3 py-1.5 text-sm', active ? 'bg-white/15 font-semibold text-white' : 'text-white/70 hover:bg-white/10 hover:text-white')}>
                    {it.label}
                    {!!it.badge && <span className="rounded-full bg-accent-600 px-1.5 text-[11px] font-bold text-white">{it.badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
