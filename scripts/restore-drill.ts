import './_env';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/**
 * ISOLATED RESTORE DRILL (Batch 2) — docs/runbooks/DATABASE_RESTORE.md.
 *
 *   npx tsx scripts/restore-drill.ts --source <postgres-url> [--keep]
 *
 * 1. pg_dump (custom format) of the SOURCE (read-only for the source).
 * 2. Restore into a NEW database named edmn_restore_drill_<timestamp> on a LOCAL server. The target must not exist,
 *    must be local, and its name must contain "restore_drill": the drill can never restore over staging/production.
 * 3. Verify source vs restored: migrations, row counts of the critical tables, ledger debits/credits/difference,
 *    projection drift, duplicate business events, approvals, withdrawal allocations (sum = amount), refund
 *    snapshots, seller source attribution, identity metadata, document references, pricing snapshots.
 * 4. Write a JSON evidence record under drills/ (timings = measured RTO for this data size) and drop the drill DB
 *    unless --keep. National ID numbers and payout details stay encrypted; the drill never decrypts or prints them.
 */
const args = process.argv.slice(2);
const source = args[args.indexOf('--source') + 1];
if (!source || args.indexOf('--source') < 0) throw new Error('usage: --source <postgres-url>');
const keep = args.includes('--keep');

const TABLES = [
  'users', 'sellers', 'orders', 'seller_orders', 'payments', 'payment_submissions', 'journal_entries', 'journal_lines', 'ledger_accounts',
  'financial_approvals', 'financial_movement_requests', 'withdrawal_requests', 'withdrawal_allocations', 'refunds', 'deal_payouts',
  'external_deals', 'user_identity_verifications', 'receiving_destinations', 'seller_payout_methods', 'files', 'stored_objects',
  'pricing_versions', 'pricing_tiers', 'pricing_category_classes', 'audit_logs', 'disputes', 'support_tickets',
];

const CHECKS: Record<string, string> = {
  migrations: `select count(*)::text v from drizzle.__drizzle_migrations`,
  debits: `select coalesce(sum(debit),0)::text v from journal_lines`,
  credits: `select coalesce(sum(credit),0)::text v from journal_lines`,
  unbalanced_entries: `select count(*)::text v from (select entry_id from journal_lines group by entry_id having sum(debit) <> sum(credit)) x`,
  projection_drift: `select count(*)::text v from ledger_accounts a where a.balance <> coalesce((select sum(case when a.type in ('ASSET','EXPENSE') then l.debit - l.credit else l.credit - l.debit end) from journal_lines l where l.account_id = a.id), 0)`,
  duplicate_events: `select count(*)::text v from (select entry_type, source_id from journal_entries where entry_type in ('ORDER_PAYMENT','SELLER_RELEASE','DEAL_PAYMENT','DEAL_SETTLEMENT','WITHDRAWAL_RESERVE','WITHDRAWAL_PAID') group by 1,2 having count(*) > 1) x`,
  approvals: `select count(*)::text v from financial_approvals`,
  allocation_sum_mismatch: `select count(*)::text v from withdrawal_requests w where exists (select 1 from withdrawal_allocations a where a.withdrawal_id = w.id) and w.amount <> (select sum(amount) from withdrawal_allocations a where a.withdrawal_id = w.id)`,
  refunds_with_snapshot: `select count(*)::text v from refunds`,
  seller_attributed_accounts: `select count(*)::text v from ledger_accounts where seller_id is not null`,
  identity_cases: `select count(*)::text v from user_identity_verifications`,
  identity_docs_referenced: `select count(*)::text v from user_identity_verifications where front_file_id is not null or back_file_id is not null`,
  file_refs_without_object: `select count(*)::text v from files f where f.deleted_at is null and not exists (select 1 from stored_objects o where o.key = f.storage_key) and exists (select 1 from stored_objects)`,
  // Historical pricing snapshots must come back byte-identical.
  pricing_snapshot_hash: `select coalesce(md5(string_agg(md5(concat_ws('|', id, pricing_source, pricing_version_id, pricing_snapshot::text, commission_total, buyer_fee_total, seller_fee_total, seller_net)), ',' order by id)), '') v from seller_orders`,
  deal_pricing_snapshot_hash: `select coalesce(md5(string_agg(md5(concat_ws('|', id, pricing_source, pricing_version_id, pricing_snapshot::text, buyer_fee_amount, seller_fee_amount, total_amount, buyer_pays)), ',' order by id)), '') v from external_deals`,
  ledger_hash: `select coalesce(md5(string_agg(md5(concat_ws('|', id, entry_id, account_id, debit, credit)), ',' order by id)), '') v from journal_lines`,
};

