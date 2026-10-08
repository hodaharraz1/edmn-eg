'use client';

import { Home, MessageSquareText, Package, ShieldCheck, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { messagesLabel, useCount } from './live/live-provider';

/**
 * Mobile bottom navigation (hidden on desktop): the high-frequency destinations. Categories and search stay
 * one tap away in the header (search bar + menu) on every page; the protected-deal action keeps its
 * prominent centre position.
 */
const items = [
  { href: '/', label: 'الرئيسية', icon: Home, match: (p: string) => p === '/' },
  { href: '/account/orders', label: 'طلباتي', icon: Package, match: (p: string) => p.startsWith('/account/orders') },
  { href: '/protected-deal', label: 'اضمن', icon: ShieldCheck, match: (p: string) => p.startsWith('/protected-deal') || p.startsWith('/account/deals'), accent: true },
  { href: '/account/messages', label: 'الرسائل', icon: MessageSquareText, match: (p: string) => p.startsWith('/account/messages'), messages: true },
  {
    href: '/account',
    label: 'حسابي',
    icon: User,
    match: (p: string) => p === '/account' || (p.startsWith('/account') && !['/account/orders', '/account/deals', '/account/messages'].some((x) => p.startsWith(x))),
  },
];

export function BottomNav({ unreadMessages = 0 }: { signedIn?: boolean; unreadMessages?: number }) {
  const path = usePathname();
  const unread = useCount('messages', unreadMessages);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="التنقل السفلي" data-testid="bottom-nav">
      <ul className="grid grid-cols-5">
        {items.map((it) => {
          const active = it.match(path);
          const Icon = it.icon;
          const n = it.messages ? unread : 0;
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                aria-label={it.messages ? messagesLabel(n) : undefined}
                data-testid={it.messages ? 'bottom-nav-messages' : undefined}
                className={cn('relative flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]', active ? 'font-bold text-brand-700' : 'font-medium text-muted')}
              >
                {active && !it.accent && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-700" aria-hidden />}
                {it.accent ? (
                  <span className={cn('-mt-5 grid size-11 place-items-center rounded-full border-4 border-white shadow-md', active ? 'bg-accent-700' : 'bg-accent-600')}>
                    <Icon className="size-5 text-white" aria-hidden />
                  </span>
                ) : (
                  <span className="relative inline-flex">
                    <Icon className="size-5" aria-hidden />
                    {n > 0 && (
                      <span className="absolute -top-2 -end-3 grid h-5 min-w-5 place-items-center rounded-full bg-accent-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white" data-testid="bottom-nav-unread" aria-hidden>
                        {n > 99 ? '99+' : n}
                      </span>
                    )}
                  </span>
                )}
                <span aria-hidden={it.messages ? true : undefined}>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
