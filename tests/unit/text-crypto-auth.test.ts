import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, mask, randomToken } from '@/server/core/crypto';
import { isValidEgyptNationalId, normalizeEgyptMobile, normalizeSearch, slugify } from '@/server/core/text';
import { hashPassword, passwordProblems, STAFF_POLICY, CUSTOMER_POLICY, verifyPassword } from '@/server/auth/password';
import { base32Decode, base32Encode, totpCode, verifyTotp } from '@/server/auth/totp';
import { toCsv } from '@/server/modules/reports/service';
import { addBusinessHours } from '@/server/modules/finance/withdrawals';
import { SELLER_ROLE_PERMISSIONS, DEFAULT_ROLES, ALL_PERMISSIONS } from '@/server/rbac/permissions';
import { requirePermission, requireSeller, requireStepUp, type Actor } from '@/server/core/actor';
import { sniff } from '@/server/storage/uploads';
import { isSafeKey } from '@/server/storage/storage';

describe('Arabic text handling', () => {
  it('normalizes alef/yaa/taa marbuta and diacritics for search', () => {
    expect(normalizeSearch('أَحْمَد')).toBe('احمد');
    expect(normalizeSearch('مكتبة')).toBe(normalizeSearch('مكتبه'));
    expect(normalizeSearch('موسى')).toBe(normalizeSearch('موسي'));
    expect(normalizeSearch('آيفون ١٥')).toBe('ايفون 15');
  });
  it('builds slugs', () => {
    expect(slugify('Galaxy A55 5G!')).toBe('galaxy-a55-5g');
    expect(slugify('موبايلات')).toBe('موبايلات');
  });
  it('validates Egyptian mobiles and national IDs', () => {
    expect(normalizeEgyptMobile('01012345678')).toBe('+201012345678');
    expect(normalizeEgyptMobile('+20 101 234 5678')).toBe('+201012345678');
    expect(normalizeEgyptMobile('٠١٠١٢٣٤٥٦٧٨')).toBe('+201012345678');
    expect(normalizeEgyptMobile('01312345678')).toBeNull();
    expect(isValidEgyptNationalId('29001011234567')).toBe(true);
    expect(isValidEgyptNationalId('1234')).toBe(false);
  });
});

describe('crypto', () => {
  it('encrypts/decrypts with AES-GCM and detects tampering', () => {
    const c = encrypt('29001011234567');
    expect(c).not.toContain('2900101');
    expect(decrypt(c)).toBe('29001011234567');
    const parts = c.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('masks sensitive values', () => {
    expect(mask('01012345678')).toBe('•••••••5678');
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
  });
});

describe('passwords & TOTP', () => {
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('Secret123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Secret123', h)).toBe(true);
    expect(await verifyPassword('secret123', h)).toBe(false);
  });
  it('enforces password policy (stricter for staff)', () => {
    expect(passwordProblems('abc', CUSTOMER_POLICY)).not.toBeNull();
    expect(passwordProblems('abcdefgh1', CUSTOMER_POLICY)).toBeNull();
    expect(passwordProblems('abcdefgh1234', STAFF_POLICY)).not.toBeNull();
    expect(passwordProblems('abcdefgh123!', STAFF_POLICY)).toBeNull();
  });
  it('generates RFC 6238 codes (test vector) and verifies within the window', () => {
    // RFC 6238 SHA1 secret "12345678901234567890", T=59s → 94287082 (8 digits) → last 6: 287082
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpCode(secret, 59_000)).toBe('287082');
    const now = Date.now();
    expect(verifyTotp(secret, totpCode(secret, now), 1, now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 120_000), 1, now)).toBe(false);
  });
});

describe('authorization primitives', () => {
  const admin = (perms: string[]): Actor => ({ type: 'ADMIN', userId: 'u', permissions: new Set(perms) as never });
  it('enforces staff permissions server-side', () => {
    expect(() => requirePermission(admin(['payments.view']), 'payments.verify')).toThrow();
    expect(() => requirePermission(admin(['payments.verify']), 'payments.verify')).not.toThrow();
    expect(() => requirePermission({ type: 'CUSTOMER', userId: 'x', permissions: new Set() }, 'payments.verify')).toThrow();
  });
  it('scopes seller staff roles', () => {
    expect(SELLER_ROLE_PERMISSIONS.CATALOG_MANAGER).not.toContain('finance.withdraw');
    expect(SELLER_ROLE_PERMISSIONS.FINANCE).toContain('finance.withdraw');
    const catalog: Actor = { type: 'SELLER', userId: 'u', sellerId: 's', permissions: new Set(), sellerPermissions: new Set(SELLER_ROLE_PERMISSIONS.CATALOG_MANAGER) };
    expect(() => requireSeller(catalog, 'finance.withdraw')).toThrow();
    expect(requireSeller(catalog, 'products.manage')).toBe('s');
  });
  it('requires recent step-up for sensitive operations', () => {
    expect(() => requireStepUp({ ...admin([]), stepUpAt: null })).toThrow();
    expect(() => requireStepUp({ ...admin([]), stepUpAt: new Date(Date.now() - 11 * 60_000) })).toThrow();
    expect(() => requireStepUp({ ...admin([]), stepUpAt: new Date() })).not.toThrow();
  });
  it('keeps maker and checker permissions in separate default roles', () => {
    expect(DEFAULT_ROLES.FINANCE_OPERATOR.permissions).toContain('withdrawals.pay');
    expect(DEFAULT_ROLES.FINANCE_OPERATOR.permissions).not.toContain('withdrawals.approve');
    expect(DEFAULT_ROLES.FINANCE_CHECKER.permissions).toContain('withdrawals.approve');
    expect(DEFAULT_ROLES.FINANCE_CHECKER.permissions).not.toContain('withdrawals.pay');
    expect(DEFAULT_ROLES.SUPER_ADMIN.permissions).toEqual(ALL_PERMISSIONS);
  });
});

describe('uploads & storage keys', () => {
  it('detects real file types from magic bytes', () => {
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpeg');
    expect(sniff(Buffer.from('%PDF-1.7 xxxxxxxx'))).toBe('pdf');
    expect(sniff(Buffer.from('<?php echo 1; ?>....'))).toBeNull();
    expect(sniff(Buffer.from('GIF89a..........'))).toBeNull();
  });
  it('rejects unsafe storage keys (path traversal)', () => {
    expect(isSafeKey('product_image/2026/01/123e4567-e89b-12d3-a456-426614174000.webp')).toBe(true);
    expect(isSafeKey('../../etc/passwd')).toBe(false);
    expect(isSafeKey('product_image/../x/123e4567-e89b-12d3-a456-426614174000.webp')).toBe(false);
  });
});

describe('misc helpers', () => {
  it('protects CSV exports against formula injection', () => {
    const csv = toCsv(['a'], [['=HYPERLINK("x")'], ['+1'], ['normal']]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`'+1`);
  });
  it('computes SLA in business hours skipping Fri/Sat', () => {
    const thu = new Date('2026-10-01T10:00:00Z'); // Thursday
    const due = addBusinessHours(thu, 48);
    expect(due.getUTCDay()).not.toBe(5);
    expect(due.getTime() - thu.getTime()).toBeGreaterThan(48 * 3600_000);
  });
});
