import './_env';
import { sql } from 'drizzle-orm';
import { closeDb, db } from '../src/server/db/client';
import { reconcile } from '../src/server/modules/finance/ledger';
import { financialInvariants } from '../src/server/modules/finance/controls';

/** Operational integrity check: balance projections vs journal + trial balance. Exit code 1 on drift. */
async function main() {
  const r = await reconcile();
  const accounts = await db.execute(sql`select a.code, s.legal_name, a.balance from ledger_accounts a left join sellers s on s.id = a.seller_id order by a.code`);
  console.table(accounts.rows);
  // PKG-WALLET-01: CUSTOMER_WALLETS must equal the per-user sub-ledger, and no wallet may be negative.
  const wallet = (await financialInvariants()).checks.filter((c) => c.code.startsWith('WALLET_') || c.code === 'MISSING_WALLET_JOURNAL');
  console.log({ walletInvariants: wallet.map((c) => ({ code: c.code, violations: c.count })) });
  console.log({ accounts: r.accounts, mismatches: r.mismatches.length, trialBalanceOk: r.trialBalanceOk, totalDebits: r.totalDebits, totalCredits: r.totalCredits });
  await closeDb();
  if (r.mismatches.length || !r.trialBalanceOk || wallet.some((c) => c.count > 0)) process.exit(1);
}
main();
