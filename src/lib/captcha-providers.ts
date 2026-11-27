/**
 * PKG-FOLLOWUP-02: what each supported CAPTCHA provider needs on a page. Pure data, no server imports, so the edge proxy
 * (Content-Security-Policy), the login pages and the tests share one table. The provider and its verification URL stay
 * in src/server/auth/login-throttle.ts (unchanged); this file only describes the widget side of the SAME providers.
 */
export type CaptchaProviderName = 'turnstile' | 'hcaptcha' | 'recaptcha';

export const CAPTCHA_PROVIDER_NAMES: readonly CaptchaProviderName[] = ['turnstile', 'hcaptcha', 'recaptcha'];

export const CAPTCHA_WIDGET: Record<CaptchaProviderName, { scriptUrl: string; global: string; frameSrc: string[]; connectSrc: string[]; styleSrc: string[]; scriptSrc: string[] }> = {
  turnstile: {
    scriptUrl: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    global: 'turnstile',
    scriptSrc: ['https://challenges.cloudflare.com'],
    frameSrc: ['https://challenges.cloudflare.com'],
    connectSrc: ['https://challenges.cloudflare.com'],
    styleSrc: [],
  },
  hcaptcha: {
    scriptUrl: 'https://js.hcaptcha.com/1/api.js?render=explicit',
    global: 'hcaptcha',
    scriptSrc: ['https://js.hcaptcha.com', 'https://hcaptcha.com', 'https://*.hcaptcha.com'],
    frameSrc: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
    connectSrc: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
    styleSrc: ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
  },
  recaptcha: {
    scriptUrl: 'https://www.google.com/recaptcha/api.js?render=explicit',
    global: 'grecaptcha',
    scriptSrc: ['https://www.google.com', 'https://www.gstatic.com'],
    frameSrc: ['https://www.google.com', 'https://recaptcha.google.com'],
    connectSrc: [],
    styleSrc: [],
  },
};

/** The only pages that may load a CAPTCHA widget; every other page keeps the strict policy. */
export const CAPTCHA_PAGES: readonly string[] = ['/login', '/seller/login', '/admin/login', '/captcha/mobile'];

export type CaptchaCsp = { scriptSrc: string[]; frameSrc: string[]; connectSrc: string[]; styleSrc: string[] };

/** Extra CSP sources for one request, or null (no widening) when the page is not a CAPTCHA page or no provider is set. */
export function captchaCspFor(pathname: string, env: Record<string, string | undefined>): CaptchaCsp | null {
  if (!CAPTCHA_PAGES.includes(pathname) || !env.CAPTCHA_SECRET) return null;
  const provider = (env.CAPTCHA_PROVIDER ?? 'turnstile') as CaptchaProviderName;
  const w = CAPTCHA_WIDGET[provider];
  return w ? { scriptSrc: w.scriptSrc, frameSrc: w.frameSrc, connectSrc: w.connectSrc, styleSrc: w.styleSrc } : null;
}
