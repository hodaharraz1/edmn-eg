import { createHash } from 'node:crypto';

/**
 * Reviewed, deliberately bogus REDACTION TEST INPUTS in old commits, not usable credentials.
 * The first is a BEGIN header without any private-key material plus a dummy URL; the second is an error string
 * containing a dummy URL to ep-x.neon.tech. Current fixtures already avoid contiguous secret patterns.
 * Pin the full introducing commit, path, exact added-line hash and rule. Never ignore a whole test path, and never
 * apply these exceptions to the current tree or to a copy of the same text introduced by another commit.
 */
const REVIEWED = [
  { commit: 'c8f3506b08b1281a048d37952eaa6e5b98a2a3c3', file: 'tests/integration/pre-server.test.ts',
    lineHash: 'b2738720b6516e5fe3359cb982e5b2c4b95631d3fd74d9f723348938d770a5f2',
    rules: ['private-key-block', 'postgres-url-with-password'] },
  { commit: 'aeb657b2afd63a5c1feebf1867b2d75eac96770e', file: 'tests/integration/infra-adapters.test.ts',
    lineHash: 'c1a79577d90c66abe688e5b8daeda5e918a0dc2ef5d8231f2b8fdd7cb2be571c',
    rules: ['postgres-url-with-password'] },
  // PKG-PUSH-02: a textarea PLACEHOLDER showing the PEM header only (no key material); replaced in the next commit.
  { commit: 'f351571957fa5cf9934e581cf20cf3cc216ba61a', file: 'src/app/admin/(console)/notifications/page.tsx',
    lineHash: 'f09d525604f86d548bdb7387bc515690cba35903fab706d448c4819d36945e70',
    rules: ['private-key-block'] },
  // PKG-INFRA-01 v3: a commented pooler URL with literal <user>:<pass> PLACEHOLDERS (no credential); replaced in 2c36367.
  { commit: 'cdf9cb961368d39143eccfb3c8725c19b1b883c1', file: 'deploy/compose/docker-compose.extra.yml',
    lineHash: '248a69ca6c289cd7a2e3021d8ab4f04f3dee3bf3654ad639566eb5c7b7123d5e',
    rules: ['postgres-url-with-password'] },
];

export function reviewedHistoricalFixture(commit: string, file: string, line: string, rule: string): boolean {
  const candidates = REVIEWED.filter((r) => r.commit === commit && r.file === file && r.rules.includes(rule));
  if (!candidates.length) return false;
  const hash = createHash('sha256').update(line).digest('hex');
  return candidates.some((r) => r.lineHash === hash);
}
