import { eq, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { hasPermission, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { files } from '@/server/db/schema';
import { storage } from './storage';

/**
 * Authorization for PRIVATE files. Knowing a file id is never enough: access is derived from the
 * business record the file is attached to (purpose-specific rules below). Denials are uniform 404s.
 */
const DOC_STEP_UP_MS = 60 * 60_000;
const SENSITIVE_PURPOSES = new Set(['SELLER_DOCUMENT', 'PAYMENT_PROOF', 'WITHDRAWAL_PROOF', 'REFUND_PROOF', 'DISPUTE_EVIDENCE', 'DEAL_EVIDENCE']);

export async function canReadPrivateFile(actor: Actor, fileId: string): Promise<boolean> {
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  if (!f || f.deletedAt) return false;
  if (f.visibility === 'PUBLIC') return true;
  if (!actor.userId) return false;
  const uid = actor.userId;
  const one = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows.length > 0;

  switch (f.purpose) {
    case 'SELLER_DOCUMENT':
      // Identity scans show the full national ID: staff need the permission AND a 2FA re-check within the hour.
      if (hasPermission(actor, 'sellers.documents.view')) return !!actor.stepUpAt && Date.now() - actor.stepUpAt.getTime() < DOC_STEP_UP_MS;
      return one(sql`select 1 from seller_documents d join sellers s on s.id = d.seller_id where d.file_id = ${f.id} and s.owner_user_id = ${uid}`);
    case 'PAYMENT_PROOF':
      if (hasPermission(actor, 'payments.view')) return true;
      return one(sql`select 1 from payment_submissions ps where ps.proof_file_id = ${f.id} and ps.submitted_by = ${uid}`);
    case 'SHIPPING_WAYBILL':
      if (hasPermission(actor, 'shipping.view')) return true;
      return one(sql`
        select 1 from shipment_documents sd join shipments sh on sh.id = sd.shipment_id
        join seller_orders so on so.id = sh.seller_order_id join orders o on o.id = so.order_id
        left join sellers s on s.id = so.seller_id left join seller_members m on m.seller_id = so.seller_id and m.user_id = ${uid} and m.is_active
        where sd.file_id = ${f.id} and (o.customer_id = ${uid} or s.owner_user_id = ${uid} or m.user_id is not null)`);
    case 'RETURN_EVIDENCE':
      if (hasPermission(actor, 'returns.manage') || hasPermission(actor, 'disputes.manage')) return true;
      return one(sql`
        select 1 from return_evidence re join returns r on r.id = re.return_id join sellers s on s.id = r.seller_id
        where re.file_id = ${f.id} and (r.customer_id = ${uid} or s.owner_user_id = ${uid})`);
    case 'DISPUTE_EVIDENCE':
      if (hasPermission(actor, 'disputes.manage')) return true;
      return one(sql`select 1 from dispute_evidence de join disputes d on d.id = de.dispute_id where de.file_id = ${f.id} and (d.claimant_user_id = ${uid} or d.respondent_user_id = ${uid})`);
    case 'DEAL_EVIDENCE':
      if (hasPermission(actor, 'deals.view')) return true;
      return one(sql`select 1 from deal_evidence de join external_deals d on d.id = de.deal_id where de.file_id = ${f.id} and (d.buyer_id = ${uid} or d.seller_user_id = ${uid})`);
    case 'WITHDRAWAL_PROOF':
      if (hasPermission(actor, 'withdrawals.view') || hasPermission(actor, 'deals.payout')) return true;
      return one(sql`select 1 from withdrawal_requests w join sellers s on s.id = w.seller_id where w.proof_file_id = ${f.id} and s.owner_user_id = ${uid}`);
    case 'REFUND_PROOF':
      if (hasPermission(actor, 'refunds.pay') || hasPermission(actor, 'finance.view')) return true;
      return one(sql`select 1 from refunds r where r.paid_proof_file_id = ${f.id} and r.customer_id = ${uid}`);
    case 'SUPPORT_ATTACHMENT':
      if (hasPermission(actor, 'support.manage')) return true;
      return one(sql`select 1 from support_messages m join support_tickets t on t.id = m.ticket_id where m.attachment_file_id = ${f.id} and t.requester_user_id = ${uid}`);
    default:
      return false;
  }
}

export async function readPrivateFile(actor: Actor, fileId: string) {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) return null;
  if (!(await canReadPrivateFile(actor, fileId))) return null;
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  const data = await storage().get(f.visibility, f.storageKey);
  if (!data) return null;
  if (actor.type === 'ADMIN' && SENSITIVE_PURPOSES.has(f.purpose)) {
    // Staff access to identity, payment and payout documents is itself audited.
    await audit(db, actor, { action: 'file.sensitive_viewed', entityType: 'file', entityId: f.id, newValues: { purpose: f.purpose } });
  }
  return { file: f, data };
}

