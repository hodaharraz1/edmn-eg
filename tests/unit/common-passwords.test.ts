import { describe, expect, it } from 'vitest';
import { commonPasswordProblem, letterCore } from '@/server/auth/common-passwords';
import { CUSTOMER_POLICY, passwordProblems, STAFF_POLICY } from '@/server/auth/password';

/** Policy SEC-023 / finding SEC-F03: common and identity-derived passwords are refused in every environment. */
describe('common and contextual passwords', () => {
  it('rejects passwords that pass letters+digits but are common', () => {
    for (const pw of ['Password1', 'password123', 'P@ssw0rd123', 'Passw0rd!', 'Qwerty123', 'qwe123456', '1q2w3e4r', 'Zaq12wsx',
      'abcd1234', 'Aa123456', 'Admin2026', '@dmin123', 'Welcome1', 'iloveyou1', 'Edmn2026', 'Zamalek123', 'Ahmed2024', 'Mohamed@123', 'Egypt2026!']) {
      expect(passwordProblems(pw, CUSTOMER_POLICY), pw).toMatch(/شائعة/);
    }
  });

  it('rejects passwords built from the account email or phone', () => {
    expect(passwordProblems('hodaharraz99', CUSTOMER_POLICY, { email: 'hoda.harraz@example.com' })).toMatch(/بريدك/);
    expect(passwordProblems('Me01012345678', CUSTOMER_POLICY, { phone: '+201012345678' })).toMatch(/موبايلك/);
    expect(passwordProblems('Key1012345x', CUSTOMER_POLICY, { phone: '01012345678' })).toMatch(/موبايلك/);
  });

  it('accepts strong passwords, including ones that merely contain a common word', () => {
    for (const pw of ['Nile-Sunset-482', 'kXq7#mPz29', 'tram9horse4lamp', 'Passwordless-Kettle-93', 'Ahmedabad-Train-2026']) {
      expect(passwordProblems(pw, CUSTOMER_POLICY), pw).toBeNull();
    }
    expect(passwordProblems('Correct-Horse-Battery-9', STAFF_POLICY)).toBeNull();
    expect(commonPasswordProblem('tram9horse4lamp', { email: 'ab@x.com', phone: '01012345678' })).toBeNull();
  });

  it('extracts the alphabetic core used for the base-word rule', () => {
    expect(letterCore('P@ssw0rd123')).toBe('password');
    expect(letterCore('@dmin1')).toBe('admin');
    expect(letterCore('Password!1')).toBe('password');
    expect(letterCore('2024Ahmed!!')).toBe('ahmed');
    expect(letterCore('12345678')).toBe('');
  });
});
