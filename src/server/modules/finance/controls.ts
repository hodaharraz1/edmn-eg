import { sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { DomainError, conflict, validation } from '@/server/core/errors';
import { applyBps } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { financialCloses, systemSettings } from '@/server/db/schema';
import { getSetting, type SettingKey } from '@/server/modules/settings';
import { reconcile } from './ledger';

/* ═══════════════ Kill switches ═══════════════ */

export const KILL_SWITCHES = {
  'killswitch.paymentConfirmation': 'تأكيد المدفوعات اليدوية',
  'killswitch.sellerRelease': 'إتاحة أرباح البائعين (Seller release)',
  'killswitch.refunds': 'اعتماد الاستردادات',
  'killswitch.withdrawals': 'اعتماد وحجز طلبات السحب',
  'killswitch.payouts': 'تسجيل صرف السحب والاستردادات ومستحقات الصفقات',
  'killswitch.dealRelease': 'تسوية وإتاحة مستحقات الصفقات المحمية',
  'killswitch.adjustments': 'التسويات المالية اليدوية',
} as const satisfies Partial<Record<SettingKey, string>>;
export type KillSwitch = keyof typeof KILL_SWITCHES;

/** Throws when a financial kill switch is engaged. Fails CLOSED: an unreadable switch counts as paused. */
export async function assertNotPaused(conn: DbOrTx, key: KillSwitch): Promise<void> {
  let paused: boolean;
  try {
    paused = await getSetting(key, conn);
  } catch {
    paused = true;
  }
  if (paused) {
    throw new DomainError('INVALID_STATE', `«${KILL_SWITCHES[key]}» موقوف مؤقتًا من الإدارة. مفيش أي حركة مالية اتعملت — حاول تاني بعد إعادة التشغيل.`);
  }
}

export async function killSwitchStates(conn: DbOrTx = db) {
  const out: { key: KillSwitch; label: string; paused: boolean }[] = [];
  for (const key of Object.keys(KILL_SWITCHES) as KillSwitch[]) {
    let paused = true;
    try {
      paused = await getSetting(key, conn);
    } catch {
      /* fail closed */
    }
    out.push({ key, label: KILL_SWITCHES[key], paused });
  }
  return out;
}

/** Engage / release a kill switch. Stops NEW sensitive actions only; never touches history. */
export async function setKillSwitch(actor: Actor, key: KillSwitch, paused: boolean, reason: string) {
  requirePermission(actor, 'finance.controls');
  requireStepUp(actor);
  if (!(key in KILL_SWITCHES)) throw validation('مفتاح غير معروف');
  if (!reason || reason.trim().length < 3) throw validation('يجب ذكر السبب');
  await db.transaction(async (tx) => {
    const old = await getSetting(key, tx);
    await tx
      .insert(systemSettings)
      .values({ key, value: paused as unknown as object, updatedBy: actor.userId })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: paused as unknown as object, updatedBy: actor.userId, updatedAt: new Date() } });
    await audit(tx, actor, { action: paused ? 'killswitch.engaged' : 'killswitch.released', entityType: 'kill_switch', entityId: key, oldValues: { paused: old }, newValues: { paused }, reason });
  });
}

/* ═══════════════ Transparent shared fee ═══════════════ */

export interface FeeConfig {
  buyerShareBps: number;
  ownerApproved: boolean;
}

/** Current fee split. Missing/invalid configuration blocks new financial checkout (never guessed). */
export async function requireFeeConfig(conn: DbOrTx = db): Promise<FeeConfig> {
  const buyerShareBps = await getSetting('fees.buyerShareBps', conn);
  if (buyerShareBps === null || !Number.isInteger(buyerShareBps) || buyerShareBps < 0 || buyerShareBps > 10000) {
    throw new DomainError('INVALID_STATE', 'الشراء متوقف مؤقتًا: إعدادات رسوم الخدمة لسه ما اتحددتش من الإدارة.');
  }
  return { buyerShareBps, ownerApproved: await getSetting('fees.ownerApproved', conn) };
}

/**
 * Split the total fee F of one item between buyer and seller in minor units:
 * Fb = round_half_up(F × buyerShareBps / 10000), Fs = F − Fb. So Fb + Fs = F exactly, always.
 */
