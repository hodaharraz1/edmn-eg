import { eq, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { hasPermission, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { files } from '@/server/db/schema';
import { servable } from './scanning';
import { SELLER_ROLE_PERMISSIONS } from '@/server/rbac/permissions';
import { storage } from './storage';

/** Store roles allowed to see order evidence (waybills, return and dispute evidence) — F-9. Owners always can. */
const EVIDENCE_ROLES = Object.entries(SELLER_ROLE_PERMISSIONS)
  .filter(([, perms]) => perms.includes('orders.manage') || perms.includes('returns.manage'))
  .map(([role]) => role);
const evidenceRoles = sql.join(EVIDENCE_ROLES.map((r) => sql`${r}`), sql`, `);

/**
 * Authorization for PRIVATE files. Knowing a file id is never enough: access is derived from the
 * business record the file is attached to (purpose-specific rules below). Denials are uniform 404s.
 */
const DOC_STEP_UP_MS = 60 * 60_000;
const SENSITIVE_PURPOSES = new Set(['IDENTITY_DOCUMENT', 'SELLER_DOCUMENT', 'PAYMENT_PROOF', 'WITHDRAWAL_PROOF', 'REFUND_PROOF', 'DISPUTE_EVIDENCE', 'DEAL_EVIDENCE', 'MESSAGE_ATTACHMENT', 'CONDITION_EVIDENCE']);

export async function canReadPrivateFile(actor: Actor, fileId: string): Promise<boolean> {
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  if (!f || f.deletedAt) return false;
  if (f.visibility === 'PUBLIC') return true;
  if (!actor.userId) return false;
  const uid = actor.userId;
  const one = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows.length > 0;

  // Global identity cases may LINK seller-application scans (legacy mapping, no duplication): identity
  // reviewers can open exactly the files referenced by an identity case, with a fresh 2FA re-check.
  const freshDocStepUp = !!actor.stepUpAt && Date.now() - actor.stepUpAt.getTime() < DOC_STEP_UP_MS;
  if ((f.purpose === 'IDENTITY_DOCUMENT' || f.purpose === 'SELLER_DOCUMENT') && hasPermission(actor, 'identity.documents.view') && freshDocStepUp) {
    if (await one(sql`select 1 from user_identity_verifications v where v.front_file_id = ${f.id} or v.back_file_id = ${f.id}`)) return true;
  }

  switch (f.purpose) {
    case 'IDENTITY_DOCUMENT':
      // Only the owner of the identity case (and identity reviewers, above). Never sellers, never other staff.
      return one(sql`select 1 from user_identity_verifications v where (v.front_file_id = ${f.id} or v.back_file_id = ${f.id}) and v.user_id = ${uid}`);
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
        left join sellers s on s.id = so.seller_id left join seller_members m on m.seller_id = so.seller_id and m.user_id = ${uid} and m.is_active and m.role in (${evidenceRoles})
        where sd.file_id = ${f.id} and (o.customer_id = ${uid} or s.owner_user_id = ${uid} or m.user_id is not null)`);
    case 'RETURN_EVIDENCE':
      if (hasPermission(actor, 'returns.manage') || hasPermission(actor, 'disputes.manage')) return true;
      return one(sql`
        select 1 from return_evidence re join returns r on r.id = re.return_id join sellers s on s.id = r.seller_id
        left join seller_members m on m.seller_id = r.seller_id and m.user_id = ${uid} and m.is_active and m.role in (${evidenceRoles})
        where re.file_id = ${f.id} and (r.customer_id = ${uid} or s.owner_user_id = ${uid} or m.user_id is not null)`);
    case 'DISPUTE_EVIDENCE':
      if (hasPermission(actor, 'disputes.manage')) return true;
      return one(sql`select 1 from dispute_evidence de join disputes d on d.id = de.dispute_id
        left join seller_members m on m.seller_id = d.respondent_seller_id and m.user_id = ${uid} and m.is_active and m.role in (${evidenceRoles})
        where de.file_id = ${f.id} and (d.claimant_user_id = ${uid} or d.respondent_user_id = ${uid} or m.user_id is not null)`);
    case 'DEAL_EVIDENCE':
      if (hasPermission(actor, 'deals.view')) return true;
      return one(sql`select 1 from deal_evidence de join external_deals d on d.id = de.deal_id where de.file_id = ${f.id} and (d.buyer_id = ${uid} or d.seller_user_id = ${uid})`);
    case 'CONDITION_EVIDENCE':
      // Used-condition evidence that is never public (identifier photos, every protected-deal photo, inspection
      // reports): the item's seller side, the transaction's buyer, and staff who review listings, deals or disputes.
      if (hasPermission(actor, 'products.moderate') || hasPermission(actor, 'deals.view') || hasPermission(actor, 'disputes.manage')) return true;
      // The parties of an agreement keep access to the evidence frozen in it (even if later unlinked from a listing).
      if (await one(sql`select 1 from condition_snapshots cs where cs.status = 'ACCEPTED' and cs.snapshot->'evidence' @> ${JSON.stringify([{ fileId: f.id }])}::jsonb
          and (cs.snapshot->'parties'->>'buyerId' = ${uid} or cs.snapshot->'parties'->>'sellerUserId' = ${uid})`)) return true;
      return one(sql`
        select 1 from used_condition_reports r
          left join external_deals d on d.id = r.deal_id
          left join products p on p.id = r.product_id
          left join sellers s on s.id = p.seller_id
          left join seller_members m on m.seller_id = p.seller_id and m.user_id = ${uid} and m.is_active
         where (r.id in (select e.report_id from used_condition_evidence e where e.file_id = ${f.id})
             or r.id in (select pp.report_id from used_inspections i join product_passports pp on pp.id = i.passport_id where i.report_file_id = ${f.id}))
           and (r.author_user_id = ${uid} or d.buyer_id = ${uid} or d.seller_user_id = ${uid} or s.owner_user_id = ${uid} or m.user_id is not null
             or exists (select 1 from condition_snapshots cs join seller_orders so on so.id = cs.seller_order_id join orders o on o.id = so.order_id
                         where cs.report_id = r.id and cs.status = 'ACCEPTED' and o.customer_id = ${uid}))`);
    case 'WITHDRAWAL_PROOF':
      if (hasPermission(actor, 'withdrawals.view') || hasPermission(actor, 'deals.payout')) return true;
      return one(sql`select 1 from withdrawal_requests w join sellers s on s.id = w.seller_id where w.proof_file_id = ${f.id} and s.owner_user_id = ${uid}`);
    case 'REFUND_PROOF':
      if (hasPermission(actor, 'refunds.pay') || hasPermission(actor, 'finance.view')) return true;
      return one(sql`select 1 from refunds r where r.paid_proof_file_id = ${f.id} and r.customer_id = ${uid}`);
    case 'SUPPORT_ATTACHMENT':
      if (hasPermission(actor, 'support.manage')) return true;
      return one(sql`select 1 from support_messages m join support_tickets t on t.id = m.ticket_id where m.attachment_file_id = ${f.id} and t.requester_user_id = ${uid}`);
    case 'MESSAGE_ATTACHMENT': {
      // Staff with message access (each view audited below); otherwise only a participant of the very
      // conversation the file was sent in, and never once staff have hidden that message.
      // Staff need an active, purpose-bound access grant for THIS conversation (same rule as reading it) — F-8.
      if (hasPermission(actor, 'messages.view')) {
        return one(sql`select 1 from conversation_message_attachments a join conversation_messages m on m.id = a.message_id
          join privileged_message_access g on g.conversation_id = m.conversation_id and g.actor_user_id = ${uid} and g.expires_at > now()
          where a.file_id = ${f.id}`);
      }
      const storeSide =
        actor.type === 'SELLER' && actor.sellerId && actor.sellerPermissions?.has('orders.communicate') ? sql`or c.seller_id = ${actor.sellerId}` : sql``;
      return one(sql`
        select 1 from conversation_message_attachments a join conversation_messages m on m.id = a.message_id
        join conversations c on c.id = m.conversation_id
        where a.file_id = ${f.id} and m.hidden_at is null
          and ((c.context = 'SELLER_ORDER' and c.buyer_user_id = ${uid} and ${actor.type !== 'SELLER'})
            or (c.context = 'DEAL' and (c.buyer_user_id = ${uid} or c.seller_user_id = ${uid}))
            ${storeSide})`);
    }
    default:
      return false;
  }
}

export async function readPrivateFile(actor: Actor, fileId: string) {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) return null;
  if (!(await canReadPrivateFile(actor, fileId))) return null;
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  // Batch 2: a quarantined / infected / unscanned-where-required file is never served (uniform 404).
  if (!servable(f)) return null;
  const data = await storage().get(f.visibility, f.storageKey);
  if (!data) return null;
  if (actor.type === 'ADMIN' && SENSITIVE_PURPOSES.has(f.purpose)) {
    // Staff access to identity, payment and payout documents is itself audited.
    await audit(db, actor, { action: 'file.sensitive_viewed', entityType: 'file', entityId: f.id, newValues: { purpose: f.purpose } });
  }
  return { file: f, data };
}

