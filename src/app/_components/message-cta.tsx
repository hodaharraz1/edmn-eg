import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/** Primary entry point into an order/deal conversation ("تواصل مع البائع" / "تواصل مع المشتري"). */
export function MessageCtaLink({ href, label, unread = 0, className }: { href: string; label: string; unread?: number; className?: string }) {
  return (
    <Link
      href={href}
      className={cn('inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300', className)}
      data-testid="message-cta"
    >
      <MessageCircle className="size-4" aria-hidden /> {label}
      {unread > 0 && (
        <span className="inline-grid min-w-5 place-items-center rounded-full bg-white px-1.5 text-[11px] font-bold text-brand-800">
          {unread}
          <span className="sr-only"> رسائل جديدة</span>
        </span>
      )}
    </Link>
  );
}
