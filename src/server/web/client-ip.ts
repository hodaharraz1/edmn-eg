/**
 * Client IP for rate limiting and audit. Never trust the left-most X-Forwarded-For entry: the client
 * controls it. On Vercel the edge sets x-vercel-forwarded-for / x-real-ip itself; behind nginx,
 * `proxy_set_header X-Real-IP $remote_addr` (see docs/DEPLOYMENT.md). Otherwise use the entry
 * appended by our single trusted proxy (the right-most one).
 */
export function clientIp(h: { get(name: string): string | null }): string | null {
  const pick = (v: string | null | undefined) => (v && /^[0-9a-fA-F:.]{2,45}$/.test(v.trim()) ? v.trim() : null);
  if (process.env.VERCEL) return pick(h.get('x-vercel-forwarded-for')?.split(',')[0]) ?? pick(h.get('x-real-ip'));
  const real = pick(h.get('x-real-ip'));
  if (real) return real;
  const fwd = h.get('x-forwarded-for')?.split(',') ?? [];
  return pick(fwd[fwd.length - 1]);
}
