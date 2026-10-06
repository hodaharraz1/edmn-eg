import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

/** scrypt$N$r$p$salt$hash — memory-hard KDF from Node's standard library (no native deps). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A precomputed hash used to equalize timing when the account does not exist. */
let dummy: string | null = null;
export async function dummyVerify(password: string): Promise<void> {
  if (!dummy) dummy = await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummy);
}

export interface PasswordPolicy {
  minLength: number;
}
export const CUSTOMER_POLICY: PasswordPolicy = { minLength: 8 };
export const STAFF_POLICY: PasswordPolicy = { minLength: 12 };

export function passwordProblems(pw: string, policy: PasswordPolicy): string | null {
  if (pw.length < policy.minLength) return `كلمة المرور لازم تكون ${policy.minLength} أحرف على الأقل`;
  if (pw.length > 200) return 'كلمة المرور طويلة جداً';
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return 'كلمة المرور لازم يكون فيها حروف وأرقام';
  if (policy.minLength >= 12 && !/[^A-Za-z0-9؀-ۿ]/.test(pw)) return 'كلمة مرور الإدارة يجب أن تحتوي على رمز خاص';
  return null;
}
