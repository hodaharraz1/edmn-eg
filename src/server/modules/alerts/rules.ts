import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';

/**
 * PROACTIVE ALERT RULES (Batch 1.5). One rule = one meaningful deadline / SLA / aging / threshold. Each rule
 * reads AUTHORITATIVE database state (server time) and returns the entities currently needing attention; the
 * engine (engine.ts) turns them into PRE_DEADLINE → DUE → OVERDUE notifications with dedupe and cooldown, and
 * marks them RESOLVED as soon as the condition disappears. Rules NEVER act: they only inform people.
 *
 * Timing defaults are OPERATIONAL DEFAULTS (not business policy) and every rule is overridable per code in
 * the `alerts.rules` setting. Bodies carry safe references only — never identity numbers, documents, bank /
 * wallet details, OTPs or message text.
 */

export interface AlertCandidate {
  entityType: string;
  entityId: string;
  /** Authoritative deadline (DB time). For aging rules: start + agingHours. */
  deadlineAt: Date | null;
  /** Direct recipients (parties). Staff recipients come from the rule's `staffPermission`. */
  userIds?: string[];
  ref: string;
  link: string;
}

export interface AlertRule {
  code: string;
  category: 'MARKETPLACE' | 'PROTECTED_DEAL' | 'INVENTORY' | 'IDENTITY' | 'REFUND' | 'SELLER_FINANCE' | 'DISPUTE' | 'SUPPORT' | 'PAYMENT_REVIEW';
  title: string;
  /** Body template: {{ref}} only. */
  body: string;
  /** Staff queue recipients: active staff holding this permission (in addition to `userIds`). */
  staffPermission?: string;
  severity: 'NORMAL' | 'HIGH';
  defaults: { preHours: number; cooldownHours: number; agingHours?: number };
  candidates(conn: DbOrTx, cfg: { agingHours: number }): Promise<AlertCandidate[]>;
}

const q = async <T>(conn: DbOrTx, query: ReturnType<typeof sql>) => (await conn.execute(query)).rows as T[];
const at = (v: string | null) => (v ? new Date(v) : null);
const hours = (h: number) => sql.raw(`interval '${Math.max(0, Number(h) || 0)} hours'`);

type Row = { id: string; due: string | null; ref: string; uid?: string | null };
const toCandidates = (rows: Row[], entityType: string, link: (r: Row) => string, withUser = true): AlertCandidate[] =>
  rows.map((r) => ({ entityType, entityId: r.id, deadlineAt: at(r.due), userIds: withUser && r.uid ? [r.uid] : [], ref: r.ref, link: link(r) }));

