import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '@/server/core/env';

/**
 * Delivery OTP primitives. The code proves PHYSICAL HANDOVER only; it never accepts the goods and
 * never releases money by itself.
 *
 * - Generated with the CSPRNG (`crypto.randomInt`), 6 digits.
 * - Stored only as an HMAC bound to (deal, OTP id), so a code for one deal / one issuance can never
 *   verify another, and a database leak does not reveal usable codes without the server secret.
 */
export const OTP_DIGITS = 6;

export function generateDeliveryCode(): string {
  return String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, '0');
}

export function deliveryCodeHash(dealId: string, otpId: string, code: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(`deal-delivery-otp:v1:${dealId}:${otpId}:${code}`).digest('hex');
}

export function deliveryCodeMatches(stored: string, dealId: string, otpId: string, candidate: string): boolean {
  if (!/^\d{6}$/.test(candidate)) return false;
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(deliveryCodeHash(dealId, otpId, candidate), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Staging / development only: no SMS provider is configured yet, so the authenticated BUYER (and only
 * the buyer) can see the current code on their deal page, labelled "رمز تجريبي — بيئة Staging".
 * Production never stores a recoverable copy.
 */
export function deliveryOtpTestMode(): boolean {
  if (process.env.EDMN_ENVIRONMENT === 'production') return false;
  return process.env.EDMN_ENVIRONMENT === 'staging' || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}
