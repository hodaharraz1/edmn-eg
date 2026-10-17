'use client';

import { Home, LayoutGrid, Package, ShieldCheck, User } from 'lucide-react';
import Link from '@/ui/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/**
 * Mobile bottom navigation (hidden on desktop), thumb-reachable: الرئيسية · التصنيفات · الضمان · طلباتي · حسابي.
 * «الضمان» (protected deals) keeps the emphasised centre position. Messages and notifications live in the
 * header with live badges on every page; search is the near-full-width field under the header.
 */
const items = [
  { href: '/', label: 'الرئيسية', icon: Home, match: (p: string) => p === '/' },
  { href: '/categories', label: 'التصنيفات', icon: LayoutGrid, match: (p: string) => p.startsWith('/categories') || p.startsWith('/category/') },
  { href: '/protected-deal', label: 'الضمان', icon: ShieldCheck, match: (p: string) => p.startsWith('/protected-deal') || p.startsWith('/account/deals'), accent: true },
  { href: '/account/orders', label: 'طلباتي', icon: Package, match: (p: string) => p.startsWith('/account/orders') },
  {
    href: '/account',
    label: 'حسابي',
    icon: User,
    match: (p: string) => p === '/account' || (p.startsWith('/account') && !['/account/orders', '/account/deals'].some((x) => p.startsWith(x))),
  },
];

export function BottomNav(_: { signedIn?: boolean; unreadMessages?: number }) {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-18px_rgb(6_26_61/0.4)] backdrop-blur lg:hidden" aria-label="التنقل السفلي" data-testid="bottom-nav">
      <ul className="grid grid-cols-5">
        {items.map((it) => {
          const active = it.match(path);
          const Icon = it.icon;
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={cn('relative flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]', active ? 'font-bold text-brand-700' : 'font-medium text-muted')}
              >
                {active && !it.accent && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-600" aria-hidden />}
                {it.accent ? (
                  <span className={cn('-mt-5 grid size-12 place-items-center rounded-full border-4 border-white bg-gradient-to-b from-brand-500 to-brand-800 shadow-[0_8px_18px_-6px_rgb(20_82_179/0.8)]', active && 'from-brand-600 to-brand-950')}>
                    <Icon className="size-5 text-white" aria-hidden />
                  </span>
                ) : (
                  <Icon className="size-5" aria-hidden />
                )}
                <span>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
