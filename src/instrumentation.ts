import type { Instrumentation } from 'next';

/**
 * Server boot (Batch 2): validate the environment policy (fail closed — an invalid PRODUCTION configuration
 * refuses to start) and verify the environment fingerprint (database / storage / encryption key of the right
 * kind). A fingerprint VIOLATION blocks every money movement for the process lifetime and fails readiness.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { env } = await import('@/server/core/env');
  env(); // throws on an unsafe configuration (never prints values)
  try {
    const { ensureFingerprint } = await import('@/server/db/fingerprint');
    await Promise.race([ensureFingerprint(), new Promise((r) => setTimeout(r, 5000))]);
  } catch {
    /* unverified at boot: re-checked by readiness and by the money gate */
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { captureError } = await import('@/server/core/error-tracking');
  const rid = request.headers['x-request-id'];
  await captureError(err, { source: 'request', route: context.routePath, requestId: typeof rid === 'string' ? rid : null });
};
