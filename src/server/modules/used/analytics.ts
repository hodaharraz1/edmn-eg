import { sql } from 'drizzle-orm';
import { requirePermission, type Actor } from '@/server/core/actor';
import { db, type DbOrTx } from '@/server/db/client';
import { usedAnalyticsEvents, USED_ANALYTICS_EVENTS } from '@/server/db/schema';

type EventName = (typeof USED_ANALYTICS_EVENTS)[number];

/**
 * Whitelisted, coarse properties only. Anything else (names, phones, addresses, identifiers, exact amounts, payment
 * data, free text) is dropped before it is stored — analytics can never become a PII or financial-secret sink.
 */
const ALLOWED: Record<string, (v: unknown) => string | null> = {
  profile: (v) => (typeof v === 'string' && /^[a-z_]{2,40}$/.test(v) ? v : null),
  condition: (v) => (v === 'NEW' || v === 'USED' ? v : null),
  channel: (v) => (v === 'MARKETPLACE' || v === 'PROTECTED_DEAL' ? v : null),
  level: (v) => (v === 'PROTECTED' || v === 'VERIFIED' || v === 'INSPECTED' ? v : null),
  result: (v) => (v === 'PASS' || v === 'PASS_WITH_NOTES' || v === 'FAIL' ? v : null),
  reason: (v) => (typeof v === 'string' && /^[A-Z_]{2,40}$/.test(v) ? v : null),
  valueBucket: (v) => (typeof v === 'string' && /^[a-z0-9<>+_-]{1,12}$/.test(v) ? v : null),
};

export function sanitizeProps(props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    const f = ALLOWED[k];
    const clean = f ? f(v) : null;
    if (clean !== null) out[k] = clean;
  }
  return out;
}

/** Transaction value as a coarse bucket (piasters in, bucket out). */
export function valueBucket(piasters: number | null | undefined): string {
  const egp = (piasters ?? 0) / 100;
  if (egp < 1000) return 'lt1k';
  if (egp < 5000) return '1k-5k';
  if (egp < 20000) return '5k-20k';
  if (egp < 50000) return '20k-50k';
  return '50k+';
}

export async function track(tx: DbOrTx, name: EventName, subjectRef: string | null, props: Record<string, unknown> = {}) {
  await tx.insert(usedAnalyticsEvents).values({ name, subjectRef, props: sanitizeProps(props) });
}

/**
 * Admin dashboard figures. Event counts come from the privacy-safe event table; funnel, acceptance, disputes and
 * release time are derived from the existing deal records (no extra tracking inside financial flows).
 */
export async function usedAnalytics(actor: Actor) {
  requirePermission(actor, 'reports.view');
  const events = await db.execute<{ name: string; d30: string; total: string }>(sql`
    select name, count(*) filter (where created_at > now() - interval '30 days')::text d30, count(*)::text total
      from used_analytics_events group by name order by name`);
  const funnel = await db.execute<{ stage: string; n: string }>(sql`
    with d as (select * from external_deals where condition = 'USED')
    select 'created' stage, count(*)::text n from d
    union all select 'invited', count(*)::text from d where invited_at is not null
    union all select 'seller_joined', count(*)::text from d where seller_joined_at is not null
    union all select 'agreed', count(*)::text from d where agreed_at is not null
    union all select 'paid', count(*)::text from d where activated_at is not null
    union all select 'delivered', count(*)::text from d where handover_verified_at is not null or delivered_at is not null
    union all select 'buyer_accepted', count(*)::text from d where buyer_confirmed_at is not null
    union all select 'completed', count(*)::text from d where status = 'COMPLETED'`);
  const disputes = await db.execute<{ reason: string; n: string }>(sql`
    select d.reason_code reason, count(*)::text n from disputes d join external_deals x on x.id = d.deal_id
     where x.condition = 'USED' group by 1 order by 2 desc`);
  const release = await db.execute<{ median_hours: string | null; n: string }>(sql`
    select round(percentile_cont(0.5) within group (order by extract(epoch from (completed_at - entitled_at)) / 3600)::numeric, 1)::text median_hours, count(*)::text n
      from external_deals where condition = 'USED' and status = 'COMPLETED' and entitled_at is not null and completed_at is not null`);
  const levels = await db.execute<{ level: string; n: string }>(sql`select level, count(*)::text n from product_passports group by 1 order by 1`);
  const value = await db.execute<{ bucket: string; n: string }>(sql`
    select case when total_amount < 100000 then 'lt1k' when total_amount < 500000 then '1k-5k' when total_amount < 2000000 then '5k-20k'
                when total_amount < 5000000 then '20k-50k' else '50k+' end bucket, count(*)::text n
      from external_deals where condition = 'USED' and agreed_at is not null group by 1 order by 1`);
  const repeat = await db.execute<{ buyers: string; sellers: string }>(sql`
    select (select count(*) from (select buyer_id from external_deals where condition = 'USED' and agreed_at is not null group by 1 having count(*) > 1) b)::text buyers,
           (select count(*) from (select seller_user_id from external_deals where condition = 'USED' and agreed_at is not null and seller_user_id is not null group by 1 having count(*) > 1) s)::text sellers`);
  return {
    events: events.rows,
    funnel: funnel.rows,
    disputes: disputes.rows,
    release: release.rows[0] ?? { median_hours: null, n: '0' },
    levels: levels.rows,
    value: value.rows,
    repeat: repeat.rows[0] ?? { buyers: '0', sellers: '0' },
  };
}
