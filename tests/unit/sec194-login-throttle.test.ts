import { afterEach, describe, expect, it, vi } from 'vitest';
import { captchaConfig, captchaTokenFrom, loginDelaySeconds, verifyCaptcha } from '@/server/auth/login-throttle';

/** SEC-194 (L3): pure helpers. No database needed. */
describe('SEC-194 — escalating login delay', () => {
  it('no delay below the threshold, then 30s doubling up to the ceiling', () => {
    const d = (n: number) => loginDelaySeconds(n, 5, 900);
    expect([0, 1, 4].map(d)).toEqual([0, 0, 0]);
    expect([5, 6, 7, 8, 9].map(d)).toEqual([30, 60, 120, 240, 480]);
    expect(d(10)).toBe(900);
    expect(d(500)).toBe(900);
  });

  it('respects a custom threshold and ceiling', () => {
    expect(loginDelaySeconds(3, 3, 60)).toBe(30);
    expect(loginDelaySeconds(4, 3, 60)).toBe(60);
    expect(loginDelaySeconds(9, 3, 60)).toBe(60);
  });

  it('is monotonic', () => {
    let prev = 0;
    for (let n = 0; n < 40; n++) {
      const v = loginDelaySeconds(n, 5, 900);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('SEC-194 — CAPTCHA verification (config-driven, fails closed)', () => {
  const saved = { p: process.env.CAPTCHA_PROVIDER, s: process.env.CAPTCHA_SECRET };
  afterEach(() => {
    if (saved.p === undefined) delete process.env.CAPTCHA_PROVIDER;
    else process.env.CAPTCHA_PROVIDER = saved.p;
    if (saved.s === undefined) delete process.env.CAPTCHA_SECRET;
    else process.env.CAPTCHA_SECRET = saved.s;
  });

  it('is not configured without a secret, and rejects an unknown provider', () => {
    expect(captchaConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(captchaConfig({ CAPTCHA_SECRET: 'x', CAPTCHA_PROVIDER: 'nope' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(captchaConfig({ CAPTCHA_SECRET: 'x' } as unknown as NodeJS.ProcessEnv)).toEqual({ provider: 'turnstile', secret: 'x' });
  });

  it('fails closed: no config, no token, provider error, bad status', async () => {
    delete process.env.CAPTCHA_SECRET;
    expect(await verifyCaptcha('tok', '1.2.3.4', vi.fn() as unknown as typeof fetch)).toBe(false);
    process.env.CAPTCHA_SECRET = 'secret';
    const ok = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as unknown as typeof fetch;
    expect(await verifyCaptcha('', null, ok)).toBe(false);
    expect(await verifyCaptcha(undefined, null, ok)).toBe(false);
    expect(await verifyCaptcha('tok', null, vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBe(false);
    expect(await verifyCaptcha('tok', null, vi.fn(async () => new Response('x', { status: 500 })) as unknown as typeof fetch)).toBe(false);
    expect(await verifyCaptcha('tok', null, vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })) as unknown as typeof fetch)).toBe(false);
  });

  it('accepts only an explicit success:true and posts the secret + token to the provider', async () => {
    process.env.CAPTCHA_SECRET = 'secret';
    process.env.CAPTCHA_PROVIDER = 'hcaptcha';
    const f = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await verifyCaptcha('tok', '9.9.9.9', f as unknown as typeof fetch)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.hcaptcha.com/siteverify');
    const body = String(init.body);
    expect(body).toContain('secret=secret');
    expect(body).toContain('response=tok');
    expect(body).toContain('remoteip=9.9.9.9');
  });

  it('reads the token from any supported widget field', () => {
    const fd = (m: Record<string, string>) => (n: string) => m[n] ?? '';
    expect(captchaTokenFrom(fd({ 'cf-turnstile-response': 'a' }))).toBe('a');
    expect(captchaTokenFrom(fd({ 'h-captcha-response': 'b' }))).toBe('b');
    expect(captchaTokenFrom(fd({ 'g-recaptcha-response': 'c' }))).toBe('c');
    expect(captchaTokenFrom(fd({}))).toBe('');
  });
});
