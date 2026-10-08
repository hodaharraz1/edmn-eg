'use client';

import { BarChart3, Boxes, CircleDollarSign, Gauge, HeartPulse, LayoutDashboard, LifeBuoy, MessagesSquare, Package, PackagePlus, RotateCcw, Settings, ShoppingBag, Star, Store, Truck, Wallet, Landmark } from 'lucide-react';
import Link from '@/ui/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { CountBadge, messagesLabel, useCount } from './live/live-provider';

export const SELLER_NAV = [
  { href: '/seller', label: 'لوحة التحكم', icon: LayoutDashboard },
  { href: '/seller/products', label: 'المنتجات', icon: Package },
  { href: '/seller/products/new', label: 'إضافة منتج', icon: PackagePlus },
  { href: '/seller/inventory', label: 'المخزون', icon: Boxes },
  { href: '/seller/orders', label: 'الطلبات', icon: ShoppingBag },
  { href: '/seller/messages', label: 'الرسائل', icon: MessagesSquare },
  { href: '/seller/shipping', label: 'الشحن', icon: Truck },
  { href: '/seller/returns', label: 'المرتجعات', icon: RotateCcw },
  { href: '/seller/reviews', label: 'التقييمات', icon: Star },
  { href: '/seller/finance', label: 'المالية', icon: CircleDollarSign },
  { href: '/seller/balance', label: 'الرصيد', icon: Landmark },
  { href: '/seller/withdrawals', label: 'السحوبات', icon: Wallet },
  { href: '/seller/analytics', label: 'التحليلات', icon: BarChart3 },
  { href: '/seller/store', label: 'المتجر', icon: Store },
  { href: '/seller/health', label: 'صحة الحساب', icon: HeartPulse },
  { href: '/seller/support', label: 'الدعم', icon: LifeBuoy },
  { href: '/seller/settings', label: 'الإعدادات', icon: Settings },
] as const;

export function SellerNav({ compact, unreadMessages = 0, canMessage = true }: { compact?: boolean; unreadMessages?: number; canMessage?: boolean }) {
  const path = usePathname();
  const unread = useCount('messages', unreadMessages);
  return (
    <nav aria-label="قائمة مركز البائع" className="space-y-0.5">
      {SELLER_NAV.filter((it) => canMessage || it.href !== '/seller/messages').map((it) => {
        const active = it.href === '/seller' ? path === '/seller' : it.href === '/seller/products' ? path.startsWith('/seller/products') && path !== '/seller/products/new' : path.startsWith(it.href);
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            aria-label={it.href === '/seller/messages' ? messagesLabel(unread) : undefined}
            className={cn('flex items-center gap-3 rounded-lg border-s-2 px-3 py-2 text-sm', active ? 'border-white bg-white/15 font-semibold text-white' : 'border-transparent text-white/75 hover:bg-white/10 hover:text-white', compact && 'text-ink/80 hover:text-ink')}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {it.label}
            {it.href === '/seller/messages' && <CountBadge kind="messages" fallback={unreadMessages} className="ms-auto inline-grid min-w-5 place-items-center rounded-full bg-accent-600 px-1.5 text-[11px] font-bold text-white" />}
          </Link>
        );
      })}
    </nav>
  );
}
export { Gauge };
