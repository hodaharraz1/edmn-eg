import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { adminActor, customerActor, sellerActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import {
  addresses,
  categories,
  orderItems,
  paymentDestinations,
  paymentMethods,
  paymentSubmissions,
  payments,
  productVariants,
  roles,
  sellerOrders,
  sellerShippingRates,
  userRoles,
  users,
} from '@/server/db/schema';
import { hashPassword } from '@/server/auth/password';
import { addImages, createDraft, moderateProduct, saveVariants, submitForReview, updateDetails, updateLogistics } from '@/server/modules/catalog/products';
import { addToCart, cartLines } from '@/server/modules/commerce/cart';
import { placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import { confirmSellerOrder, markShipped, saveShipment } from '@/server/modules/commerce/fulfilment';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { addPayoutMethod, decideSeller, saveIdentity, saveStore, startApplication, submitApplication, uploadSellerDocument } from '@/server/modules/sellers/service';

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e4)}`;
let phoneSeq = 10_000_000 + Math.floor(Math.random() * 80_000_000);
const nextPhone = () => `+2010${String(phoneSeq++).padStart(8, '0')}`;

let PASSWORD_HASH: string | null = null;

export async function makeUser(opts: { staff?: boolean; roles?: string[]; name?: string } = {}) {
  PASSWORD_HASH ??= await hashPassword('Test@12345');
  const [u] = await db
    .insert(users)
    .values({
      email: `u-${uniq()}@test.local`,
      phone: nextPhone(),
      fullName: opts.name ?? 'مستخدم اختبار',
      passwordHash: PASSWORD_HASH,
      isStaff: !!opts.staff,
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
    })
    .returning();
  for (const r of opts.roles ?? []) {
    const [exists] = await db.select().from(roles).where(eq(roles.code, r));
    if (!exists) throw new Error(`role ${r} not seeded`);
    await db.insert(userRoles).values({ userId: u.id, roleCode: r });
  }
  return u;
}

export async function makeAdmin(rolesList: string[] = ['SUPER_ADMIN']) {
  const u = await makeUser({ staff: true, roles: rolesList });
  return adminActor(u.id, { stepUpAt: new Date() });
}

export async function makeCustomer() {
  const u = await makeUser({ name: 'عميل اختبار' });
  const [address] = await db
    .insert(addresses)
    .values({ userId: u.id, recipientName: u.fullName, phone: u.phone!, governorateId: 1, city: 'القاهرة', street: 'شارع الاختبار', isDefault: true })
    .returning();
  return { user: u, actor: customerActor(u.id), address };
}

export async function png(label = 'x', w = 400): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}"><rect width="${w}" height="${w}" fill="#3366${(label.length * 7) % 99}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'ascii');

export async function ensurePaymentSetup() {
  await db.update(paymentMethods).set({ isEnabled: true });
  const [d] = await db.select().from(paymentDestinations).limit(1);
  if (!d) {
    await db.insert(paymentDestinations).values([
      { methodCode: 'INSTAPAY', label: 'TEST', details: { instapayAddress: 'test@instapay' } },
      { methodCode: 'BANK_TRANSFER', label: 'TEST', details: { bankName: 'T', accountName: 'T', accountNumber: '1' } },
      { methodCode: 'VODAFONE_CASH', label: 'TEST', details: { walletNumber: '0' } },
    ]);
  }
}

/** Fully onboarded, APPROVED seller shipping to every governorate. */
export async function makeSeller(admin: Actor, opts: { type?: 'INDIVIDUAL' | 'BUSINESS' } = {}) {
  const u = await makeUser({ name: 'بائع اختبار' });
  const a = customerActor(u.id);
  await startApplication(a, opts.type ?? 'INDIVIDUAL');
  await saveIdentity(a, { type: opts.type ?? 'INDIVIDUAL', legalName: 'بائع اختبار كامل', nationalId: '29001011234567', mobile: u.phone!, email: u.email!, addressLine: 'عنوان اختبار طويل', city: 'القاهرة', governorateId: 1 });
  await saveStore(a, { name: `متجر ${uniq()}`, description: 'متجر اختبار', returnAddress: 'عنوان الإرجاع للاختبار', returnGovernorateId: 1 });
  await uploadSellerDocument(a, 'NATIONAL_ID_FRONT', { data: await png('f'), name: 'f.png' });
  await uploadSellerDocument(a, 'NATIONAL_ID_BACK', { data: await png('b'), name: 'b.png' });
  await addPayoutMethod(a, { type: 'INSTAPAY', holderName: 'بائع اختبار', instapayAddress: `s${uniq()}@instapay` });
  await submitApplication(a, true);
  const pre = (await sellerActor(u.id))!;
  await decideSeller(admin, pre.sellerId!, 'APPROVE');
  await db.update(sellerShippingRates).set({ enabled: true, fee: 5000, etaMinDays: 1, etaMaxDays: 3 }).where(eq(sellerShippingRates.sellerId, pre.sellerId!));
  return { user: u, actor: (await sellerActor(u.id))! };
}

export async function categoryId(slug: string) {
  const [c] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug));
  return c.id;
}

/** LIVE product with one variant. */
export async function makeProduct(
  seller: Actor,
  admin: Actor,
  opts: { price?: number; stock?: number; category?: string; condition?: 'NEW' | 'USED'; title?: string; approve?: boolean; setReturnPolicy?: boolean; attributes?: Record<string, string[]> } = {},
) {
  const cat = await categoryId(opts.category ?? 'electronics-accessories');
  const title = opts.title ?? `منتج اختبار ${uniq()}`;
  const p = await createDraft(seller, { categoryId: cat, titleAr: title, condition: opts.condition ?? 'NEW' });
  await updateDetails(seller, p.id, {
    titleAr: title,
    categoryId: cat,
    description: 'وصف تفصيلي لمنتج الاختبار يتجاوز عشرين حرفاً',
    keyFeatures: ['ميزة'],
    condition: opts.condition ?? 'NEW',
    usedGrade: opts.condition === 'USED' ? 'GOOD' : null,
    conditionNotes: opts.condition === 'USED' ? 'حالة جيدة' : '',
    defects: opts.condition === 'USED' ? 'لا يوجد' : '',
    attributes: opts.attributes ?? {},
  });
  await addImages(seller, p.id, [{ data: await png('1'), name: '1.png' }, { data: await png('2'), name: '2.png' }], opts.condition === 'USED');
  await saveVariants(seller, p.id, [{ sku: `SKU-${uniq()}`, price: opts.price ?? 10000, stockOnHand: opts.stock ?? 10, options: {}, isActive: true, lowStockThreshold: 1 }]);
  // Every listing needs an explicit return policy before submission (here: the store default).
  if (opts.setReturnPolicy !== false) await updateLogistics(seller, p.id, { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, processingDays: null, returnPolicyOverride: false, acceptsVoluntaryReturns: null, voluntaryReturnDays: null });
  if (opts.approve === false) return { productId: p.id, variantId: await variantOf(p.id) };
  await submitForReview(seller, p.id);
  await moderateProduct(admin, p.id, 'APPROVE');
  return { productId: p.id, variantId: await variantOf(p.id) };
}

export async function variantOf(productId: string) {
  const [v] = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
  return v.id;
}

export async function checkout(c: Awaited<ReturnType<typeof makeCustomer>>, items: { variantId: string; qty: number }[], key = randomUUID()) {
  await ensurePaymentSetup();
  for (const i of items) await addToCart({ userId: c.user.id }, i.variantId, i.qty);
  const lines = await cartLines(db, { userId: c.user.id });
  const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
  const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'INSTAPAY', checkoutKey: key, expectedTotal: priced.grandTotal });
  return order;
}

export async function paymentOf(orderId: string) {
  const [p] = await db.select().from(payments).where(eq(payments.orderId, orderId));
  return p;
}

export async function submitAndConfirm(c: { actor: Actor }, orderId: string, admin: Actor) {
  const p = await paymentOf(orderId);
  const { submission } = await submitProof(c.actor, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png('proof'), name: 'proof.png' });
  await confirmPayment(admin, p.id, submission.id);
  return { payment: p, submission };
}

export async function sellerOrdersOf(orderId: string) {
  return db.select().from(sellerOrders).where(eq(sellerOrders.orderId, orderId)).orderBy(sellerOrders.suffix);
}

export async function shipIt(seller: Actor, soId: string) {
  await confirmSellerOrder(seller, soId);
  await saveShipment(seller, soId, { carrierName: 'بوسطة', trackingNumber: 'T1', shippedAt: new Date() }, { data: pdf(), name: 'waybill.pdf' });
  await markShipped(seller, soId);
}

export async function itemsOf(soId: string) {
  return db.select().from(orderItems).where(eq(orderItems.sellerOrderId, soId));
}

export async function pendingSubmission(paymentId: string) {
  const [s] = await db.select().from(paymentSubmissions).where(and(eq(paymentSubmissions.paymentId, paymentId), eq(paymentSubmissions.status, 'SUBMITTED')));
  return s;
}
