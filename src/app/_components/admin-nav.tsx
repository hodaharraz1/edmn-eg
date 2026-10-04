'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  return (
    <nav aria-label="قائمة الإدارة" className="space-y-4">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-white/40">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = it.href === '/admin' ? path === '/admin' : path === it.href || path.startsWith(it.href + '/');
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
