import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '@/server/core/crypto';
import { openBuyerCode, sealBuyerCode } from '@/server/modules/deals/delivery-otp';

/**
 * Policy SEC-048 / finding SEC-F02: AES-256-GCM decryption must insist on the full 16-byte tag. Node otherwise
 * accepts tags as short as 4 bytes, which weakens authentication of stored ciphertext to 32 bits.
 */
function truncateTag(payload: string, tagIndex: number, bytes: number) {
  const parts = payload.split('.');
  parts[tagIndex] = Buffer.from(parts[tagIndex], 'base64url').subarray(0, bytes).toString('base64url');
  return parts.join('.');
}

describe('GCM authentication tag length', () => {
  it('field encryption round-trips, and a truncated tag is rejected', () => {
    const sealed = encrypt('29001011234567');
    expect(decrypt(sealed)).toBe('29001011234567');
    const tagIndex = sealed.startsWith('v2.') ? 3 : 2;
    for (const bytes of [4, 8, 12, 15]) expect(() => decrypt(truncateTag(sealed, tagIndex, bytes))).toThrow();
  });

  it('the buyer delivery-code copy round-trips, and a truncated tag is rejected', () => {
    const dealId = '11111111-2222-4333-8444-555555555555';
    const otpId = '66666666-7777-4888-9999-000000000000';
    const sealed = sealBuyerCode(dealId, otpId, '482913');
    expect(openBuyerCode(dealId, otpId, sealed)).toBe('482913');
    for (const bytes of [4, 8, 12]) expect(() => openBuyerCode(dealId, otpId, truncateTag(sealed, 2, bytes))).toThrow();
  });
});
