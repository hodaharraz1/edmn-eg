/** Arabic-aware text normalization used by search, slugs and duplicate detection. */
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

export function normalizeArabic(input: string): string {
  return input
    .replace(TASHKEEL, '')
    .replace(/ـ/g, '') // tatweel
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function normalizeSearch(input: string): string {
  return normalizeArabic(input.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Unicode-friendly slug (keeps Arabic letters; URL-encoded by the browser). */
export function slugify(input: string): string {
  const s = normalizeArabic(input.toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'item';
}

/** Normalize an Egyptian mobile number to +20XXXXXXXXXX, or null if invalid. */
export function normalizeEgyptMobile(input: string): string | null {
  const digits = input.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  let local = digits;
  if (local.startsWith('0020')) local = local.slice(4);
  else if (local.startsWith('20') && local.length === 12) local = local.slice(2);
  if (local.startsWith('0')) local = local.slice(1);
  if (!/^1[0125]\d{8}$/.test(local)) return null;
  return `+20${local}`;
}

/** Egyptian national ID: 14 digits, century digit 2 or 3. Structural validation only. */
export function isValidEgyptNationalId(input: string): boolean {
  return /^[23]\d{13}$/.test(input);
}
