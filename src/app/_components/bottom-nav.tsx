'use client';

import { Home, LayoutGrid, Package, ShieldCheck, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const items = [
  { href: '/', label: 'الرئيسية', icon: Home, match: (p: string) => p === '/' },
  { href: '/categories', label: 'التصنيفات', icon: LayoutGrid, match: (p: string) => p.startsWith('/categor') },
  { href: '/protected-deal', label: 'اضمن', icon: ShieldCheck, match: (p: string) => p.startsWith('/protected-deal') || p.startsWith('/account/deals'), accent: true },
  { href: '/account/orders', label: 'طلباتي', icon: Package, match: (p: string) => p.startsWith('/account/orders') },
  { href: '/account', label: 'حسابي', icon: User, match: (p: string) => p === '/account' || (p.startsWith('/account') && !p.startsWith('/account/orders') && !p.startsWith('/account/deals')) },
];

/** Mobile bottom navigation (hidden on desktop). */
export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="التنقل السفلي">
      <ul className="grid grid-cols-5">
        {items.map((it) => {
          const active = it.match(path);
          const Icon = it.icon;
          return (
            <li key={it.href}>
              <Link href={it.href} aria-current={active ? 'page' : undefined} className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active ? 'text-brand-700' : 'text-muted')}>
                {it.accent ? (
                  <span className={cn('-mt-5 grid size-11 place-items-center rounded-full border-4 border-white shadow-md', active ? 'bg-accent-700' : 'bg-accent-600')}>
                    <Icon className="size-5 text-white" aria-hidden />
                  </span>
                ) : (
                  <Icon className="size-5" aria-hidden />
                )}
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