async function measure(url: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  const out: Record<string, string> = {};
  try {
    for (const t of TABLES) {
      try {
        out[`rows.${t}`] = (await c.query<{ v: string }>(`select count(*)::text v from ${t}`)).rows[0].v;
      } catch {
        out[`rows.${t}`] = 'n/a';
      }
    }
    for (const [k, q] of Object.entries(CHECKS)) {
      try {
        out[k] = (await c.query<{ v: string }>(q)).rows[0].v;
      } catch {
        out[k] = 'n/a';
      }
    }
  } finally {
    await c.end();
  }
  return out;
}

async function main() {
  const src = new URL(source);
  const local = ['localhost', '127.0.0.1'];
  // The repository drill runs on a local server only. A hosted (Neon) drill is a provider branch restore done by
  // the owner (runbook); this script never connects to, dumps into or restores over a hosted database.
  if (!local.includes(src.hostname)) throw new Error('refusing: the scripted drill uses a local source; hosted drills use a provider branch (see runbook)');
  const target = new URL(source);
  const name = `edmn_restore_drill_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  target.pathname = `/${name}`;
  if (!/restore_drill/.test(name) || !local.includes(target.hostname)) throw new Error('refusing: drill target must be a new local restore_drill database');
  const admin = new URL(target.toString());
  admin.pathname = '/postgres';
  const ac = new Client({ connectionString: admin.toString() });
  await ac.connect();
  const exists = await ac.query('select 1 from pg_database where datname = $1', [name]);
  if (exists.rows.length) throw new Error('refusing: drill database already exists');

  const dumpFile = path.resolve('.restore-drill.dump');
  const t0 = Date.now();
  execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--file=${dumpFile}`, source], { stdio: 'inherit' });
  const t1 = Date.now();
  await ac.query(`create database ${name}`);
  execFileSync('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${target.toString()}`, dumpFile], { stdio: 'inherit' });
  const t2 = Date.now();
  const before = await measure(source);
  const after = await measure(target.toString());
  const diffs = Object.keys(before).filter((k) => before[k] !== after[k]).map((k) => ({ check: k, source: before[k], restored: after[k] }));
  const debit = Number(after.debits);
  const credit = Number(after.credits);
  const financialOk = debit === credit && after.unbalanced_entries === '0' && after.projection_drift === '0' && after.duplicate_events === '0' && after.allocation_sum_mismatch === '0';
  const record = {
    drill: 'ISOLATED_DATABASE_RESTORE',
    at: new Date().toISOString(),
    sourceHost: src.hostname,
    sourceDb: src.pathname.slice(1),
    target: name,
    dumpMs: t1 - t0,
    restoreMs: t2 - t1,
    measuredRtoMs: t2 - t0,
    result: diffs.length === 0 && financialOk ? 'PASS' : 'FAIL',
    financial: { debits: debit, credits: credit, difference: debit - credit, unbalanced: after.unbalanced_entries, drift: after.projection_drift, duplicates: after.duplicate_events, allocationMismatch: after.allocation_sum_mismatch },
    diffs,
    restored: after,
    note: 'Logical dump/restore drill. A provider point-in-time restore (Neon branch) must be drilled separately by the owner; this record does not prove production backups.',
  };
  mkdirSync('drills', { recursive: true });
  const file = path.join('drills', `${name}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));
  execFileSync('rm', ['-f', dumpFile]);
  if (!keep) await ac.query(`drop database ${name}`);
  await ac.end();
  console.log(`${record.result} — evidence: ${file} (dump ${record.dumpMs} ms, restore ${record.restoreMs} ms, diffs ${diffs.length})`);
  if (record.result !== 'PASS') process.exit(1);
}

main().catch((e) => {
  console.error('✗ restore drill failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
