import { sql } from 'drizzle-orm';
import { db, type DbOrTx } from '@/server/db/client';
import { getSetting } from '@/server/modules/settings';
import { identityStatus } from '@/server/modules/identity/service';
import { safetyScore, type ProtectionLevel, type SafetyScore } from '@/domain/used';

/** Dispute reasons that mean «the item did not match what was declared». */
const MATCH_REASONS = ['NOT_AS_DESCRIBED', 'UNDISCLOSED_DEFECT', 'DIFFERENT_IDENTIFIER', 'MISSING_ACCESSORY', 'WORSE_CONDITION', 'FUNCTION_NOT_WORKING', 'WRONG_PRODUCT', 'SUSPECTED_COUNTERFEIT'];
/** Decisions in the buyer's favour. */
const LOST = ['FULL_REFUND', 'PARTIAL_REFUND', 'RETURN_REQUIRED', 'REPLACEMENT'];
/** Below this many observations a rate is shown as «لسه بيانات قليلة», never as a number. */
export const MIN_SAMPLE = 3;

export type Signal = { key: string; label: string; value: string; sample: number | null; good: boolean | null };
export type SellerSignals = {
  identityApproved: boolean;
  phoneVerified: boolean;
  accountAgeDays: number;
  completed: number;
  disputesLost: number;
  signals: Signal[];
};

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * Explainable seller reputation (the user behind a store or a protected deal). Every signal states its sample;
 * there is no aggregate «trusted seller» badge — only facts with clear criteria.
 */
