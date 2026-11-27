import { describe, expect, it } from 'vitest';
import { apiRateBuckets, RATE_TIERS } from '@/server/api/rate-limit';
import { unsafeProductionConfig, type Env } from '@/server/core/env';
import { pdfContentProblems } from '@/server/storage/uploads';

/**
 * PKG-SEC-04 regression tests. Each one fails on the pre-package code:
 *  - pdfContentProblems did not exist (L10),
 *  - apiRateBuckets did not exist and the device+IP composite bucket was absent (M2),
 *  - a self-hosted production build booted happily without TRUSTED_PROXY (M2).
 */

/** The smallest bytes that pass the gate: a header and a trailer. */
const minimalPdf = (body = '1 0 obj << /Type /Catalog >> endobj') =>
  Buffer.from(`%PDF-1.4\n${body}\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n`, 'latin1');

describe('SEC-04 L10 — PDF content gate', () => {
  it('accepts a plain PDF', () => {
    expect(pdfContentProblems(minimalPdf())).toEqual([]);
  });

  it('rejects a file that is not a PDF at all', () => {
    expect(pdfContentProblems(Buffer.from('<html>hello</html>'.repeat(10)))).toContain('not-a-pdf');
  });

  it('rejects a truncated PDF with no trailer', () => {
    expect(pdfContentProblems(Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n'))).toContain('truncated');
  });

  it('rejects embedded JavaScript', () => {
    const problems = pdfContentProblems(minimalPdf('2 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj'));
    expect(problems).toContain('active-content:JavaScript');
    expect(problems).toContain('active-content:JS');
  });

  it('rejects an open/launch action and an embedded file', () => {
    expect(pdfContentProblems(minimalPdf('<< /OpenAction 4 0 R >>'))).toContain('active-content:OpenAction');
    expect(pdfContentProblems(minimalPdf('<< /EmbeddedFile 7 0 R >>'))).toContain('active-content:EmbeddedFile');
  });

  it('does not flag a name that merely starts with a guarded name', () => {
    expect(pdfContentProblems(minimalPdf('<< /JSFoo 1 /JavaScriptEnabled true >>'))).toEqual([]);
  });
});

describe('SEC-04 M2 — rate-limit buckets', () => {
  const install = 'install-0123456789abcdef';

  it('charges an anonymous request to device, IP and the device+IP composite', () => {
    const keys = apiRateBuckets('write', 'route', { userId: null, installationId: install, ip: '197.1.2.3' }).map((c) => c[0]);
    expect(keys).toContain(`api:write:i:${install}`);
    expect(keys).toContain('api:write:ip:197.1.2.3');
    expect(keys).toContain(`api:write:di:${install}:197.1.2.3`);
  });

  it('keeps the composite bucket generous enough for a shared CGNAT address', () => {
    const [, limit] = apiRateBuckets('write', 'route', { userId: null, installationId: install, ip: '197.1.2.3' }).find(
      (c) => c[0].startsWith('api:write:di:'),
    )!;
    expect(limit).toBe(RATE_TIERS.write.installation[0] * 3);
  });

  it('does not charge a device+IP bucket to an authenticated request (it is keyed on the account)', () => {
    const keys = apiRateBuckets('read', 'route', { userId: 'user-1', installationId: install, ip: '197.1.2.3' }).map((c) => c[0]);
    expect(keys).toEqual(['api:read:u:user-1']);
  });

  it('falls back to one strict per-route bucket when no identity at all is known', () => {
    const keys = apiRateBuckets('read', 'public-route', { userId: null, installationId: null, ip: null }).map((c) => c[0]);
    expect(keys).toEqual(['api:read:anon:public-route']);
  });
});

describe('SEC-04 M2 — TRUSTED_PROXY is mandatory for a self-hosted production build', () => {
  const base = {
    NODE_ENV: 'production',
    EDMN_ENVIRONMENT: 'production',
    SESSION_SECRET: 'x'.repeat(48),
    DATA_ENCRYPTION_KEY: 'y'.repeat(48),
    APP_URL: 'https://www.edmneg.com',
    MAIL_DRIVER: 'smtp',
    SMTP_HOST: 'smtp.example.com',
    SMS_DRIVER: 'log',
  } as unknown as Env;

  it('refuses to boot a self-hosted production build with no declared proxy', () => {
    const problems = unsafeProductionConfig(base, {});
    expect(problems.some((p) => p.includes('TRUSTED_PROXY'))).toBe(true);
  });

  it('accepts the same build once TRUSTED_PROXY=true', () => {
    const problems = unsafeProductionConfig(base, { TRUSTED_PROXY: 'true' });
    expect(problems.some((p) => p.includes('TRUSTED_PROXY'))).toBe(false);
  });

  it('does not require TRUSTED_PROXY on Vercel (the edge sets the client IP itself)', () => {
    const problems = unsafeProductionConfig(base, { VERCEL: '1' });
    expect(problems.some((p) => p.includes('TRUSTED_PROXY'))).toBe(false);
  });
});
