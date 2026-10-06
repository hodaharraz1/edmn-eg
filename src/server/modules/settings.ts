import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { requirePermission, type Actor, requireStepUp } from '@/server/core/actor';
import { validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { paymentDestinations, systemSettings } from '@/server/db/schema';

/**
 * Typed business configuration. Defaults below are DEVELOPMENT/BENCHMARK values and are editable
 * by authorized admins at runtime (audited). Nothing here is a final business or legal decision.
 */
export const SETTINGS_SCHEMA = {
  'marketplace.name': z.string().min(1).default('اضمن | EDMN'),
  'marketplace.supportEmail': z.string().default(''),
  'marketplace.supportPhone': z.string().default(''),
  'marketplace.maintenanceMode': z.boolean().default(false),
  /** Hours a customer has to pay (or submit proof) before an unpaid order expires and stock is released. */
  /**
   * REAL MONEY switch. Off by default: payment destinations and seller withdrawals are TEST only and
   * clearly labelled as such. Can never be enabled on a staging deployment (EDMN_ENVIRONMENT=staging).
   */
  'payments.realMoneyEnabled': z.boolean().default(false),
  'payments.paymentWindowHours': z.number().int().min(1).max(168).default(48),
  'withdrawals.minimumAmount': z.number().int().min(0).default(10000), // 100 EGP in piasters
  'withdrawals.slaBusinessHours': z.number().int().min(1).max(240).default(48),
  /** Withdrawals at/above this amount require approver ≠ payer (maker/checker). */
  'withdrawals.dualControlThreshold': z.number().int().min(0).default(5_000_000), // 50,000 EGP
  /** Ledger adjustments at/above this absolute amount require a second approver (all adjustments do by default). */
  'ledger.adjustmentDualControlThreshold': z.number().int().min(0).default(0),
  'settlement.mode': z.enum(['ON_REQUEST', 'SCHEDULED', 'HYBRID']).default('HYBRID'),
  'settlement.daysOfMonth': z.array(z.number().int().min(1).max(28)).default([1, 15]),
  'settlement.minimumAmount': z.number().int().min(0).default(10000),
  'payout.changeRequiresReview': z.boolean().default(true),
  'payout.changeHoldHours': z.number().int().min(0).max(720).default(24),
  'sellers.requireEmailVerification': z.boolean().default(false),
  'sellers.businessRequiredDocuments': z
    .array(z.enum(['COMMERCIAL_REGISTRATION', 'TAX_CARD', 'AUTHORIZATION_LETTER']))
    .default(['COMMERCIAL_REGISTRATION', 'TAX_CARD']),
  'products.requireModeration': z.boolean().default(true),
  'products.minImages': z.number().int().min(1).max(10).default(1),
  'products.minActualImagesForUsed': z.number().int().min(1).max(10).default(2),
  /** Statutory return window shown to customers — SUBJECT TO LEGAL REVIEW, do not treat as legal advice. */
  /** Neutral notice shown with every return policy (legal-counsel controlled wording). */
  'returns.mandatoryRightsNotice': z.string().min(5).max(500).default('مع عدم الإخلال بأي حقوق إلزامية للمستهلك تنطبق وفق القانون.'),
  'returns.statutoryWindowDays': z.number().int().min(0).max(90).default(14),
  /** Days after shipment without buyer confirmation before the order is flagged for operations follow-up. */
  'orders.deliveryFollowUpDays': z.number().int().min(1).max(60).default(10),
  /** Days after delivery confirmation before a seller order is marked COMPLETED. */
  /** Days after delivery during which the buyer can still open a dispute on a marketplace order. */
  'disputes.windowDays': z.number().int().min(1).max(180).default(30),
  'orders.completionDays': z.number().int().min(0).max(60).default(14),
  'deals.feeBps': z.number().int().min(0).max(5000).default(0),
  'deals.feePayer': z.enum(['SELLER', 'BUYER']).default('SELLER'),
  'deals.invitationTtlHours': z.number().int().min(1).max(720).default(168),
  /** Delivery handover OTP lifetime and wrong-code limit (a new code can be requested afterwards). */
  'deals.deliveryOtpTtlHours': z.number().int().min(1).max(336).default(72),
  'deals.deliveryOtpMaxAttempts': z.number().int().min(3).max(10).default(5),
  /**
   * Buyer ↔ seller messaging stays writable this many days after the order/deal reaches a final state
   * (completed / cancelled / refunded), then becomes read-only. A product default, NOT a legal retention
   * period: conversations themselves are never deleted (evidence), whatever this value is.
   */
  'messaging.postCloseWriteDays': z.number().int().min(0).max(365).default(30),
  'uploads.maxImageMb': z.number().min(1).max(25).default(8),
  'uploads.maxDocumentMb': z.number().min(1).max(25).default(10),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_SCHEMA)[K]>;

export const SENSITIVE_SETTINGS: readonly SettingKey[] = [
  'payments.realMoneyEnabled',
  'withdrawals.dualControlThreshold',
  'ledger.adjustmentDualControlThreshold',
  'withdrawals.minimumAmount',
  'payout.changeRequiresReview',
  'payout.changeHoldHours',
  'deals.feeBps',
  'deals.feePayer',
  'settlement.mode',
  'settlement.daysOfMonth',
  'settlement.minimumAmount',
  'withdrawals.slaBusinessHours',
];

export function settingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS_SCHEMA[key].parse(undefined) as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(key: K, conn: DbOrTx = db): Promise<SettingValue<K>> {
  const [row] = await conn.select().from(systemSettings).where(eq(systemSettings.key, key));
  if (!row) return settingDefault(key);
  const parsed = SETTINGS_SCHEMA[key].safeParse(row.value);
  return (parsed.success ? parsed.data : settingDefault(key)) as SettingValue<K>;
}

export async function getAllSettings(conn: DbOrTx = db): Promise<{ [K in SettingKey]: SettingValue<K> }> {
  const rows = await conn.select().from(systemSettings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS_SCHEMA) as SettingKey[]) {
    const parsed = SETTINGS_SCHEMA[key].safeParse(map.get(key));
    out[key] = parsed.success ? parsed.data : settingDefault(key);
  }
  return out as { [K in SettingKey]: SettingValue<K> };
}

