import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  conversationMessageAttachments,
  conversationMessageReports,
  deliveryEvidence,
  providerEvents,
  refundItems,
  sellerOrders,
  withdrawalRequests,
} from '@/server/db/schema';
import { submitDeliveryEvidence } from '@/server/modules/commerce/fulfilment';
import { requestRefundTx } from '@/server/modules/finance/refunds';
import { approveWithdrawal, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { openSellerOrderConversation, sendMessage } from '@/server/modules/messaging/service';
import { checkout, itemsOf, makeAdmin, makeCustomer, makeProduct, makeSeller, png, receiveAndRelease, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * PKG-I03-03 — append-only evidence tables and messaging guards (drizzle/0007 + 0008).
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 *
 * Closes the integrity-trigger regression track (after PKG-I03-01 unconditional triggers and
 * PKG-I03-02 conditional financial guards): refund items, delivery evidence, provider events,
 * withdrawal destination snapshots, and the messaging guards (message immutability, attachment
 * append-only, conversation binding immutability, report no-delete).
 */


/** Drizzle wraps the PostgreSQL error: the SQLSTATE is on the error itself or on its cause. */
const sqlstateOf = (e: unknown) => (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

const rejected = async (label: string, run: () => Promise<unknown>, sqlstate = '42501') => {
  const err = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `${label}: the database accepted a forbidden mutation`).not.toBeNull();
  expect(sqlstateOf(err), `${label}: unexpected SQLSTATE`).toBe(sqlstate); // 42501 = 0001/0008 guards; P0001 = 0007 messaging guards
};

/** One released purchase shared by the evidence tests. */
async function releasedFlow(opts: { evidenceBeforeRelease?: boolean } = {}) {
  const admin = await makeAdmin(['SUPER_ADMIN']);
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 200_00 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.orderId, order.id));
  await shipIt(s.actor, so.id);
  // Delivery evidence is accepted only while the order is in transit (SHIPPED / AWAITING_BUYER_RESPONSE).
  if (opts.evidenceBeforeRelease) await submitDeliveryEvidence(s.actor, so.id, { carrierReference: 'CR-TEST-1', note: 'تسليم' }, [{ data: await png('ev'), name: 'ev.png' }]);
  await receiveAndRelease(c.actor, so.id);
  return { admin, s, c, order, so };
}

describe('refund_items + refunds — append-only financial evidence (0008)', () => {
  it('refuses UPDATE/DELETE on refund items and DELETE on the refund itself', async () => {
    const { admin, so } = await releasedFlow();
    const [item] = await itemsOf(so.id);
    const refund = await db.transaction((tx) =>
      requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), items: [{ orderItemId: item.id, quantity: 1 }], reason: 'اختبار حارس سجل الاسترداد' }),
    );
    const [ri] = await db.select().from(refundItems).where(eq(refundItems.refundId, refund.id));
    expect(ri, 'item refund did not record refund_items').toBeTruthy();
    await rejected('refund_items UPDATE', () => db.execute(sql`update refund_items set quantity = 99 where id = ${ri.id}`));
    await rejected('refund_items DELETE', () => db.execute(sql`delete from refund_items where id = ${ri.id}`));
    await rejected('refunds DELETE', () => db.execute(sql`delete from refunds where id = ${refund.id}`));
  });
});

describe('delivery_evidence — append-only (0008)', () => {
  it('refuses UPDATE and DELETE on submitted delivery evidence', async () => {
    const { so } = await releasedFlow({ evidenceBeforeRelease: true });
    const [ev] = await db.select().from(deliveryEvidence).where(eq(deliveryEvidence.sellerOrderId, so.id));
    expect(ev, 'delivery evidence was not recorded').toBeTruthy();
    await rejected('delivery_evidence UPDATE', () => db.execute(sql`update delivery_evidence set note = 'tampered' where id = ${ev.id}`));
    await rejected('delivery_evidence DELETE', () => db.execute(sql`delete from delivery_evidence where id = ${ev.id}`));
  });
});

describe('provider_events — append-only webhook evidence (0008)', () => {
  it('refuses UPDATE and DELETE on a recorded provider event', async () => {
    const [ev] = await db
      .insert(providerEvents)
      .values({ provider: 'test-provider', eventId: randomUUID(), eventType: 'test.event', signatureValid: true, bodySha256: randomUUID().replaceAll('-', ''), status: 'RECORDED_AS_EVIDENCE' })
      .returning();
    await rejected('provider_events UPDATE', () => db.execute(sql`update provider_events set status = 'DUPLICATE' where id = ${ev.id}`));
    await rejected('provider_events DELETE', () => db.execute(sql`delete from provider_events where id = ${ev.id}`));
  });
});

describe('withdrawal destination snapshot — frozen at approval (0008)', () => {
  it('refuses changing the destination snapshot once the approval froze it', async () => {
    const { s, so } = await releasedFlow();
    void so;
    const { withdrawal: w } = await requestWithdrawal(s.actor, { amount: 150_00, clientKey: randomUUID() } /* ≥ withdrawals.minimumAmount (100 EGP) */);
    await approveWithdrawal(await makeAdmin(['FINANCE_CHECKER']), w.id);
    const [after] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, w.id));
    expect(after.destinationSnapshot, 'approval did not freeze a destination snapshot').not.toBeNull();
    await rejected('destination_snapshot changed', () =>
      db.execute(sql`update withdrawal_requests set destination_snapshot = '{"payoutMethodId":"tampered"}'::jsonb where id = ${w.id}`),
    );
  });
});

describe('messaging guards — immutable messages, append-only attachments, fixed bindings, kept reports (0007)', () => {
  it('refuses every forbidden mutation on a real conversation', async () => {
    const { c, so } = await releasedFlow();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const msg = await sendMessage(c.actor, conv.id, { body: 'مرحبا، الطلب كويس؟', clientKey: `ck${randomUUID().replaceAll('-', '').slice(0, 10)}` }, [{ data: await png('att'), name: 'att.png' }]);
    const [att] = await db.select().from(conversationMessageAttachments).where(eq(conversationMessageAttachments.messageId, msg.id));
    expect(att, 'attachment was not recorded').toBeTruthy();
    // message content and identity are immutable; messages are never deleted
    await rejected('message body edit', () => db.execute(sql`update conversation_messages set body = 'tampered' where id = ${msg.id}`), 'P0001');
    await rejected('message DELETE', () => db.execute(sql`delete from conversation_messages where id = ${msg.id}`), 'P0001');
    // attachments are fully append-only
    await rejected('attachment UPDATE', () => db.execute(sql`update conversation_message_attachments set message_id = ${msg.id} where id = ${att.id}`), 'P0001');
    await rejected('attachment DELETE', () => db.execute(sql`delete from conversation_message_attachments where id = ${att.id}`), 'P0001');
    // the conversation's business binding can never be re-pointed or deleted
    await rejected('conversation re-pointed', () => db.execute(sql`update conversations set order_id = ${randomUUID()} where id = ${conv.id}`), 'P0001');
    await rejected('conversation DELETE', () => db.execute(sql`delete from conversations where id = ${conv.id}`), 'P0001');
    // reports are kept for review — never deleted
    const [report] = await db
      .insert(conversationMessageReports)
      .values({ messageId: msg.id, conversationId: conv.id, reporterUserId: c.user.id, reason: 'OTHER' })
      .returning();
    await rejected('report DELETE', () => db.execute(sql`delete from conversation_message_reports where id = ${report.id}`), 'P0001');
  });
});
