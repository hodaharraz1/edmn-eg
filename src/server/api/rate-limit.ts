import { hit } from '@/server/auth/rate-limit';
import { ApiError } from './errors';

/**
 * Mobile-safe rate limiting (Phase 1). Egyptian mobile carriers put many subscribers behind one CGNAT address, so a
 * tight per-IP limit would lock out unrelated buyers. Buckets are therefore keyed on the most specific identity known:
 *
 *   authenticated  per USER (one account, any device)
 *   anonymous      per app INSTALLATION (X-EDMN-Installation header) — plus a generous per-IP ceiling that only stops
 *                  floods; when the client IP is unknown the IP bucket is skipped rather than shared by everyone.
 *
 * Credential-guessing protection is NOT relaxed: login keeps its per-identifier limit and lockout in the auth service;
 * these tiers sit in front of it. All counters live in PostgreSQL (shared by every app instance).
 */
export type RateTier = 'read' | 'write' | 'auth' | 'sensitive';

interface TierLimits {
  user: [limit: number, windowSeconds: number];
  installation: [number, number];
  ip: [number, number];
}

export const RATE_TIERS: Record<RateTier, TierLimits> = {
  read: { user: [300, 60], installation: [120, 60], ip: [1200, 60] },
  write: { user: [60, 60], installation: [20, 60], ip: [300, 60] },
  auth: { user: [20, 300], installation: [20, 300], ip: [300, 300] },
  sensitive: { user: [10, 900], installation: [5, 900], ip: [100, 900] },
};

const INSTALLATION_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function installationIdFrom(req: Request): string | null {
  const v = req.headers.get('x-edmn-installation');
  return v && INSTALLATION_RE.test(v) ? v : null;
}

export async function enforceApiRateLimit(tier: RateTier, routeId: string, who: { userId: string | null; installationId: string | null; ip: string | null }) {
  const t = RATE_TIERS[tier];
  const checks: Array<[string, number, number]> = [];
  if (who.userId) checks.push([`api:${tier}:u:${who.userId}`, ...t.user]);
  else if (who.installationId) checks.push([`api:${tier}:i:${who.installationId}`, ...t.installation]);
  if (!who.userId && who.ip) checks.push([`api:${tier}:ip:${who.ip}`, ...t.ip]);
  // Anonymous and no identity at all: one shared, strict bucket per route so the API cannot be used anonymously at scale.
  if (!who.userId && !who.installationId && !who.ip) checks.push([`api:${tier}:anon:${routeId}`, t.ip[0], t.ip[1]]);
  for (const [key, limit, windowSeconds] of checks) {
    if (!(await hit(key, limit, windowSeconds))) {
      const retry = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
      throw new ApiError('rate_limited', undefined, { retryAfterSeconds: retry });
    }
  }
}
