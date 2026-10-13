import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { sanitizeError, scrubText } from './logger';
import { runtimeEnvironment } from './runtime-env';

/**
 * ERROR TRACKING (Batch 2 + production infrastructure batch).
 *
 *   internal   every captured error is reduced to the logger's safe shape and grouped by fingerprint in
 *              `error_events` — always, and authoritative (the Ops page reads it).
 *   external   only when ERROR_TRACKING_DSN is set, the same redacted event is forwarded through an adapter:
 *                sentry   DSN `https://<publicKey>@<host>/<projectId>` → Sentry envelope endpoint, X-Sentry-Auth
 *                webhook  any other https URL → JSON POST, `Authorization: Bearer ERROR_TRACKING_TOKEN` when set
 *              Provider chosen by ERROR_TRACKING_PROVIDER (sentry | webhook) or detected from the DSN.
 *   safety     3 s timeout, one retry on network / 429 / 5xx, at most one forward per fingerprint per 10 minutes
 *              (an error storm never floods the provider), failures are swallowed and recorded as provider health.
 *              The application never fails because error tracking fails.
 *   privacy    no request bodies, headers, cookies, query strings, users, IPs or record values are ever sent;
 *              messages, routes and stack lines pass through `redactForTracking` (credentials, tokens, emails,
 *              phone / national-ID / account numbers, DB URLs). PII-free by default (send_default_pii is never on).
 */
export interface CaptureContext {
  source: 'action' | 'request' | 'job' | 'schedule' | 'other';
  route?: string | null;
  requestId?: string | null;
}

export function errorFingerprint(e: unknown, source: string): { fingerprint: string; name: string; code: string | null; message: string } {
  const s = sanitizeError(e);
  const root = s.cause ?? s;
  const frame = (s.stack ?? [])[0] ?? '';
  // Numbers / ids in messages would split one bug into many groups.
  const shape = s.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>').replace(/\d+/g, '<n>');
  const fingerprint = createHash('sha256').update(`${source}|${s.name}|${root.code ?? ''}|${shape}|${frame.replace(/:\d+:\d+\)?$/, '')}`).digest('hex').slice(0, 32);
  return { fingerprint, name: s.name.slice(0, 80), code: root.code ?? null, message: s.message.slice(0, 300) };
}

/**
 * Last line of defence before anything leaves the platform. On top of the logger scrub: every digit run long
 * enough to be an OTP / TOTP, phone, national ID, IBAN or account number, private file / message ids in paths,
 * secret-bearing path segments (invite / reset tokens) and any query string.
 */
export function redactForTracking(text: string): string {
  return scrubText(text)
    .replace(/\?[^\s)]*/g, '?[REDACTED_QUERY]')
    .replace(/\/(invite|reset-password|verify|files|attachments|media\/private)\/[^\s/)]+/gi, '/$1/[REDACTED]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\+?\d[\d\s-]{4,}\d/g, '[REDACTED_NUMBER]')
    .replace(/\b(sk|pk|rk|whsec|napi|rnd|hf|ghp|vcp)_[A-Za-z0-9_-]{8,}/g, '[REDACTED_TOKEN]');
}

export interface TrackedEvent {
  eventId: string;
  fingerprint: string;
  name: string;
  code: string | null;
  message: string;
  source: string;
  route: string | null;
  requestId: string | null;
  environment: string;
  release: string | null;
  frames: string[];
  at: string;
}

export interface ErrorTransport {
  name: 'sentry' | 'webhook';
  send(ev: TrackedEvent): Promise<void>;
}

/** Release / commit tag when the platform provides one (Vercel exposes the git SHA at build and runtime). */
export function releaseTag(raw: Record<string, string | undefined> = process.env): string | null {
  const v = raw.EDMN_RELEASE || raw.VERCEL_GIT_COMMIT_SHA || null;
  return v && /^[\w.-]{4,64}$/.test(v) ? v.slice(0, 40) : null;
}

export function parseSentryDsn(dsn: string): { endpoint: string; publicKey: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+|\/+$/g, '');
    if (u.protocol !== 'https:' || !u.username || !/^\d+$/.test(projectId.split('/').pop() ?? '')) return null;
    const prefix = projectId.split('/').slice(0, -1).join('/');
    const id = projectId.split('/').pop();
    return { endpoint: `https://${u.host}/${prefix ? `${prefix}/` : ''}api/${id}/envelope/`, publicKey: decodeURIComponent(u.username) };
  } catch {
    return null;
  }
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`error tracker responded ${status}`);
  }
}

