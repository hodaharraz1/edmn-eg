import { describe, expect, it } from 'vitest';
import { keyFor, KeyMaterialMissing } from '@/server/core/keys';
import { validateEnvironment } from '@/server/core/runtime-env';

const LONG = (c: string) => c.repeat(48);

describe('key separation (Phase 1)', () => {
  it('every purpose derives different bytes, even from the same source secret', () => {
    const raw = { DELIVERY_OTP_KEY: LONG('a'), MOBILE_TOKEN_KEY: LONG('b'), EDMN_ENVIRONMENT: 'production' };
    const otpHmac = keyFor('delivery-otp-hmac', raw);
    const otpEnc = keyFor('delivery-otp-enc', raw);
    const token = keyFor('mobile-access-token', raw);
    expect(otpHmac).toHaveLength(32);
    expect(otpHmac.equals(otpEnc)).toBe(false);
    expect(otpHmac.equals(token)).toBe(false);
    expect(otpEnc.equals(token)).toBe(false);
  });

  it('OTP and token keys never derive from SESSION_SECRET', () => {
    const a = keyFor('delivery-otp-hmac', { DELIVERY_OTP_KEY: LONG('c'), SESSION_SECRET: LONG('s') });
    const b = keyFor('delivery-otp-hmac', { DELIVERY_OTP_KEY: LONG('c'), SESSION_SECRET: LONG('t') });
    expect(a.equals(b)).toBe(true);
    const c = keyFor('mobile-access-token', { MOBILE_TOKEN_KEY: LONG('d'), SESSION_SECRET: LONG('s') });
    expect(c.equals(keyFor('mobile-access-token', { MOBILE_TOKEN_KEY: LONG('d'), SESSION_SECRET: LONG('u') }))).toBe(true);
  });

  it('hosted environments fail closed without dedicated key material (no fallback)', () => {
    for (const env of ['staging', 'production']) {
      expect(() => keyFor('delivery-otp-hmac', { EDMN_ENVIRONMENT: env, SESSION_SECRET: LONG('s') })).toThrow(KeyMaterialMissing);
      expect(() => keyFor('mobile-access-token', { EDMN_ENVIRONMENT: env, SESSION_SECRET: LONG('s') })).toThrow(KeyMaterialMissing);
      expect(() => keyFor('delivery-otp-enc', { EDMN_ENVIRONMENT: env, DELIVERY_OTP_KEY: 'short' })).toThrow(KeyMaterialMissing);
    }
  });

  it('local/test fall back to a public development key only', () => {
    expect(keyFor('delivery-otp-hmac', { NODE_ENV: 'test' })).toHaveLength(32);
  });

  it('the environment policy requires distinct, non-placeholder keys (fatal in production, reported in staging)', () => {
    const base: Record<string, string> = {
      EDMN_ENVIRONMENT: 'production',
      SESSION_SECRET: LONG('s'),
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      CRON_SECRET: LONG('r'),
    };
    const missing = validateEnvironment(base).errors.join('\n');
    expect(missing).toMatch(/DELIVERY_OTP_KEY/);
    expect(missing).toMatch(/MOBILE_TOKEN_KEY/);
    const same = validateEnvironment({ ...base, DELIVERY_OTP_KEY: LONG('s'), MOBILE_TOKEN_KEY: LONG('m') }).errors.join('\n');
    expect(same).toMatch(/DELIVERY_OTP_KEY must be a different secret from SESSION_SECRET/);
    const dup = validateEnvironment({ ...base, DELIVERY_OTP_KEY: LONG('k'), MOBILE_TOKEN_KEY: LONG('k') }).errors.join('\n');
    expect(dup).toMatch(/MOBILE_TOKEN_KEY must be a different secret from DELIVERY_OTP_KEY/);
    const ok = validateEnvironment({ ...base, DELIVERY_OTP_KEY: LONG('k'), MOBILE_TOKEN_KEY: LONG('m') }).errors.join('\n');
    expect(ok).not.toMatch(/DELIVERY_OTP_KEY|MOBILE_TOKEN_KEY/);
    const staging = validateEnvironment({ ...base, EDMN_ENVIRONMENT: 'staging' });
    expect(staging.warnings.join('\n')).toMatch(/DELIVERY_OTP_KEY is required in STAGING/);
  });
});
