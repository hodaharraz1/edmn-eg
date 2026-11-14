import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '@/server/core/env';
import { keyFor } from '@/server/core/keys';

/**
 * Delivery OTP primitives. The code proves PHYSICAL HANDOVER only; it never accepts the goods and
 * never releases money by itself.
 *
 * - Generated with the CSPRNG (`crypto.randomInt`), 6 digits.
 * - Stored only as an HMAC bound to (deal, OTP id), so a code for one deal / one issuance can never
 *   verify another, and a database leak does not reveal usable codes without the server secret.
 * - Key separation (Phase 1): codes issued from now on (hash version 2) are keyed with dedicated OTP key material
 *   (DELIVERY_OTP_KEY, src/server/core/keys.ts), never with the login/session secret. Version 1 codes (keyed with
 *   SESSION_SECRET before this change) can still be VERIFIED until they expire (≤ deals.deliveryOtpTtlHours); no new
 *   version-1 hash is ever written.
 * - The buyer's in-app copy is sealed with a second, purpose-separated OTP key (AES-256-GCM), not the data key, and is
 *   destroyed by the database when the code is used or invalidated.
 */
export const OTP_DIGITS = 6;
export const CURRENT_OTP_HASH_VERSION = 2;

export function generateDeliveryCode(): string {
  return String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, '0');
}

export function deliveryCodeHash(dealId: string, otpId: string, code: string, version: number = CURRENT_OTP_HASH_VERSION): string {
  if (version === 2) return createHmac('sha256', keyFor('delivery-otp-hmac')).update(`deal-delivery-otp:v2:${dealId}:${otpId}:${code}`).digest('hex');
  if (version === 1) return createHmac('sha256', env().SESSION_SECRET).update(`deal-delivery-otp:v1:${dealId}:${otpId}:${code}`).digest('hex');
  throw new Error(`unknown delivery OTP hash version ${version}`);
}

export function deliveryCodeMatches(stored: string, dealId: string, otpId: string, candidate: string, version: number = CURRENT_OTP_HASH_VERSION): boolean {
  if (!/^\d{6}$/.test(candidate)) return false;
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(deliveryCodeHash(dealId, otpId, candidate, version), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Seal the code for the buyer's in-app view. Bound to (deal, OTP id) as authenticated data: a copy cannot be moved. */
export function sealBuyerCode(dealId: string, otpId: string, code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor('delivery-otp-enc'), iv);
  cipher.setAAD(Buffer.from(`deal-delivery-otp-buyer:${dealId}:${otpId}`));
  const ct = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return `o1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

export function openBuyerCode(dealId: string, otpId: string, sealed: string): string {
  const [v, ivs, tags, cts] = sealed.split('.');
  if (v !== 'o1' || !ivs || !tags || !cts) throw new Error('unsupported sealed delivery code');
  const decipher = createDecipheriv('aes-256-gcm', keyFor('delivery-otp-enc'), Buffer.from(ivs, 'base64url'));
  decipher.setAAD(Buffer.from(`deal-delivery-otp-buyer:${dealId}:${otpId}`));
  decipher.setAuthTag(Buffer.from(tags, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cts, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * Staging / development only: no SMS provider is configured yet, so the authenticated BUYER (and only
 * the buyer) can see the current code on their deal page, labelled "رمز تجريبي — بيئة Staging".
 * Production never returns this test copy (the buyer's in-app view uses the sealed copy above).
 */
export function deliveryOtpTestMode(): boolean {
  if (process.env.EDMN_ENVIRONMENT === 'production') return false;
  return process.env.EDMN_ENVIRONMENT === 'staging' || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}