export const ALERT_RULES: AlertRule[] = [
  /* ───── Marketplace ───── */
  {
    code: 'MKT_PAYMENT_DUE',
    category: 'MARKETPLACE',
    title: 'موعد دفع طلبك يقترب',
    body: 'ادفع وارفع إثبات الدفع للطلب {{ref}} قبل انتهاء المهلة.',
    severity: 'NORMAL',
    defaults: { preHours: 12, cooldownHours: 24 },
    candidates: async (c) =>
      toCandidates(await q<Row>(c, sql`select o.id, o.payment_due_at::text due, '#' || o.number ref, o.customer_id uid from orders o where o.status = 'PENDING_PAYMENT' and o.number <> 100016`), 'order', (r) => `/account/orders/${r.id}`),
  },
  {
    code: 'PAY_REVIEW_AGING',
    category: 'PAYMENT_REVIEW',
    title: 'إثبات دفع بانتظار المراجعة',
    body: 'إثبات الدفع {{ref}} ينتظر المراجعة.',
    staffPermission: 'payments.verify',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 6, agingHours: 4 },
    candidates: async (c, cfg) =>
      toCandidates(
        await q<Row>(c, sql`select p.id, (max(s.created_at) + ${hours(cfg.agingHours)})::text due, coalesce('#' || o.number, 'صفقة') ref from payments p join payment_submissions s on s.payment_id = p.id and s.status = 'SUBMITTED' left join orders o on o.id = p.order_id where p.status in ('PAYMENT_SUBMITTED','UNDER_REVIEW') group by p.id, o.number`),
        'payment',
        () => '/admin/payments',
        false,
      ),
  },
  {
    code: 'MKT_SELLER_CONFIRM_DUE',
    category: 'MARKETPLACE',
    title: 'طلب مدفوع بانتظار تأكيدك',
    body: 'أكّد الطلب {{ref}} وابدأ تجهيزه قبل الموعد.',
    severity: 'HIGH',
    defaults: { preHours: 6, cooldownHours: 12 },
    candidates: async (c) =>
      toCandidates(await q<Row>(c, sql`select so.id, so.seller_response_due_at::text due, '#' || o.number || '-' || so.suffix ref, s.owner_user_id uid from seller_orders so join orders o on o.id = so.order_id join sellers s on s.id = so.seller_id where so.status = 'PAID' and so.seller_response_due_at is not null and o.number <> 100016`), 'seller_order', (r) => `/seller/orders/${r.id}`),
  },
  {
    code: 'MKT_SHIP_DUE',
    category: 'MARKETPLACE',
    title: 'موعد شحن طلب يقترب',
    body: 'اشحن الطلب {{ref}} قبل موعد الشحن.',
    severity: 'HIGH',
    defaults: { preHours: 12, cooldownHours: 12 },
    candidates: async (c) =>
      toCandidates(await q<Row>(c, sql`select so.id, so.ship_by_due_at::text due, '#' || o.number || '-' || so.suffix ref, s.owner_user_id uid from seller_orders so join orders o on o.id = so.order_id join sellers s on s.id = so.seller_id where so.status in ('SELLER_CONFIRMED','PROCESSING','READY_TO_SHIP') and so.ship_by_due_at is not null and o.number <> 100016`), 'seller_order', (r) => `/seller/orders/${r.id}`),
  },
  {
    code: 'MKT_DELIVERY_EVIDENCE_DUE',
    category: 'MARKETPLACE',
    title: 'مطلوب دليل التسليم',
    body: 'ارفع دليل تسليم الطلب {{ref}} قبل انتهاء المهلة.',
    severity: 'HIGH',
    defaults: { preHours: 6, cooldownHours: 12 },
    candidates: async (c) =>
      toCandidates(await q<Row>(c, sql`select so.id, so.delivery_report_due_at::text due, '#' || o.number || '-' || so.suffix ref, s.owner_user_id uid from seller_orders so join orders o on o.id = so.order_id join sellers s on s.id = so.seller_id where so.status = 'SHIPPED' and so.delivery_report_due_at is not null and so.seller_delivery_confirmed_at is null`), 'seller_order', (r) => `/seller/orders/${r.id}`),
  },
  {
    code: 'MKT_DELIVERY_OVERDUE',
    category: 'MARKETPLACE',
    title: 'طلب مشحون بدون حدث تسليم',
    body: 'الطلب {{ref}} متأخر عن التسليم المتوقع ولا يوجد حدث تسليم موثق.',
    staffPermission: 'delivery.verify',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 120 },
    candidates: async (c, cfg) =>
      toCandidates(await q<Row>(c, sql`select so.id, (so.shipped_at + ${hours(cfg.agingHours)})::text due, '#' || o.number || '-' || so.suffix ref from seller_orders so join orders o on o.id = so.order_id where so.status = 'SHIPPED' and so.delivery_event_at is null and so.shipped_at is not null`), 'seller_order', () => `/admin/orders`, false),
  },
  {
    code: 'MKT_BUYER_RESPONSE_DUE',
    category: 'MARKETPLACE',
    title: 'أكّد استلام طلبك أو بلّغ عن مشكلة',
    body: 'مهلة الرد على الطلب {{ref}} قربت تخلص. أكّد الاستلام أو بلّغ عن مشكلة.',
    severity: 'NORMAL',
    defaults: { preHours: 6, cooldownHours: 24 },
    candidates: async (c) =>
      toCandidates(await q<Row>(c, sql`select so.id, so.buyer_response_due_at::text due, '#' || o.number || '-' || so.suffix ref, o.customer_id uid from seller_orders so join orders o on o.id = so.order_id where so.status = 'AWAITING_BUYER_RESPONSE' and so.buyer_response_due_at is not null`), 'seller_order', () => `/account/orders`),
  },
  {
    code: 'MKT_RETURN_ACTION',
    category: 'MARKETPLACE',
    title: 'طلب إرجاع ينتظر الرد',
    body: 'طلب الإرجاع {{ref}} ينتظر قرارك.',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 48 },
    candidates: async (c, cfg) =>
      toCandidates(await q<Row>(c, sql`select r.id, (r.created_at + ${hours(cfg.agingHours)})::text due, '#' || r.number ref, s.owner_user_id uid from returns r join sellers s on s.id = r.seller_id where r.status = 'REQUESTED'`), 'return', (r) => `/seller/returns/${r.id}`),
  },
  /* ───── Refunds ───── */
  {
    code: 'REFUND_REVIEW_PENDING',
    category: 'REFUND',
    title: 'استرداد بانتظار المراجعة',
    body: 'الاسترداد {{ref}} ينتظر طلب المنشئ واعتماد المراجع.',
    staffPermission: 'refunds.approve',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 24 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select r.id, (r.created_at + ${hours(cfg.agingHours)})::text due, '#' || r.number ref from refunds r where r.status in ('REQUESTED','UNDER_REVIEW')`), 'refund', () => '/admin/refunds', false),
  },
  {
    code: 'REFUND_EXECUTION_PENDING',
    category: 'REFUND',
    title: 'استرداد معتمد لم يُحوَّل بعد',
    body: 'الاسترداد {{ref}} معتمد وينتظر تنفيذ التحويل بواسطة شخص آخر.',
    staffPermission: 'refunds.pay',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 24 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select r.id, (r.approved_at + ${hours(cfg.agingHours)})::text due, '#' || r.number ref from refunds r where r.status in ('APPROVED','PROCESSING') and r.approved_at is not null`), 'refund', () => '/admin/refunds?tab=approved', false),
  },
  {
    code: 'REFUND_DESTINATION_REAPPROVAL',
    category: 'REFUND',
    title: 'وجهة استرداد بانتظار إعادة الاعتماد',
    body: 'تم تغيير وجهة الاسترداد {{ref}} بشكل استثنائي وتحتاج اعتماد شخص آخر قبل الصرف.',
    staffPermission: 'refunds.approve',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 0 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select r.id, r.destination_changed_at::text due, '#' || r.number ref from refunds r where r.destination_reapproval_required`), 'refund', () => '/admin/refunds?tab=approved', false),
  },
  {
    code: 'REFUND_FAILED',
    category: 'REFUND',
    title: 'فشل تحويل استرداد',
    body: 'تعذّر تحويل الاسترداد {{ref}} — المبلغ ما زال مستحقًا للعميل.',
    staffPermission: 'refunds.pay',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 0 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select r.id, r.updated_at::text due, '#' || r.number ref from refunds r where r.status = 'FAILED'`), 'refund', () => '/admin/refunds', false),
  },
  /* ───── Seller finance / Maker-Checker ───── */
  {
    code: 'FIN_RELEASE_PENDING',
    category: 'SELLER_FINANCE',
    title: 'أرباح مستحقة بانتظار الإتاحة',
    body: 'الطلب {{ref}} مستحق للبائع وينتظر طلب الإتاحة واعتمادها من شخصين.',
    staffPermission: 'finance.release',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 24 },
    candidates: async (c, cfg) =>
      toCandidates(await q<Row>(c, sql`select so.id, (so.entitled_at + ${hours(cfg.agingHours)})::text due, '#' || o.number || '-' || so.suffix ref from seller_orders so join orders o on o.id = so.order_id where so.status = 'DELIVERED' and so.receipt_basis is not null and so.funds_released_at is null and not so.financial_hold and so.entitled_at is not null`), 'seller_order', (r) => `/admin/releases/${r.id}`, false),
  },
  {
    code: 'FIN_CHECKER_REQUIRED',
    category: 'SELLER_FINANCE',
    title: 'حركة مالية بانتظار المعتمد (Checker)',
    body: 'طلب حركة مالية {{ref}} ينتظر اعتماد/تنفيذ شخص مختلف عن المنشئ.',
    staffPermission: 'finance.view',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 6, agingHours: 0 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select m.id, m.requested_at::text due, m.kind ref from financial_movement_requests m where m.status = 'PENDING'`), 'financial_movement_request', () => '/admin/approvals', false),
  },
  {
    code: 'FIN_WITHDRAWAL_REQUESTED',
    category: 'SELLER_FINANCE',
    title: 'طلب سحب ينتظر المراجعة',
    body: 'طلب السحب {{ref}} ينتظر المراجعة والاعتماد.',
    staffPermission: 'withdrawals.approve',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 24 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select w.id, (w.created_at + ${hours(cfg.agingHours)})::text due, '#' || w.number ref from withdrawal_requests w where w.status in ('REQUESTED','UNDER_REVIEW')`), 'withdrawal', (r) => `/admin/withdrawals/${r.id}`, false),
  },
  {
    code: 'FIN_PAYOUT_PENDING',
    category: 'SELLER_FINANCE',
    title: 'سحب معتمد بانتظار التنفيذ',
    body: 'السحب {{ref}} معتمد ومحجوز وينتظر التحويل بواسطة شخص آخر غير المعتمد.',
    staffPermission: 'withdrawals.pay',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 24 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select w.id, (coalesce(w.approved_at, w.created_at) + ${hours(cfg.agingHours)})::text due, '#' || w.number ref from withdrawal_requests w where w.status in ('APPROVED','PROCESSING')`), 'withdrawal', (r) => `/admin/withdrawals/${r.id}`, false),
  },
  {
    code: 'FIN_TRANSFER_UNCERTAIN',
    category: 'SELLER_FINANCE',
    title: 'نتيجة تحويل غير مؤكدة',
    body: 'نتيجة تحويل السحب {{ref}} غير مؤكدة والمبلغ محجوز — مطلوب إثبات النتيجة.',
    staffPermission: 'withdrawals.approve',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 6, agingHours: 0 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select w.id, w.transfer_uncertain_at::text due, '#' || w.number ref from withdrawal_requests w where w.status = 'TRANSFER_UNCERTAIN'`), 'withdrawal', (r) => `/admin/withdrawals/${r.id}`, false),
  },
  {
    code: 'SELLER_LIABILITY',
    category: 'SELLER_FINANCE',
    title: 'عليك مديونية',
    body: 'على متجرك {{ref}} مديونية بعد استرداد. السحب متوقف لحين التسوية.',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 72, agingHours: 0 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select a.seller_id id, a.updated_at::text due, coalesce(st.name, 'المتجر') ref, s.owner_user_id uid from ledger_accounts a join sellers s on s.id = a.seller_id left join stores st on st.seller_id = s.id where a.code = 'SELLER_AVAILABLE' and a.balance < 0`), 'seller', () => '/seller/balance'),
  },
  /* ───── Protected Deal ───── */
  {
    code: 'DEAL_OFFER_PENDING_BUYER',
    category: 'PROTECTED_DEAL',
    title: 'عرض البائع بانتظار ردك',
    body: 'البائع قدّم عرضه في الصفقة {{ref}}. راجعه ووافق أو اطلب تعديل.',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 24 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select d.id, (d.updated_at + ${hours(cfg.agingHours)})::text due, 'EDMN-' || lpad(d.number::text, 8, '0') ref, d.buyer_id uid from external_deals d where d.status = 'OFFER_PENDING_BUYER'`), 'external_deal', (r) => `/account/deals/${r.id}`),
  },
  {
    code: 'DEAL_PAYMENT_DUE',
    category: 'PROTECTED_DEAL',
    title: 'الصفقة بانتظار الدفع',
    body: 'اتفقت على شروط الصفقة {{ref}}. كمّل الدفع.',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 24 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select d.id, (coalesce(d.accepted_at, d.updated_at) + ${hours(cfg.agingHours)})::text due, 'EDMN-' || lpad(d.number::text, 8, '0') ref, d.buyer_id uid from external_deals d where d.status = 'PAYMENT_PENDING'`), 'external_deal', (r) => `/account/deals/${r.id}`),
  },
  {
    code: 'DEAL_DELIVERY_DUE_SELLER',
    category: 'PROTECTED_DEAL',
    title: 'موعد تسليم صفقة يقترب',
    body: 'سلّم الصفقة {{ref}} قبل الموعد المتفق عليه.',
    severity: 'HIGH',
    defaults: { preHours: 24, cooldownHours: 24 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select d.id, d.delivery_deadline::text due, 'EDMN-' || lpad(d.number::text, 8, '0') ref, d.seller_user_id uid from external_deals d where d.status = 'ACTIVE' and d.delivery_deadline is not null`), 'external_deal', (r) => `/account/deals/${r.id}`),
  },
  {
    code: 'DEAL_DELIVERY_OVERDUE_BUYER',
    category: 'PROTECTED_DEAL',
    title: 'الصفقة متأخرة عن موعد التسليم',
    body: 'الصفقة {{ref}} تجاوزت موعد التسليم. تقدر تتواصل مع البائع أو تبلّغ عن عدم الاستلام.',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 48 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select d.id, d.delivery_deadline::text due, 'EDMN-' || lpad(d.number::text, 8, '0') ref, d.buyer_id uid from external_deals d where d.status in ('ACTIVE','DELIVERED') and d.delivery_deadline is not null and d.delivery_deadline < now()`), 'external_deal', (r) => `/account/deals/${r.id}`),
  },
  {
    code: 'DEAL_INSPECTION_DUE',
    category: 'PROTECTED_DEAL',
    title: 'مهلة فحص المنتج قربت تخلص',
    body: 'أكّد مطابقة المنتج في الصفقة {{ref}} أو بلّغ عن مشكلة قبل انتهاء المهلة.',
    severity: 'HIGH',
    defaults: { preHours: 12, cooldownHours: 12 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select d.id, d.buyer_response_due_at::text due, 'EDMN-' || lpad(d.number::text, 8, '0') ref, d.buyer_id uid from external_deals d where d.status in ('DELIVERY_HANDOVER_VERIFIED','BUYER_CONFIRMATION_PENDING') and d.buyer_response_due_at is not null`), 'external_deal', (r) => `/account/deals/${r.id}`),
  },
  {
    code: 'DEAL_RELEASE_PENDING',
    category: 'PROTECTED_DEAL',
    title: 'صفقة مستحقة بانتظار التسوية',
    body: 'الصفقة {{ref}} مستحقة للبائع وتنتظر طلب التسوية واعتمادها من شخصين.',
    staffPermission: 'finance.release',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 24 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select d.id, (coalesce(d.entitled_at, d.updated_at) + ${hours(cfg.agingHours)})::text due, 'EDMN-' || lpad(d.number::text, 8, '0') ref from external_deals d where d.status in ('BUYER_CONFIRMED_RECEIPT','ENTITLED_AWAITING_RELEASE') and not d.financial_hold`), 'external_deal', (r) => `/admin/deals/${r.id}`, false),
  },
  {
    code: 'DEAL_PAYOUT_PENDING',
    category: 'PROTECTED_DEAL',
    title: 'مستحقاتك من صفقة محمية جاهزة للسحب',
    body: 'مستحقاتك من الصفقة {{ref}} متاحة. اطلب سحب على بيانات استلام أموال متحقق منها من «مستحقاتي من البيع».',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 72, agingHours: 24 },
    // Payable and not yet reserved by any withdrawal → the seller (payee) is told to request it.
    candidates: async (c, cfg) =>
      toCandidates(
        await q<Row>(c, sql`select p.id, (p.created_at + ${hours(cfg.agingHours)})::text due, 'EDMN-' || lpad(d.number::text, 8, '0') ref, p.payee_user_id uid
          from deal_payouts p join external_deals d on d.id = p.deal_id
          where p.status = 'PENDING' and p.payee_user_id is not null
            and p.amount > coalesce((select sum(a.amount - a.restored_amount) from withdrawal_allocations a where a.source_entity_type = 'deal_payout' and a.source_entity_id = p.id), 0)`),
        'deal_payout',
        () => '/account/earnings',
      ),
  },
  /* ───── Inventory ───── */
  {
    code: 'INV_LOW_STOCK',
    category: 'INVENTORY',
    title: 'مخزون منخفض',
    body: 'المتاح من {{ref}} وصل لحد المخزون المنخفض.',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 72 },
    candidates: async (c) =>
      toCandidates(await q<Row>(c, sql`select v.id, now()::text due, left(p.title_ar, 60) || ' (' || v.sku || ')' ref, s.owner_user_id uid from product_variants v join products p on p.id = v.product_id join sellers s on s.id = p.seller_id where p.status = 'LIVE' and v.is_active and v.stock_on_hand - v.reserved > 0 and v.stock_on_hand - v.reserved <= v.low_stock_threshold`), 'product_variant', () => '/seller/inventory'),
  },
  {
    code: 'INV_OUT_OF_STOCK',
    category: 'INVENTORY',
    title: 'نفد المخزون',
    body: 'المنتج {{ref}} نفد من المخزون ولن يظهر كمتاح للشراء.',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 72 },
    candidates: async (c) =>
      toCandidates(await q<Row>(c, sql`select v.id, now()::text due, left(p.title_ar, 60) || ' (' || v.sku || ')' ref, s.owner_user_id uid from product_variants v join products p on p.id = v.product_id join sellers s on s.id = p.seller_id where p.status = 'LIVE' and v.is_active and v.stock_on_hand - v.reserved <= 0`), 'product_variant', () => '/seller/inventory'),
  },
  /* ───── Identity / destinations ───── */
  {
    code: 'KYC_REVIEW_AGING',
    category: 'IDENTITY',
    title: 'تحقق هوية بانتظار المراجعة',
    body: 'طلب التحقق من الهوية {{ref}} ينتظر المراجعة.',
    staffPermission: 'identity.review',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 24 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select v.id, (v.submitted_at + ${hours(cfg.agingHours)})::text due, 'رقم ' || v.submission_version ref from user_identity_verifications v where v.status = 'PENDING_REVIEW' and v.submitted_at is not null`), 'identity', (r) => `/admin/identity/${r.id}`, false),
  },
  {
    code: 'KYC_ACTION_REQUIRED',
    category: 'IDENTITY',
    title: 'التحقق من هويتك يحتاج إجراء',
    body: 'مطلوب منك استكمال أو إعادة التحقق من الهوية {{ref}}.',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 72, agingHours: 0 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select v.id, v.reviewed_at::text due, '' ref, v.user_id uid from user_identity_verifications v where v.status in ('MORE_INFO_REQUIRED','REVERIFICATION_REQUIRED')`), 'identity', () => '/account/identity'),
  },
  {
    code: 'DEST_REVIEW_AGING',
    category: 'IDENTITY',
    title: 'بيانات استلام أموال بانتظار المراجعة',
    body: 'بيانات استلام الأموال {{ref}} تنتظر المراجعة.',
    staffPermission: 'destinations.review',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 24 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select d.id, (d.created_at + ${hours(cfg.agingHours)})::text due, 'نسخة ' || d.version ref from receiving_destinations d where d.status = 'PENDING_REVIEW'`), 'receiving_destination', () => '/admin/receiving-destinations', false),
  },
  /* ───── Disputes ───── */
  {
    code: 'DISPUTE_UNASSIGNED',
    category: 'DISPUTE',
    title: 'نزاع جديد بدون مسؤول',
    body: 'النزاع {{ref}} لم يُسند لمسؤول بعد.',
    staffPermission: 'disputes.manage',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 4 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select d.id, (d.created_at + ${hours(cfg.agingHours)})::text due, '#' || d.number ref from disputes d where d.status = 'OPEN' and d.assigned_to is null`), 'dispute', (r) => `/admin/disputes/${r.id}`, false),
  },
  {
    code: 'DISPUTE_AGING',
    category: 'DISPUTE',
    title: 'نزاع مفتوح يحتاج قرارًا',
    body: 'النزاع {{ref}} مفتوح ويحتاج متابعة أو قرارًا رسميًا.',
    staffPermission: 'disputes.manage',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 72 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select d.id, (d.created_at + ${hours(cfg.agingHours)})::text due, '#' || d.number ref from disputes d where d.status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')`), 'dispute', (r) => `/admin/disputes/${r.id}`, false),
  },
  /* ───── Support ───── */
  {
    code: 'SUPPORT_UNASSIGNED',
    category: 'SUPPORT',
    title: 'تذكرة دعم بدون مسؤول',
    body: 'التذكرة {{ref}} لم تُسند لمسؤول بعد.',
    staffPermission: 'support.manage',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 2 },
    candidates: async (c, cfg) => toCandidates(await q<Row>(c, sql`select t.id, (t.updated_at + ${hours(cfg.agingHours)})::text due, '#' || t.number ref from support_tickets t where t.status in ('OPEN','IN_PROGRESS') and t.assignee_id is null`), 'support_ticket', (r) => `/admin/support/${r.id}`, false),
  },
  {
    code: 'SUPPORT_FIRST_RESPONSE_SLA',
    category: 'SUPPORT',
    title: 'موعد أول رد على تذكرة',
    body: 'موعد أول رد على التذكرة {{ref}} يقترب أو تجاوز.',
    staffPermission: 'support.manage',
    severity: 'HIGH',
    defaults: { preHours: 1, cooldownHours: 4 },
    candidates: async (c) => {
      const rows = await q<Row & { owner: string | null }>(c, sql`select t.id, t.first_response_due_at::text due, '#' || t.number ref, t.assignee_id owner from support_tickets t where t.first_response_due_at is not null and t.first_responded_at is null and t.status not in ('RESOLVED','CLOSED')`);
      return rows.map((r) => ({ entityType: 'support_ticket', entityId: r.id, deadlineAt: at(r.due), userIds: r.owner ? [r.owner] : [], ref: r.ref, link: `/admin/support/${r.id}` }));
    },
  },
  {
    code: 'SUPPORT_RESOLUTION_SLA',
    category: 'SUPPORT',
    title: 'موعد حل تذكرة',
    body: 'موعد حل التذكرة {{ref}} يقترب أو تجاوز.',
    staffPermission: 'support.manage',
    severity: 'HIGH',
    defaults: { preHours: 4, cooldownHours: 12 },
    candidates: async (c) => {
      const rows = await q<Row & { owner: string | null }>(c, sql`select t.id, t.resolution_due_at::text due, '#' || t.number ref, t.assignee_id owner from support_tickets t where t.resolution_due_at is not null and t.status not in ('RESOLVED','CLOSED')`);
      return rows.map((r) => ({ entityType: 'support_ticket', entityId: r.id, deadlineAt: at(r.due), userIds: r.owner ? [r.owner] : [], ref: r.ref, link: `/admin/support/${r.id}` }));
    },
  },
  {
    code: 'SUPPORT_REOPENED',
    category: 'SUPPORT',
    title: 'تذكرة أعيد فتحها',
    body: 'التذكرة {{ref}} أعيد فتحها وتحتاج متابعة.',
    staffPermission: 'support.manage',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 0 },
    candidates: async (c) => toCandidates(await q<Row>(c, sql`select t.id, t.reopened_at::text due, '#' || t.number ref from support_tickets t where t.reopened_at is not null and t.status = 'OPEN'`), 'support_ticket', (r) => `/admin/support/${r.id}`, false),
  },
  {
    code: 'SUPPORT_SPECIALIST_OVERDUE',
    category: 'SUPPORT',
    title: 'تذكرة مصعّدة تنتظر المختص',
    body: 'التذكرة المصعّدة {{ref}} تنتظر رد الفريق المختص.',
    severity: 'NORMAL',
    defaults: { preHours: 0, cooldownHours: 24, agingHours: 24 },
    candidates: async (c, cfg) => {
      const rows = await q<Row & { owner: string | null; specialist: string | null }>(c, sql`select t.id, (t.escalated_at + ${hours(cfg.agingHours)})::text due, '#' || t.number ref, t.assignee_id owner, t.specialist_user_id specialist from support_tickets t where t.status = 'ESCALATED' and t.escalated_at is not null`);
      return rows.map((r) => ({ entityType: 'support_ticket', entityId: r.id, deadlineAt: at(r.due), userIds: [r.owner, r.specialist].filter((u): u is string => !!u), ref: r.ref, link: `/admin/support/${r.id}` }));
    },
  },
];
