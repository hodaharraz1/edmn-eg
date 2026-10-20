import './_env';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

/**
 * STORAGE RECOVERY VERIFICATION (Batch 2) — docs/runbooks/STORAGE_OUTAGE.md.
 *   npx tsx scripts/storage-verify.ts --db <postgres-url> [--root <storage root>]
 * For every live `files` row, reads the object (stored_objects for STORAGE_DRIVER=database, else the disk root)
 * and checks its sha256 against the recorded checksum. Read-only. Prints counts per class — never file contents,
 * names or owners. Exit code 1 when any highly sensitive or private object is missing or altered.
 */
const args = process.argv.slice(2);
const url = args[args.indexOf('--db') + 1];
const root = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : null;
if (!url || args.indexOf('--db') < 0) throw new Error('usage: --db <postgres-url> [--root <dir>]');
const SENSITIVE = new Set(['IDENTITY_DOCUMENT', 'SELLER_DOCUMENT', 'PAYMENT_PROOF', 'WITHDRAWAL_PROOF', 'REFUND_PROOF']);

async function main() {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('set default_transaction_read_only = on');
  const rows = (await c.query<{ id: string; visibility: string; purpose: string; storage_key: string; sha256: string }>(`select id, visibility, purpose, storage_key, sha256 from files where deleted_at is null`)).rows;
  const tally: Record<string, { ok: number; missing: number; altered: number }> = {};
  for (const f of rows) {
    const cls = f.visibility === 'PUBLIC' ? 'PUBLIC' : SENSITIVE.has(f.purpose) ? 'HIGHLY_SENSITIVE' : 'PRIVATE';
    tally[cls] ??= { ok: 0, missing: 0, altered: 0 };
    let data: Buffer | null = null;
    if (root) {
      data = await readFile(path.join(root, f.visibility === 'PUBLIC' ? 'public' : 'private', f.storage_key)).catch(() => null);
    } else {
      const r = await c.query<{ data: Buffer }>('select data from stored_objects where visibility = $1 and key = $2', [f.visibility, f.storage_key]);
      data = r.rows[0]?.data ?? null;
    }
    if (!data) tally[cls].missing++;
    else if (createHash('sha256').update(data).digest('hex') !== f.sha256) tally[cls].altered++;
    else tally[cls].ok++;
  }
  await c.end();
  console.log(JSON.stringify({ files: rows.length, tally }, null, 2));
  const bad = ['PRIVATE', 'HIGHLY_SENSITIVE'].some((k) => (tally[k]?.missing ?? 0) + (tally[k]?.altered ?? 0) > 0);
  if (bad) process.exit(1);
}
main().catch((e) => {
  console.error('✗', e instanceof Error ? e.message : e);
  process.exit(1);
});
