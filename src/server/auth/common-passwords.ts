/**
 * Policy SEC-023 (NIST SP 800-63B §3.1.1.2): refuse passwords that are commonly used, expected or compromised, and
 * passwords built from the account's own identifiers. Applies in every environment.
 *
 * The composition rule (letters + digits) already rejects all-digit and all-letter lists, so this blocks what slips
 * through it: well-known full passwords, and a common base word decorated with digits or symbols
 * ("Password1", "P@ssw0rd123", "Ahmed2024", "Zamalek123", "Edmn2026").
 */

/** Full passwords (lower-case) that satisfy letters + digits but appear at the top of breach corpora. */
const COMMON_FULL = new Set([
  '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y', '1qaz2wsx', '1qaz2wsx3edc', 'q1w2e3r4', 'q1w2e3r4t5', 'zaq12wsx', 'zaq1xsw2',
  'abc123', 'abc12345', 'abc123456', 'a1b2c3d4', 'a1b2c3d4e5', '123abc', '123qwe', '123qweasd', 'qweasd123', 'qwe123',
  '1234qwer', 'qwer1234', 'asdf1234', '1234asdf', 'zxcv1234', 'aa123456', 'a123456', 'a12345678', 'aa12345678',
  'abcd1234', '1234abcd', 'pass1234', 'test1234', 'user1234', 'admin1234', 'love1234', 'iloveyou1', 'iloveu123',
  '12345a', '123456a', '1234567a', '12345678a', '123456789a', 'x123456', 'z123456', 'q123456', 'p@ssw0rd',
]);

/** Words that are weak when they are the whole alphabetic part of a password. Lower-case, after un-leeting. */
const BASE_WORDS = new Set([
  // global
  'password', 'passw', 'passwd', 'pass', 'qwerty', 'qwertyuiop', 'qwert', 'qwe', 'asdf', 'asdfgh', 'asdfghjkl', 'zxcvbn',
  'zxcvbnm', 'qaz', 'wsx', 'admin', 'administrator', 'root', 'welcome', 'letmein', 'iloveyou', 'iloveu', 'love', 'monkey',
  'dragon', 'football', 'soccer', 'baseball', 'master', 'shadow', 'sunshine', 'princess', 'superman', 'batman',
  'trustno', 'login', 'user', 'guest', 'secret', 'changeme', 'default', 'hello', 'freedom', 'whatever', 'computer',
  'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg', 'abcdefgh', 'aaa', 'aaaa', 'aaaaaa', 'xxx', 'xxxx',
  // this service and its market
  'edmn', 'edman', 'adman', 'edmnmarket', 'admanmarket', 'egypt', 'egyptian', 'cairo', 'giza', 'alex', 'alexandria',
  'misr', 'masr', 'ahly', 'alahly', 'elahly', 'zamalek', 'pyramids', 'salah', 'mosalah', 'allah', 'bismillah',
  'mohamed', 'mohammed', 'muhammad', 'mohammad', 'ahmed', 'ahmad', 'mahmoud', 'mostafa', 'mustafa', 'ali', 'omar',
  'hassan', 'hussein', 'ibrahim', 'khaled', 'khalid', 'youssef', 'yousef', 'amr', 'islam', 'eslam', 'karim', 'kareem',
  'mona', 'sara', 'sarah', 'nour', 'noor', 'fatma', 'fatima', 'yasmin', 'yasmine', 'mariam', 'maryam', 'aya', 'hoda',
  'heba', 'doaa', 'mai', 'salma', 'reem', 'nada', 'dina', 'eman', 'iman', 'asmaa', 'esraa', 'shimaa',
]);

const LEET: Record<string, string> = { '@': 'a', '4': 'a', '$': 's', '5': 's', '0': 'o', '3': 'e', '1': 'i', '!': 'i', '7': 't', '+': 't' };

/**
 * The alphabetic core: the span from the first to the last letter (plus a leading "@" or "$", as in "@dmin"), with
 * common substitutions undone inside it. Decoration around it ("123", "!", "2024") is ignored.
 */
export function letterCore(pw: string): string {
  const s = pw.toLowerCase();
  const first = s.search(/[a-z]/);
  if (first < 0) return '';
  let start = first;
  while (start > 0 && /[@$]/.test(s[start - 1])) start--;
  let end = s.length - 1;
  while (end > first && !/[a-z]/.test(s[end])) end--;
  return [...s.slice(start, end + 1)].map((c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');
}

export type PasswordContext = { email?: string | null; phone?: string | null };

/** Returns an Arabic reason when the password is common or built from the account's identifiers, else null. */
export function commonPasswordProblem(pw: string, ctx: PasswordContext = {}): string | null {
  const lower = pw.toLowerCase();
  if (COMMON_FULL.has(lower) || BASE_WORDS.has(letterCore(pw))) return 'كلمة المرور دي شائعة وسهل تخمينها. اختار كلمة مرور أقوى';
  const local = ctx.email?.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  if (local.length >= 4 && lower.replace(/[^a-z0-9]/g, '').includes(local)) return 'متستخدمش بريدك الإلكتروني في كلمة المرور';
  const digits = (ctx.phone ?? '').replace(/\D/g, '');
  const pwDigits = pw.replace(/\D/g, '');
  if (digits.length >= 7) {
    for (let i = 0; i + 7 <= digits.length; i++) if (pwDigits.includes(digits.slice(i, i + 7))) return 'متستخدمش رقم موبايلك في كلمة المرور';
  }
  return null;
}
