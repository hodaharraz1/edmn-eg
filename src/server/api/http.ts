import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RequestContext } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { logger } from '@/server/core/logger';
import { clientIp } from '@/server/web/client-ip';
import { authenticate, type AuthMode } from './authenticate';
import { ApiError, toProblem, type ApiErrorCode } from './errors';
import { abandonIdempotent, beginIdempotent, completeIdempotent, type IdemClaim } from './idempotency';
import { enforceApiRateLimit, installationIdFrom, type RateTier } from './rate-limit';

/**
 * Mobile API route definitions (Phase 1).
 *
 * A route is DATA: method, path, audience, auth mode, rate tier, idempotency, zod schemas for params/query/body and
 * the response, and a handler that calls a domain service. The same definition drives
 *   1. the Next.js route handler (`toHandler`, exported by a thin src/app/api/v1/.../route.ts file),
 *   2. the OpenAPI 3.1 contract (scripts/openapi.ts → openapi/*.json, diffed in CI),
 * so the contract cannot drift from the implementation.
 *
 * Route handlers never touch the database: they receive an Actor and call services, which own authorization and
 * transactions (enforced by an ESLint import restriction). Responses are parsed through the response schema, which
 * strips every field not declared in the contract (allow-list), so an internal column can never leak by accident.
 */
export type Api = 'mobile' | 'admin';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HandlerInput<P, Q, B> {
  req: Request;
  params: P;
  query: Q;
  body: B;
  actor: Actor | null;
  /** Request attribution for services that take RequestMeta (login, refresh, MFA). */
  meta: RequestContext & { installationId: string | null };
  deviceId: string | null;
  /** Uploaded files by form field (multipart routes only). Bytes are validated by the storage layer, never trusted. */
  files: Record<string, UploadedFile[]>;
}

export interface UploadedFile {
  data: Buffer;
  name: string;
}

/** A private file returned by a `binary` route (authorization already enforced by the service). */
export interface BinaryResult {
  data: Buffer | Uint8Array;
  contentType: string;
  filename: string;
}

export interface RouteDef<P extends z.ZodType = z.ZodType, Q extends z.ZodType = z.ZodType, B extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  id: string;
  api: Api;
  method: HttpMethod;
  /** OpenAPI path, e.g. /api/v1/catalog/products/{slug} */
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  auth: AuthMode;
  rate: RateTier;
  /** 'required': the client MUST send Idempotency-Key; the response is replayed for retries. */
  idempotency?: 'required';
  /** Stable error codes this route can return besides the generic ones (documented in the contract). */
  errors?: ApiErrorCode[];
  params?: P;
  query?: Q;
  body?: B;
  response: R;
  status?: 200 | 201 | 202;
  /** Public reads only: allow shared caches for this many seconds. */
  cacheSeconds?: number;
  /**
   * multipart/form-data route: text fields are validated by `body` (use z.coerce for numbers); each listed file field
   * accepts up to `max` files. JSON bodies are refused on such a route and vice versa.
   */
  multipart?: { files: Record<string, { max: number; required?: boolean }> };
  /** The handler returns a BinaryResult (private file download); `response` only documents the JSON error shape. */
  binary?: true;
  handler: (input: HandlerInput<z.output<P>, z.output<Q>, z.output<B>>) => Promise<z.input<R>>;
}

export function defineRoute<P extends z.ZodType = z.ZodObject<Record<never, never>>, Q extends z.ZodType = z.ZodObject<Record<never, never>>, B extends z.ZodType = z.ZodUndefined, R extends z.ZodType = z.ZodType>(
  def: RouteDef<P, Q, B, R>,
): RouteDef<P, Q, B, R> {
  return def;
}

const PROBLEM_CT = 'application/problem+json';

function json(status: number, body: unknown, headers: Record<string, string>, contentType = 'application/json') {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': `${contentType}; charset=utf-8`, ...headers } });
}

async function readBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return undefined;
  if (text.length > 256 * 1024) throw new ApiError('validation_failed', undefined, { issues: [{ path: '', code: 'too_big' }] });
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) throw new ApiError('validation_failed', undefined, { issues: [{ path: '', code: 'unsupported_media_type' }] });
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('validation_failed', undefined, { issues: [{ path: '', code: 'invalid_json' }] });
  }
}

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

