import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '@/server/api/errors';
import { buildOpenApi } from '@/server/api/openapi';
import { ADMIN_API_ROUTES, ALL_API_ROUTES, MOBILE_API_ROUTES } from '@/server/api/routes';

/** The committed OpenAPI documents are the reviewed contract: they must equal what the route definitions generate. */
describe('mobile API contract (OpenAPI 3.1)', () => {
  for (const api of ['mobile', 'admin'] as const) {
    it(`openapi/${api}.v1.json is up to date (run: npx tsx scripts/openapi.ts)`, () => {
      const committed = JSON.parse(readFileSync(join(process.cwd(), 'openapi', `${api}.v1.json`), 'utf8'));
      expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApi(api))));
      expect(committed.openapi).toBe('3.1.0');
    });
  }

  it('every route definition is mounted by a src/app/api/v1 route file exporting its method', () => {
    for (const r of ALL_API_ROUTES) {
      const file = join(process.cwd(), 'src/app', r.path.replace(/\{(\w+)\}/g, '[$1]'), 'route.ts');
      expect(existsSync(file), `${r.id}: ${file}`).toBe(true);
      expect(readFileSync(file, 'utf8'), r.id).toMatch(new RegExp(`export const ${r.method} = toHandler\\(\\w+\\)`));
    }
  });

  it('operation ids are unique, and admin routes live only under /api/v1/admin', () => {
    const ids = ALL_API_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ADMIN_API_ROUTES) expect(r.path.startsWith('/api/v1/admin/')).toBe(true);
    for (const r of MOBILE_API_ROUTES) expect(r.path.startsWith('/api/v1/admin/')).toBe(false);
  });

  it('admin routes use admin auth modes; customer routes never do', () => {
    for (const r of ADMIN_API_ROUTES) expect(['none', 'admin', 'admin-pre-mfa']).toContain(r.auth);
    for (const r of MOBILE_API_ROUTES) expect(['admin', 'admin-pre-mfa']).not.toContain(r.auth);
  });

  it('credential-returning endpoints are never idempotency-cached; session mutations are', () => {
    for (const r of ALL_API_ROUTES) {
      const returnsTokens = /login|register|refresh/i.test(r.id);
      if (returnsTokens) expect(r.idempotency, r.id).toBeUndefined();
      if (r.method === 'DELETE' || /revoke/i.test(r.id)) expect(r.idempotency, r.id).toBe('required');
    }
  });

  it('Phase 1 exposes no money-moving or privileged financial operation', () => {
    for (const r of ALL_API_ROUTES) expect(r.path).not.toMatch(/withdraw|settle|payout|refund|release|ledger|journal|real-?money|kill-?switch/i);
    const writes = ALL_API_ROUTES.filter((r) => r.method !== 'GET');
    for (const r of writes) expect(r.tags.join(' ')).toMatch(/Auth|Account|Security/);
  });

  it('every documented error code is a stable snake_case code from the catalogue', () => {
    const doc = buildOpenApi('mobile') as { components: { schemas: { ErrorCode: { enum: string[] } } } };
    expect(doc.components.schemas.ErrorCode.enum).toEqual([...API_ERROR_CODES]);
    for (const c of API_ERROR_CODES) expect(c).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('API routes and their mounts never import the database layer (services own data access)', () => {
    for (const r of ALL_API_ROUTES) {
      const file = join(process.cwd(), 'src/app', r.path.replace(/\{(\w+)\}/g, '[$1]'), 'route.ts');
      expect(readFileSync(file, 'utf8')).not.toMatch(/@\/server\/db|drizzle-orm/);
    }
    for (const f of ['public', 'customer', 'admin', 'index']) {
      expect(readFileSync(join(process.cwd(), 'src/server/api/routes', `${f}.ts`), 'utf8')).not.toMatch(/@\/server\/db|drizzle-orm/);
    }
  });
});
