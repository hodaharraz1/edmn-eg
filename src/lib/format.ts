/** Client-safe formatting helpers (no server imports). Money values are integer piasters. */
const egp = new Intl.NumberFormat('ar-EG-u-nu-latn', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const egpFixed = new Intl.NumberFormat('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatEGP(minor: number | null | undefined, opts: { fixed?: boolean } = {}): string {
  if (minor === null || minor === undefined) return '—';
  const v = minor / 100;
  return `${(opts.fixed ? egpFixed : egp).format(v)} ج.م`;
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('ar-EG-u-nu-latn').format(Number(n));
}

export function formatDate(d: Date | string | null | undefined, withTime = false): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
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

const cairoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
const plural = (n: number, one: string, two: string, few: string, many: string) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);

/** Human-friendly relative time (الآن، منذ 5 دقائق، أمس …). Callers keep the exact time in a title/dateTime attribute. */
export function formatRelative(d: Date | string | null | undefined, now: Date = new Date()): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 45) return 'الآن';
  const m = Math.round(s / 60);
  if (m < 60) return `منذ ${plural(Math.max(1, m), 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`;
  const h = Math.round(m / 60);
  if (h < 24 && cairoDay(date) === cairoDay(now)) return `منذ ${plural(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  const y = new Date(now.getTime() - 86_400_000);
  const time = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(date);
  if (cairoDay(date) === cairoDay(y)) return `أمس ${time}`;
  if (h < 24) return `منذ ${plural(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  return formatDate(date, true);
}

/** Clock time only (message bubbles; the full timestamp stays in the title). */
export function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(date);
}
