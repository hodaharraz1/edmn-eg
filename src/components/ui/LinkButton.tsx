import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

type Variant = 'primary' | 'accent' | 'outline' | 'ghost' | 'white';
type Size = 'sm' | 'md' | 'lg';

interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
}

const variantStyles: Record<Variant, string> = {
  primary:
    'bg-[#1A57A1] text-white shadow-[0_4px_14px_rgba(26,87,161,.3)] hover:bg-[#164A8A] hover:shadow-[0_8px_24px_rgba(26,87,161,.4)] hover:-translate-y-0.5',
  accent:
    'bg-[#F0171A] text-white shadow-[0_4px_14px_rgba(240,23,26,.3)] hover:bg-[#C8141C] hover:shadow-[0_8px_24px_rgba(240,23,26,.4)] hover:-translate-y-0.5',
  outline:
    'border-2 border-[#1A57A1] text-[#1A57A1] hover:bg-[#EBF2FC] hover:-translate-y-0.5',
  ghost:
    'text-[#1A57A1] hover:bg-[#EBF2FC]',
  white:
    'bg-white text-[#1A57A1] shadow-[var(--shadow-md)] hover:bg-[#EBF2FC] hover:-translate-y-0.5',
};

const sizeStyles: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm gap-1.5',
  md: 'px-6 py-3 text-base gap-2',
  lg: 'px-8 py-4 text-lg gap-2.5',
};

export default function LinkButton({
  className,
  variant = 'primary',
  size = 'md',
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-sm)] font-bold',
        'transition-all duration-200 ease-[var(--ease-smooth)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A57A1] focus-visible:ring-offset-2',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
