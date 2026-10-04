/** Client-safe formatting helpers (no server imports). Money values are integer piasters. */
const egp = new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const egpFixed = new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatEGP(minor: number | null | undefined, opts: { fixed?: boolean } = {}): string {
  if (minor === null || minor === undefined) return '—';
  const v = minor / 100;
  return `${(opts.fixed ? egpFixed : egp).format(v)} ج.م`;
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('ar-EG').format(Number(n));
}

export function formatDate(d: Date | string | null | undefined, withTime = false): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Africa/Cairo',
  }).format(date);
}

export function discountPercent(price: number | null, compareAt: number | null): number | null {
  if (!price || !compareAt || compareAt <= price) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

/** "125.50" from piasters for <input> default values */
export function toInputAmount(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 100).toFixed(2).replace(/\.00$/, '');
}