export function splitFee(total: number, buyerShareBps: number): { buyer: number; seller: number } {
  const buyer = applyBps(total, buyerShareBps);
  return { buyer, seller: total - buyer };
}
export const FEE_ROUNDING_RULE = 'PER_ITEM_BUYER_SHARE_HALF_UP_SELLER_REMAINDER';

/* ═══════════════ Financial invariants (never repaired automatically) ═══════════════ */

export interface InvariantResult {
  code: string;
  label: string;
  count: number;
  sample: unknown[];
}

async function rows<T>(conn: DbOrTx, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await conn.execute(q)).rows as T[];
}

/** Every check returns the offending rows (drill-down to the source business event). Expected: 0 each. */
export async function financialInvariants(conn: DbOrTx = db): Promise<{ ok: boolean; totals: { debits: number; credits: number; difference: number }; checks: InvariantResult[] }> {
  const rec = await reconcile(conn);
  const checks: InvariantResult[] = [];
  const add = (code: string, label: string, sample: unknown[]) => checks.push({ code, label, count: sample.length, sample: sample.slice(0, 20) });

  add('TRIAL_BALANCE', 'مجموع المدين ≠ مجموع الدائن', rec.trialBalanceOk ? [] : [{ debits: rec.totalDebits, credits: rec.totalCredits }]);
  add('PROJECTION_DRIFT', 'رصيد حساب مخزَّن لا يطابق القيود', rec.mismatches);
  add(
    'UNBALANCED_ENTRY',
    'قيد غير متوازن',
    await rows(conn, sql`select e.id, e.entry_type, e.source_type, e.source_id, sum(l.debit) dr, sum(l.credit) cr from journal_entries e join journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit) or count(*) < 2`),
  );
  add(
    'DUPLICATE_BUSINESS_EVENT',
    'حدث مالي مسجل أكثر من مرة',
    await rows(
      conn,
      sql`select entry_type, source_id, count(*) n from journal_entries
        where entry_type in ('ORDER_PAYMENT','SELLER_RELEASE','DEAL_PAYMENT','DEAL_SETTLEMENT','DEAL_REFUND','WITHDRAWAL_RESERVE','WITHDRAWAL_PAID','WITHDRAWAL_REVERSAL','DEAL_PAYOUT_PAID')
        group by entry_type, source_id having count(*) > 1`,
    ),
  );
  add(
    'ORPHAN_JOURNAL',
    'قيد مرتبط بمصدر غير موجود',
    await rows(
      conn,
      sql`select e.id, e.entry_type, e.source_type, e.source_id from journal_entries e where
        (e.source_type = 'seller_order' and not exists (select 1 from seller_orders s where s.id::text = e.source_id))
        or (e.source_type = 'withdrawal' and not exists (select 1 from withdrawal_requests w where w.id::text = e.source_id))
        or (e.source_type = 'refund' and not exists (select 1 from refunds r where r.id::text = e.source_id))
        or (e.source_type = 'external_deal' and not exists (select 1 from external_deals d where d.id::text = e.source_id))
        or (e.source_type = 'ledger_adjustment' and not exists (select 1 from ledger_adjustments a where a.id::text = e.source_id))`,
    ),
  );
  add(
    'MISSING_PAYMENT_JOURNAL',
    'دفعة مؤكدة بدون قيد دفع',
    await rows(
      conn,
      sql`select p.id payment_id, so.id seller_order_id from payments p join seller_orders so on so.order_id = p.order_id
        where p.status = 'CONFIRMED' and so.paid_at is not null
          and not exists (select 1 from journal_entries e where e.entry_type = 'ORDER_PAYMENT' and e.source_id = so.id::text)`,
    ),
  );
  add(
    'MISSING_WITHDRAWAL_JOURNAL',
    'سحب محجوز/مصروف بدون قيده',
    await rows(
      conn,
      sql`select w.id, w.status from withdrawal_requests w where
        (w.reserved_at is not null and not exists (select 1 from journal_entries e where e.entry_type = 'WITHDRAWAL_RESERVE' and e.source_id = w.id::text))
        or (w.status = 'PAID' and not exists (select 1 from journal_entries e where e.entry_type = 'WITHDRAWAL_PAID' and e.source_id = w.id::text))`,
    ),
  );
  add(
    'MISSING_REFUND_JOURNAL',
    'استرداد معتمد/مصروف بدون قيده',
    await rows(
      conn,
      sql`select r.id, r.status from refunds r where
        (r.approval_id is not null and r.deal_id is null and not exists (select 1 from journal_entries e where e.idempotency_key = 'refund:' || r.id))
        or (r.approval_id is not null and r.deal_id is not null and not exists (select 1 from journal_entries e where e.source_id = r.deal_id::text and e.entry_type in ('DEAL_REFUND','DEAL_SETTLEMENT')))
        or (r.status in ('COMPLETED','PAID') and not exists (select 1 from journal_entries e where e.entry_type = 'REFUND_PAID' and e.source_id = r.id::text))`,
    ),
  );
  add(
    'UNAPPROVED_JOURNAL',
    'قيد بعد التحصين بدون موافقة إدارة',
    await rows(
      conn,
      sql`select e.id, e.entry_type from journal_entries e where e.approval_id is null
        and e.created_at > coalesce((select min(created_at) from financial_approvals), 'infinity'::timestamptz)`,
    ),
  );
  add(
    'NEGATIVE_INVENTORY',
    'مخزون سالب أو محجوز أكبر من المتاح',
    await rows(conn, sql`select id, stock_on_hand, reserved from product_variants where stock_on_hand < 0 or reserved < 0 or reserved > stock_on_hand`),
  );
  add(
    'RESERVATION_DRIFT',
    'الكمية المحجوزة لا تطابق الحجوزات النشطة',
    await rows(
      conn,
      sql`select v.id, v.reserved, coalesce(r.q, 0) active from product_variants v
        left join (select variant_id, sum(quantity) q from inventory_reservations where status = 'ACTIVE' group by variant_id) r on r.variant_id = v.id
        where v.reserved <> coalesce(r.q, 0)`,
    ),
  );
  add(
    'INVALID_RESERVATION',
    'حجز نشط لطلب ملغي أو مدفوع',
    await rows(
      conn,
      sql`select r.id, so.status from inventory_reservations r join order_items oi on oi.id = r.order_item_id join seller_orders so on so.id = oi.seller_order_id
        where r.status = 'ACTIVE' and so.status not in ('PENDING_PAYMENT','PAYMENT_UNDER_REVIEW')`,
    ),
  );
  add(
    'REFUND_OVERAGE',
    'استرداد أكبر من القابل للاسترداد',
    await rows(
      conn,
      sql`select so.id, so.gross_total, coalesce(sum(r.amount), 0) refunded from seller_orders so
        left join refunds r on r.seller_order_id = so.id and r.status not in ('REJECTED','CANCELLED')
        group by so.id having coalesce(sum(r.amount), 0) > so.gross_total or so.refunded_total > so.gross_total`,
    ),
  );
  add(
    'REFUND_QTY_OVERAGE',
    'كمية مستردة أكبر من المشتراة',
    await rows(
      conn,
      sql`select oi.id, oi.quantity, coalesce(sum(ri.quantity), 0) q from order_items oi
        left join refund_items ri on ri.order_item_id = oi.id
        left join refunds r on r.id = ri.refund_id and r.status not in ('REJECTED','CANCELLED')
        group by oi.id having coalesce(sum(case when r.id is not null then ri.quantity else 0 end), 0) > oi.quantity`,
    ),
  );
  add(
    'WITHDRAWAL_OVERAGE',
    'الرصيد المحجوز للسحب لا يطابق طلبات السحب المحجوزة',
    await rows(
      conn,
      sql`select a.seller_id, a.balance, coalesce(w.q, 0) open_reserved from ledger_accounts a
        left join (select seller_id, sum(amount) q from withdrawal_requests where reserved_at is not null and status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING') group by seller_id) w on w.seller_id = a.seller_id
        where a.code = 'SELLER_WITHDRAWAL_RESERVED' and (a.balance < 0 or a.balance <> coalesce(w.q, 0))`,
    ),
  );
  add(
    'COMPLETION_WITHOUT_RELEASE',
    'طلب مكتمل بدون إتاحة أرباح أو أساس استلام',
    await rows(conn, sql`select id from seller_orders where status = 'COMPLETED' and (receipt_basis is null or funds_released_at is null)`),
  );
  const ok = checks.every((c) => c.count === 0);
  return { ok, totals: { debits: rec.totalDebits, credits: rec.totalCredits, difference: rec.totalDebits - rec.totalCredits }, checks };
}

