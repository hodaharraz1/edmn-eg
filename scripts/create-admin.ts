import './_env';
import { createInterface } from 'node:readline/promises';
import { eq } from 'drizzle-orm';
import { hashPassword, passwordProblems, STAFF_POLICY } from '../src/server/auth/password';
import { otpauthUri, generateTotpSecret } from '../src/server/auth/totp';
import { encrypt } from '../src/server/core/crypto';
import { normalizeEgyptMobile } from '../src/server/core/text';
import { closeDb, db } from '../src/server/db/client';
import { auditLogs, userRoles, users } from '../src/server/db/schema';

/**
 * Bootstrap the first SUPER_ADMIN (production-safe). Prompts interactively; the password is never
 * echoed or logged. Prints a TOTP enrolment URI that must be added to an authenticator app.
 */
async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = (await rl.question('Admin email: ')).trim().toLowerCase();
  const fullName = (await rl.question('Full name: ')).trim();
  const phone = normalizeEgyptMobile((await rl.question('Mobile (01xxxxxxxxx): ')).trim());
  const password = await rl.question('Password (min 12, letters+digits+symbol): ');
  rl.close();
  if (!email.includes('@') || !fullName || !phone) throw new Error('invalid input');
  const problem = passwordProblems(password, STAFF_POLICY);
  if (problem) throw new Error(problem);
  const [exists] = await db.select().from(users).where(eq(users.email, email));
  if (exists) throw new Error('user already exists');
  const secret = generateTotpSecret();
  await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email, fullName, phone, passwordHash: await hashPassword(password), isStaff: true, totpSecretEnc: encrypt(secret), passwordChangedAt: new Date(), emailVerifiedAt: new Date() })
      .returning();
    await tx.insert(userRoles).values({ userId: u.id, roleCode: 'SUPER_ADMIN' });
    await tx.insert(auditLogs).values({ actorType: 'SYSTEM', action: 'admin.bootstrap_created', entityType: 'user', entityId: u.id });
  });
  console.log('\n✓ Super admin created. Add this to your authenticator app NOW (shown once):');
  console.log(otpauthUri(secret, email));
  console.log(`Secret: ${secret}\n`);
  await closeDb();
}
main().catch(async (e) => {
  console.error('✗', (e as Error).message);
  await closeDb();
  process.exit(1);
});
