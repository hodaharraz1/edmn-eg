import { execFileSync } from 'node:child_process';

/**
 * SECRET LEAK SCAN (Batch 2) — docs/runbooks/SECRET_ROTATION.md.
 *   npx tsx scripts/secret-scan.ts            tracked files of the working tree
 *   npx tsx scripts/secret-scan.ts --history  every commit reachable from HEAD (git log -p)
 * Prints only "<location> <rule>" — NEVER the matched value. Exit code 1 on any finding.
 * It never rewrites history: a finding means "revoke and rotate the credential" (history rewrite is an owner decision).
 */
const RULES: { name: string; re: RegExp }[] = [
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'postgres-url-with-password', re: /postgres(?:ql)?:\/\/(?!edmn:edmn@|user:pass@|x@|u:p@)[^\s:@/'"`]+:[^\s@'"`]{6,}@(?!localhost|127\.0\.0\.1|[^\s/'"`]*\bexample\.(?:com|org|net)\b)[^\s'"`]+/ },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: 'neon-api-key', re: /\bnapi_[a-z0-9]{40,}\b/ },
  { name: 'huggingface-token', re: /\bhf_[A-Za-z0-9]{30,}\b/ },
  { name: 'render-api-key', re: /\brnd_[A-Za-z0-9]{20,}\b/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'stripe-like-live-key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'vercel-token-assignment', re: /VERCEL_TOKEN\s*[=:]\s*['"]?[A-Za-z0-9]{24}\b/ },
  { name: 'secret-env-assignment', re: /^\s*(?:SESSION_SECRET|DATA_ENCRYPTION_KEY|CRON_SECRET|SMTP_PASSWORD|SMS_HTTP_TOKEN|VAPID_PRIVATE_KEY|PAYMENT_WEBHOOK_SECRET)\s*=\s*(?!replace-with|$|<)[A-Za-z0-9+/=_-]{16,}\s*$/m },
];
const SKIP = /(^|\/)(package-lock\.json|node_modules\/|\.next\/|drizzle\/meta\/)|\.(png|jpe?g|webp|ico|woff2?|pdf)$/;

function scanText(text: string, where: (line: number) => string, out: string[]) {
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    for (const r of RULES) if (r.re.test(l)) out.push(`${where(i + 1)} ${r.name}`);
  });
}

const findings: string[] = [];
if (process.argv.includes('--history')) {
  const log = execFileSync('git', ['log', '-p', '--no-color', '--unified=0', '--format=__COMMIT__ %h'], { maxBuffer: 1 << 30 }).toString();
  let commit = '';
  let file = '';
  for (const l of log.split('\n')) {
    if (l.startsWith('__COMMIT__ ')) commit = l.slice(11);
    else if (l.startsWith('+++ b/')) file = l.slice(6);
    else if (l.startsWith('+') && !l.startsWith('+++') && !SKIP.test(file)) scanText(l.slice(1), () => `${commit}:${file}`, findings);
  }
} else {
  const files = execFileSync('git', ['ls-files']).toString().split('\n').filter((f) => f && !SKIP.test(f));
  for (const f of files) {
    let text = '';
    try {
      text = execFileSync('git', ['show', `HEAD:${f}`], { maxBuffer: 1 << 28 }).toString();
    } catch {
      continue;
    }
    scanText(text, (n) => `${f}:${n}`, findings);
  }
}
const unique = [...new Set(findings)];
console.log(unique.length ? unique.join('\n') : 'no secret patterns found');
console.log(`secret-scan: ${unique.length} finding(s)`);
if (unique.length) process.exit(1);
