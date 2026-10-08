import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { customerActor, sellerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import {
  auditLogs,
  conversationMessageReports,
  conversationMessages,
  conversations,
  dealDeliveryOtps,
  dealPayouts,
  dealTermsVersions,
  disputes,
  externalDeals,
  journalEntries,
  notifications,
  payments,
  sellerMembers,
  sellerOrders,
  shipments,
  systemSettings,
} from '@/server/db/schema';
import {
  cleanBody,
  hideMessage,
  listForSeller,
  listForUser,
  markRead,
  openDealConversation,
  openSellerOrderConversation,
  participantAccess,
  participantThread,
  reportMessage,
  sendMessage,
  setConversationLock,
  staffThread,
  unreadForSeller,
  unreadForUser,
} from '@/server/modules/messaging/service';
import {
  cancelDeal,
  claimInvitation,
  createDeal,
  deliveryOtpForBuyer,
  inviteSeller,
  markDealDelivered,
  respondToOffer,
  saveDealStep,
  startDealPayment,
  submitSellerOffer,
} from '@/server/modules/deals/service';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { openDispute } from '@/server/modules/postpurchase/disputes';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { canReadPrivateFile } from '@/server/storage/access';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, pdf, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

/**
 * Buyer ↔ seller communication — functional, security and money/terms-isolation regression suite.
 * Numbers in test names refer to the acceptance list in docs/INTERNAL_COMMUNICATION_SYSTEM.md.
 */
let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

const key = () => randomUUID();
const send = (a: Actor, convId: string, body: string, files: { data: Buffer; name: string }[] = []) => sendMessage(a, convId, { body, clientKey: key() }, files);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};

/** Paid marketplace order from one seller (sub-order PAID). */
async function paidOrder(opts: { seller?: Awaited<ReturnType<typeof makeSeller>> } = {}) {
  const s = opts.seller ?? (await makeSeller(admin));
  const p = await makeProduct(s.actor, admin, { price: 300_00 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  return { s, c, order, so };
}

/** Store member with a given role (shares the store's seller context). */
async function member(sellerId: string, role: string) {
  const u = await makeUser({ name: 'موظف متجر' });
  await db.insert(sellerMembers).values({ sellerId, userId: u.id, role: role as never, isActive: true });
  return { user: u, actor: (await sellerActor(u.id))! };
}

async function staff(roles: string[]) {
  return makeAdmin(roles);
}

/** Protected deal up to the seller's first formal offer (OFFER_PENDING_BUYER). */
async function dealWithOffer() {
  const buyerUser = await makeUser();
  const buyer = customerActor(buyerUser.id);
  const deal = await createDeal(buyer, { title: 'موبايل جديد', description: 'موبايل جديد متبرشم في العلبة', condition: 'NEW', quantity: 1 });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: '5500' });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير' });
  const { token } = await inviteSeller(buyer, deal.id, true);
  const sellerUser = await makeUser();
  const seller = customerActor(sellerUser.id);
  return { buyer, buyerUser, seller, sellerUser, dealId: deal.id, token };
}
const OFFER = {
  details: { fullName: 'بائع الصفقة' },
  location: { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم' },
  payout: { type: 'INSTAPAY' as const, holderName: 'بائع الصفقة', instapayAddress: 'deal@instapay' },
  offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 3, deliveryMaxDays: 5, processingDays: 1 },
  returnPolicy: { type: 'NONE' as const },
};

/* ───────────────────────── MARKETPLACE ───────────────────────── */

