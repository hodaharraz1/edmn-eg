import { LEGAL_V11_VERSION as LEGAL_VERSION } from '@/server/db/seed/legal-texts-v1_1';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { customerActor, sellerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { auditLogs, productRevisions, products, sellers, statusHistory } from '@/server/db/schema';
import { addImages, createDraft, moderateProduct, moderateRevision, submitForReview, updateDetails, updateLogistics, saveVariants } from '@/server/modules/catalog/products';
import { addPayoutMethod, decideSeller, saveIdentity, saveStore, startApplication, submitApplication, uploadSellerDocument } from '@/server/modules/sellers/service';
import { searchProducts } from '@/server/modules/catalog/search';
import { categoryId, makeAdmin, makeProduct, makeSeller, makeUser, png } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
});

describe('seller onboarding & approval', () => {
  it('requires a complete application, records agreement version, and needs admin approval', async () => {
    const u = await makeUser();
    const a = customerActor(u.id);
    await startApplication(a, 'INDIVIDUAL');
    await expect(submitApplication(a, true)).rejects.toThrow(/غير مكتمل/);
    await saveIdentity(a, { type: 'INDIVIDUAL', legalName: 'اسم قانوني كامل', nationalId: '29001011234567', mobile: u.phone!, email: u.email!, addressLine: 'عنوان كامل', city: 'القاهرة', governorateId: 1 });
    await saveStore(a, { name: 'متجر الموافقة', returnAddress: 'عنوان الإرجاع', returnGovernorateId: 1 });
    await uploadSellerDocument(a, 'NATIONAL_ID_FRONT', { data: await png(), name: 'f.png' });
    await uploadSellerDocument(a, 'NATIONAL_ID_BACK', { data: await png(), name: 'b.png' });
    await addPayoutMethod(a, { type: 'MOBILE_WALLET', holderName: 'اسم', walletProvider: 'فودافون كاش', walletNumber: '01012345678' });
    await expect(submitApplication(a, false)).rejects.toThrow(/اتفاقية/);
    await submitApplication(a, true);
    const sa = (await sellerActor(u.id))!;
    const [s] = await db.select().from(sellers).where(eq(sellers.id, sa.sellerId!));
    expect(s.status).toBe('PENDING_REVIEW');
    expect(s.agreementVersion).toBe(LEGAL_VERSION);
    expect(s.nationalIdEnc).not.toContain('29001011234567');
    expect(s.nationalIdLast4).toBe('4567');

    // An unapproved seller cannot create listings
    await expect(createDraft(sa, { categoryId: await categoryId('books'), titleAr: 'كتاب اختبار', condition: 'NEW' })).rejects.toThrow(/غير مفعّل/);

    // Sensitive decisions require a reason
    await expect(decideSeller(admin, s.id, 'REJECT', '')).rejects.toThrow();
    await decideSeller(admin, s.id, 'REQUEST_MORE_INFORMATION', 'صورة البطاقة غير واضحة');
    await submitApplication(a, true);
    await decideSeller(admin, s.id, 'APPROVE');
    const [after] = await db.select().from(sellers).where(eq(sellers.id, s.id));
    expect(after.status).toBe('APPROVED');
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'seller'), eq(auditLogs.entityId, s.id)));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(['seller.request_more_information', 'seller.approve']));
    const hist = await db.select().from(statusHistory).where(eq(statusHistory.entityId, s.id));
    expect(hist.map((h) => h.toStatus)).toEqual(expect.arrayContaining(['PENDING_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED']));
  });

  it('low-privilege admins cannot approve sellers', async () => {
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    const { actor } = await makeSeller(admin);
    await expect(decideSeller(support, actor.sellerId!, 'SUSPEND', 'سبب الإيقاف')).rejects.toThrow(/صلاحية/);
  });
});

