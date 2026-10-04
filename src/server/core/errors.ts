/**
 * Domain errors. Application code throws these; the UI/API layer maps them to safe messages.
 * Messages are user-safe Arabic text. Internal details go to `detail` and are only logged.
 */
export type DomainErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'INSUFFICIENT_STOCK'
  | 'INSUFFICIENT_BALANCE'
  | 'RATE_LIMITED'
  | 'MFA_REQUIRED'
  | 'STEP_UP_REQUIRED';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly detail?: unknown,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what = 'العنصر') => new DomainError('NOT_FOUND', `${what} غير موجود`);
export const forbidden = (msg = 'ليست لديك صلاحية لتنفيذ هذا الإجراء') => new DomainError('FORBIDDEN', msg);
export const unauthenticated = () => new DomainError('UNAUTHENTICATED', 'يجب تسجيل الدخول أولاً');
export const invalidState = (msg: string, detail?: unknown) => new DomainError('INVALID_STATE', msg, detail);
export const conflict = (msg: string) => new DomainError('CONFLICT', msg);
export const validation = (msg: string, fieldErrors?: Record<string, string[]>) =>
  new DomainError('VALIDATION', msg, undefined, fieldErrors);

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
