import { and, desc, eq, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { DomainError, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { payoutChannelConfigs, type PayoutChannel, type TransferCostPayer } from '@/server/db/schema';

export type ChannelConfig = typeof payoutChannelConfigs.$inferSelect;

/** Seller payout-method type → transfer channel (provider-agnostic). */
export const PAYOUT_TYPE_CHANNEL: Record<string, PayoutChannel> = { INSTAPAY: 'INSTAPAY', BANK_ACCOUNT: 'BANK_TRANSFER', MOBILE_WALLET: 'MOBILE_WALLET' };

/** The configuration version in force now for a channel (DB clock). */
export async function activeChannelConfig(conn: DbOrTx, channel: PayoutChannel): Promise<ChannelConfig | null> {
  const r = await conn.execute<{ id: string }>(sql`select id from payout_channel_configs
    where channel = ${channel} and is_active and effective_from <= now() and (effective_to is null or effective_to > now())
    order by effective_from desc, version desc limit 1`);
  if (!r.rows[0]) return null;
  const [c] = await conn.select().from(payoutChannelConfigs).where(eq(payoutChannelConfigs.id, r.rows[0].id));
  return c;
}

/** cost = clamp(round_half_up(amount × bps / 10000) + fixed, min, max). Integer piastres. */
export function transferCostFor(cfg: Pick<ChannelConfig, 'costBps' | 'costFixed' | 'costMin' | 'costMax'>, amount: number): number {
  let c = Math.floor((amount * cfg.costBps + 5000) / 10000) + cfg.costFixed;
  if (c < cfg.costMin) c = cfg.costMin;
  if (cfg.costMax !== null && c > cfg.costMax) c = cfg.costMax;
  return c;
}

export interface TransferQuote {
  channel: PayoutChannel;
  config: ChannelConfig;
  cost: number;
  payer: TransferCostPayer;
  /** What the seller is expected to receive. */
  net: number;
  /** Hard limit violations (block approval / payout). */
  violations: string[];
  /** Soft warnings (near a limit). */
  warnings: string[];
  snapshot: Record<string, unknown>;
}

const fmt = (m: number) => `${(m / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;

/**
 * Quote the transfer cost and check the channel's operational limits for one payout. Never splits a
 * payout and never switches provider. Totals count reserved/in-flight/paid withdrawals (Cairo day/month).
 */
export async function quoteTransfer(conn: DbOrTx, input: { payoutType: string; amount: number; sellerId: string; payoutMethodId: string | null; excludeWithdrawalId?: string }): Promise<TransferQuote> {
  const channel = PAYOUT_TYPE_CHANNEL[input.payoutType];
  if (!channel) throw validation('وسيلة سحب غير مدعومة');
  const cfg = await activeChannelConfig(conn, channel);
  if (!cfg) throw new DomainError('INVALID_STATE', 'قناة التحويل دي غير مضبوطة حاليًا من الإدارة (التكلفة/الحدود). السحب متوقف عليها لحين ضبطها.');
  const cost = transferCostFor(cfg, input.amount);
  const payer = cfg.payerPolicy;
  const net = payer === 'SELLER_PAYS' ? input.amount - cost : input.amount;
  const violations: string[] = [];
  const warnings: string[] = [];
  if (payer === 'SELLER_PAYS' && net <= 0) violations.push('مبلغ السحب أقل من رسوم التحويل');
  const excl = input.excludeWithdrawalId ?? '00000000-0000-0000-0000-000000000000';
  const totals = (
    await conn.execute<{ d_total: string; m_total: string; rd_total: string; rm_total: string }>(sql`
      select
        coalesce(sum(amount) filter (where (coalesce(paid_at, approved_at) at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date), 0)::text d_total,
        coalesce(sum(amount) filter (where date_trunc('month', coalesce(paid_at, approved_at) at time zone 'Africa/Cairo') = date_trunc('month', now() at time zone 'Africa/Cairo')), 0)::text m_total,
        coalesce(sum(amount) filter (where payout_method_id = ${input.payoutMethodId} and (coalesce(paid_at, approved_at) at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date), 0)::text rd_total,
        coalesce(sum(amount) filter (where payout_method_id = ${input.payoutMethodId} and date_trunc('month', coalesce(paid_at, approved_at) at time zone 'Africa/Cairo') = date_trunc('month', now() at time zone 'Africa/Cairo')), 0)::text rm_total
      from withdrawal_requests
      where payout_channel = ${channel} and reserved_at is not null and status in ('APPROVED','PROCESSING','PAID') and id <> ${excl}`)
  ).rows[0];
  const check = (limit: number | null, used: number, label: string) => {
    if (limit === null) return;
    const after = used + input.amount;
    if (after > limit) violations.push(`${label}: الحد ${fmt(limit)}، المستخدم ${fmt(used)}، المطلوب ${fmt(input.amount)}`);
    else if (after * 10000 > limit * cfg.warningThresholdBps) warnings.push(`${label}: سيصل الاستخدام إلى ${fmt(after)} من ${fmt(limit)}`);
  };
  check(cfg.maxPerTransaction, 0, 'الحد الأقصى للعملية الواحدة');
  check(cfg.maxPerDay, Number(totals.d_total), 'الحد اليومي للقناة');
  check(cfg.maxPerMonth, Number(totals.m_total), 'الحد الشهري للقناة');
  if (input.payoutMethodId) {
    check(cfg.recipientMaxPerDay, Number(totals.rd_total), 'الحد اليومي للمستفيد');
    check(cfg.recipientMaxPerMonth, Number(totals.rm_total), 'الحد الشهري للمستفيد');
  }
  return {
    channel,
    config: cfg,
    cost,
    payer,
    net,
    violations,
    warnings,
    snapshot: {
      channel,
      configId: cfg.id,
      configVersion: cfg.version,
      name: cfg.name,
      costBps: cfg.costBps,
      costFixed: cfg.costFixed,
      costMin: cfg.costMin,
      costMax: cfg.costMax,
      payerPolicy: payer,
      taxTreatment: cfg.taxTreatment,
      amount: input.amount,
      cost,
      net,
      quotedAt: new Date().toISOString(),
    },
  };
}

/* ─────────────── Admin: versioned channel configuration ─────────────── */

export interface ChannelInput {
  channel: PayoutChannel;
  name: string;
  isActive: boolean;
  costBps: number;
  costFixed: number;
  costMin: number;
  costMax: number | null;
  payerPolicy: TransferCostPayer;
  maxPerTransaction: number | null;
  maxPerDay: number | null;
  maxPerMonth: number | null;
  recipientMaxPerDay: number | null;
  recipientMaxPerMonth: number | null;
  warningThresholdBps: number;
  effectiveFrom?: Date | null;
  notes?: string | null;
  sourceReference?: string | null;
}

/** A change is a NEW version; the previous one is closed at the new effective time. Audited (before/after). */
export async function saveChannelVersion(actor: Actor, input: ChannelInput, reason: string) {
  requirePermission(actor, 'payout_costs.manage');
  requireStepUp(actor);
  if (!reason || reason.trim().length < 3) throw validation('يجب ذكر السبب');
  for (const [k, v] of Object.entries({ costBps: input.costBps, costFixed: input.costFixed, costMin: input.costMin, warningThresholdBps: input.warningThresholdBps })) {
    if (!Number.isSafeInteger(v) || v < 0) throw validation(`قيمة غير صالحة: ${k}`);
  }
  if (input.costBps > 10000 || input.warningThresholdBps > 10000) throw validation('النسبة لا تتجاوز 100%');
  for (const v of [input.costMax, input.maxPerTransaction, input.maxPerDay, input.maxPerMonth, input.recipientMaxPerDay, input.recipientMaxPerMonth]) {
    if (v !== null && (!Number.isSafeInteger(v) || v <= 0)) throw validation('الحدود لازم تكون أرقام موجبة أو فارغة');
  }
  if (input.costMax !== null && input.costMax < input.costMin) throw validation('أقصى تكلفة أقل من أدنى تكلفة');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'payout-channel:' + input.channel}))`);
    const [{ now }] = (await tx.execute<{ now: Date }>(sql`select now() as now`)).rows;
    const eff = input.effectiveFrom && input.effectiveFrom.getTime() > new Date(now).getTime() ? input.effectiveFrom : new Date(now);
    const prev = await activeChannelConfig(tx, input.channel);
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select coalesce(max(version), 0) + 1 as n from payout_channel_configs where channel = ${input.channel}`)).rows;
    if (prev && !prev.effectiveTo) await tx.update(payoutChannelConfigs).set({ effectiveTo: eff }).where(eq(payoutChannelConfigs.id, prev.id));
    const [row] = await tx
      .insert(payoutChannelConfigs)
      .values({ ...input, effectiveFrom: eff, version: Number(n), createdBy: actor.userId, lastReviewedAt: new Date(now), lastReviewedBy: actor.userId })
      .returning();
    await audit(tx, actor, { action: 'payout_costs.version_saved', entityType: 'payout_channel_config', entityId: row.id, oldValues: prev ? { ...prev } as Record<string, unknown> : null, newValues: { ...row } as Record<string, unknown>, reason });
    return row;
  });
}

export async function markChannelReviewed(actor: Actor, id: string, note: string) {
  requirePermission(actor, 'payout_costs.manage');
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(payoutChannelConfigs).where(eq(payoutChannelConfigs.id, id)).for('update');
    if (!c) throw notFound('إعداد القناة');
    await tx.update(payoutChannelConfigs).set({ lastReviewedAt: new Date(), lastReviewedBy: actor.userId }).where(eq(payoutChannelConfigs.id, id));
    await audit(tx, actor, { action: 'payout_costs.reviewed', entityType: 'payout_channel_config', entityId: id, reason: note || 'مراجعة' });
  });
}

export async function channelConfigs() {
  return db.select().from(payoutChannelConfigs).orderBy(payoutChannelConfigs.channel, desc(payoutChannelConfigs.version));
}

/**
 * Initial channel data (configuration, editable from Admin — never calculation logic). Values must be
 * re-verified against the provider's current tariff before real money; until then they are UNVERIFIED.
 */
export async function seedPayoutChannels() {
  const [any] = await db.select({ id: payoutChannelConfigs.id }).from(payoutChannelConfigs).limit(1);
  if (any) return;
  const now = new Date();
  await db.insert(payoutChannelConfigs).values([
    {
      channel: 'INSTAPAY',
      name: 'InstaPay (تحويل يدوي)',
      version: 1,
      costBps: 10,
      costFixed: 0,
      costMin: 50,
      costMax: 2000,
      payerPolicy: 'SELLER_PAYS',
      maxPerTransaction: 7_000_000,
      maxPerDay: 12_000_000,
      maxPerMonth: 40_000_000,
      effectiveFrom: now,
      notes: 'UNVERIFIED initial values (0.1%, min 0.50, max 20.00 EGP; 70k/120k/400k). Re-verify the bank tariff and limits before real money.',
      sourceReference: 'Public InstaPay tariff/limits — to be confirmed by Finance',
    },
    {
      channel: 'MOBILE_WALLET',
      name: 'محفظة موبايل (تحويل يدوي)',
      version: 1,
      costBps: 0,
      costFixed: 0,
      costMin: 0,
      payerPolicy: 'SELLER_PAYS',
      effectiveFrom: now,
      notes: 'UNVERIFIED placeholder (no cost/limits configured). Finance must set the real wallet tariff and limits.',
    },
    {
      channel: 'BANK_TRANSFER',
      name: 'تحويل بنكي',
      version: 1,
      costBps: 0,
      costFixed: 0,
      costMin: 0,
      payerPolicy: 'SELLER_PAYS',
      effectiveFrom: now,
      notes: 'UNVERIFIED placeholder (no cost/limits configured). Finance must set the real bank tariff and limits.',
    },
  ]);
}

export async function unverifiedChannels(conn: DbOrTx = db) {
  return conn.select({ id: payoutChannelConfigs.id, channel: payoutChannelConfigs.channel }).from(payoutChannelConfigs)
    .where(and(eq(payoutChannelConfigs.isActive, true), sql`${payoutChannelConfigs.effectiveTo} is null`, sql`(${payoutChannelConfigs.notes} like 'UNVERIFIED%' or ${payoutChannelConfigs.lastReviewedAt} is null)`));
}
