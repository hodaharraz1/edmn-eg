import 'server-only';
import { isDomainError } from '@/server/core/errors';
import { logger } from '@/server/core/logger';

/** Shape returned by every server action to the client form helper. */
export interface ActionState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  data?: Record<string, unknown>;
  code?: string;
  /** monotonically changes so the client can re-show identical messages */
  at?: number;
}

/**
 * Wraps a server action body: DomainErrors become safe user messages; unexpected errors are logged
 * (with a reference id) and replaced by a generic message — stack traces never reach the browser.
 * redirect()/notFound() must be called by the caller AFTER this returns (outside the try).
 */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    const res = await fn();
    return { ok: true, ...(res ?? {}), at: Date.now() };
  } catch (e) {
    if (isDomainError(e)) {
      if (e.code === 'INVALID_STATE' || e.code === 'FORBIDDEN') logger.warn('action.rejected', { code: e.code, detail: e.detail as Record<string, unknown> });
      return { ok: false, error: e.message, fieldErrors: e.fieldErrors, code: e.code, at: Date.now() };
    }
    const ref = Math.random().toString(36).slice(2, 10).toUpperCase();
    logger.error('action.failed', { ref, error: e as Error });
    return { ok: false, error: `حصلت مشكلة غير متوقعة. جرّب تاني (مرجع: ${ref})`, at: Date.now() };
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}
export function optStr(fd: FormData, key: string): string | undefined {
  const v = str(fd, key);
  return v === '' ? undefined : v;
}
export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === 'on' || v === 'true' || v === '1';
}
export function int(fd: FormData, key: string): number | undefined {
  const v = str(fd, key);
  if (v === '') return undefined;
  const n = Number(v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
export async function fileOf(fd: FormData, key: string): Promise<{ data: Buffer; name: string } | null> {
  const v = fd.get(key);
  if (!v || typeof v === 'string' || v.size === 0) return null;
  return { data: Buffer.from(await v.arrayBuffer()), name: v.name };
}
export async function filesOf(fd: FormData, key: string): Promise<{ data: Buffer; name: string }[]> {
  const out: { data: Buffer; name: string }[] = [];
  for (const v of fd.getAll(key)) {
    if (typeof v !== 'string' && v.size > 0) out.push({ data: Buffer.from(await v.arrayBuffer()), name: v.name });
  }
  return out;
}

export { safeNext } from './safe-next';
