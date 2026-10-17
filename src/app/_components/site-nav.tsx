'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import Link from '@/ui/link';
import { cn } from '@/lib/cn';
import { NAV_LINK, NAV_LINK_ACTIVE as ACTIVE } from './nav-styles';

/** Primary navigation of the public site. The active item follows the current route (also for nested pages). */
export function SiteNav({ productsMenu }: { productsMenu: ReactNode }) {
  const path = usePathname();
  const item = (href: string, label: string, match: (p: string) => boolean) => {
    const on = match(path);
    return (
      <Link key={href} href={href} aria-current={on ? 'page' : undefined} className={cn(NAV_LINK, on && ACTIVE)}>
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="التنقل الرئيسي" className="hidden items-center gap-0.5 text-sm font-semibold [grid-area:nav] lg:flex lg:justify-self-center">
      {item('/', 'الرئيسية', (p) => p === '/')}
      {productsMenu}
      {item('/stores', 'المتاجر', (p) => p.startsWith('/stores') || p.startsWith('/store/'))}
      {item('/protected-deal', 'كيف يعمل الضمان؟', (p) => p.startsWith('/protected-deal'))}
      {item('/sell', 'مركز البائع', (p) => p.startsWith('/sell'))}
      {item('/contact', 'المساعدة', (p) => p.startsWith('/contact') || p.startsWith('/legal'))}
    </nav>
  );
}
