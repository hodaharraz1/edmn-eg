import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * NON-PRODUCTION FINGERPRINTS (production infrastructure batch). Production refuses to boot with a resource or
 * secret that is known to belong to staging / test. Only one-way check values live here — never a secret:
 *   key check value   HMAC-SHA256(key, constant) truncated (the same KCV staging stores in secret_fingerprints)
 *   endpoint hash     SHA-256("neon-endpoint:" + endpoint id) truncated (the staging database endpoint)
 *   secret check value HMAC-SHA256(secret, "edmn-secret-check-value-v1:" + name) truncated — recorded once by the
 *                     staging runtime in the append-only secret_fingerprints table, read from there (never the secret)
 * Membership is tested in constant time. If a list is ever emptied, production refuses to boot (protection missing).
 */
export const NONPROD_DATA_KEY_KCVS: readonly string[] = [
  'a13bf70529f59063208e40ab245f5cf3', // staging DATA_ENCRYPTION_KEY:default (recorded by staging, 2026)
];
export const NONPROD_SECRET_KCVS: readonly string[] = [
  '046b259e66b8afdb945d73513116c8d5', // staging SESSION_SECRET (recorded by staging, 2026-10-13)
  'a04f72714d485dd43761fa7de1952077', // staging CRON_SECRET (recorded by staging, 2026-10-13)
];
export const NONPROD_DB_ENDPOINT_HASHES: readonly string[] = [
  '342d9dfda5036f1d845a1096c3cabb98', // staging Neon endpoint (pooled and direct share the endpoint id)
];

/** Check value of a non-key secret (SESSION_SECRET / CRON_SECRET), bound to its name. */
export function secretCheckValue(name: string, value: string): string {
  return createHmac('sha256', value).update(`edmn-secret-check-value-v1:${name}`).digest('hex').slice(0, 32);
}

/** Same derivation as crypto.keyCheckValue (same key material rule), from the raw env value. Pure. */
export function dataKeyCheckValue(raw: string): string {
  const b = Buffer.from(raw, 'base64');
  const k = b.length === 32 ? b : createHash('sha256').update(raw).digest();
  return createHmac('sha256', k).update('edmn-key-check-value-v1').digest('hex').slice(0, 32);
}

/** Endpoint hash of a Postgres URL (Neon endpoint id, or the host for other providers). */
export function databaseEndpointHash(url: string): string | null {
  const m = url.match(/@([^/:?]+)/);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const ep = host.endsWith('.neon.tech') ? host.split('.')[0].replace(/-pooler$/, '') : host;
  return createHash('sha256').update(`neon-endpoint:${ep}`).digest('hex').slice(0, 32);
}

/** Constant-time membership test for check values (no early exit on the first differing byte). */
export function matchesFingerprint(list: readonly string[], value: string): boolean {
  const v = Buffer.from(value);
  let hit = false;
  for (const item of list) {
    const b = Buffer.from(item);
    if (b.length === v.length && timingSafeEqual(b, v)) hit = true;
  }
  return hit;
}