describe('product moderation', () => {
  it('a seller product is not live until approved; rejection reasons are visible', async () => {
    const { actor: seller } = await makeSeller(admin);
    const { productId } = await makeProduct(seller, admin, { approve: false });
    await submitForReview(seller, productId);
    let [p] = await db.select().from(products).where(eq(products.id, productId));
    expect(p.status).toBe('SUBMITTED');
    const hits = await searchProducts({ q: p.titleAr });
    expect(hits.items.find((x) => x.id === productId)).toBeUndefined();
    await expect(moderateProduct(admin, productId, 'REJECT', '')).rejects.toThrow();
    await moderateProduct(admin, productId, 'REQUEST_CHANGES', 'الصور غير واضحة');
    [p] = await db.select().from(products).where(eq(products.id, productId));
    expect(p.status).toBe('REJECTED');
    expect(p.statusReason).toBe('الصور غير واضحة');
    await submitForReview(seller, productId);
    await moderateProduct(admin, productId, 'APPROVE');
    [p] = await db.select().from(products).where(eq(products.id, productId));
    expect(p.status).toBe('LIVE');
  });

  it('EDGE 14 — used product without enough actual-item photos cannot be submitted', async () => {
    const { actor: seller } = await makeSeller(admin);
    const cat = await categoryId('mobile-phones');
    const d = await createDraft(seller, { categoryId: cat, titleAr: 'موبايل مستعمل للاختبار', condition: 'USED' });
    await updateDetails(seller, d.id, { titleAr: 'موبايل مستعمل للاختبار', categoryId: cat, description: 'وصف تفصيلي للموبايل المستعمل', condition: 'USED', usedGrade: 'GOOD', conditionNotes: 'حالة جيدة', defects: 'خدش', attributes: { model: ['X1'], storage: ['128GB'] } });
    await addImages(seller, d.id, [{ data: await png('stock'), name: 's.png' }], false); // generic catalog image only
    await saveVariants(seller, d.id, [{ sku: 'USED-1', price: 100000, stockOnHand: 1, options: {}, isActive: true, lowStockThreshold: 0 }]);
    await updateLogistics(seller, d.id, { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, processingDays: null, returnPolicyOverride: true, acceptsVoluntaryReturns: false, voluntaryReturnDays: null });
    await expect(submitForReview(seller, d.id)).rejects.toThrow(/صور فعلية/);
    await addImages(seller, d.id, [{ data: await png('real1'), name: 'r1.png' }, { data: await png('real2'), name: 'r2.png' }], true);
    await expect(submitForReview(seller, d.id)).resolves.toBe('SUBMITTED');
  });

  it('material edits to a live listing are staged for re-review, the live version is unchanged', async () => {
    const { actor: seller } = await makeSeller(admin);
    const { productId } = await makeProduct(seller, admin);
    const [before] = await db.select().from(products).where(eq(products.id, productId));
    const res = await updateDetails(seller, productId, { titleAr: 'منتج مختلف تماماً الآن', categoryId: before.categoryId!, description: before.description!, condition: 'NEW', attributes: {} });
    expect(res.staged).toBe(true);
    const [still] = await db.select().from(products).where(eq(products.id, productId));
    expect(still.titleAr).toBe(before.titleAr);
    expect(still.status).toBe('LIVE');
    const [rev] = await db.select().from(productRevisions).where(eq(productRevisions.productId, productId));
    expect(rev.changedFields).toContain('titleAr');
    await moderateRevision(admin, rev.id, true);
    const [after] = await db.select().from(products).where(eq(products.id, productId));
    expect(after.titleAr).toBe('منتج مختلف تماماً الآن');
  });

  it('prohibited keywords block submission; restricted categories are flagged for enhanced review', async () => {
    const { actor: seller } = await makeSeller(admin);
    const { productId } = await makeProduct(seller, admin, { approve: false, title: 'مسدس صوت للبيع' });
    await expect(submitForReview(seller, productId)).rejects.toThrow(/المحظورة/);
    const { productId: p2 } = await makeProduct(seller, admin, { approve: false, category: 'health', title: 'جهاز قياس ضغط' });
    await submitForReview(seller, p2);
    const [row] = await db.select().from(products).where(eq(products.id, p2));
    expect(row.needsEnhancedReview).toBe(true);
  });

  it('search finds live products with Arabic normalization and typos', async () => {
    const { actor: seller } = await makeSeller(admin);
    await makeProduct(seller, admin, { title: 'مكتبة خشبية أنيقة للمنزل' });
    expect((await searchProducts({ q: 'مكتبه خشبيه' })).total).toBeGreaterThan(0);
    expect((await searchProducts({ q: 'مكتبة خشبيا' })).total).toBeGreaterThan(0);
  });
});
