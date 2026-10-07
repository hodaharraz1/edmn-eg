import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Actor } from '@/server/core/actor';
import { DomainError } from '@/server/core/errors';
import { assertMinor } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { journalEntries, journalLines, ledgerAccounts } from '@/server/db/schema';

/**
 * Chart of accounts.
 * Platform accounts have sellerId = null; seller sub-ledgers carry the seller id.
 *
 *  PLATFORM_CASH              ASSET      money received into EDMN's collection accounts
 *  COMMISSION_DEFERRED        LIABILITY  commission on paid orders not yet delivered (not earned yet)
 *  COMMISSION_REVENUE         REVENUE    commission earned on buyer-confirmed deliveries
 *  CUSTOMER_REFUNDS_PAYABLE   LIABILITY  refunds owed to customers, until paid out manually
 *  DEAL_FUNDS_HELD            LIABILITY  external-deal payments held pending completion
 *  DEAL_PAYOUTS_PAYABLE       LIABILITY  amounts owed to external-deal sellers
 *  DEAL_FEE_REVENUE           REVENUE    protected-deal fees
 *  ADJUSTMENTS_EXPENSE        EXPENSE    platform-funded manual adjustments (goodwill etc.)
 *  SELLER_PENDING             LIABILITY  seller net on paid orders awaiting buyer receipt confirmation
 *  SELLER_AVAILABLE           LIABILITY  seller net available for withdrawal
 *  SELLER_WITHDRAWAL_RESERVED LIABILITY  amounts locked by in-flight withdrawal requests
 */
export const ACCOUNTS = {
  PLATFORM_CASH: { type: 'ASSET', name: 'نقدية اضمن المحصلة' },
  COMMISSION_DEFERRED: { type: 'LIABILITY', name: 'عمولات مؤجلة' },
  COMMISSION_REVENUE: { type: 'REVENUE', name: 'إيرادات العمولات' },
  CUSTOMER_REFUNDS_PAYABLE: { type: 'LIABILITY', name: 'مستردات مستحقة للعملاء' },
  DEAL_FUNDS_HELD: { type: 'LIABILITY', name: 'مبالغ الصفقات المحمية' },
  DEAL_PAYOUTS_PAYABLE: { type: 'LIABILITY', name: 'مستحقات بائعي الصفقات' },
  DEAL_FEE_REVENUE: { type: 'REVENUE', name: 'رسوم الصفقات المحمية' },
  ADJUSTMENTS_EXPENSE: { type: 'EXPENSE', name: 'مصروف التسويات' },
  /** Payout/refund transfer costs borne by EDMN (seller-borne costs reduce the amount sent instead). */
  TRANSFER_COST_EXPENSE: { type: 'EXPENSE', name: 'مصروف رسوم التحويل' },
  SELLER_PENDING: { type: 'LIABILITY', name: 'رصيد البائع المعلق' },
  SELLER_AVAILABLE: { type: 'LIABILITY', name: 'رصيد البائع المتاح' },
  SELLER_WITHDRAWAL_RESERVED: { type: 'LIABILITY', name: 'رصيد محجوز لطلبات السحب' },
} as const;
export type AccountCode = keyof typeof ACCOUNTS;
const SELLER_CODES: ReadonlySet<AccountCode> = new Set(['SELLER_PENDING', 'SELLER_AVAILABLE', 'SELLER_WITHDRAWAL_RESERVED']);

export function isDebitNormal(code: AccountCode) {
  const t = ACCOUNTS[code].type;
  return t === 'ASSET' || t === 'EXPENSE';
}

export interface AccountRef {
  code: AccountCode;
  sellerId?: string | null;
}