async function readMultipart(req: Request, spec: NonNullable<RouteDef['multipart']>): Promise<{ fields: Record<string, string>; files: Record<string, UploadedFile[]>; digest: unknown }> {
  if (!/^multipart\/form-data\b/i.test(req.headers.get('content-type') ?? '')) throw new ApiError('validation_failed', undefined, { issues: [{ path: '', code: 'unsupported_media_type' }] });
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES) throw new ApiError('validation_failed', undefined, { issues: [{ path: '', code: 'too_big' }] });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError('validation_failed', undefined, { issues: [{ path: '', code: 'invalid_multipart' }] });
  }
  const fields: Record<string, string> = {};
  const files: Record<string, UploadedFile[]> = {};
  const digest: Record<string, string[]> = {};
  let total = 0;
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') {
      fields[key] = value;
      continue;
    }
    const rule = spec.files[key];
    if (!rule) throw new ApiError('validation_failed', undefined, { issues: [{ path: key, code: 'unexpected_file' }] });
    const data = Buffer.from(await value.arrayBuffer());
    total += data.length;
    if (total > MAX_UPLOAD_BYTES) throw new ApiError('validation_failed', undefined, { issues: [{ path: key, code: 'too_big' }] });
    if (!data.length) continue;
    (files[key] ??= []).push({ data, name: (value.name || 'upload').slice(0, 200) });
    (digest[key] ??= []).push(createHash('sha256').update(data).digest('hex'));
    if (files[key].length > rule.max) throw new ApiError('validation_failed', undefined, { issues: [{ path: key, code: 'too_many_files' }] });
  }
  for (const [key, rule] of Object.entries(spec.files)) {
    if (rule.required && !files[key]?.length) throw new ApiError('validation_failed', undefined, { issues: [{ path: key, code: 'required' }] });
  }
  return { fields, files, digest: { fields, files: digest } };
}

type NextCtx = { params: Promise<Record<string, string | string[] | undefined>> };

/** Next.js route handler for a definition. */
export function toHandler(def: RouteDef) {
  return async function handler(req: Request, ctx: NextCtx): Promise<Response> {
    const rid = req.headers.get('x-request-id');
    const requestId = rid && /^[\w-]{1,64}$/.test(rid) ? rid : randomUUID();
    const base: Record<string, string> = { 'x-request-id': requestId, 'cache-control': 'no-store', 'content-language': 'ar' };
    let claim: IdemClaim | null = null;
    try {
      const installationId = installationIdFrom(req);
      const meta = { ip: clientIp(req.headers), userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null, requestId, installationId };
      const auth = await authenticate(req, def.auth, meta);
      await enforceApiRateLimit(def.rate, def.id, { userId: auth.userId, installationId, ip: meta.ip });

      const rawParams = await ctx.params;
      const params = def.params ? def.params.parse(rawParams) : {};
      const url = new URL(req.url);
      const query = def.query ? def.query.parse(Object.fromEntries(url.searchParams)) : {};
      let rawBody: unknown;
      let files: Record<string, UploadedFile[]> = {};
      let bodyInput: unknown;
      if (def.multipart) {
        const m = await readMultipart(req, def.multipart);
        files = m.files;
        bodyInput = m.fields;
        rawBody = m.digest; // idempotency hash covers the fields and the SHA-256 of every file
      } else {
        rawBody = def.method === 'GET' || def.method === 'DELETE' ? undefined : await readBody(req);
        bodyInput = rawBody ?? {};
      }
      const body = def.body ? def.body.parse(bodyInput) : undefined;

      if (def.idempotency === 'required') {
        const owner = auth.userId ? `u:${auth.userId}` : installationId ? `i:${installationId}` : null;
        if (!owner) throw new ApiError('validation_failed', undefined, { issues: [{ path: 'X-EDMN-Installation', code: 'required' }] });
        const o = await beginIdempotent(req, owner, rawBody);
        if (o.kind === 'replay') return json(o.status, o.body, { ...base, 'idempotent-replayed': 'true' });
        claim = o.claim;
      }

      const out = await def.handler({
        req,
        params,
        query,
        body,
        actor: auth.actor,
        meta: { ...meta, channel: auth.actor?.channel ?? null, deviceId: auth.deviceId },
        deviceId: auth.deviceId,
        files,
      });
      if (def.binary) {
        const b = out as unknown as BinaryResult;
        return new Response(new Uint8Array(b.data), {
          status: 200,
          headers: {
            ...base,
            'content-type': b.contentType,
            'content-disposition': `inline; filename="${b.filename.replace(/[^\w.-]/g, '_')}"`,
            'cache-control': 'private, no-store',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; sandbox",
          },
        });
      }
      const status = def.status ?? 200;
      const payload = def.response.parse(out);
      if (claim) await completeIdempotent(claim, status, payload);
      const headers = { ...base };
      if (def.cacheSeconds && def.auth === 'none' && def.method === 'GET') headers['cache-control'] = `public, max-age=${def.cacheSeconds}, stale-while-revalidate=${def.cacheSeconds * 5}`;
      return json(status, payload, headers);
    } catch (e) {
      if (claim) await abandonIdempotent(claim).catch(() => undefined);
      const { problem, retryAfterSeconds, unexpected } = toProblem(e);
      if (unexpected) {
        logger.error('api.failed', { ref: requestId, route: def.id, error: e as Error });
        const { captureError } = await import('@/server/core/error-tracking');
        await captureError(e, { source: 'request', route: def.id, requestId });
        problem.reference = requestId;
      }
      const headers = { ...base };
      if (retryAfterSeconds) headers['retry-after'] = String(Math.max(1, Math.ceil(retryAfterSeconds)));
      if (problem.code === 'unauthenticated') headers['www-authenticate'] = 'Bearer realm="edmn"';
      return json(problem.status, problem, headers, PROBLEM_CT);
    }
  };
}
