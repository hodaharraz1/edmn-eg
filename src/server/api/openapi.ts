import { z } from 'zod';
import { API_ERROR_CODES, problem, problemSchema, type ApiErrorCode } from './errors';
import type { Api, RouteDef } from './http';
import { RATE_TIERS } from './rate-limit';
import { ADMIN_API_ROUTES, MOBILE_API_ROUTES } from './routes';

/**
 * OpenAPI 3.1 documents generated from the route definitions (the single source of truth). `scripts/openapi.ts`
 * writes them to openapi/*.json; tests/unit/openapi-contract.test.ts fails when the committed files drift, so every
 * contract change is reviewed as a diff. Flutter models are generated from these files.
 */
type Json = Record<string, unknown>;

const INFO: Record<Api, { title: string; description: string }> = {
  mobile: {
    title: 'EDMN Customer App API',
    description:
      'Customer App (buyers and sellers). Arabic is the default language; error `code` values are stable and are what the app localizes. Money is integer piastres. Real Money is OFF: payments are labelled TEST.',
  },
  admin: {
    title: 'EDMN Admin App API',
    description: 'Admin App (staff only). Every admin API requires a TOTP-verified session; sensitive actions require fresh 2FA (step-up). Phase 1 exposes no financial mutation.',
  },
};

class Components {
  schemas: Record<string, Json> = {};

  /** JSON Schema for `schema`, with named sub-schemas (`.meta({ id })`) hoisted into components. */
  convert(schema: z.ZodType, io: 'input' | 'output'): Json {
    const js = z.toJSONSchema(schema, {
      io,
      unrepresentable: 'any',
      target: 'draft-2020-12',
      // Responses may gain fields without a breaking change: clients must ignore unknown properties.
      override: (ctx) => {
        if (io === 'output' && ctx.jsonSchema.additionalProperties === false) delete ctx.jsonSchema.additionalProperties;
      },
    }) as Json;
    delete js.$schema;
    const defs = (js.$defs ?? {}) as Record<string, Json>;
    delete js.$defs;
    const rename: Record<string, string> = {};
    const rewrite = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(rewrite);
      if (v && typeof v === 'object') {
        const o: Json = {};
        for (const [k, x] of Object.entries(v as Json)) {
          if (k === '$ref' && typeof x === 'string' && x.startsWith('#/$defs/')) o[k] = `#/components/schemas/${rename[x.slice(8)] ?? x.slice(8)}`;
          else o[k] = rewrite(x);
        }
        return o;
      }
      return v;
    };
    // Same name, same shape → shared component; same name, different shape (input vs output view) → suffixed.
    for (const [name, def] of Object.entries(defs)) {
      const existing = this.schemas[name];
      if (existing && JSON.stringify(existing) !== JSON.stringify(rewrite(def))) rename[name] = `${name}${io === 'input' ? 'Input' : 'Output'}`;
    }
    for (const [name, def] of Object.entries(defs)) this.schemas[rename[name] ?? name] = rewrite(def) as Json;
    // A root schema with an id comes back as a bare $ref to its own hoisted definition.
    return rewrite(js) as Json;
  }
}

const STATUS_OF = (code: ApiErrorCode) => problem(code).status;

function errorCodesFor(def: RouteDef): ApiErrorCode[] {
  const codes = new Set<ApiErrorCode>(['validation_failed', 'rate_limited', 'internal_error', ...(def.errors ?? [])]);
  if (def.auth !== 'none' && def.auth !== 'optional-customer') codes.add('unauthenticated');
  if (def.auth === 'admin') codes.add('mfa_required');
  if (def.auth === 'seller') codes.add('seller_required');
  if (def.idempotency === 'required') ['idempotency_key_required', 'idempotency_key_reused', 'idempotency_in_progress'].forEach((c) => codes.add(c as ApiErrorCode));
  return [...codes].sort();
}

function parametersFrom(c: Components, schema: z.ZodType | undefined, where: 'path' | 'query'): Json[] {
  if (!schema) return [];
  const js = c.convert(schema, 'input') as { properties?: Record<string, Json>; required?: string[] };
  return Object.entries(js.properties ?? {}).map(([name, s]) => {
    const { description, ...rest } = s as Json & { description?: string };
    return { name, in: where, required: where === 'path' || (js.required ?? []).includes(name), ...(description ? { description } : {}), schema: rest };
  });
}

function operation(c: Components, def: RouteDef): Json {
  const params: Json[] = [...parametersFrom(c, def.params, 'path'), ...parametersFrom(c, def.query, 'query')];
  if (def.auth === 'none' || def.auth === 'optional-customer') {
    params.push({ name: 'X-EDMN-Installation', in: 'header', required: false, description: 'App installation id (per-installation rate limits).', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' } });
  }
  if (def.idempotency === 'required') {
    params.push({ name: 'Idempotency-Key', in: 'header', required: true, description: 'Unique per logical request; retries reuse it and receive the original response (header Idempotent-Replayed: true).', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' } });
  }
  const responses: Json = {
    [String(def.status ?? 200)]: { description: 'OK', content: { 'application/json': { schema: c.convert(def.response, 'output') } } },
  };
  const byStatus = new Map<number, ApiErrorCode[]>();
  for (const code of errorCodesFor(def)) byStatus.set(STATUS_OF(code), [...(byStatus.get(STATUS_OF(code)) ?? []), code]);
  for (const [status, codes] of [...byStatus.entries()].sort(([a], [b]) => a - b)) {
    responses[String(status)] = {
      description: `Problem: ${codes.join(', ')}`,
      'x-error-codes': codes,
      ...(status === 429 ? { headers: { 'Retry-After': { schema: { type: 'integer' } } } } : {}),
      content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
    };
  }
  const tier = RATE_TIERS[def.rate];
  return {
    operationId: def.id,
    summary: def.summary,
    ...(def.description ? { description: def.description } : {}),
    tags: def.tags,
    security: def.auth === 'none' ? [] : def.auth === 'optional-customer' ? [{}, { bearer: [] }] : [{ bearer: [] }],
    ...(params.length ? { parameters: params } : {}),
    ...(def.body ? { requestBody: { required: true, content: { 'application/json': { schema: c.convert(def.body, 'input') } } } } : {}),
    responses,
    'x-auth-mode': def.auth,
    'x-rate-limit': { tier: def.rate, perUser: tier.user, perInstallation: tier.installation, perIp: tier.ip },
    ...(def.idempotency ? { 'x-idempotency': def.idempotency } : {}),
  };
}

export function buildOpenApi(api: Api): Json {
  const routes = api === 'admin' ? ADMIN_API_ROUTES : MOBILE_API_ROUTES;
  const c = new Components();
  c.convert(problemSchema, 'output');
  c.schemas.ErrorCode = { type: 'string', enum: [...API_ERROR_CODES] };
  const paths: Record<string, Json> = {};
  for (const def of routes) {
    if (def.api !== api) throw new Error(`route ${def.id} registered under the wrong API`);
    paths[def.path] ??= {};
    paths[def.path][def.method.toLowerCase()] = operation(c, def);
  }
  const sortObj = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: '3.1.0',
    info: { ...INFO[api], version: '1.0.0-phase1' },
    servers: [{ url: 'https://edmneg.com', description: 'Production (Real Money OFF)' }],
    paths: sortObj(paths),
    components: {
      schemas: sortObj(c.schemas),
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'em1',
          description: api === 'admin' ? 'Admin App access token (ADMIN_MOBILE session, 10 minutes).' : 'Customer App access token (MOBILE session, 10 minutes).',
        },
      },
    },
  };
}