export interface LineInput {
  account: AccountRef;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface PostInput {
  entryType: string;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  description: string;
  lines: LineInput[];
  /** After posting, each listed account balance must be >= min (checked under row lock). */
  guards?: { account: AccountRef; min: number }[];
  reversesEntryId?: string;
  /** The operation-specific Admin approval this entry executes. Mandatory (DB trigger enforces it too). */
  approvalId: string;
}

async function ensureAccount(tx: DbOrTx, ref: AccountRef): Promise<string> {
  const isSeller = SELLER_CODES.has(ref.code);
  if (isSeller && !ref.sellerId) throw new Error(`account ${ref.code} requires sellerId`);
  if (!isSeller && ref.sellerId) throw new Error(`account ${ref.code} is a platform account`);
  const where = isSeller
    ? and(eq(ledgerAccounts.code, ref.code), eq(ledgerAccounts.sellerId, ref.sellerId!))
    : and(eq(ledgerAccounts.code, ref.code), isNull(ledgerAccounts.sellerId));
  const [found] = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(where);
  if (found) return found.id;
  const def = ACCOUNTS[ref.code];
  await tx
    .insert(ledgerAccounts)
    .values({ code: ref.code, name: def.name, type: def.type, sellerId: ref.sellerId ?? null })
    .onConflictDoNothing();
  const [created] = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(where);
  return created.id;
}

const key = (r: AccountRef) => `${r.code}:${r.sellerId ?? ''}`;

/**
 * Post a balanced journal entry atomically and idempotently.
 *  - idempotencyKey is UNIQUE: a retry returns the original entry and posts nothing.
 *  - affected accounts are locked FOR UPDATE in a deterministic order (no deadlocks, no lost updates).
 *  - balance projections are updated in the same transaction; a deferred DB trigger re-verifies balance.
 */
export async function postEntry(tx: DbOrTx, actor: Actor, input: PostInput): Promise<{ entryId: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.idempotencyKey, input.idempotencyKey));
  if (existing) return { entryId: existing.id, created: false };
  if (!input.approvalId) throw new DomainError('FORBIDDEN', 'لا يمكن تسجيل أي حركة مالية بدون موافقة صريحة من الإدارة');

  const lines = input.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const d = assertMinor(l.debit ?? 0, 'debit');
    const c = assertMinor(l.credit ?? 0, 'credit');
    if (d < 0 || c < 0 || (d > 0 && c > 0)) throw new Error('each journal line must be a single positive debit or credit');
    dr += d;
    cr += c;
  }
  if (lines.length < 2 || dr !== cr) throw new Error(`unbalanced journal entry ${input.entryType}: dr=${dr} cr=${cr}`);

  // Resolve & lock accounts.
  const refs = new Map<string, AccountRef>();
  for (const l of lines) refs.set(key(l.account), l.account);
  for (const g of input.guards ?? []) refs.set(key(g.account), g.account);
  const ids = new Map<string, string>();
  for (const [k, r] of refs) ids.set(k, await ensureAccount(tx, r));
  const sortedIds = [...new Set(ids.values())].sort();
  await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(inArray(ledgerAccounts.id, sortedIds)).orderBy(ledgerAccounts.id).for('update');

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      entryType: input.entryType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      reversesEntryId: input.reversesEntryId ?? null,
      approvalId: input.approvalId,
      createdBy: actor.userId,
    })
    .returning({ id: journalEntries.id });

  const deltas = new Map<string, number>();
  for (const l of lines) {
    const accountId = ids.get(key(l.account))!;
    await tx.insert(journalLines).values({ entryId: entry.id, accountId, debit: l.debit ?? 0, credit: l.credit ?? 0, memo: l.memo ?? null });
    const d = (l.debit ?? 0) - (l.credit ?? 0);
    const delta = isDebitNormal(l.account.code) ? d : -d;
    deltas.set(accountId, (deltas.get(accountId) ?? 0) + delta);
  }
  for (const [accountId, delta] of deltas) {
    if (delta !== 0) {
      await tx
        .update(ledgerAccounts)
        .set({ balance: sql`${ledgerAccounts.balance} + ${delta}`, updatedAt: new Date() })
        .where(eq(ledgerAccounts.id, accountId));
    }
  }
  for (const g of input.guards ?? []) {
    const [acc] = await tx.select({ balance: ledgerAccounts.balance }).from(ledgerAccounts).where(eq(ledgerAccounts.id, ids.get(key(g.account))!));
    if (acc.balance < g.min) throw new DomainError('INSUFFICIENT_BALANCE', 'الرصيد المتاح غير كافٍ لإتمام العملية');
  }
  return { entryId: entry.id, created: true };
}

export async function accountBalance(conn: DbOrTx, ref: AccountRef, lock = false): Promise<number> {
  const where = ref.sellerId
    ? and(eq(ledgerAccounts.code, ref.code), eq(ledgerAccounts.sellerId, ref.sellerId))
    : and(eq(ledgerAccounts.code, ref.code), isNull(ledgerAccounts.sellerId));
  const q = conn.select({ balance: ledgerAccounts.balance }).from(ledgerAccounts).where(where);
  const [row] = lock ? await q.for('update') : await q;
  return row?.balance ?? 0;
}

export interface SellerBalances {
  pending: number;
  available: number;
  reserved: number;
}

export async function sellerBalances(conn: DbOrTx, sellerId: string): Promise<SellerBalances> {
  const rows = await conn
    .select({ code: ledgerAccounts.code, balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.sellerId, sellerId));
  const by = Object.fromEntries(rows.map((r) => [r.code, r.balance]));
  return {
    pending: by.SELLER_PENDING ?? 0,
    available: by.SELLER_AVAILABLE ?? 0,
    reserved: by.SELLER_WITHDRAWAL_RESERVED ?? 0,
  };
}

/** Re-derive every account balance from journal lines and report any drift from the projection. */
export async function reconcile(conn: DbOrTx = db) {
  const res = await conn.execute<{ id: string; code: string; seller_id: string | null; type: string; projected: string; derived: string }>(sql`
    select a.id, a.code, a.seller_id, a.type, a.balance as projected,
      coalesce(sum(case when a.type in ('ASSET','EXPENSE') then l.debit - l.credit else l.credit - l.debit end), 0) as derived
    from ledger_accounts a left join journal_lines l on l.account_id = a.id
    group by a.id`);
  const mismatches = res.rows.filter((r) => Number(r.projected) !== Number(r.derived));
  const totals = await conn.execute<{ dr: string; cr: string }>(sql`select coalesce(sum(debit),0) dr, coalesce(sum(credit),0) cr from journal_lines`);
  return {
    accounts: res.rows.length,
    mismatches,
    trialBalanceOk: Number(totals.rows[0].dr) === Number(totals.rows[0].cr),
    totalDebits: Number(totals.rows[0].dr),
    totalCredits: Number(totals.rows[0].cr),
  };
}
