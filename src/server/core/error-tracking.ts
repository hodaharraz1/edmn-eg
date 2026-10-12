import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { sanitizeError } from './logger';
import { runtimeEnvironment } from './runtime-env';

/**
 * PROVIDER-NEUTRAL ERROR TRACKING (Batch 2).
 * Every captured error is reduced to the logger's safe shape (no query parameters, no row values, no secrets,
 * no request bodies), grouped by a fingerprint in `error_events`, and — only when ERROR_TRACKING_DSN is set —
 * forwarded as the same redacted JSON (POST, 3 s timeout, failures ignored). Without a DSN the report is
 * "ERROR TRACKING: INTERNAL ONLY (provider not configured)".
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

export async function captureError(e: unknown, ctx: CaptureContext): Promise<string | null> {
  try {
    const { db } = await import('@/server/db/client');
    const f = errorFingerprint(e, ctx.source);
    const environment = runtimeEnvironment();
    const requestId = ctx.requestId && /^[\w-]{1,64}$/.test(ctx.requestId) ? ctx.requestId : null;
    await db.execute(sql`insert into error_events (fingerprint, name, code, message, source, route, last_request_id, environment)
      values (${f.fingerprint}, ${f.name}, ${f.code}, ${f.message}, ${ctx.source}, ${ctx.route?.slice(0, 200) ?? null}, ${requestId}, ${environment})
      on conflict (fingerprint) do update set occurrences = error_events.occurrences + 1, last_seen_at = now(), last_request_id = excluded.last_request_id`);
    const dsn = process.env.ERROR_TRACKING_DSN;
    if (dsn) {
      void fetch(dsn, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...f, source: ctx.source, route: ctx.route ?? null, requestId, environment, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(3000),
      })
        .then(() => db.execute(sql`update error_events set forwarded_at = now() where fingerprint = ${f.fingerprint}`))
        .catch(() => {});
    }
    return f.fingerprint;
  } catch {
    return null; // error tracking must never break the request it observes
  }
}

export function errorTrackingStatus() {
  return process.env.ERROR_TRACKING_DSN ? 'EXTERNAL_CONFIGURED_UNVERIFIED' : 'INTERNAL_ONLY_PROVIDER_NOT_CONFIGURED';
}
