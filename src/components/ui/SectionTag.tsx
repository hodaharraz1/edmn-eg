import { cn } from '@/lib/utils';

export default function SectionTag({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block px-4 py-1.5 bg-[#EBF2FC] text-[#1A57A1] rounded-full text-sm font-bold mb-4',
        className,
      )}
    >
      {children}
    </span>
  );
}
