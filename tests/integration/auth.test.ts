import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { beginTotpEnrollment, login, resolveSession, verifyTotpForUser } from '@/server/auth/service';
import { totpCode } from '@/server/auth/totp';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
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

  it('rejects a wrong password with a generic error', async () => {
    const u = await makeUser();
    await expect(login(u.email!, 'wrong-password', 'WEB', meta)).rejects.toThrow();
  });
});
