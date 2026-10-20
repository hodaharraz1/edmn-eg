import './_env';
import { sql } from 'drizzle-orm';
import { decrypt, encrypt, needsReencryption, primaryKeyId } from '../src/server/core/crypto';
import { closeDb, db } from '../src/server/db/client';

/**
 * KEY ROTATION RE-WRAP (Batch 2) — docs/runbooks/SECRET_ROTATION.md.
 *   npx tsx scripts/reencrypt.ts            DRY RUN: counts ciphertexts not under the primary key id (default)
 *   npx tsx scripts/reencrypt.ts --apply    re-encrypts them under DATA_ENCRYPTION_KEY_ID, row by row
 * Plaintext never leaves memory and is never printed. Each row is decrypted and verified (round trip) before the
 * update. Never run automatically; run only after the new key id is deployed and the old key sits in
 * DATA_ENCRYPTION_KEYS_PREVIOUS. Tables whose rows are immutable by trigger are reported, not forced.
 */
const COLUMNS: [table: string, column: string][] = [
  ['users', 'totp_secret_enc'],
  ['addresses', 'location_enc'],
  ['user_identity_verifications', 'national_id_enc'],
  ['receiving_destinations', 'details_enc'],
  ['sellers', 'national_id_enc'],
  ['seller_payout_methods', 'details_enc'],
  ['external_deals', 'buyer_location_enc'],
  ['external_deals', 'seller_location_enc'],
  ['external_deals', 'seller_payout_enc'],
  ['deal_delivery_otps', 'test_code_enc'],
  ['push_subscriptions', 'secret_enc'],
];

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATA_ENCRYPTION_KEY_ID) throw new Error('DATA_ENCRYPTION_KEY_ID is not set: nothing to rotate to');
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — target key id: ${primaryKeyId()}`);
  for (const [table, column] of COLUMNS) {
    const rows = (await db.execute<{ id: string; v: string }>(sql.raw(`select id::text id, ${column} v from ${table} where ${column} is not null`))).rows;
    const stale = rows.filter((r) => needsReencryption(r.v));
    let done = 0;
    let refused = 0;
    let unreadable = 0;
    if (apply) {
      for (const r of stale) {
        let plain: string;
        try {
          plain = decrypt(r.v);
        } catch {
          unreadable++;
          continue;
        }
        const next = encrypt(plain);
        if (decrypt(next) !== plain) throw new Error('round-trip verification failed');
        try {
          await db.execute(sql.raw(`update ${table} set ${column} = '${next.replace(/'/g, "''")}' where id = '${r.id.replace(/'/g, "''")}' and ${column} = '${r.v.replace(/'/g, "''")}'`));
          done++;
        } catch {
          refused++; // immutable by trigger (versioned records): stays readable through the previous key
        }
      }
    }
    console.log(`${table}.${column}: total=${rows.length} stale=${stale.length}${apply ? ` reencrypted=${done} refused=${refused} unreadable=${unreadable}` : ''}`);
  }
  await closeDb();
}
main().catch(async (e) => {
  console.error('✗', e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
