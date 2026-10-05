import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * EDMN logo slot.
 * The official, legally-registered logo must be used AS-IS (never redrawn/recoloured/cropped).
 * Set NEXT_PUBLIC_LOGO_URL to the official asset (e.g. /brand/edmn-logo.png). Until then a
 * neutral placeholder reserves the same area so the layout does not change when the asset arrives.
 */
export function Logo({ className, href = '/', size = 'md', label = 'اضمن – الصفحة الرئيسية' }: { className?: string; href?: string; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const src = process.env.NEXT_PUBLIC_LOGO_URL;
  const box = { sm: 'h-8 w-20', md: 'h-10 w-24', lg: 'h-14 w-32' }[size];
  return (
    <Link href={href} aria-label={label} className={cn('inline-flex shrink-0 items-center', className)}>
      {src ? (
        <img src={src} alt="EDMN اضمن" className={cn(box, 'object-contain')} />
      ) : (
        <span
          className={cn(box, 'grid place-items-center rounded-md border border-dashed border-current/40 text-center leading-none')}
          title="مكان الشعار الرسمي — يُستبدل بالملف المعتمد"
        >
          <span className="text-base font-bold tracking-tight">
            اضمن <span className="text-[10px] font-semibold">EDMN</span>
          </span>
        </span>
      )}
    </Link>
  );
}