/* ═══════════════ Control center ═══════════════ */

export async function controlBalances(conn: DbOrTx = db) {
  const r = await rows<{ code: string; total: string }>(conn, sql`select code, sum(balance)::text total from ledger_accounts group by code`);
  const by = Object.fromEntries(r.map((x) => [x.code, Number(x.total)]));
  const unreconciledPayments = await rows<{ n: string; total: string }>(
    conn,
    sql`select count(*)::text n, coalesce(sum(p.confirmed_amount), 0)::text total from payments p
      where p.status = 'CONFIRMED' and not exists (select 1 from external_transactions x where x.state = 'MATCHED' and x.matched_type = 'payment' and x.matched_id = p.id)`,
  );
  const unreconciledPayouts = await rows<{ n: string; total: string }>(
    conn,
    sql`select count(*)::text n, coalesce(sum(amount), 0)::text total from (
      select w.id, w.amount from withdrawal_requests w where w.status = 'PAID'
        and not exists (select 1 from external_transactions x where x.state = 'MATCHED' and x.matched_type = 'withdrawal' and x.matched_id = w.id)
      union all select r.id, r.amount from refunds r where r.status in ('PAID','COMPLETED')
        and not exists (select 1 from external_transactions x where x.state = 'MATCHED' and x.matched_type = 'refund' and x.matched_id = r.id)
      union all select d.id, d.amount from deal_payouts d where d.status = 'PAID'
        and not exists (select 1 from external_transactions x where x.state = 'MATCHED' and x.matched_type = 'deal_payout' and x.matched_id = d.id)) t`,
  );
  return {
    platformCash: by.PLATFORM_CASH ?? 0,
    sellerPending: by.SELLER_PENDING ?? 0,
    sellerAvailable: by.SELLER_AVAILABLE ?? 0,
    withdrawalReserved: by.SELLER_WITHDRAWAL_RESERVED ?? 0,
    refundLiability: by.CUSTOMER_REFUNDS_PAYABLE ?? 0,
    commissionDeferred: by.COMMISSION_DEFERRED ?? 0,
    commissionRevenue: by.COMMISSION_REVENUE ?? 0,
    dealFundsHeld: by.DEAL_FUNDS_HELD ?? 0,
    dealPayoutsPayable: by.DEAL_PAYOUTS_PAYABLE ?? 0,
    dealFeeRevenue: by.DEAL_FEE_REVENUE ?? 0,
    adjustmentsExpense: by.ADJUSTMENTS_EXPENSE ?? 0,
    unreconciledPayments: { count: Number(unreconciledPayments[0].n), total: Number(unreconciledPayments[0].total) },
    unreconciledPayouts: { count: Number(unreconciledPayouts[0].n), total: Number(unreconciledPayouts[0].total) },
  };
}

