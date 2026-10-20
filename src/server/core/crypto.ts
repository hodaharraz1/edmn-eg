import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/** URL-safe random token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmac(input: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ─────────── Versioned key ring (Batch 2) ───────────
 * v1.<iv>.<tag>.<ct>         historical format: no key id, encrypted with the key that was primary at the time.
 * v2.<kid>.<iv>.<tag>.<ct>   written when DATA_ENCRYPTION_KEY_ID is set; decrypt looks the key up by id.
 * Rotation (docs/runbooks/SECRET_ROTATION.md): new key + new id becomes primary, the old key moves to
 * DATA_ENCRYPTION_KEYS_PREVIOUS ("kid:base64,…") so every historical ciphertext (KYC, payout details, TOTP) stays
 * readable; `scripts/reencrypt.ts` re-wraps rows on demand (dry-run by default). Keys are never logged.
 */
function material(raw: string): Buffer {
  // Accept base64 32-byte keys; otherwise derive a 32-byte key deterministically.
  const b = Buffer.from(raw, 'base64');
  return b.length === 32 ? b : createHash('sha256').update(raw).digest();
}

export function primaryKeyId(): string {
  return process.env.DATA_ENCRYPTION_KEY_ID || 'default';
}

function key(): Buffer {
  return material(env().DATA_ENCRYPTION_KEY);
}

function previousKeys(): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const part of (process.env.DATA_ENCRYPTION_KEYS_PREVIOUS ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i > 0) out.set(part.slice(0, i), material(part.slice(i + 1)));
  }
  return out;
}

/** HMAC of a constant under the primary key: identifies the key without revealing it. */
export function keyCheckValue(): string {
  return createHmac('sha256', key()).update('edmn-key-check-value-v1').digest('hex').slice(0, 32);
}

function open(k: Buffer, ivs: string, tags: string, cts: string): string {
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivs, 'base64url'));
  decipher.setAuthTag(Buffer.from(tags, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cts, 'base64url')), decipher.final()]).toString('utf8');
}

/** AES-256-GCM field encryption for highly sensitive data (national IDs, payout details, TOTP secrets). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = `${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
  return process.env.DATA_ENCRYPTION_KEY_ID ? `v2.${primaryKeyId()}.${body}` : `v1.${body}`;
}

export function decrypt(payload: string): string {
  const parts = payload.split('.');
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, kid, ivs, tags, cts] = parts;
    const k = kid === primaryKeyId() ? key() : previousKeys().get(kid);
    if (!k) throw new Error('Unknown encryption key id');
    return open(k, ivs, tags, cts);
  }
  const [v, ivs, tags, cts] = parts;
  if (v !== 'v1' || !ivs || !tags || !cts) throw new Error('Unsupported ciphertext');
  // v1 carries no key id: the primary key first, then each previous key (the GCM tag rejects a wrong key).
  try {
    return open(key(), ivs, tags, cts);
  } catch (e) {
    for (const k of previousKeys().values()) {
      try {
        return open(k, ivs, tags, cts);
      } catch {
        /* next */
      }
    }
    throw e;
  }
}

/** True when the ciphertext is not written with the current primary key id (re-encryption candidate). */
export function needsReencryption(payload: string): boolean {
  const parts = payload.split('.');
  if (!process.env.DATA_ENCRYPTION_KEY_ID) return false;
  return !(parts[0] === 'v2' && parts[1] === primaryKeyId());
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}
export function decryptJson<T>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}

/** Mask all but the last `visible` characters: "01012345678" -> "•••••••5678" */
export function mask(value: string | null | undefined, visible = 4): string {
  if (!value) return '';
  const v = String(value);
  if (v.length <= visible) return '•'.repeat(v.length);
  return '•'.repeat(Math.min(8, v.length - visible)) + v.slice(-visible);
}
