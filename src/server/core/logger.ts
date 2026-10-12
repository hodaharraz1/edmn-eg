/**
 * Structured JSON logger. Never pass secrets, passwords, full national IDs or payment credentials.
 * Defence in depth (C7): sensitive KEYS are masked, Error objects (including database/Drizzle errors whose
 * message embeds the query parameters, and pg errors whose `detail` echoes row values) are converted to a
 * safe shape BEFORE serialization, and string values are scrubbed of credential-like content.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /pass(word)?|secret|token|national_?id|iban|account_?number|wallet|totp|otp|cookie|authorization|email|phone|mobile|address|legal_?name|lat(itude)?$|lng|lon(gitude)?$|coord|params|body|payload|detail|vapid|private_?key|session/i;

/** Credential-like content inside free text (applies to every logged string). */
export function scrubText(text: string): string {
  return text
    .replace(/\b(postgres(?:ql)?|mysql|redis|https?):\/\/[^\s:@/]+:[^\s@/]+@/gi, '$1://[REDACTED]@') // URL credentials
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{40,}={0,2})\b/g, '[REDACTED_TOKEN]')
    .replace(/((?:password|secret|token|otp|code|key)\s*[=:]\s*)\S+/gi, '$1[REDACTED]');
}

/** Error messages additionally lose every number long enough to be an OTP, phone, IBAN or card number. */
function scrubErrorText(text: string): string {
  return scrubText(text).replace(/\+?\d[\d\s-]{4,}\d/g, '[REDACTED_NUMBER]');
}

export interface SafeError {
  name: string;
  /** pg SQLSTATE / domain code — never a value */
  code?: string;
  constraint?: string;
  table?: string;
  message: string;
  stack?: string[];
  cause?: SafeError;
}

/**
 * Safe, serializable view of any thrown value. Drops query parameters (Drizzle "params: …"), pg `detail`
 * (row values), `where`, and the raw message line of the stack; keeps class, safe code, constraint/table
 * names and code locations so the incident can still be traced with the request reference.
 */
export function sanitizeError(e: unknown, depth = 0): SafeError {
  if (!(e instanceof Error)) return { name: typeof e, message: scrubErrorText(String(e)).slice(0, 300) };
  const any = e as Error & { code?: unknown; constraint?: unknown; table?: unknown; cause?: unknown; query?: unknown };
  // Drizzle: "Failed query: <sql>\nparams: <values>" — keep the statement shape, never the parameters.
  let message = e.message.split(/\n?\s*params:/i)[0];
  message = scrubErrorText(message).slice(0, 300);
  const out: SafeError = { name: e.name || e.constructor?.name || 'Error', message };
  if (typeof any.code === 'string' && /^[A-Z0-9_]{2,40}$/i.test(any.code)) out.code = any.code;
  if (typeof any.constraint === 'string') out.constraint = any.constraint.slice(0, 80);
  if (typeof any.table === 'string') out.table = any.table.slice(0, 80);
  if (e.stack) out.stack = e.stack.split('\n').filter((l) => /^\s+at\s/.test(l)).slice(0, 8).map((l) => scrubText(l.trim()));
  if (any.cause !== undefined && depth < 2) out.cause = sanitizeError(any.cause, depth + 1);
  return out;
}

/** Short, safe text for persisting an error (jobs.last_error, outbox, deliveries). */
export function safeErrorMessage(e: unknown): string {
  const s = sanitizeError(e);
  const root = s.cause ?? s;
  return `${s.name}${root.code ? ` [${root.code}]` : ''}: ${s.message}`.slice(0, 500);
}

function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return sanitizeError(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

/** Exposed for tests: the exact object that would be serialized. */
export function redactForLog(ctx: Record<string, unknown>): Record<string, unknown> {
  return redact(ctx) as Record<string, unknown>;
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
