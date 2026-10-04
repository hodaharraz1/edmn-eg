import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireSeller, requireUser, type Actor } from '@/server/core/actor';
import { conflict, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { orderItems, orders, productReviews, products, reviewReports, sellerOrders, sellerReviews, sellers, users } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { storeUpload } from '@/server/storage/uploads';
import { parse, requireReason } from '../_shared';

/** Only verified purchases (delivered/completed seller orders of the reviewer) may be reviewed. */
async function verifiedSellerOrder(tx: DbOrTx, userId: string, soId: string) {
  const [row] = await tx
    .select({ so: sellerOrders, customerId: orders.customerId })
    .from(sellerOrders)
    .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
    .where(eq(sellerOrders.id, soId));
  if (!row) throw notFound('الطلب');
  if (row.customerId !== userId) throw forbidden();
  if (row.so.status !== 'DELIVERED' && row.so.status !== 'COMPLETED') throw invalidState('يمكن التقييم بعد تأكيد استلام الطلب');
  return row.so;
}

export async function refreshProductRating(tx: DbOrTx, productId: string) {
  await tx.execute(sql`
    update products set
      rating_avg = coalesce((select round(avg(rating)::numeric, 2) from product_reviews where product_id = ${productId} and status = 'PUBLISHED'), 0),
      rating_count = (select count(*) from product_reviews where product_id = ${productId} and status = 'PUBLISHED')
    where id = ${productId}`);
}

export async function refreshSellerRating(tx: DbOrTx, sellerId: string) {
  await tx.execute(sql`
    update sellers set
      rating_avg = coalesce((select round(avg(rating)::numeric, 2) from seller_reviews where seller_id = ${sellerId} and status = 'PUBLISHED'), 0),
      rating_count = (select count(*) from seller_reviews where seller_id = ${sellerId} and status = 'PUBLISHED'),
      positive_count = (select count(*) from seller_reviews where seller_id = ${sellerId} and status = 'PUBLISHED' and rating >= 4)
    where id = ${sellerId}`);
}

export const productReviewSchema = z.object({
  orderItemId: z.string().uuid(),
  rating: z.coerce.number().int().min(1, 'اختر التقييم').max(5),
  title: z.string().trim().max(120).optional().default(''),
  body: z.string().trim().max(3000).optional().default(''),
});

export async function createProductReview(actor: Actor, input: z.input<typeof productReviewSchema>, photos: { data: Buffer; name: string }[] = []) {
  const userId = requireUser(actor);
  const d = parse(productReviewSchema, input);
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(orderItems).where(eq(orderItems.id, d.orderItemId));
    if (!item) throw notFound('المنتج');
    await verifiedSellerOrder(tx, userId, item.sellerOrderId);
    const [dupe] = await tx.select({ id: productReviews.id }).from(productReviews).where(eq(productReviews.orderItemId, item.id));
    if (dupe) throw conflict('قمت بتقييم هذا المنتج بالفعل');
    const photoIds: string[] = [];
    for (const p of photos.slice(0, 4)) photoIds.push((await storeUpload(tx, actor, { purpose: 'REVIEW_PHOTO', data: p.data, originalName: p.name })).id);
    const [r] = await tx
      .insert(productReviews)
      .values({ orderItemId: item.id, productId: item.productId, customerId: userId, rating: d.rating, title: d.title || null, body: d.body || null, photoFileIds: photoIds })
      .returning();
    await refreshProductRating(tx, item.productId);
    const [p] = await tx.select({ sellerId: products.sellerId }).from(products).where(eq(products.id, item.productId));
    const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, p.sellerId));
    await notify(tx, { event: 'REVIEW_RECEIVED', userIds: [s.ownerUserId], vars: { rating: d.rating }, link: '/seller/reviews' });
    return r;
  });
}

export const sellerReviewSchema = z.object({
  sellerOrderId: z.string().uuid(),
  rating: z.coerce.number().int().min(1, 'اختر التقييم').max(5),
  deliveryRating: z.coerce.number().int().min(1).max(5).optional(),
  packagingRating: z.coerce.number().int().min(1).max(5).optional(),
  accuracyRating: z.coerce.number().int().min(1).max(5).optional(),
  communicationRating: z.coerce.number().int().min(1).max(5).optional(),
  body: z.string().trim().max(3000).optional().default(''),
});

export async function createSellerReview(actor: Actor, input: z.input<typeof sellerReviewSchema>) {
  const userId = requireUser(actor);
  const d = parse(sellerReviewSchema, input);
  return db.transaction(async (tx) => {
    const so = await verifiedSellerOrder(tx, userId, d.sellerOrderId);
    const [dupe] = await tx.select({ id: sellerReviews.id }).from(sellerReviews).where(eq(sellerReviews.sellerOrderId, so.id));
    if (dupe) throw conflict('قمت بتقييم هذا البائع على هذا الطلب بالفعل');
    const [r] = await tx
      .insert(sellerReviews)
      .values({ sellerOrderId: so.id, sellerId: so.sellerId, customerId: userId, rating: d.rating, deliveryRating: d.deliveryRating ?? null, packagingRating: d.packagingRating ?? null, accuracyRating: d.accuracyRating ?? null, communicationRating: d.communicationRating ?? null, body: d.body || null })
      .returning();
    await refreshSellerRating(tx, so.sellerId);
    return r;
  });
}

