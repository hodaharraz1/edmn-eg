import { createHash, hkdfSync } from 'node:crypto';
import { runtimeEnvironment } from './runtime-env';

/**
 * Purpose-separated key material (Phase 1, mobile).
 *
 * Login/session secrets (SESSION_SECRET) and data-at-rest keys (DATA_ENCRYPTION_KEY) are never used for:
 *   - Protected Deal delivery OTPs   → DELIVERY_OTP_KEY   (HKDF → one HMAC key + one AES-256-GCM key)
 *   - mobile access tokens           → MOBILE_TOKEN_KEY   (HKDF → one HMAC key)
 *
 * Hosted environments (STAGING / PRODUCTION) must provide each secret explicitly; using one fails closed when missing.
 * LOCAL / TEST derive a deterministic development key from a fixed, public label so a fresh checkout works — such a key
 * protects nothing and the environment policy refuses it on hosted deployments (they never fall back).
 */
export type KeyPurpose = 'delivery-otp-hmac' | 'delivery-otp-enc' | 'mobile-access-token';

const SOURCE: Record<KeyPurpose, 'DELIVERY_OTP_KEY' | 'MOBILE_TOKEN_KEY'> = {
  'delivery-otp-hmac': 'DELIVERY_OTP_KEY',
  'delivery-otp-enc': 'DELIVERY_OTP_KEY',
  'mobile-access-token': 'MOBILE_TOKEN_KEY',
};

export class KeyMaterialMissing extends Error {
  constructor(name: string) {
    super(`${name} is required in hosted environments (dedicated key material, never derived from other secrets)`);
    this.name = 'KeyMaterialMissing';
  }
}

function secretFor(name: 'DELIVERY_OTP_KEY' | 'MOBILE_TOKEN_KEY', raw: Record<string, string | undefined>): string {
  const v = raw[name];
  if (v && v.length >= 32) return v;
  const kind = runtimeEnvironment(raw);
  if (kind === 'STAGING' || kind === 'PRODUCTION') throw new KeyMaterialMissing(name);
  // Development-only material: public by construction, never accepted on a hosted deployment (see above).
  return `edmn-local-development-only:${name}`;
}

const cache = new Map<string, Buffer>();

/** 32-byte key for one purpose (HKDF-SHA256 with the purpose as `info`, so purposes never share bytes). */
export function keyFor(purpose: KeyPurpose, raw: Record<string, string | undefined> = process.env): Buffer {
  const name = SOURCE[purpose];
  const secret = secretFor(name, raw);
  const id = `${purpose}:${createHash('sha256').update(secret).digest('hex')}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const k = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('edmn-key-separation-v1'), Buffer.from(purpose), 32));
  cache.set(id, k);
  return k;
}