/** Cairo business-day boundaries in UTC. */
export function cairoDayBounds(isoDate: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw validation('تاريخ غير صالح');
  // Offset of Africa/Cairo at noon of that day (handles DST without a tz library).
  const noon = new Date(`${isoDate}T12:00:00Z`);
  const local = new Date(noon.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const offsetMs = local.getTime() - new Date(noon.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const start = new Date(new Date(`${isoDate}T00:00:00Z`).getTime() - offsetMs);
  return { start, end: new Date(start.getTime() + 86400_000) };
}

/** Daily control report: opening/closing control balances and the day's movements by event type. */
export async function dailyControlReport(isoDate: string, conn: DbOrTx = db) {
  const { start, end } = cairoDayBounds(isoDate);
  const balanceAt = async (at: Date) =>
    Object.fromEntries(
      (
        await rows<{ code: string; total: string }>(
          conn,
          sql`select a.code, coalesce(sum(case when a.type in ('ASSET','EXPENSE') then l.debit - l.credit else l.credit - l.debit end), 0)::text total
            from ledger_accounts a left join journal_lines l on l.account_id = a.id and l.created_at < ${at.toISOString()}::timestamptz group by a.code`,
        )
      ).map((x) => [x.code, Number(x.total)]),
    );
  const movements = await rows<{ entry_type: string; entries: string; debits: string }>(
    conn,
    sql`select e.entry_type, count(distinct e.id)::text entries, coalesce(sum(l.debit), 0)::text debits
      from journal_entries e join journal_lines l on l.entry_id = e.id
      where e.created_at >= ${start.toISOString()}::timestamptz and e.created_at < ${end.toISOString()}::timestamptz group by e.entry_type order by e.entry_type`,
  );
  const unreconciledExternal = await rows<{ state: string; n: string }>(
    conn,
    sql`select state, count(*)::text n from external_transactions where occurred_at >= ${start.toISOString()}::timestamptz and occurred_at < ${end.toISOString()}::timestamptz and state <> 'MATCHED' group by state`,
  );
  const inv = await financialInvariants(conn);
  return {
    date: isoDate,
    window: { start: start.toISOString(), end: end.toISOString(), timezone: 'Africa/Cairo' },
    opening: await balanceAt(start),
    closing: await balanceAt(end),
    movements: movements.map((m) => ({ type: m.entry_type, entries: Number(m.entries), amount: Number(m.debits) })),
    unreconciledExternal: unreconciledExternal.map((u) => ({ state: u.state, count: Number(u.n) })),
    invariants: { ok: inv.ok, totals: inv.totals, issues: inv.checks.filter((c) => c.count > 0).map((c) => ({ code: c.code, label: c.label, count: c.count, sample: c.sample })) },
  };
}

/** Record the day's control report (snapshot). Differences are reported, never repaired. Once per day. */
export async function closeFinancialDay(actor: Actor, isoDate: string) {
  requirePermission(actor, 'finance.controls');
  const report = await dailyControlReport(isoDate);
  return db.transaction(async (tx) => {
    const exists = await tx.execute(sql`select 1 from financial_closes where business_date = ${isoDate}`);
    if (exists.rows.length) throw conflict('تم إقفال هذا اليوم بالفعل');
    const [row] = await tx
      .insert(financialCloses)
      .values({ businessDate: isoDate, report, balanced: report.invariants.ok, issues: report.invariants.issues.reduce((a, i) => a + i.count, 0), closedBy: actor.userId })
      .returning();
    await audit(tx, actor, { action: 'finance.day_closed', entityType: 'financial_close', entityId: row.id, newValues: { date: isoDate, balanced: report.invariants.ok, issues: row.issues } });
    return row;
  });
}

/* ═══════════════ Real-money go-live gate (fail closed) ═══════════════ */

/**
 * Production blockers that cannot be cleared from inside the app: each needs evidence from outside
 * (infrastructure, legal counsel, the owner). They are removed only by a reviewed code change.
 */
export const KNOWN_PRODUCTION_BLOCKERS: { code: string; label: string }[] = [
  { code: 'RESTORE_DRILL', label: 'لم يتم تنفيذ تجربة استعادة نسخة احتياطية موثقة (قاعدة البيانات + الملفات الخاصة)' },
  { code: 'MALWARE_SCANNING', label: 'لا يوجد فحص فيروسات للملفات المرفوعة (البنية غير متاحة)' },
  { code: 'PAYMENT_PROVIDER', label: 'لا يوجد مزود دفع/صرف حقيقي مربوط ولا مطابقة كشوف آلية' },
  { code: 'SECRETS_ROTATION', label: 'تدوير أسرار الإنتاج لم يتم ولم يوثق' },
  { code: 'PRODUCTION_MESSAGING', label: 'مزودا البريد والرسائل للإنتاج غير مفعّلين' },
];

export async function goLiveGate(conn: DbOrTx = db) {
  const blockers: { code: string; label: string }[] = [...KNOWN_PRODUCTION_BLOCKERS];
  const env = process.env;
  if (env.EDMN_ENVIRONMENT !== 'production') blockers.push({ code: 'ENVIRONMENT', label: 'البيئة ليست إنتاج (EDMN_ENVIRONMENT=production)' });
  if (!env.DATA_ENCRYPTION_KEY || env.DATA_ENCRYPTION_KEY.length < 32) blockers.push({ code: 'ENCRYPTION_KEY', label: 'مفتاح التشفير غير مضبوط' });
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) blockers.push({ code: 'SESSION_SECRET', label: 'سر الجلسات غير مضبوط' });
  if (!env.PAYMENT_WEBHOOK_SECRET) blockers.push({ code: 'PROVIDER_SIGNING_SECRET', label: 'سر توقيع إشعارات مزود الدفع غير مضبوط' });
  if ((env.MAIL_DRIVER ?? 'log').startsWith('log') || (env.SMS_DRIVER ?? 'log').startsWith('log')) blockers.push({ code: 'MESSAGING_DRIVERS', label: 'مزودا البريد/الرسائل على وضع التسجيل (log)' });
  // Fee engine: both models need a published version in force (maker/checker approved).
  const { activeVersionId } = await import('@/server/modules/pricing/service');
  for (const m of ['MARKETPLACE', 'PROTECTED_DEAL'] as const) {
    if (!(await activeVersionId(conn, m))) blockers.push({ code: `PRICING_${m}`, label: `لا يوجد إصدار تسعير منشور وساري (${m === 'MARKETPLACE' ? 'السوق' : 'الضمانة'})` });
  }
  const taxUnresolved = await rows<{ n: string }>(conn, sql`select count(*)::text n from pricing_versions where status = 'PUBLISHED' and tax_treatment = 'UNRESOLVED'`);
  if (Number(taxUnresolved[0].n) > 0) blockers.push({ code: 'TAX_TREATMENT', label: 'المعالجة الضريبية للرسوم غير محسومة (محاسب/قانوني)' });
  const refundPolicy = await rows<{ n: string }>(conn, sql`select count(*)::text n from refund_fee_policy_versions where status = 'PUBLISHED'`);
  if (Number(refundPolicy[0].n) === 0) blockers.push({ code: 'REFUND_FEE_POLICY', label: 'مصفوفة استرداد الرسوم وتحميل التكاليف غير منشورة (مراجعة قانونية مطلوبة)' });
  const { unverifiedChannels } = await import('@/server/modules/pricing/payout-costs');
  const unverified = await unverifiedChannels(conn);
  if (unverified.length) blockers.push({ code: 'PAYOUT_COSTS_UNVERIFIED', label: `تكاليف/حدود قنوات التحويل غير موثقة: ${unverified.map((u) => u.channel).join(', ')}` });
  if (!(await getSetting('legal.policiesApproved', conn))) blockers.push({ code: 'LEGAL_APPROVAL', label: 'النصوص والسياسات القانونية لم تُعتمد قانونيًا' });
  if ((await getSetting('withdrawals.dualControlThreshold', conn)) !== 0) blockers.push({ code: 'MAKER_CHECKER', label: 'حد الرقابة المزدوجة على السحب ليس 0 ج.م' });
  const staffNo2fa = await rows<{ n: string }>(conn, sql`select count(*)::text n from users where is_staff and status = 'ACTIVE' and totp_enabled_at is null`);
  if (Number(staffNo2fa[0].n) > 0) blockers.push({ code: 'ADMIN_2FA', label: `${staffNo2fa[0].n} حساب إدارة بدون تحقق بخطوتين` });
  const realDest = await rows<{ n: string }>(conn, sql`select count(*)::text n from payment_destinations where is_enabled and not is_test`);
  if (Number(realDest[0].n) === 0) blockers.push({ code: 'REAL_DESTINATION', label: 'لا توجد وجهة دفع حقيقية مفعلة' });
  const inv = await financialInvariants(conn);
  if (!inv.ok) blockers.push({ code: 'INVARIANTS', label: `مخالفات مالية: ${inv.checks.filter((c) => c.count).map((c) => c.code).join(', ')}` });
  if (inv.totals.difference !== 0) blockers.push({ code: 'LEDGER_IMBALANCE', label: `فرق دفتر الأستاذ ${inv.totals.difference}` });
  // Owner approval is still required even when everything passes: a passing gate never enables real money.
  return { pass: blockers.length === 0, blockers, automaticSellerRelease: false as const };
}
