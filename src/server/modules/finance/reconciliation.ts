import { desc, eq, inArray, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, type Actor } from '@/server/core/actor';
import { conflict, invalidState, notFound, validation } from '@/server/core/errors';
import { parseEgp } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { externalTransactions, reconImports, riskFlags, type ReconState } from '@/server/db/schema';

type Channel = 'BANK_TRANSFER' | 'INSTAPAY' | 'VODAFONE_CASH' | 'PSP';
type MatchType = 'payment' | 'withdrawal' | 'refund' | 'deal_payout';
export type ExternalTx = typeof externalTransactions.$inferSelect;

interface Candidate {
  type: MatchType;
  id: string;
  amount: number;
  reference: string | null;
  strength: 'REFERENCE_AND_AMOUNT' | 'AMOUNT_ONLY';
}

/**
 * Parse a statement CSV: externalRef,direction,amount,occurredAt[,counterparty]. Amounts are decimal EGP.
 * Rows are validated strictly; one bad row fails the whole import (recorded as FAILED, nothing partial).
 */
export function parseStatementCsv(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && /externalref/i.test(lines[0])) lines.shift();
  if (!lines.length) throw validation('الملف فاضي');
  if (lines.length > 5000) throw validation('الحد الأقصى 5000 سطر في الملف');
  return lines.map((line, i) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const [externalRef, direction, amount, occurredAt, counterparty] = cols;
    if (!externalRef || externalRef.length > 120) throw validation(`سطر ${i + 1}: مرجع غير صالح`);
    if (direction !== 'IN' && direction !== 'OUT') throw validation(`سطر ${i + 1}: الاتجاه لازم IN أو OUT`);
    let minor: number;
    try {
      minor = parseEgp(amount);
    } catch {
      throw validation(`سطر ${i + 1}: مبلغ غير صالح`);
    }
    if (minor <= 0) throw validation(`سطر ${i + 1}: المبلغ لازم يكون موجب`);
    const at = new Date(occurredAt);
    if (Number.isNaN(at.getTime())) throw validation(`سطر ${i + 1}: تاريخ غير صالح`);
    return { externalRef, direction: direction as 'IN' | 'OUT', amount: minor, occurredAt: at, counterparty: counterparty?.slice(0, 120) || null };
  });
}

async function candidatesFor(conn: DbOrTx, t: Pick<ExternalTx, 'direction' | 'amount' | 'externalRef'>): Promise<Candidate[]> {
  if (t.direction === 'IN') {
    const r = await conn.execute<{ id: string; amount: string; reference: string | null }>(sql`
      select p.id, coalesce(p.confirmed_amount, p.amount_due)::text amount, s.reference from payments p
      left join payment_submissions s on s.payment_id = p.id and s.status in ('ACCEPTED','SUBMITTED')
      where coalesce(p.confirmed_amount, p.amount_due) = ${t.amount} and p.status in ('CONFIRMED','PAYMENT_SUBMITTED','UNDER_REVIEW')
        and not exists (select 1 from external_transactions x where x.state = 'MATCHED' and x.matched_type = 'payment' and x.matched_id = p.id)
      limit 20`);
    return r.rows.map((x) => ({ type: 'payment', id: x.id, amount: Number(x.amount), reference: x.reference, strength: x.reference && x.reference === t.externalRef ? 'REFERENCE_AND_AMOUNT' : 'AMOUNT_ONLY' }));
  }
  const r = await conn.execute<{ type: MatchType; id: string; amount: string; reference: string | null }>(sql`
    select 'withdrawal' as type, w.id, w.amount::text amount, w.paid_reference reference from withdrawal_requests w
      where w.status = 'PAID' and w.amount = ${t.amount}
        and not exists (select 1 from external_transactions x where x.state = 'MATCHED' and x.matched_type = 'withdrawal' and x.matched_id = w.id)
    union all select 'refund', r.id, r.amount::text, r.paid_reference from refunds r
      where r.status in ('PAID','COMPLETED') and r.amount = ${t.amount}
        and not exists (select 1 from external_transactions x where x.state = 'MATCHED' and x.matched_type = 'refund' and x.matched_id = r.id)
    union all select 'deal_payout', d.id, d.amount::text, d.paid_reference from deal_payouts d
      where d.status = 'PAID' and d.amount = ${t.amount}
        and not exists (select 1 from external_transactions x where x.state = 'MATCHED' and x.matched_type = 'deal_payout' and x.matched_id = d.id)
    limit 20`);
  return r.rows.map((x) => ({ type: x.type, id: x.id, amount: Number(x.amount), reference: x.reference, strength: x.reference && x.reference === t.externalRef ? 'REFERENCE_AND_AMOUNT' : 'AMOUNT_ONLY' }));
}

/**
 * Import a statement. Every row becomes UNMATCHED or SUGGESTED_MATCH (with its candidates) — never
 * MATCHED: a human confirms each match (audited). Re-importing the same reference is ignored.
 */