export async function sellerSignals(userId: string, conn: DbOrTx = db): Promise<SellerSignals> {
  const ident = (await identityStatus(conn, userId)) === 'APPROVED';
  const r = await conn.execute<{
    age_days: string;
    phone: boolean;
    deals_done: string;
    orders_done: string;
    disputes: string;
    lost: string;
    mismatch: string;
    ship_n: string;
    ship_ok: string;
    resp_hours: string | null;
    resp_n: string;
  }>(sql`
    with u as (select id, created_at, phone_verified_at from users where id = ${userId}),
    stores as (select id from sellers where owner_user_id = ${userId}),
    so as (select * from seller_orders where seller_id in (select id from stores)),
    dsp as (select * from disputes where respondent_user_id = ${userId}),
    resp as (
      select extract(epoch from (min(v.created_at) - d.seller_joined_at)) / 3600 h
        from external_deals d join deal_terms_versions v on v.deal_id = d.id and v.proposed_by = 'SELLER'
       where d.seller_user_id = ${userId} and d.seller_joined_at is not null group by d.id, d.seller_joined_at)
    select greatest(0, floor(extract(epoch from (now() - (select created_at from u))) / 86400))::text age_days,
           (select phone_verified_at is not null from u) phone,
           (select count(*) from external_deals where seller_user_id = ${userId} and status = 'COMPLETED')::text deals_done,
           (select count(*) from so where status = 'COMPLETED')::text orders_done,
           (select count(*) from dsp)::text disputes,
           (select count(*) from dsp where decision in (${sql.join(LOST.map((x) => sql`${x}`), sql`, `)}))::text lost,
           (select count(*) from dsp where decision in (${sql.join(LOST.map((x) => sql`${x}`), sql`, `)}) and reason_code in (${sql.join(MATCH_REASONS.map((x) => sql`${x}`), sql`, `)}))::text mismatch,
           (select count(*) from so where shipped_at is not null and ship_by_due_at is not null)::text ship_n,
           (select count(*) from so where shipped_at is not null and ship_by_due_at is not null and shipped_at <= ship_by_due_at)::text ship_ok,
           (select round(percentile_cont(0.5) within group (order by h)::numeric, 1)::text from resp) resp_hours,
           (select count(*) from resp)::text resp_n`);
  const x = r.rows[0];
  const age = Number(x?.age_days ?? 0);
  const completed = Number(x?.deals_done ?? 0) + Number(x?.orders_done ?? 0);
  const disputes = Number(x?.disputes ?? 0);
  const lost = Number(x?.lost ?? 0);
  const mismatch = Number(x?.mismatch ?? 0);
  const shipN = Number(x?.ship_n ?? 0);
  const respN = Number(x?.resp_n ?? 0);
  const few = 'لسه بيانات قليلة';
  const base = completed + Math.max(0, disputes - lost);
  const signals: Signal[] = [
    { key: 'identity', label: 'التحقق من الهوية', value: ident ? 'هوية متحقق منها' : 'لسه ما اتحققش', sample: null, good: ident },
    { key: 'verification', label: 'مستوى التحقق', value: ident && x?.phone ? 'هوية + موبايل متأكد' : ident ? 'هوية' : x?.phone ? 'موبايل متأكد فقط' : 'لا يوجد', sample: null, good: ident && !!x?.phone },
    { key: 'age', label: 'عمر الحساب', value: age < 30 ? `${age} يوم` : age < 365 ? `${Math.floor(age / 30)} شهر` : `${Math.floor(age / 365)} سنة`, sample: null, good: age >= 90 },
    { key: 'completed', label: 'عمليات مكتملة', value: String(completed), sample: completed, good: completed >= MIN_SAMPLE },
    { key: 'successful', label: 'عمليات ناجحة بدون نزاع ضده', value: String(Math.max(0, completed - lost)), sample: completed, good: completed >= MIN_SAMPLE && lost === 0 },
    { key: 'disputeRate', label: 'نسبة النزاعات', value: base >= MIN_SAMPLE ? pct(disputes / Math.max(1, base)) : few, sample: base, good: base >= MIN_SAMPLE ? disputes / Math.max(1, base) <= 0.05 : null },
    { key: 'matchRate', label: 'مطابقة المنتج للوصف', value: completed >= MIN_SAMPLE ? pct(1 - mismatch / completed) : few, sample: completed, good: completed >= MIN_SAMPLE ? mismatch / completed <= 0.05 : null },
    { key: 'shipping', label: 'الشحن في الميعاد', value: shipN >= MIN_SAMPLE ? pct(Number(x?.ship_ok ?? 0) / shipN) : few, sample: shipN, good: shipN >= MIN_SAMPLE ? Number(x?.ship_ok ?? 0) / shipN >= 0.9 : null },
    { key: 'response', label: 'سرعة الرد على الصفقات', value: respN >= MIN_SAMPLE && x?.resp_hours != null ? `حوالي ${x.resp_hours} ساعة` : few, sample: respN, good: respN >= MIN_SAMPLE && x?.resp_hours != null ? Number(x.resp_hours) <= 24 : null },
  ];
  return { identityApproved: ident, phoneVerified: !!x?.phone, accountAgeDays: age, completed, disputesLost: lost, signals };
}

/** The explainable score for one used item in one context (listing or deal). Information only. */
export async function safetyFor(
  input: {
    sellerUserId: string | null;
    conditionCompleteness: number;
    evidenceCompleteness: number;
    level: ProtectionLevel;
    inspected: boolean;
    shippingEvidence: boolean | null;
    returnPolicy: 'VOLUNTARY' | 'NONE' | null;
  },
  conn: DbOrTx = db,
): Promise<{ score: SafetyScore; seller: SellerSignals | null }> {
  const rules = await getSetting('used.safetyScore', conn);
  const seller = input.sellerUserId ? await sellerSignals(input.sellerUserId, conn) : null;
  const score = safetyScore(rules, {
    identityApproved: seller?.identityApproved ?? false,
    phoneVerified: seller?.phoneVerified ?? false,
    accountAgeDays: seller?.accountAgeDays ?? 0,
    completedDeals: seller?.completed ?? 0,
    disputesLost: seller?.disputesLost ?? 0,
    conditionCompleteness: input.conditionCompleteness,
    evidenceCompleteness: input.evidenceCompleteness,
    inspected: input.inspected,
    shippingEvidence: input.shippingEvidence,
    returnPolicy: input.returnPolicy,
    level: input.level,
  });
  return { score, seller };
}
