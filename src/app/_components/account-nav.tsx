'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const LINKS: [string, string][] = [
  ['/account', 'لوحة الحساب'],
  ['/account/orders', 'طلباتي'],
  ['/account/messages', 'الرسائل'],
  ['/account/deals', 'الصفقات المحمية'],
  ['/account/returns', 'طلبات الإرجاع'],
  ['/account/disputes', 'النزاعات'],
  ['/account/wishlist', 'المفضلة'],
  ['/account/reviews', 'تقييماتي'],
  ['/account/payments', 'المدفوعات'],
  ['/account/addresses', 'العناوين'],
  ['/account/notifications', 'الإشعارات'],
  ['/account/support', 'الدعم'],
  ['/account/profile', 'الملف الشخصي'],
  ['/account/security', 'الأمان'],
];

export function AccountNav({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const path = usePathname();
  return (
    <nav aria-label="قائمة الحساب" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
      {LINKS.map(([href, label]) => {
        const active = href === '/account' ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('whitespace-nowrap rounded-lg px-3 py-2 text-sm', active ? 'bg-brand-50 font-semibold text-brand-800' : 'text-ink hover:bg-white')}>
            {label}
            {href === '/account/messages' && unreadMessages > 0 && <UnreadBadge n={unreadMessages} />}
          </Link>
        );
      })}
    </nav>
  );
}

/** Count + text for screen readers (status is never conveyed by colour alone). */
export function UnreadBadge({ n }: { n: number }) {
  return (
    <span className="ms-1.5 inline-grid min-w-5 place-items-center rounded-full bg-accent-600 px-1.5 text-[11px] font-bold text-white" data-testid="unread-badge">
      {n > 99 ? '99+' : n}
      <span className="sr-only"> رسائل جديدة</span>
    </span>
  );
}
