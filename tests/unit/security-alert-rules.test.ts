import { describe, expect, it } from 'vitest';
import { ALERT_RULES } from '@/server/modules/alerts/rules';
import {
  ADMIN_BURST_MIN_ACTIONS,
  LOGIN_SPIKE_MIN_ATTEMPTS,
  MAX_CANDIDATES,
  SECURITY_ALERT_RULES,
  lookbackHours,
  redactRef,
  spikeEntityId,
} from '@/server/modules/alerts/security-rules';

/* PKG-SEC-OPS-01 — pure checks on the security/ops alert rules (no database). */

describe('security alert rules — registration and shape', () => {
  it('registers exactly five rules into the shared ALERT_RULES list', () => {
    expect(SECURITY_ALERT_RULES).toHaveLength(5);
    for (const r of SECURITY_ALERT_RULES) expect(ALERT_RULES).toContain(r);
  });

  it('rule codes are unique across the whole engine and keep the SEC_ prefix', () => {
    const codes = ALERT_RULES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of SECURITY_ALERT_RULES) expect(r.code).toMatch(/^SEC_[A-Z_]+$/);
  });

  it('all rules are SECURITY-category, staff-addressed, HIGH-severity and read-only shaped', () => {
    for (const r of SECURITY_ALERT_RULES) {
      expect(r.category).toBe('SECURITY');
      expect(r.staffPermission).toBeTruthy(); // staff queue only — never customer notifications
      expect(r.severity).toBe('HIGH');
      expect(r.body).toContain('{{ref}}'); // engine template contract
      expect(r.body).not.toMatch(/\{\{(?!ref\}\})[^}]+\}\}/); // no other template fields
      expect(r.defaults.cooldownHours).toBeGreaterThanOrEqual(1);
      expect(r.defaults.preHours).toBe(0); // spikes and failures alert immediately
    }
  });

  it('titles and bodies carry no sensitive-data vocabulary', () => {
    const text = SECURITY_ALERT_RULES.map((r) => `${r.title} ${r.body}`).join(' ');
    for (const banned of ['هوية', 'رقم قومي', 'حساب بنكي', 'محفظة', 'OTP', 'كلمة']) expect(text).not.toContain(banned);
  });
});

describe('security alert rules — fingerprinting and bounds', () => {
  it('redactRef is a stable, irreversible fingerprint that never contains the source', () => {
    const phone = '+201000000000';
    const fp = redactRef(`login-id:${phone}`);
    expect(fp).toMatch(/^[0-9a-f]{10}$/);
    expect(fp).toBe(redactRef(`login-id:${phone}`)); // deterministic (dedupe depends on it)
    expect(fp).not.toBe(redactRef(`login-id:${phone}x`));
    expect(fp).not.toContain(phone);
  });

  it('spikeEntityId dedupes per source and per kind without leaking the source', () => {
    const a = spikeEntityId('login', 'login-ip:41.1.2.3');
    expect(a).toBe(spikeEntityId('login', 'login-ip:41.1.2.3'));
    expect(a).not.toBe(spikeEntityId('login', 'login-ip:41.1.2.4'));
    expect(a).not.toBe(spikeEntityId('admin', 'login-ip:41.1.2.3'));
    expect(a).not.toContain('41.1.2.3');
  });

  it('lookbackHours clamps overrides into 1..168 hours so scans stay bounded', () => {
    const raw = (h: number) =>
    JSON.stringify(
      lookbackHours(h).queryChunks.map((c) => {
        const v = (c as unknown as { value?: string | string[] }).value;
        return Array.isArray(v) ? v.join('') : String(v ?? c);
      }),
    );
    // SEC-04 L7: the interval is a bound integer (make_interval), never text pasted into SQL.
    expect(raw(0)).toContain('"1"');
    expect(raw(1)).toContain('"1"');
    expect(raw(48)).toContain('"48"');
    expect(raw(99999)).toContain('"168"');
    expect(raw(Number.NaN)).toContain('"1"');
  });

  it('detection thresholds are deliberate positive constants', () => {
    expect(LOGIN_SPIKE_MIN_ATTEMPTS).toBeGreaterThan(10); // above the per-identifier login cap
    expect(ADMIN_BURST_MIN_ACTIONS).toBeGreaterThanOrEqual(100);
    expect(MAX_CANDIDATES).toBeLessThanOrEqual(100);
  });
});
