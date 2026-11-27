import { describe, expect, it } from 'vitest';
import { CAPTCHA_PAGES, CAPTCHA_PROVIDER_NAMES, CAPTCHA_WIDGET, captchaCspFor } from '@/lib/captcha-providers';
import { captchaPublicFrom } from '@/server/auth/captcha-public';
import { pageCsp } from '@/proxy';

/** PKG-FOLLOWUP-02: the CAPTCHA widget side. Pure checks, no database. */
describe('captchaPublicFrom — what a page or an app may know', () => {
  const env = { CAPTCHA_PROVIDER: 'turnstile', CAPTCHA_SECRET: 'server-only-secret' };
  it('is null while the mode is off, whatever else is set (the default: nothing is shown)', () => {
    expect(captchaPublicFrom('off', 'site-key', env)).toBeNull();
  });
  it('is null without a public key or without the server secret (the widget could not work)', () => {
    expect(captchaPublicFrom('always', '', env)).toBeNull();
    expect(captchaPublicFrom('always', 'site-key', {})).toBeNull();
  });
  it('is null for a provider the server does not verify', () => {
    expect(captchaPublicFrom('always', 'site-key', { CAPTCHA_PROVIDER: 'madeup', CAPTCHA_SECRET: 's' })).toBeNull();
  });
  it('carries the mode, the provider and the PUBLIC key only: never the secret', () => {
    const c = captchaPublicFrom('after_failures', 'site-key', env)!;
    expect(c).toMatchObject({ mode: 'after_failures', provider: 'turnstile', siteKey: 'site-key' });
    expect(JSON.stringify(c)).not.toContain('server-only-secret');
  });
  it('defaults to the same provider the server verifies by default (turnstile)', () => {
    expect(captchaPublicFrom('always', 'k', { CAPTCHA_SECRET: 's' })?.provider).toBe('turnstile');
  });
  it('every provider the server can verify has a widget description', () => {
    for (const p of CAPTCHA_PROVIDER_NAMES) {
      const c = captchaPublicFrom('always', 'k', { CAPTCHA_PROVIDER: p, CAPTCHA_SECRET: 's' })!;
      expect(c.scriptUrl.startsWith('https://')).toBe(true);
      expect(CAPTCHA_WIDGET[p].frameSrc.length).toBeGreaterThan(0);
    }
  });
});

describe('CSP: the provider is allowed only on the CAPTCHA pages and only when configured', () => {
  const env = { CAPTCHA_PROVIDER: 'turnstile', CAPTCHA_SECRET: 's' };
  it('every other page keeps frame-src none and no provider origin', () => {
    expect(captchaCspFor('/', env)).toBeNull();
    expect(captchaCspFor('/account/orders', env)).toBeNull();
    expect(pageCsp('n')).toContain("frame-src 'none'");
    expect(pageCsp('n', captchaCspFor('/', env))).not.toContain('cloudflare');
  });
  it('with no CAPTCHA_SECRET nothing is widened, even on the login page', () => {
    expect(captchaCspFor('/login', {})).toBeNull();
  });
  it('the login pages and the mobile page get exactly the provider origin', () => {
    for (const path of CAPTCHA_PAGES) {
      const csp = pageCsp('n', captchaCspFor(path, env));
      expect(csp).toContain('frame-src https://challenges.cloudflare.com');
      expect(csp).toContain("script-src 'self' 'nonce-n' 'strict-dynamic' https://challenges.cloudflare.com");
      expect(csp).not.toContain("'unsafe-inline' 'unsafe-inline'");
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    }
  });
});
