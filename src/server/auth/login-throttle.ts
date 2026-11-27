import { logger } from '@/server/core/logger';

/**
 * SEC-194 (L3): escalating login delay + optional CAPTCHA, replacing the old hard account lock.
 * Pure helpers only: no database access here, so they are unit-testable without Postgres.
 */

/** First delay step in seconds; each further consecutive failure doubles it, up to the configured maximum. */
export const LOGIN_DELAY_BASE_SECONDS = 30;

/**
 * Seconds an account must wait after `failures` consecutive wrong passwords.
 * 0 while failures < `after`; then 30, 60, 120, 240 ... capped at `maxSeconds`.
 */
export function loginDelaySeconds(failures: number, after: number, maxSeconds: number): number {
  if (!Number.isFinite(failures) || failures < after) return 0;
  const exp = Math.min(failures - after, 20);
  return Math.min(maxSeconds, LOGIN_DELAY_BASE_SECONDS * 2 ** exp);
}

/** A failure streak older than this no longer counts (the owner who mistyped last month is not penalised today). */
export const LOGIN_FAILURE_DECAY_HOURS = 24;

export type CaptchaMode = 'off' | 'after_failures' | 'always';
export type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'recaptcha';

const VERIFY_URLS: Record<CaptchaProvider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
};

/** Provider + secret come from the environment only (a secret never lives in the settings table). */
export function captchaConfig(e: NodeJS.ProcessEnv = process.env): { provider: CaptchaProvider; secret: string } | null {
  const provider = (e.CAPTCHA_PROVIDER ?? 'turnstile') as CaptchaProvider;
  const secret = e.CAPTCHA_SECRET;
  if (!secret || !(provider in VERIFY_URLS)) return null;
  return { provider, secret };
}

/**
 * Server-side CAPTCHA verification. Fails CLOSED: a missing token, a provider error or a timeout is "not verified".
 * `fetchImpl` is injectable for tests.
 */
export async function verifyCaptcha(token: string | undefined | null, ip: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const cfg = captchaConfig();
  if (!cfg || !token || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret: cfg.secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetchImpl(VERIFY_URLS[cfg.provider], {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch (e) {
    logger.warn('captcha.verify_failed', { error: e as Error });
    return false;
  }
}

/** Form field names the supported providers' widgets post, plus a neutral one for custom clients. */
export function captchaTokenFrom(get: (name: string) => string): string {
  return get('captchaToken') || get('cf-turnstile-response') || get('h-captcha-response') || get('g-recaptcha-response');
}