/** Sellers can respond to — but never delete or hide — reviews about them. */
export async function respondToReview(actor: Actor, type: 'PRODUCT' | 'SELLER', reviewId: string, response: string) {
  const sellerId = requireSeller(actor, 'reviews.respond');
  const text = response?.trim();
  if (!text || text.length < 2 || text.length > 1500) throw validation('الرد يجب أن يكون بين 2 و 1500 حرف');
  await db.transaction(async (tx) => {
    if (type === 'PRODUCT') {
      const [r] = await tx.select({ r: productReviews, sellerId: products.sellerId }).from(productReviews).innerJoin(products, eq(products.id, productReviews.productId)).where(eq(productReviews.id, reviewId));
      if (!r || r.sellerId !== sellerId) throw forbidden();
      await tx.update(productReviews).set({ sellerResponse: text, sellerRespondedAt: new Date() }).where(eq(productReviews.id, reviewId));
    } else {
      const [r] = await tx.select().from(sellerReviews).where(eq(sellerReviews.id, reviewId));
      if (!r || r.sellerId !== sellerId) throw forbidden();
      await tx.update(sellerReviews).set({ sellerResponse: text, sellerRespondedAt: new Date() }).where(eq(sellerReviews.id, reviewId));
    }
    await audit(tx, actor, { action: 'review.seller_responded', entityType: `${type.toLowerCase()}_review`, entityId: reviewId });
  });
}

export async function reportReview(actor: Actor, type: 'PRODUCT' | 'SELLER', reviewId: string, reason: string) {
  const userId = requireUser(actor);
  const why = requireReason(reason);
  await db.insert(reviewReports).values({ reviewType: type, reviewId, reporterUserId: userId, reason: why }).onConflictDoNothing();
}

/** Moderation under the published review policy; every action is audited. */
export async function moderateReview(actor: Actor, type: 'PRODUCT' | 'SELLER', reviewId: string, status: 'PUBLISHED' | 'HIDDEN' | 'REMOVED', reason: string) {
  requirePermission(actor, 'reviews.moderate');
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    if (type === 'PRODUCT') {
      const [r] = await tx.select().from(productReviews).where(eq(productReviews.id, reviewId)).for('update');
      if (!r) throw notFound('التقييم');
      await tx.update(productReviews).set({ status, moderationReason: why }).where(eq(productReviews.id, reviewId));
      await refreshProductRating(tx, r.productId);
      await audit(tx, actor, { action: 'review.moderated', entityType: 'product_review', entityId: reviewId, oldValues: { status: r.status }, newValues: { status }, reason: why });
    } else {
      const [r] = await tx.select().from(sellerReviews).where(eq(sellerReviews.id, reviewId)).for('update');
      if (!r) throw notFound('التقييم');
      await tx.update(sellerReviews).set({ status, moderationReason: why }).where(eq(sellerReviews.id, reviewId));
      await refreshSellerRating(tx, r.sellerId);
      await audit(tx, actor, { action: 'review.moderated', entityType: 'seller_review', entityId: reviewId, oldValues: { status: r.status }, newValues: { status }, reason: why });
    }
    await tx.update(reviewReports).set({ status: 'ACTIONED', handledBy: actor.userId }).where(and(eq(reviewReports.reviewType, type), eq(reviewReports.reviewId, reviewId)));
  });
}

export async function productReviewsPublic(productId: string, limit = 20) {
  return db
    .select({ r: productReviews, author: users.fullName })
    .from(productReviews)
    .innerJoin(users, eq(users.id, productReviews.customerId))
    .where(and(eq(productReviews.productId, productId), eq(productReviews.status, 'PUBLISHED')))
    .orderBy(desc(productReviews.createdAt))
    .limit(limit);
}

export async function sellerReviewsPublic(sellerId: string, limit = 20) {
  return db
    .select({ r: sellerReviews, author: users.fullName })
    .from(sellerReviews)
    .innerJoin(users, eq(users.id, sellerReviews.customerId))
    .where(and(eq(sellerReviews.sellerId, sellerId), eq(sellerReviews.status, 'PUBLISHED')))
    .orderBy(desc(sellerReviews.createdAt))
    .limit(limit);
}

export async function ratingHistogram(productId: string) {
  const rows = await db
    .select({ rating: productReviews.rating, n: sql<number>`count(*)::int` })
    .from(productReviews)
    .where(and(eq(productReviews.productId, productId), eq(productReviews.status, 'PUBLISHED')))
    .groupBy(productReviews.rating);
  return [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: rows.find((x) => x.rating === r)?.n ?? 0 }));
}

/** Short public display of a reviewer name: "أحمد م." */
export function reviewerDisplayName(full: string) {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1].charAt(0)}.` : parts[0];
}
