import { describe, expect, it } from 'vitest';
import { safeNext } from '@/server/web/safe-next';

describe('safeNext (post-login returnTo)', () => {
  it('keeps internal relative destinations, query included', () => {
    for (const p of ['/account/deals/new', '/account/orders?x=1', '/product/abc?v=1#reviews', '/'])
      expect(safeNext(p, '/account')).toBe(p);
  });

  it('refuses external, protocol-relative and scriptable destinations', () => {
    const evil = [
      'https://evil.example',
      'http://evil.example/account',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      'evil.example',
      '/x?u=https://evil.example',
      '',
      null,
      undefined,
    ];
    for (const e of evil) expect(safeNext(e, '/account'), String(e)).toBe('/account');
  });

  it('an encoded "//" stays a same-origin path (never decoded into a host)', () => {
    const out = safeNext('/%2F%2Fevil.example', '/account');
    expect(new URL(out, 'https://edmneg.com').origin).toBe('https://edmneg.com');
  });
});
