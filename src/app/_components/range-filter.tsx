import Link from 'next/link';
import { cn } from '@/lib/cn';

const PRESETS: [string, string][] = [
  ['today', 'اليوم'],
  ['7d', '7 أيام'],
  ['30d', '30 يوماً'],
  ['90d', '90 يوماً'],
  ['365d', 'سنة'],
];

export function RangeFilter({ path, active }: { path: string; active: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="الفترة">
      {PRESETS.map(([k, l]) => (
        <Link key={k} href={`${path}?range=${k}`} aria-current={active === k ? 'true' : undefined} className={cn('rounded-full border px-3 py-1 text-xs', active === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white hover:bg-page')}>
          {l}
        </Link>
      ))}
    </div>
  );
}
