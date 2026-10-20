/**
 * Client IP for rate limiting and audit. Never trust the left-most X-Forwarded-For entry: the client controls it.
 *   Vercel          the edge sets x-vercel-forwarded-for / x-real-ip itself (client values are overwritten).
 *   Self-hosted     forwarding headers are trusted ONLY when TRUSTED_PROXY=true declares that a reverse proxy we
 *                   operate (nginx: `proxy_set_header X-Real-IP $remote_addr`) sits in front and strips client
 *                   copies; then X-Real-IP, else the right-most X-Forwarded-For entry (appended by that proxy).
 *   Otherwise       no header is trusted (Batch 2): a directly-exposed server would let any client choose its IP and
 *                   escape per-IP rate limits; requests share the "unknown" bucket and per-account limits still apply.
 */
export function clientIp(h: { get(name: string): string | null }, raw: Record<string, string | undefined> = process.env): string | null {
  const pick = (v: string | null | undefined) => (v && /^[0-9a-fA-F:.]{2,45}$/.test(v.trim()) ? v.trim() : null);
  if (raw.VERCEL) return pick(h.get('x-vercel-forwarded-for')?.split(',')[0]) ?? pick(h.get('x-real-ip'));
  if (raw.TRUSTED_PROXY !== 'true') return null;
  const real = pick(h.get('x-real-ip'));
  if (real) return real;
  const fwd = h.get('x-forwarded-for')?.split(',') ?? [];
  return pick(fwd[fwd.length - 1]);
}
