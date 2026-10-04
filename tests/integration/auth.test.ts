import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { beginTotpEnrollment, login, register, resolveSession, verifyTotpForUser } from '@/server/auth/service';
import { totpCode } from '@/server/auth/totp';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { adminActor } from '@/server/auth/actors';
import { saveDestination } from '@/server/modules/payments/service';
import { updateSetting } from '@/server/modules/settings';
import { makeUser } from '../helpers/factory';

const meta = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('auth hardening', () => {
  it('accepts a TOTP code once and rejects its replay', async () => {
    const u = await makeUser({ staff: true, roles: ['SUPER_ADMIN'] });
    await db.update(users).set({ totpSecretEnc: null, totpEnabledAt: null }).where(eq(users.id, u.id));
    const secret = await beginTotpEnrollment(u.id);
    const code = totpCode(secret);
    expect(await verifyTotpForUser(u.id, code, meta)).toBe(true);
    expect(await verifyTotpForUser(u.id, code, meta)).toBe(false);
    // an older (previous-step) code is also refused after a newer one was used
    expect(await verifyTotpForUser(u.id, totpCode(secret, Date.now() - 30_000), meta)).toBe(false);
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.totpEnabledAt).not.toBeNull();
  });

  it('admin sessions start without MFA and customer sessions cannot be used as admin sessions', async () => {
    const u = await makeUser({ staff: true, roles: ['SUPER_ADMIN'] });
    const r = await login(u.email!, 'Test@12345', 'ADMIN', meta);
    const s = await resolveSession(r.token, 'ADMIN');
    expect(s?.session.mfaVerifiedAt).toBeNull();
    expect(await resolveSession(r.token, 'WEB')).toBeNull();
  });

  it('a session created at registration is immediately valid (no clock race with passwordChangedAt)', async () => {
    for (let i = 0; i < 15; i++) {
      const n = String(Date.now() + i).slice(-8);
      const r = await register({ fullName: 'مستخدم جديد', email: `reg-${n}-${i}@test.local`, phone: `010${n}`, password: 'Test@12345' }, { ip: `10.0.0.${i}`, userAgent: 'vitest' });
      expect(await resolveSession(r.token, 'WEB')).not.toBeNull();
    }
  });

  it('rejects a wrong password with a generic error', async () => {
    const u = await makeUser();
    await expect(login(u.email!, 'wrong-password', 'WEB', meta)).rejects.toThrow();
  });

  it('high-risk admin operations require a recent 2FA step-up', async () => {
    const u = await makeUser({ staff: true, roles: ['SUPER_ADMIN'] });
    const stale = await adminActor(u.id, { stepUpAt: new Date(Date.now() - 60 * 60_000) });
    const fresh = await adminActor(u.id, { stepUpAt: new Date() });
    const dest = { methodCode: 'INSTAPAY' as const, label: 'حساب اختبار', details: { instapayAddress: 'test@instapay', accountName: 'EDMN TEST' }, isEnabled: false, sortOrder: 9 };
    await expect(saveDestination(stale, null, dest, 'اختبار')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await expect(updateSetting(stale, 'withdrawals.dualControlThreshold', 1_000_000, 'اختبار')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    // Non-sensitive settings do not need step-up; sensitive ones succeed after step-up.
    await expect(updateSetting(stale, 'marketplace.supportPhone', '01000000000', 'اختبار')).resolves.toBeUndefined();
    await expect(updateSetting(fresh, 'withdrawals.dualControlThreshold', 5_000_000, 'اختبار')).resolves.toBeUndefined();
  });
});
