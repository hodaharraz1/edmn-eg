import { beforeAll } from 'vitest';

/**
 * Money movements fail closed without a RECENT ledger-health snapshot (B1, P0 #1). In production the scheduler
 * records one every 30 minutes; tests have no scheduler, so each test file starts by running the REAL read-only
 * health check against the current books (never a synthetic OK row). Files that test the gate itself insert their
 * own rows afterwards.
 */
beforeAll(async () => {
  const { runLedgerHealthCheck } = await import('@/server/modules/finance/ledger-health');
  await runLedgerHealthCheck('test-setup');
});