export async function updateSetting(actor: Actor, key: SettingKey, value: unknown, reason: string): Promise<void> {
  requirePermission(actor, 'settings.manage');
  if (SENSITIVE_SETTINGS.includes(key)) requireStepUp(actor);
  const schema = SETTINGS_SCHEMA[key];
  if (!schema) throw validation('إعداد غير معروف');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validation('قيمة غير صالحة لهذا الإعداد');
  if (!reason || reason.trim().length < 3) throw validation('يجب ذكر سبب التعديل');
  if (key === 'payments.realMoneyEnabled' && parsed.data === true) {
    if (process.env.EDMN_ENVIRONMENT === 'staging') throw validation('لا يمكن تفعيل الأموال الحقيقية على بيئة تجريبية (Staging).');
    const [real] = await db.select({ id: paymentDestinations.id }).from(paymentDestinations).where(and(eq(paymentDestinations.isEnabled, true), eq(paymentDestinations.isTest, false))).limit(1);
    if (!real) throw validation('أضف أولاً وجهة دفع حقيقية مفعّلة (غير تجريبية) من «طرق وحسابات الدفع».');
    // Test money must never become real: go-live requires a clean financial state (no test payment,
    // withdrawal, refund or deal still open, and no balance left in any seller or deal account).
    const r = await db.execute<{ open_payments: string; open_withdrawals: string; open_refunds: string; open_deal_payouts: string; balances: string }>(sql`select
      (select count(*) from payments where is_test and status in ('AWAITING_PAYMENT','PAYMENT_SUBMITTED','UNDER_REVIEW'))::text open_payments,
      (select count(*) from withdrawal_requests where status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING'))::text open_withdrawals,
      (select count(*) from refunds where status = 'PENDING')::text open_refunds,
      (select count(*) from deal_payouts where status = 'PENDING')::text open_deal_payouts,
      (select count(*) from ledger_accounts where balance <> 0 and (seller_id is not null or code = 'DEAL_FUNDS_HELD'))::text balances`);
    const c = r.rows[0];
    const blockers = Object.entries(c).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}=${v}`);
    if (blockers.length) throw validation(`لا يمكن التفعيل وما زالت توجد أموال/عمليات تجريبية مفتوحة (${blockers.join('، ')}). يجب إقفالها أولاً أو البدء بقاعدة بيانات إنتاج جديدة.`);
  }
  await db.transaction(async (tx) => {
    const old = await getSetting(key, tx);
    await tx
      .insert(systemSettings)
      .values({ key, value: parsed.data as object, updatedBy: actor.userId })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: parsed.data as object, updatedBy: actor.userId, updatedAt: new Date() } });
    await audit(tx, actor, {
      action: 'settings.update',
      entityType: 'system_setting',
      entityId: key,
      oldValues: { value: old },
      newValues: { value: parsed.data },
      reason,
    });
  });
}

/** True only when an authorized admin has explicitly enabled real money on a non-staging deployment. */
export async function realMoneyEnabled(conn: DbOrTx = db): Promise<boolean> {
  if (process.env.EDMN_ENVIRONMENT === 'staging') return false;
  return getSetting('payments.realMoneyEnabled', conn);
}
