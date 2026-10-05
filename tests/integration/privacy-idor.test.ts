import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { paymentSubmissions, sellerDocuments, sellerPayoutMethods, sellers, shipmentDocuments, shipments } from '@/server/db/schema';
import { canReadPrivateFile } from '@/server/storage/access';
import { orderForCustomer } from '@/server/modules/commerce/orders';
import { sellerOrderForSeller } from '@/server/modules/commerce/fulfilment';
import type { Actor } from '@/server/core/actor';
import { checkout, makeAdmin, makeCustomer, makeProduct, makeSeller, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

const ANON: Actor = { type: 'ANONYMOUS', userId: null, permissions: new Set() };

let admin: Actor;
let support: Actor;
let sellerA: Awaited<ReturnType<typeof makeSeller>>;
let sellerB: Awaited<ReturnType<typeof makeSeller>>;
let buyer: Awaited<ReturnType<typeof makeCustomer>>;
let stranger: Awaited<ReturnType<typeof makeCustomer>>;
let orderId: string;
let soId: string;

beforeAll(async () => {
  admin = await makeAdmin();
  support = await makeAdmin(['CUSTOMER_SUPPORT']);
  sellerA = await makeSeller(admin);
  sellerB = await makeSeller(admin);
  buyer = await makeCustomer();
  stranger = await makeCustomer();
  const p = await makeProduct(sellerA.actor, admin, { stock: 3 });
  const order = await checkout(buyer, [{ variantId: p.variantId, qty: 1 }]);
  orderId = order.id;
  await submitAndConfirm(buyer, orderId, admin);
  soId = (await sellerOrdersOf(orderId))[0].id;
  await shipIt(sellerA.actor, soId);
});

describe('real-seller pilot privacy — explicit IDOR checks', () => {
  it('seller identity documents: owner and authorized reviewers only', async () => {
    const [doc] = await db.select().from(sellerDocuments).where(and(eq(sellerDocuments.sellerId, sellerA.actor.sellerId!), isNull(sellerDocuments.supersededAt)));
    expect(await canReadPrivateFile(sellerA.actor, doc.fileId)).toBe(true);
    expect(await canReadPrivateFile(sellerB.actor, doc.fileId)).toBe(false); // Seller B ≠ Seller A
    expect(await canReadPrivateFile(buyer.actor, doc.fileId)).toBe(false); // customers never
    expect(await canReadPrivateFile(stranger.actor, doc.fileId)).toBe(false);
    expect(await canReadPrivateFile(ANON, doc.fileId)).toBe(false);
    expect(await canReadPrivateFile(support, doc.fileId)).toBe(false); // staff without sellers.documents.view
    expect(await canReadPrivateFile(admin, doc.fileId)).toBe(true);
  });

  it('payment proofs: the payer and finance staff only — not the seller, not other customers', async () => {
    const [sub] = await db.select().from(paymentSubmissions).where(eq(paymentSubmissions.submittedBy, buyer.user.id));
    expect(await canReadPrivateFile(buyer.actor, sub.proofFileId)).toBe(true);
    expect(await canReadPrivateFile(sellerA.actor, sub.proofFileId)).toBe(false);
    expect(await canReadPrivateFile(sellerB.actor, sub.proofFileId)).toBe(false);
    expect(await canReadPrivateFile(stranger.actor, sub.proofFileId)).toBe(false);
    expect(await canReadPrivateFile(ANON, sub.proofFileId)).toBe(false);
  });

  it('shipping waybills: buyer of that order and the shipping seller only', async () => {
    const [doc] = await db.select({ fileId: shipmentDocuments.fileId }).from(shipmentDocuments).innerJoin(shipments, eq(shipments.id, shipmentDocuments.shipmentId)).where(eq(shipments.sellerOrderId, soId));
    expect(await canReadPrivateFile(buyer.actor, doc.fileId)).toBe(true);
    expect(await canReadPrivateFile(sellerA.actor, doc.fileId)).toBe(true);
    expect(await canReadPrivateFile(sellerB.actor, doc.fileId)).toBe(false);
    expect(await canReadPrivateFile(stranger.actor, doc.fileId)).toBe(false);
    expect(await canReadPrivateFile(ANON, doc.fileId)).toBe(false);
  });

  it('orders: other customers and other sellers cannot open them by id', async () => {
    await expect(orderForCustomer(buyer.actor, orderId)).resolves.toBeTruthy();
    await expect(orderForCustomer(stranger.actor, orderId)).rejects.toThrow();
    await expect(sellerOrderForSeller(sellerA.actor, soId)).resolves.toBeTruthy();
    await expect(sellerOrderForSeller(sellerB.actor, soId)).rejects.toThrow();
  });

  it('national ID and payout destination are stored encrypted and only masked values are kept in clear', async () => {
    const [s] = await db.select().from(sellers).where(eq(sellers.id, sellerA.actor.sellerId!));
    expect(s.nationalIdEnc).toBeTruthy();
    expect(s.nationalIdEnc).not.toContain('29001011234567');
    expect(s.nationalIdLast4).toBe('4567');
    const [pm] = await db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.sellerId, sellerA.actor.sellerId!));
    expect(pm.detailsEnc).not.toContain('@instapay');
    expect(pm.maskedLabel).not.toMatch(/^s\d+.*@instapay$/);
  });
});
