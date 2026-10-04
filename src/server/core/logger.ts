/**
 * Structured JSON logger. Never pass secrets, passwords, full national IDs or payment credentials.
 * A small redaction pass masks well-known sensitive keys defensively.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /pass(word)?|secret|token|national_?id|iban|account_?number|wallet|totp|otp|cookie|authorization/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level) || 'info';
  return ORDER[lvl] ?? 20;
}

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  if (process.env.NODE_ENV === 'test' && level !== 'error' && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(ctx ?? {}) as object) });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => write('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write('error', msg, ctx),
};
