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

function key(): Buffer {
  const raw = env().DATA_ENCRYPTION_KEY;
  // Accept base64 32-byte keys; otherwise derive a 32-byte key deterministically.
  const b = Buffer.from(raw, 'base64');
  return b.length === 32 ? b : createHash('sha256').update(raw).digest();
}

/** AES-256-GCM field encryption for highly sensitive data (national IDs, payout details, TOTP secrets). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

export function decrypt(payload: string): string {
  const [v, ivs, tags, cts] = payload.split('.');
  if (v !== 'v1' || !ivs || !tags || !cts) throw new Error('Unsupported ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivs, 'base64url'));
  decipher.setAuthTag(Buffer.from(tags, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cts, 'base64url')), decipher.final()]).toString('utf8');
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