export async function importStatement(actor: Actor, channel: Channel, csv: string, fileName?: string) {
  requirePermission(actor, 'reconciliation.manage');
  let rows: ReturnType<typeof parseStatementCsv>;
  try {
    rows = parseStatementCsv(csv);
  } catch (e) {
    await db.insert(reconImports).values({ channel, fileName: fileName ?? null, status: 'FAILED', error: (e as Error).message.slice(0, 500), importedBy: actor.userId });
    throw e;
  }
  return db.transaction(async (tx) => {
    const [imp] = await tx.insert(reconImports).values({ channel, fileName: fileName ?? null, rowCount: rows.length, importedBy: actor.userId }).returning();
    let inserted = 0;
    let suggested = 0;
    for (const r of rows) {
      const cands = await candidatesFor(tx, r);
      const state: ReconState = cands.length ? 'SUGGESTED_MATCH' : 'UNMATCHED';
      const res = await tx
        .insert(externalTransactions)
        .values({ importId: imp.id, channel, direction: r.direction, externalRef: r.externalRef, amount: r.amount, occurredAt: r.occurredAt, counterparty: r.counterparty, state, suggestion: cands.length ? { candidates: cands, ambiguous: cands.length > 1 || cands[0].strength !== 'REFERENCE_AND_AMOUNT' } : null })
        .onConflictDoNothing()
        .returning({ id: externalTransactions.id });
      if (res.length) {
        inserted++;
        if (cands.length) suggested++;
      }
    }
    await audit(tx, actor, { action: 'reconciliation.imported', entityType: 'recon_import', entityId: imp.id, newValues: { channel, rows: rows.length, inserted, suggested } });
    return { importId: imp.id, rows: rows.length, inserted, suggested };
  });
}

async function lockTx(tx: DbOrTx, id: string) {
  const [t] = await tx.select().from(externalTransactions).where(eq(externalTransactions.id, id)).for('update');
  if (!t) throw notFound('الحركة');
  return t;
}

/** Manual match (audited). Amount mismatch → MISMATCH + high-severity flag; never silently accepted. */
export async function confirmMatch(actor: Actor, externalId: string, target: { type: MatchType; id: string }, note: string) {
  requirePermission(actor, 'reconciliation.manage');
  if (!note || note.trim().length < 3) throw validation('اكتب ملاحظة المطابقة');
  return db.transaction(async (tx) => {
    const t = await lockTx(tx, externalId);
    if (t.state === 'MATCHED') throw conflict('الحركة دي متطابقة بالفعل');
    const taken = await tx.execute(sql`select 1 from external_transactions where state = 'MATCHED' and matched_type = ${target.type} and matched_id = ${target.id} limit 1`);
    if (taken.rows.length) throw conflict('السجل ده متطابق مع حركة تانية بالفعل');
    const table = { payment: 'payments', withdrawal: 'withdrawal_requests', refund: 'refunds', deal_payout: 'deal_payouts' }[target.type];
    if (!table) throw validation('نوع غير صالح');
    const amountCol = target.type === 'payment' ? sql.raw('coalesce(confirmed_amount, amount_due)') : sql.raw('amount');
    const rec = await tx.execute<{ amount: string }>(sql`select ${amountCol}::text amount from ${sql.raw(table)} where id = ${target.id}`);
    if (!rec.rows.length) throw notFound('السجل');
    const expected = Number(rec.rows[0].amount);
    const journal = await tx.execute<{ id: string }>(sql`select id from journal_entries where source_id = ${target.id} or idempotency_key like ${'%' + target.id + '%'} order by created_at desc limit 1`);
    const state: ReconState = expected === t.amount ? 'MATCHED' : 'MISMATCH';
    await tx
      .update(externalTransactions)
      .set({ state, matchedType: target.type, matchedId: target.id, journalEntryId: journal.rows[0]?.id ?? null, note: note.trim(), decidedBy: actor.userId, decidedAt: new Date() })
      .where(eq(externalTransactions.id, t.id));
    if (state === 'MISMATCH') {
      await tx.insert(riskFlags).values({ entityType: 'external_transaction', entityId: t.id, code: 'RECONCILIATION_MISMATCH', severity: 'HIGH', note: `statement ${t.amount} ≠ record ${expected}`, createdBy: actor.userId });
    }
    await audit(tx, actor, { action: state === 'MATCHED' ? 'reconciliation.matched' : 'reconciliation.mismatch', entityType: 'external_transaction', entityId: t.id, oldValues: { state: t.state }, newValues: { state, target, statementAmount: t.amount, recordAmount: expected }, reason: note });
    return { state };
  });
}

export async function setReconState(actor: Actor, externalId: string, to: 'UNMATCHED' | 'IGNORED_WITH_REASON' | 'MISMATCH', reason: string) {
  requirePermission(actor, 'reconciliation.manage');
  if (!reason || reason.trim().length < 3) throw validation('يجب ذكر السبب');
  await db.transaction(async (tx) => {
    const t = await lockTx(tx, externalId);
    if (t.state === to) return;
    if (to === 'IGNORED_WITH_REASON' && t.state === 'MATCHED') throw invalidState('فك المطابقة الأول');
    await tx
      .update(externalTransactions)
      .set({ state: to, ...(to === 'UNMATCHED' ? { matchedType: null, matchedId: null, journalEntryId: null } : {}), note: reason.trim(), decidedBy: actor.userId, decidedAt: new Date() })
      .where(eq(externalTransactions.id, t.id));
    await audit(tx, actor, { action: `reconciliation.${to.toLowerCase()}`, entityType: 'external_transaction', entityId: t.id, oldValues: { state: t.state, matchedType: t.matchedType, matchedId: t.matchedId }, newValues: { state: to }, reason });
  });
}

export async function reconQueue(states: ReconState[], limit = 50, offset = 0) {
  return db
    .select()
    .from(externalTransactions)
    .where(inArray(externalTransactions.state, states))
    .orderBy(desc(externalTransactions.occurredAt), desc(externalTransactions.id))
    .limit(limit)
    .offset(offset);
}

export async function reconCounts() {
  const r = await db.execute<{ state: string; n: string }>(sql`select state, count(*)::text n from external_transactions group by state`);
  return Object.fromEntries(r.rows.map((x) => [x.state, Number(x.n)])) as Partial<Record<ReconState, number>>;
}

export async function reconImportsList(limit = 20) {
  return db.select().from(reconImports).orderBy(desc(reconImports.createdAt)).limit(limit);
}

