import Link from '@/ui/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'accent' | 'success' | 'navy';
export type ButtonSize = 'sm' | 'md' | 'lg';

/* One button language for the whole product (see the homepage): EDMN blue primary with a soft blue glow,
   navy for strong secondary actions, quiet outline/ghost, semantic success/danger, red accent for the
   protected-deal action. Touch-friendly sizes: md and lg meet the 44px target. */
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-[var(--shadow-cta)]',
  secondary: 'bg-brand-50 text-brand-800 hover:bg-brand-100 border border-brand-100',
  outline: 'border border-line bg-white text-ink hover:border-brand-200 hover:bg-brand-50/60',
  ghost: 'text-ink hover:bg-brand-50/70',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  accent: 'bg-accent-600 text-white hover:bg-accent-700 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  navy: 'bg-brand-950 text-white hover:bg-brand-900 shadow-sm',
};
const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(
    'inline-flex items-center justify-center rounded-xl font-semibold transition-[background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none',
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ variant, size, className, type = 'button', ...props }: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  href,
  variant,
  size,
  className,
  children,
  ...rest
}: { href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode } & Omit<ComponentProps<typeof Link>, 'href' | 'className'>) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
