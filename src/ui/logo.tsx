import Link from '@/ui/link';
import { cn } from '@/lib/cn';

/**
 * The official, legally-registered EDMN logo — ONE canonical asset for the whole application.
 *
 * - Source: /public/brand/edmn-logo.png (the supplied master, 752×720 transparent PNG, used byte-for-byte).
 * - Never redrawn, recoloured, cropped, stretched or filtered: only the display HEIGHT is set and the
 *   width follows the intrinsic aspect ratio (object-contain), so the mark can never be distorted.
 * - Transparent: it must sit on a light surface (the surrounding UI provides one — never a box
 *   added behind the logo, never a colour change to the logo).
 * - Served as-is (≈40 KB); the browser scales the high-resolution master to the display size.
 */
export const LOGO_SRC = '/brand/edmn-logo.png';
export const LOGO_WIDTH = 752;
export const LOGO_HEIGHT = 720;

const SIZES = {
  /** Marketplace header (mobile → desktop) */
  header: 'h-11 sm:h-12',
  /** Compact bars (mobile admin / seller top bars) */
  mobile: 'h-9',
  /** Seller Center / Admin sidebars */
  sidebar: 'h-16',
  /** Authentication cards (customer, seller, admin, 2FA) */
  auth: 'h-20 sm:h-24',
  /** Large brand display (seller entry hero, footer, empty states) */
  large: 'h-28 sm:h-32',
} as const;
export type LogoVariant = keyof typeof SIZES;

export function LogoImage({ variant = 'header', className, priority }: { variant?: LogoVariant; className?: string; priority?: boolean }) {
  return (
    // Plain <img>: the official master is served unmodified (no re-encoding by an image optimizer).
    <img
      src={LOGO_SRC}
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      alt="اضمن EDMN"
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      draggable={false}
      className={cn(SIZES[variant], 'w-auto max-w-none select-none object-contain', className)}
    />
  );
}

export function Logo({ className, href = '/', variant = 'header', label = 'اضمن – الصفحة الرئيسية', priority }: { className?: string; href?: string; variant?: LogoVariant; label?: string; priority?: boolean }) {
  return (
    <Link href={href} aria-label={label} className={cn('inline-flex shrink-0 items-center', className)}>
      <LogoImage variant={variant} priority={priority} />
    </Link>
  );
}
