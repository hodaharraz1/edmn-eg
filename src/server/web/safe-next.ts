/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string') return fallback;
  // Browsers drop tab/CR/LF and treat "\\" like "/" while parsing URLs, so "/\t/evil.com" would become
  // "//evil.com". Reject control characters and backslashes outright, then require a same-origin path.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('://')) return fallback;
  try {
    const base = 'https://edmn.invalid';
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
