import { z } from 'zod';
import { DomainError, isDomainError, type DomainErrorCode } from '@/server/core/errors';

/**
 * Mobile API errors are RFC 9457 problem+json with a STABLE machine `code` (snake_case). Flutter localizes by `code`
 * (Arabic default, English secondary); `detail` carries the server's Arabic text only as a fallback, and is never needed
 * for logic. Stack traces and internal details never leave the server.
 */
export const API_ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'invalid_state',
  'insufficient_stock',
  'insufficient_balance',
  'rate_limited',
  'mfa_required',
  'step_up_required',
  'identity_required',
  'seller_required',
  'idempotency_key_required',
  'idempotency_key_reused',
  'idempotency_in_progress',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const STATUS: Record<ApiErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_state: 409,
  insufficient_stock: 409,
  insufficient_balance: 409,
  rate_limited: 429,
  mfa_required: 401,
  step_up_required: 401,
  identity_required: 403,
  seller_required: 403,
  idempotency_key_required: 400,
  idempotency_key_reused: 422,
  idempotency_in_progress: 409,
  internal_error: 500,
};

const FROM_DOMAIN: Record<DomainErrorCode, ApiErrorCode> = {
  VALIDATION: 'validation_failed',
  NOT_FOUND: 'not_found',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  CONFLICT: 'conflict',
  INVALID_STATE: 'invalid_state',
  INSUFFICIENT_STOCK: 'insufficient_stock',
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  RATE_LIMITED: 'rate_limited',
  MFA_REQUIRED: 'mfa_required',
  STEP_UP_REQUIRED: 'step_up_required',
  IDENTITY_REQUIRED: 'identity_required',
};

export const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.enum(API_ERROR_CODES),
    detail: z.string().optional(),
    reference: z.string().optional(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    issues: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
  })
  .meta({ id: 'Problem' });
export type Problem = z.infer<typeof problemSchema>;

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly detail?: string,
    public readonly extra: Partial<Problem> & { retryAfterSeconds?: number } = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export function problem(code: ApiErrorCode, extra: Partial<Problem> = {}): Problem {
  return { type: `https://docs.edmneg.com/mobile-api/errors/${code}`, title: code, status: STATUS[code], code, ...extra };
}

/** Map anything thrown by a handler or service to a safe problem. Unknown errors become internal_error + reference. */
export function toProblem(e: unknown): { problem: Problem; retryAfterSeconds?: number; unexpected: boolean } {
  if (e instanceof ApiError) {
    const { retryAfterSeconds, ...extra } = e.extra;
    return { problem: problem(e.code, { ...(e.detail ? { detail: e.detail } : {}), ...extra }), retryAfterSeconds, unexpected: false };
  }
  if (isDomainError(e)) {
    const de = e as DomainError;
    return { problem: problem(FROM_DOMAIN[de.code] ?? 'internal_error', { detail: de.message, ...(de.fieldErrors ? { fieldErrors: de.fieldErrors } : {}) }), unexpected: false };
  }
  if (e instanceof z.ZodError) {
    return { problem: problem('validation_failed', { issues: e.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) }), unexpected: false };
  }
  return { problem: problem('internal_error'), unexpected: true };
}
