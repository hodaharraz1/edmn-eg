import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { reviewedHistoricalFixture } from '../../scripts/lib/historical-secret-fixtures';

it('exempts only exact reviewed historical redaction inputs, never modified/copied inputs or another rule', () => {
  const commit = 'c8f3506b08b1281a048d37952eaa6e5b98a2a3c3';
  const file = 'tests/integration/pre-server.test.ts';
  const text = execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'utf8' });
  const line = text.split('\n').find((l) => createHash('sha256').update(l).digest('hex') === 'b2738720b6516e5fe3359cb982e5b2c4b95631d3fd74d9f723348938d770a5f2')!;
  expect(typeof line).toBe('string');
  expect(reviewedHistoricalFixture(commit, file, line, 'private-key-block')).toBe(true);
  expect(reviewedHistoricalFixture(commit, file, line, 'postgres-url-with-password')).toBe(true);
  expect(reviewedHistoricalFixture('0'.repeat(40), file, line, 'private-key-block')).toBe(false);
  expect(reviewedHistoricalFixture(commit, 'copied.test.ts', line, 'private-key-block')).toBe(false);
  expect(reviewedHistoricalFixture(commit, file, line + ' ', 'private-key-block')).toBe(false);
  expect(reviewedHistoricalFixture(commit, file, line, 'github-token')).toBe(false);
});
