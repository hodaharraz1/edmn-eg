import { CAPTCHA_PROVIDER_NAMES, CAPTCHA_WIDGET, type CaptchaProviderName } from '@/lib/captcha-providers';
import { getSetting } from '@/server/modules/settings';
import type { CaptchaMode } from './login-throttle';

/**
 * PKG-FOLLOWUP-02: what a page or an app may know about the CAPTCHA: the mode, the provider and the PUBLIC site key.
 * Never the secret. null means "do not show a CAPTCHA": the mode is off, no provider/secret is configured, or the
 * public key is missing. The verification itself (login-throttle.ts, unchanged) stays the only judge of a token.
 */
export interface CaptchaPublic {
  mode: Exclude<CaptchaMode, 'off'>;
  provider: CaptchaProviderName;
  siteKey: string;
  scriptUrl: string;
  global: string;
}

export function captchaPublicFrom(mode: CaptchaMode, siteKey: string, env: Record<string, string | undefined>): CaptchaPublic | null {
  if (mode === 'off' || !siteKey || !env.CAPTCHA_SECRET) return null;
  const provider = (env.CAPTCHA_PROVIDER ?? 'turnstile') as CaptchaProviderName;
  if (!CAPTCHA_PROVIDER_NAMES.includes(provider)) return null;
  const w = CAPTCHA_WIDGET[provider];
  return { mode, provider, siteKey, scriptUrl: w.scriptUrl, global: w.global };
}

export async function loadCaptchaPublic(): Promise<CaptchaPublic | null> {
  const [mode, siteKey] = await Promise.all([getSetting('auth.captchaMode'), getSetting('auth.captchaSiteKey')]);
  return captchaPublicFrom(mode, siteKey, process.env);
}