async function post(url: string, init: RequestInit, timeoutMs = 3000): Promise<void> {
  const res = await fetchImpl(url, { ...init, method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpStatusError(res.status);
}

function sentryTransport(dsn: string): ErrorTransport | null {
  const p = parseSentryDsn(dsn);
  if (!p) return null;
  return {
    name: 'sentry',
    async send(ev) {
      const event = {
        event_id: ev.eventId,
        timestamp: ev.at,
        platform: 'node',
        level: 'error',
        logger: 'edmn',
        environment: ev.environment.toLowerCase(),
        ...(ev.release ? { release: ev.release } : {}),
        fingerprint: [ev.fingerprint],
        tags: { source: ev.source, ...(ev.code ? { code: ev.code } : {}), ...(ev.requestId ? { request_id: ev.requestId } : {}) },
        transaction: ev.route ?? undefined,
        exception: {
          values: [
            {
              type: ev.name,
              value: ev.message,
              stacktrace: ev.frames.length ? { frames: ev.frames.slice().reverse().map((f) => ({ function: f.slice(0, 200), in_app: !/node_modules/.test(f) })) } : undefined,
            },
          ],
        },
      };
      const body = `${JSON.stringify({ event_id: ev.eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
      await post(p.endpoint, {
        headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': `Sentry sentry_version=7, sentry_client=edmn/1.0, sentry_key=${p.publicKey}` },
        body,
      });
    },
  };
}

function webhookTransport(url: string, token?: string): ErrorTransport | null {
  if (!/^https:\/\//.test(url)) return null;
  return {
    name: 'webhook',
    async send(ev) {
      await post(url, { headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(ev) });
    },
  };
}

/** Adapter for the current configuration, or null (internal only). */
export function errorTransport(raw: Record<string, string | undefined> = process.env): ErrorTransport | null {
  const dsn = raw.ERROR_TRACKING_DSN;
  if (!dsn) return null;
  const kind = raw.ERROR_TRACKING_PROVIDER ?? (parseSentryDsn(dsn) ? 'sentry' : 'webhook');
  return kind === 'sentry' ? sentryTransport(dsn) : webhookTransport(dsn, raw.ERROR_TRACKING_TOKEN);
}

let fetchImpl: typeof fetch = (...a) => fetch(...a);
let transportOverride: ErrorTransport | null | undefined;
/** Tests only. */
export function setErrorTrackingForTests(opts: { fetch?: typeof fetch; transport?: ErrorTransport | null } = {}) {
  fetchImpl = opts.fetch ?? ((...a) => fetch(...a));
  transportOverride = 'transport' in opts ? opts.transport : undefined;
  lastForward.clear();
}

const THROTTLE_MS = 10 * 60_000;
const lastForward = new Map<string, number>();

/** Forwards one event; one retry on transient failures. Resolves either way (never rejects). */
export async function forwardEvent(t: ErrorTransport, ev: TrackedEvent): Promise<boolean> {
  const { recordProviderResult } = await import('@/server/ops/provider-health');
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await t.send(ev);
      await recordProviderResult('ERROR_TRACKING', true);
      return true;
    } catch (e) {
      const transient = !(e instanceof HttpStatusError) || e.status === 429 || e.status >= 500;
      if (attempt === 2 || !transient) {
        await recordProviderResult('ERROR_TRACKING', false, e);
        return false;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

/** Pending forward (tests await it; production never waits for the external tracker). */
export let lastForwardPromise: Promise<boolean> | null = null;

export async function captureError(e: unknown, ctx: CaptureContext): Promise<string | null> {
  try {
    const { db } = await import('@/server/db/client');
    const f = errorFingerprint(e, ctx.source);
    const environment = runtimeEnvironment();
    const requestId = ctx.requestId && /^[\w-]{1,64}$/.test(ctx.requestId) ? ctx.requestId : null;
    await db.execute(sql`insert into error_events (fingerprint, name, code, message, source, route, last_request_id, environment)
      values (${f.fingerprint}, ${f.name}, ${f.code}, ${f.message}, ${ctx.source}, ${ctx.route?.slice(0, 200) ?? null}, ${requestId}, ${environment})
      on conflict (fingerprint) do update set occurrences = error_events.occurrences + 1, last_seen_at = now(), last_request_id = excluded.last_request_id`);
    const transport = transportOverride !== undefined ? transportOverride : errorTransport();
    const now = Date.now();
    if (transport && now - (lastForward.get(f.fingerprint) ?? 0) >= THROTTLE_MS) {
      lastForward.set(f.fingerprint, now);
      const s = sanitizeError(e);
      const ev: TrackedEvent = {
        eventId: randomUUID().replace(/-/g, ''),
        fingerprint: f.fingerprint,
        name: redactForTracking(f.name),
        code: f.code,
        message: redactForTracking(f.message),
        source: ctx.source,
        route: ctx.route ? redactForTracking(ctx.route).slice(0, 200) : null,
        requestId,
        environment,
        release: releaseTag(),
        frames: (s.stack ?? []).slice(0, 8).map(redactForTracking),
        at: new Date(now).toISOString(),
      };
      lastForwardPromise = forwardEvent(transport, ev).then(async (ok) => {
        if (ok) await db.execute(sql`update error_events set forwarded_at = now() where fingerprint = ${f.fingerprint}`).catch(() => {});
        return ok;
      });
    }
    return f.fingerprint;
  } catch {
    return null; // error tracking must never break the request it observes
  }
}

/** Kept for the Ops page text; the evidence-based status is in provider-health (ERROR_TRACKING). */
export function errorTrackingStatus() {
  const t = errorTransport();
  if (!process.env.ERROR_TRACKING_DSN) return 'INTERNAL_ONLY_PROVIDER_NOT_CONFIGURED';
  return t ? `EXTERNAL_${t.name.toUpperCase()}_CONFIGURED` : 'EXTERNAL_DSN_INVALID';
}