describe('marketplace order communication', () => {
  it('1 — no conversation before the order relationship is eligible (payment not confirmed)', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin);
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const [so] = await sellerOrdersOf(order.id);
    expect(so.status).toBe('PENDING_PAYMENT');
    await expect(openSellerOrderConversation(c.actor, so.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(openSellerOrderConversation(s.actor, so.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await db.select().from(conversations).where(eq(conversations.sellerOrderId, so.id))).toHaveLength(0);
  });

  it('2-6 — opens once paid; buyer sends, seller sees and replies, buyer sees the reply (same conversation)', async () => {
    const { s, c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    expect(conv.context).toBe('SELLER_ORDER');
    expect((await openSellerOrderConversation(s.actor, so.id)).id).toBe(conv.id);
    await send(c.actor, conv.id, 'هو المقاس ده مظبوط؟');
    const sellerView = await participantThread(s.actor, conv.id);
    expect(sellerView.side).toBe('SELLER');
    expect(sellerView.messages.map((m) => m.body)).toEqual(['هو المقاس ده مظبوط؟']);
    expect(sellerView.context.ref).toContain(`-${so.suffix}`);
    await send(s.actor, conv.id, 'أيوه مظبوط، وهشحنه بكرة');
    const buyerView = await participantThread(c.actor, conv.id);
    expect(buyerView.messages.map((m) => [m.side, m.mine])).toEqual([
      ['BUYER', true],
      ['SELLER', false],
    ]);
  });

  it('7-8 — multi-seller order: one isolated conversation per seller sub-order; seller A cannot see seller B', async () => {
    const a = await makeSeller(admin);
    const b = await makeSeller(admin);
    const pa = await makeProduct(a.actor, admin);
    const pb = await makeProduct(b.actor, admin);
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: pa.variantId, qty: 1 }, { variantId: pb.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const sos = await sellerOrdersOf(order.id);
    const soA = sos.find((x) => x.sellerId === a.actor.sellerId)!;
    const soB = sos.find((x) => x.sellerId === b.actor.sellerId)!;
    const convA = await openSellerOrderConversation(c.actor, soA.id);
    const convB = await openSellerOrderConversation(c.actor, soB.id);
    expect(convA.id).not.toBe(convB.id);
    expect(convA.sellerId).toBe(a.actor.sellerId);
    await send(c.actor, convB.id, 'رسالة لبائع B بس');
    await expect(participantAccess(a.actor, convB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(participantThread(a.actor, convB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(openSellerOrderConversation(a.actor, soB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await listForSeller(a.actor)).map((x) => x.id)).not.toContain(convB.id);
    expect((await listForSeller(b.actor)).map((x) => x.id)).toContain(convB.id);
  });

  it('9 — a buyer cannot open or read another buyer’s conversation', async () => {
    const { c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const other = await makeCustomer();
    await expect(participantAccess(other.actor, conv.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(openSellerOrderConversation(other.actor, so.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(send(other.actor, conv.id, 'تطفل')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await listForUser(other.actor)).map((x) => x.id)).not.toContain(conv.id);
  });

  it('10 — «استلمت» in a message does not confirm receipt or release seller money', async () => {
    const { s, c, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const before = await sellerBalances(db, s.actor.sellerId!);
    const [je] = await db.select({ n: count() }).from(journalEntries);
    await send(c.actor, conv.id, 'استلمت الطلب، تمام كده. أكدت الاستلام');
    const [after] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id));
    expect(after.status).toBe('SHIPPED');
    expect(after.fundsReleasedAt).toBeNull();
    expect(after.deliveredAt).toBeNull();
    expect(await sellerBalances(db, s.actor.sellerId!)).toEqual(before);
    expect((await db.select({ n: count() }).from(journalEntries))[0].n).toBe(je.n);
  });
});

/* ───────────────────────── PROTECTED DEAL ───────────────────────── */

describe('protected deal communication', () => {
  it('11-12 — unavailable before the seller securely claims the invitation; available after binding', async () => {
    const d = await dealWithOffer();
    await expect(openDealConversation(d.buyer, d.dealId)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(openDealConversation(d.seller, d.dealId)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // not bound yet
    await claimInvitation(d.seller, d.token);
    const conv = await openDealConversation(d.buyer, d.dealId);
    expect(conv.context).toBe('DEAL');
    expect(conv.sellerUserId).toBe(d.sellerUser.id);
    expect((await openDealConversation(d.seller, d.dealId)).id).toBe(conv.id);
    const stranger = customerActor((await makeUser()).id);
    await expect(openDealConversation(stranger, d.dealId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('13-17 — negotiation chat never changes the formal offer or the agreed terms snapshot', async () => {
    const d = await dealWithOffer();
    await claimInvitation(d.seller, d.token);
    const conv = await openDealConversation(d.buyer, d.dealId);
    await send(d.buyer, conv.id, 'ممكن نتكلم في السعر قبل العرض؟');
    await send(d.seller, conv.id, 'أكيد، هبعت العرض حالاً');
    const { version } = await submitSellerOffer(d.seller, d.dealId, OFFER, true);
    const versionsBefore = await db.select().from(dealTermsVersions).where(eq(dealTermsVersions.dealId, d.dealId));
    const [dealBefore] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    // 15: a price in a message is NOT an offer.
    await send(d.buyer, conv.id, 'خليه 5000 بدل 5500');
    // 16: a delivery promise in a message is NOT a term.
    await send(d.seller, conv.id, 'هوصله خلال يومين');
    expect(await db.select().from(dealTermsVersions).where(eq(dealTermsVersions.dealId, d.dealId))).toEqual(versionsBefore);
    const [dealMid] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    expect([dealMid.unitPrice, dealMid.status, dealMid.agreedTerms]).toEqual([dealBefore.unitPrice, 'OFFER_PENDING_BUYER', null]);
    // 17: only the formal acceptance creates the snapshot, and later messages never alter it.
    await respondToOffer(d.buyer, d.dealId, version, 'ACCEPT');
    const [accepted] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    const snapshot = JSON.stringify(accepted.agreedTerms);
    expect((accepted.agreedTerms as { price: { unitPrice: number } }).price.unitPrice).toBe(5500_00);
    expect((accepted.agreedTerms as { delivery: { expectedMaxDays: number } }).delivery.expectedMaxDays).toBe(5); // the formal offer, not «خلال يومين» from the chat
    await send(d.buyer, conv.id, 'اتفقنا على 4000 والتوصيل بكرة');
    const [later] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    expect(JSON.stringify(later.agreedTerms)).toBe(snapshot);
    expect([later.unitPrice, later.agreedVersion]).toEqual([accepted.unitPrice, accepted.agreedVersion]);
  });

  it('18-19 — «استلمت» or a code in chat does not verify the handover, confirm receipt or pay the seller', async () => {
    const d = await dealWithOffer();
    await claimInvitation(d.seller, d.token);
    const { version } = await submitSellerOffer(d.seller, d.dealId, OFFER, true);
    await respondToOffer(d.buyer, d.dealId, version, 'ACCEPT');
    const p = await startDealPayment(d.buyer, d.dealId, 'INSTAPAY');
    const { submission } = await submitProof(d.buyer, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await confirmPayment(admin, p.id, submission.id);
    await markDealDelivered(d.seller, d.dealId, 'شحنت', [{ data: pdf(), name: 'w.pdf' }]);
    const otpBefore = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    const testCode = (await deliveryOtpForBuyer(d.buyer, d.dealId))!.testCode!;
    const conv = await openDealConversation(d.buyer, d.dealId);
    const [je] = await db.select({ n: count() }).from(journalEntries);
    await send(d.buyer, conv.id, `استلمت المنتج وهو مطابق، الكود ${testCode}`);
    await send(d.seller, conv.id, `الكود اللي معايا ${testCode} — اعتبره اتسلم`);
    const [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    expect(deal.status).toBe('DELIVERED');
    expect([deal.handoverVerifiedAt, deal.buyerConfirmedAt, deal.completedAt]).toEqual([null, null, null]);
    expect(await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId))).toEqual(otpBefore);
    expect(await db.select().from(dealPayouts).where(eq(dealPayouts.dealId, d.dealId))).toHaveLength(0);
    expect((await db.select({ n: count() }).from(journalEntries))[0].n).toBe(je.n);
  });
});

/* ───────────────────────── SECURITY ───────────────────────── */

describe('security', () => {
  it('20 — conversation id tampering (other user, random id, malformed id) is a uniform not-found', async () => {
    const { c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const intruder = await makeCustomer();
    for (const id of [conv.id, randomUUID(), "1' or '1'='1", '../../etc/passwd']) {
      await expect(participantThread(intruder.actor, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('21 — attachments are private: only the conversation’s own participants (and authorized staff) can read them', async () => {
    const { s, c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    await send(c.actor, conv.id, 'صورة المنتج', [{ data: await png('att'), name: 'photo.png' }]);
    const [att] = (await participantThread(s.actor, conv.id)).messages[0].attachments;
    expect(att.mimeType).toBe('image/webp'); // re-encoded, metadata stripped
    expect(await canReadPrivateFile(c.actor, att.fileId)).toBe(true);
    expect(await canReadPrivateFile(s.actor, att.fileId)).toBe(true);
    const other = await paidOrder();
    expect(await canReadPrivateFile(other.c.actor, att.fileId)).toBe(false);
    expect(await canReadPrivateFile(other.s.actor, att.fileId)).toBe(false);
    expect(await canReadPrivateFile(customerActor(s.user.id), att.fileId)).toBe(false); // store owner acting as a plain customer
    expect(await canReadPrivateFile(await staff(['CATALOG_REVIEWER']), att.fileId)).toBe(false);
    expect(await canReadPrivateFile(await staff(['DISPUTE_OFFICER']), att.fileId)).toBe(true);
  });

  it('22-23 — store staff without `orders.communicate` (catalog, finance-only) are blocked; order staff allowed', async () => {
    const { s, c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    await send(c.actor, conv.id, 'سؤال للمتجر');
    const catalog = await member(s.actor.sellerId!, 'CATALOG_MANAGER');
    const finance = await member(s.actor.sellerId!, 'FINANCE');
    const orders = await member(s.actor.sellerId!, 'ORDER_MANAGER');
    for (const m of [catalog, finance]) {
      await expect(participantAccess(m.actor, conv.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(openSellerOrderConversation(m.actor, so.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(listForSeller(m.actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await unreadForSeller(m.actor)).toBe(0);
    }
    expect((await participantThread(orders.actor, conv.id)).side).toBe('SELLER');
  });

  it('24 — staff RBAC: only roles with messages.view can open a conversation, and every view is audited', async () => {
    const { c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    for (const role of ['FINANCE_OPERATOR', 'FINANCE_CHECKER', 'CATALOG_REVIEWER', 'PAYMENT_REVIEWER', 'SELLER_REVIEWER']) {
      await expect(staffThread(await staff([role]), conv.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const officer = await staff(['DISPUTE_OFFICER']);
    const t = await staffThread(officer, conv.id, { via: 'dispute' });
    expect(t.conv.id).toBe(conv.id);
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'conversation.staff_viewed'), eq(auditLogs.entityId, conv.id), eq(auditLogs.actorUserId, officer.userId!)));
    expect(log.newValues).toMatchObject({ sellerOrderId: so.id, orderId: so.orderId, via: 'dispute' });
    for (const role of ['CUSTOMER_SUPPORT', 'OPERATIONS_MANAGER', 'SUPER_ADMIN']) expect((await staffThread(await staff([role]), conv.id)).conv.id).toBe(conv.id);
  });

  it('25-26 — script/HTML payloads are stored as plain text (rendered escaped); control characters are stripped', async () => {
    const { c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
    await send(c.actor, conv.id, payload);
    const [m] = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conv.id));
    expect(m.body).toBe(payload); // never interpreted server-side; React escapes it on render (E2E checks the DOM)
    expect(cleanBody('a\u0000b​c‮d\n\n\n\n\ne')).toBe('abc‮d\n\n\ne');
    await expect(send(c.actor, conv.id, 'x'.repeat(2001))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(send(c.actor, conv.id, '   \n  ')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('27 — rate limit: flooding a conversation is refused', async () => {
    const { c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const results: string[] = [];
    for (let i = 0; i < 22; i++) results.push(await code(send(c.actor, conv.id, `رسالة ${i}`)));
    expect(results.filter((r) => r === 'OK').length).toBeLessThanOrEqual(20);
    expect(results).toContain('RATE_LIMITED');
  });

  it('28-29 — oversized, disallowed and disguised attachments are rejected; more than 3 files refused', async () => {
    const { c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(9 * 1024 * 1024)]);
    await expect(send(c.actor, conv.id, 'كبير', [{ data: big, name: 'big.jpg' }])).rejects.toMatchObject({ code: 'VALIDATION' });
    for (const [data, name] of [
      [Buffer.from('MZ\x90\x00 executable file content here'), 'tool.exe'],
      [Buffer.from('<html><script>alert(1)</script></html>'), 'page.html'],
      [Buffer.from('PK\x03\x04 zip archive content data'), 'a.zip'],
      [await png('disguised'), 'invoice.exe'],
    ] as const) {
      await expect(send(c.actor, conv.id, 'ملف', [{ data, name }])).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    const four = await Promise.all([1, 2, 3, 4].map(async (i) => ({ data: await png(`f${i}`), name: `${i}.png` })));
    await expect(send(c.actor, conv.id, 'كتير', four)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conv.id))).toHaveLength(0);
    // A real PDF is accepted.
    await send(c.actor, conv.id, 'الفاتورة', [{ data: pdf(), name: 'invoice.pdf' }]);
  });
});

/* ───────────────────────── MESSAGING ───────────────────────── */

describe('messaging behaviour', () => {
  it('30-31 — unread counts per side/member; viewing the conversation (not merely fetching it) marks it read and shows «seen»', async () => {
    const { s, c, so } = await paidOrder();
    const om = await member(s.actor.sellerId!, 'ORDER_MANAGER');
    const conv = await openSellerOrderConversation(c.actor, so.id);
    await send(c.actor, conv.id, 'أول رسالة');
    await send(c.actor, conv.id, 'تاني رسالة');
    expect(await unreadForSeller(s.actor)).toBe(2);
    expect(await unreadForSeller(om.actor)).toBe(2);
    expect(await unreadForUser(c.user.id)).toBe(0); // own messages never count
    const view = await participantThread(s.actor, conv.id);
    // Fetching/rendering the thread is NOT reading it: only the visible-view report (markRead) is.
    expect(await unreadForSeller(s.actor)).toBe(2);
    await markRead(s.actor, conv.id);
    expect(await unreadForSeller(s.actor)).toBe(0);
    expect(await unreadForSeller(om.actor)).toBe(2); // each member has their own read position
    expect(view.messages.every((m) => !m.mine)).toBe(true);
    expect((await participantThread(c.actor, conv.id)).messages.every((m) => m.readByOther)).toBe(true);
    await send(s.actor, conv.id, 'رد البائع');
    expect(await unreadForUser(c.user.id)).toBe(1);
    expect((await listForUser(c.actor)).find((x) => x.id === conv.id)).toMatchObject({ unread: 1, preview: 'رد البائع' });
  });

  it('32 — notifications: one per unread burst, to authorized store members only, never containing the text', async () => {
    const { s, c, so } = await paidOrder();
    const om = await member(s.actor.sellerId!, 'ORDER_MANAGER');
    const fin = await member(s.actor.sellerId!, 'FINANCE');
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const n = async (userId: string, event: string) => (await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.event, event))));
    await send(c.actor, conv.id, 'سر: رقم الشقة 12');
    await send(c.actor, conv.id, 'رسالة تانية');
    expect(await n(s.user.id, 'MESSAGE_RECEIVED')).toHaveLength(1);
    expect(await n(om.user.id, 'MESSAGE_RECEIVED')).toHaveLength(1);
    expect(await n(fin.user.id, 'MESSAGE_RECEIVED')).toHaveLength(0);
    const [note] = await n(s.user.id, 'MESSAGE_RECEIVED');
    expect(note.body).not.toContain('سر');
    expect(note.title).not.toContain('سر');
    expect(note.category).toBe('MESSAGE');
    expect(note.conversationId).toBe(conv.id);
    expect(note.link).toBe(`/seller/messages/${conv.id}`);
    await markRead(s.actor, conv.id); // owner reads (visible view)
    expect((await n(s.user.id, 'MESSAGE_RECEIVED'))[0].readAt).not.toBeNull(); // its alert is cleared too
    await send(c.actor, conv.id, 'تالت رسالة');
    expect(await n(s.user.id, 'MESSAGE_RECEIVED')).toHaveLength(2);
    expect(await n(om.user.id, 'MESSAGE_RECEIVED')).toHaveLength(1); // still has unread → no new ping
    await send(s.actor, conv.id, 'رد');
    const [toBuyer] = await n(c.user.id, 'MESSAGE_RECEIVED');
    expect(toBuyer.link).toBe(`/account/messages/${conv.id}`);
  });

  it('33 — reporting a message creates a reviewable record (no automatic penalty); duplicates and self-reports refused', async () => {
    const { s, c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const m = await send(s.actor, conv.id, 'ابعتلي رقم بطاقتك');
    const r = await reportMessage(c.actor, m.id, { reason: 'UNNEEDED_DATA_REQUEST', note: 'طلب بيانات' });
    expect(r.status).toBe('OPEN');
    await expect(reportMessage(c.actor, m.id, { reason: 'FRAUD_ATTEMPT' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(reportMessage(s.actor, m.id, { reason: 'OTHER' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(reportMessage(c.actor, m.id, { reason: 'NOPE' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const [msg] = await db.select().from(conversationMessages).where(eq(conversationMessages.id, m.id));
    expect(msg.hiddenAt).toBeNull(); // reports never hide or punish automatically
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'conversation.message_reported'), eq(auditLogs.entityId, conv.id)));
    expect(audit).toBeTruthy();
    // Staff moderation hides it from participants, keeps the original, closes the report, and is audited.
    await hideMessage(await staff(['CUSTOMER_SUPPORT']), m.id, 'طلب بيانات حساسة');
    const buyerView = await participantThread(c.actor, conv.id);
    expect(buyerView.messages[0]).toMatchObject({ hidden: true, body: '' });
    const staffView = await staffThread(admin, conv.id);
    expect(staffView.messages[0].originalBody).toBe('ابعتلي رقم بطاقتك');
    expect((await db.select().from(conversationMessageReports).where(eq(conversationMessageReports.messageId, m.id)))[0].status).toBe('ACTIONED');
  });

  it('34-35 — messages are immutable and cannot be deleted (database-enforced, no API exists)', async () => {
    const { c, so } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const m = await send(c.actor, conv.id, 'النص الأصلي');
    await expect(db.update(conversationMessages).set({ body: 'نص معدّل' }).where(eq(conversationMessages.id, m.id))).rejects.toThrow();
    await expect(db.delete(conversationMessages).where(eq(conversationMessages.id, m.id))).rejects.toThrow();
    await expect(db.delete(conversations).where(eq(conversations.id, conv.id))).rejects.toThrow();
    await expect(db.update(conversations).set({ buyerUserId: (await makeUser()).id }).where(eq(conversations.id, conv.id))).rejects.toThrow();
    const svc = await import('@/server/modules/messaging/service');
    expect(Object.keys(svc).filter((k) => /edit|update|delete|remove/i.test(k))).toEqual([]);
    // Idempotent retry: same client key → same message, no duplicate.
    const k = key();
    const a = await sendMessage(c.actor, conv.id, { body: 'مرة واحدة', clientKey: k });
    const b = await sendMessage(c.actor, conv.id, { body: 'مرة واحدة', clientKey: k });
    expect(b.id).toBe(a.id);
  });

  it('36 — locked or long-closed conversations reject new messages but stay readable', async () => {
    const { c, so, s } = await paidOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    await send(c.actor, conv.id, 'قبل القفل');
    await setConversationLock(await staff(['OPERATIONS_MANAGER']), conv.id, true, 'مخالفة متكررة');
    await expect(send(c.actor, conv.id, 'بعد القفل')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(send(s.actor, conv.id, 'بعد القفل')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const t = await participantThread(c.actor, conv.id);
    expect(t.write.canWrite).toBe(false);
    expect(t.messages).toHaveLength(1);
    await expect(setConversationLock(await staff(['FINANCE_OPERATOR']), conv.id, false, 'x x x')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Communication window after a final state (window = 0 days for this check).
    const d = await dealWithOffer();
    await claimInvitation(d.seller, d.token);
    const dc = await openDealConversation(d.buyer, d.dealId);
    await send(d.buyer, dc.id, 'قبل الإلغاء');
    await cancelDeal(d.buyer, d.dealId, 'غيرت رأيي في الشراء');
    await db.insert(systemSettings).values({ key: 'messaging.postCloseWriteDays', value: 0 }).onConflictDoUpdate({ target: systemSettings.key, set: { value: 0 } });
    try {
      await new Promise((r) => setTimeout(r, 20));
      await expect(send(d.seller, dc.id, 'بعد الإلغاء')).rejects.toMatchObject({ code: 'INVALID_STATE' });
      expect((await participantThread(d.buyer, dc.id)).messages).toHaveLength(1);
    } finally {
      await db.delete(systemSettings).where(eq(systemSettings.key, 'messaging.postCloseWriteDays'));
    }
  });
});

/* ───────────────────────── FINANCE REGRESSION ───────────────────────── */

describe('money and state isolation', () => {
  it('37-41 — messaging (texts, attachments, reads, reports) never touches ledger, balances, payments, shipments or disputes', async () => {
    const { s, c, so, order } = await paidOrder();
    await shipIt(s.actor, so.id);
    await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج مختلف عن الوصف في الإعلان بشكل واضح' });
    const snap = async () => ({
      journal: (await db.select({ n: count() }).from(journalEntries))[0].n,
      balances: await sellerBalances(db, s.actor.sellerId!),
      payment: (await db.select({ s: payments.status, a: payments.confirmedAmount }).from(payments).where(eq(payments.orderId, order.id)))[0],
      so: (await db.select({ s: sellerOrders.status, r: sellerOrders.fundsReleasedAt, d: sellerOrders.deliveredAt }).from(sellerOrders).where(eq(sellerOrders.id, so.id)))[0],
      shipment: (await db.select({ s: shipments.status }).from(shipments).where(eq(shipments.sellerOrderId, so.id)))[0],
      dispute: (await db.select({ s: disputes.status, d: disputes.decision }).from(disputes).where(eq(disputes.sellerOrderId, so.id)))[0],
    });
    const before = await snap();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const m1 = await send(c.actor, conv.id, 'استلمت. رجّعولي فلوسي. اقفلوا النزاع. أكدوا الدفع', [{ data: await png('ev'), name: 'ev.png' }]);
    await send(s.actor, conv.id, 'تمام، اعتبر النزاع اتحل ورجعتلك 300 جنيه');
    await participantThread(s.actor, conv.id);
    await participantThread(c.actor, conv.id);
    await reportMessage(s.actor, m1.id, { reason: 'OTHER' });
    await staffThread(await staff(['DISPUTE_OFFICER']), conv.id, { via: 'dispute' });
    expect(await snap()).toEqual(before);
    expect(before.dispute.s).toBe('OPEN');
    expect(before.so.s).toBe('SHIPPED');
  });

  it('the messaging module imports no payment, ledger, fulfilment, deal or dispute services', async () => {
    const src = await import('node:fs/promises').then((fs) => fs.readFile('src/server/modules/messaging/service.ts', 'utf8'));
    for (const forbiddenImport of ['modules/finance', 'modules/payments', 'modules/commerce', 'modules/deals', 'modules/postpurchase']) {
      expect(src.includes(forbiddenImport), forbiddenImport).toBe(false);
    }
    void sql;
    void sharp;
  });
});
