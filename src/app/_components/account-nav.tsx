'use client';

import Link from '@/ui/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Bell, CreditCard, Heart, IdCard, Landmark, LayoutDashboard, LifeBuoy, Lock, type LucideIcon, MapPin, MessageCircle, Package, Scale, ShieldCheck, Star, Undo2, User, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CountBadge, messagesLabel, useCount } from './live/live-provider';

type Item = [href: string, label: string, icon: LucideIcon];
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'مشترياتي',
    items: [
      ['/account', 'لوحة الحساب', LayoutDashboard],
      ['/account/orders', 'طلباتي', Package],
      ['/account/deals', 'الصفقات المحمية', ShieldCheck],
      ['/account/returns', 'طلبات الإرجاع', Undo2],
      ['/account/disputes', 'النزاعات', Scale],
      ['/account/wishlist', 'المفضلة', Heart],
      ['/account/reviews', 'تقييماتي', Star],
      ['/account/payments', 'المدفوعات', CreditCard],
    ],
  },
  {
    title: 'التواصل',
    items: [
      ['/account/messages', 'الرسائل', MessageCircle],
      ['/account/notifications', 'الإشعارات', Bell],
      ['/account/support', 'الدعم', LifeBuoy],
    ],
  },
  {
    title: 'الأموال والتحقق',
    items: [
      ['/account/earnings', 'مستحقاتي من البيع', Wallet],
      ['/account/identity', 'التحقق من الهوية', IdCard],
      ['/account/receiving', 'بيانات استلام الأموال', Landmark],
    ],
  },
  {
    title: 'الحساب',
    items: [
      ['/account/addresses', 'العناوين', MapPin],
      ['/account/profile', 'الملف الشخصي', User],
      ['/account/security', 'الأمان', Lock],
    ],
  },
];

/** Desktop: grouped sidebar card. Phones/tablets: one horizontally scrollable row of pills (same links). */
export function AccountNav({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const path = usePathname();
  const unread = useCount('messages', unreadMessages);
  const navRef = useRef<HTMLElement>(null);
  // Phones: the menu is one horizontal row, so bring the current page's pill into view (no page scroll).
  useEffect(() => {
    const nav = navRef.current;
    const a = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!nav || !a || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft += a.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - a.offsetWidth) / 2;
  }, [path]);
  return (
    <nav ref={navRef} aria-label="قائمة الحساب" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:block lg:space-y-4 lg:overflow-visible lg:rounded-2xl lg:bg-white lg:p-3 lg:shadow-[var(--shadow-card)] lg:ring-1 lg:ring-line">
      {GROUPS.map((g) => (
        <div key={g.title} className="contents lg:block lg:space-y-0.5">
          <p className="hidden px-3 pb-1 text-[11px] font-bold tracking-wide text-muted lg:block">{g.title}</p>
          {g.items.map(([href, label, Icon]) => {
            const active = href === '/account' ? path === href : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                aria-label={href === '/account/messages' ? messagesLabel(unread) : undefined}
                className={cn(
                  'flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm ring-1 transition-colors lg:min-h-10 lg:rounded-xl lg:px-3 lg:ring-0',
                  active ? 'bg-brand-950 font-semibold text-white ring-brand-950 lg:bg-brand-50 lg:text-brand-800' : 'bg-white text-ink ring-line hover:bg-soft lg:bg-transparent',
                )}
              >
                <Icon className={cn('size-4 shrink-0', active ? 'lg:text-brand-700' : 'text-muted')} aria-hidden />
                {label}
                {href === '/account/messages' && <CountBadge kind="messages" fallback={unreadMessages} className="ms-auto inline-grid min-w-5 place-items-center rounded-full bg-accent-600 px-1.5 text-[11px] font-bold text-white" />}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
