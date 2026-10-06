'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { addImages, archiveProduct, createDraft, markOutOfStock, removeImage, saveVariants, setListingActive, submitForReview, updateDetails, updateLogistics, withdrawSubmission } from '@/server/modules/catalog/products';
import { setStock } from '@/server/modules/catalog/inventory';
import { addTrackingEvent, advanceSellerOrder, cancelSellerOrder, confirmSellerOrder, markShipped, saveShipment, decideCancellationRequest, recordShipmentException, submitDeliveryEvidence } from '@/server/modules/commerce/fulfilment';
import { acceptReturnRefund, approveReturn, escalateReturn, markReturnReceived, rejectReturn, startInspection } from '@/server/modules/postpurchase/returns';
import { respondToReview } from '@/server/modules/reviews/service';
import { cancelWithdrawal, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { addPayoutMethod, addStaffMember, removeStaffMember, setShippingRates, updateStoreSettings } from '@/server/modules/sellers/service';
import { openTicket, replyToTicket } from '@/server/modules/support/service';
import { addDisputeMessage } from '@/server/modules/postpurchase/disputes';
import { beginTotpEnrollment, verifyTotpForUser } from '@/server/auth/service';
import { parseEgp } from '@/server/core/money';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { validation } from '@/server/core/errors';
import { bool, fileOf, filesOf, int, runAction, str, type ActionState } from '@/server/web/action';
import { requestMeta, requireSellerActor } from '@/server/web/session';

const money = (v: string, field: string) => {
  try {
    return parseEgp(v);
  } catch {
    throw validation(`قيمة غير صحيحة في ${field}`);
  }
};

/* ───────── Products ───────── */

export async function createProductAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/products/new');
  let id = '';
  const res = await runAction(async () => {
    const p = await createDraft(actor, { categoryId: str(fd, 'categoryId'), titleAr: str(fd, 'titleAr'), condition: str(fd, 'condition') === 'USED' ? 'USED' : 'NEW' });
    id = p.id;
  });
  if (res.ok) redirect(`/seller/products/${id}?step=details`);
  return res;
}

export async function productDetailsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/products');
  const id = str(fd, 'productId');
  const attributes: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('attr_') && typeof v === 'string' && v.trim()) {
      const code = k.slice(5);
      (attributes[code] ??= []).push(v.trim());
    }
  }
  let staged = false;
  const res = await runAction(async () => {
    const r = await updateDetails(actor, id, {
      titleAr: str(fd, 'titleAr'),
      titleEn: str(fd, 'titleEn'),
      brandId: str(fd, 'brandId') || null,
      categoryId: str(fd, 'categoryId'),
      description: str(fd, 'description'),
      keyFeatures: str(fd, 'keyFeatures').split('\n').map((s) => s.trim()).filter(Boolean),
      condition: str(fd, 'condition') === 'USED' ? 'USED' : 'NEW',
      usedGrade: (str(fd, 'usedGrade') || null) as 'GOOD' | null,
      conditionNotes: str(fd, 'conditionNotes'),
      defects: str(fd, 'defects'),
      includedAccessories: str(fd, 'includedAccessories'),
      usageInfo: str(fd, 'usageInfo'),
      warrantyInfo: str(fd, 'warrantyInfo'),
      attributes,
    });
    staged = r.staged;
    return { message: r.staged ? 'تم حفظ التعديلات وإرسالها للمراجعة. يظل الإعلان الحالي منشوراً حتى الموافقة.' : 'تم الحفظ' };
  });
  revalidatePath(`/seller/products/${id}`);
  if (res.ok && !staged && str(fd, 'next')) redirect(`/seller/products/${id}?step=${str(fd, 'next')}`);
  return res;
}

export async function productImagesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/products');
  const id = str(fd, 'productId');
  const res = await runAction(async () => {
    const r = await addImages(actor, id, await filesOf(fd, 'images'), bool(fd, 'isActualItem'));
    return { message: r.staged ? 'تم رفع الصور وإرسالها للمراجعة' : 'تم رفع الصور' };
  });
  revalidatePath(`/seller/products/${id}`);
  return res;
}

export async function removeImageAction(fd: FormData) {
  const actor = await requireSellerActor('/seller/products');
  await runAction(async () => removeImage(actor, str(fd, 'productId'), str(fd, 'fileId')));
  revalidatePath(`/seller/products/${str(fd, 'productId')}`);
}

export async function productVariantsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/products');
  const id = str(fd, 'productId');
  const rows = fd.getAll('row').map(String);
  const res = await runAction(async () => {
    const variants = rows
      .map((r) => {
        const sku = str(fd, `sku_${r}`);
        if (!sku && !str(fd, `price_${r}`)) return null;
        const options: Record<string, string> = {};
        for (const [k, v] of fd.entries()) {
          const m = k.match(/^opt_(\w+)_(.+)$/);
          if (m && m[2] === r && typeof v === 'string' && v) options[m[1]] = v;
        }
        return {
          id: str(fd, `id_${r}`) || undefined,
          sku,
          barcode: str(fd, `barcode_${r}`),
          options,
          price: money(str(fd, `price_${r}`), 'السعر'),
          compareAtPrice: str(fd, `compare_${r}`) ? money(str(fd, `compare_${r}`), 'السعر قبل الخصم') : null,
          stockOnHand: int(fd, `stock_${r}`) ?? 0,
          lowStockThreshold: int(fd, `low_${r}`) ?? 2,
          isActive: bool(fd, `active_${r}`),
        };
      })
      .filter((v): v is NonNullable<typeof v> => !!v);
    await saveVariants(actor, id, variants);
    return { message: 'تم حفظ الأسعار والمخزون' };
  });
  revalidatePath(`/seller/products/${id}`);
  if (res.ok && str(fd, 'next')) redirect(`/seller/products/${id}?step=${str(fd, 'next')}`);
  return res;
}

export async function productLogisticsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/products');
  const id = str(fd, 'productId');
  const override = str(fd, 'returnPolicy') !== 'STORE';
  const res = await runAction(async () => {
    await updateLogistics(actor, id, {
      weightGrams: int(fd, 'weightGrams') ?? null,
      lengthCm: int(fd, 'lengthCm') ?? null,
      widthCm: int(fd, 'widthCm') ?? null,
      heightCm: int(fd, 'heightCm') ?? null,
      processingDays: int(fd, 'processingDays') ?? null,
      returnPolicyOverride: override,
      acceptsVoluntaryReturns: override ? str(fd, 'returnPolicy') === 'ACCEPT' : null,
      voluntaryReturnDays: override && str(fd, 'returnPolicy') === 'ACCEPT' ? (int(fd, 'voluntaryReturnDays') ?? null) : null,
      returnConditionKeys: override && str(fd, 'returnPolicy') === 'ACCEPT' ? (fd.getAll('rp_conditions').map(String) as never) : [],
      returnShippingPayer: override ? ((str(fd, 'rp_shippingPayer') || 'BY_REASON') as never) : null,
      returnPolicyNotes: override ? str(fd, 'rp_notes') : '',
      seoTitle: str(fd, 'seoTitle'),
      seoDescription: str(fd, 'seoDescription'),
    });
    return { message: 'تم الحفظ' };
  });
  revalidatePath(`/seller/products/${id}`);
  if (res.ok && str(fd, 'next')) redirect(`/seller/products/${id}?step=${str(fd, 'next')}`);
  return res;
}

export async function submitProductAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/products');
  const id = str(fd, 'productId');
  const res = await runAction(async () => {
    const to = await submitForReview(actor, id);
    return { message: to === 'LIVE' ? 'تم نشر المنتج' : 'تم إرسال المنتج للمراجعة. سنبلغك فور اتخاذ القرار.' };
  });
  revalidatePath(`/seller/products/${id}`);
  return res;
}

export async function productControlAction(fd: FormData) {
  const actor = await requireSellerActor('/seller/products');
  const id = str(fd, 'productId');
  const op = str(fd, 'op');
  await runAction(async () => {
    if (op === 'activate') await setListingActive(actor, id, true);
    else if (op === 'deactivate') await setListingActive(actor, id, false);
    else if (op === 'archive') await archiveProduct(actor, id);
    else if (op === 'outofstock') await markOutOfStock(actor, id);
    else if (op === 'withdraw') await withdrawSubmission(actor, id);
  });
  revalidatePath('/seller/products');
  revalidatePath(`/seller/products/${id}`);
}

export async function setStockAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/inventory');
  const res = await runAction(async () => {
    await setStock(actor, str(fd, 'variantId'), int(fd, 'stockOnHand') ?? -1, int(fd, 'lowStockThreshold'));
    return { message: 'تم التحديث' };
  });
  revalidatePath('/seller/inventory');
  return res;
}

/* ───────── Orders & shipping ───────── */

export async function sellerOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/orders');
  const id = str(fd, 'sellerOrderId');
  const op = str(fd, 'op');
  const res = await runAction(async () => {
    if (op === 'confirm') await confirmSellerOrder(actor, id);
    else if (op === 'processing') await advanceSellerOrder(actor, id, 'PROCESSING');
    else if (op === 'ready') await advanceSellerOrder(actor, id, 'READY_TO_SHIP');
    else if (op === 'ship') await markShipped(actor, id);
    else if (op === 'cancel') await cancelSellerOrder(actor, id, str(fd, 'reason'), (['SELLER_UNABLE_TO_FULFIL', 'OUT_OF_STOCK', 'OTHER'].includes(str(fd, 'code')) ? str(fd, 'code') : 'SELLER_UNABLE_TO_FULFIL') as 'OTHER');
    else if (op === 'acceptCancel') await decideCancellationRequest(actor, str(fd, 'requestId'), true, str(fd, 'reason'));
    else if (op === 'deliveryEvidence') {
      const f = await fileOf(fd, 'evidence');
      await submitDeliveryEvidence(actor, id, { carrierReference: str(fd, 'carrierReference'), note: str(fd, 'note') }, f ? [f] : []);
    } else if (op === 'shipmentException') await recordShipmentException(actor, id, str(fd, 'code') as 'CARRIER_EXCEPTION', str(fd, 'reason'));
    else if (op === 'tracking') await addTrackingEvent(actor, id, { status: str(fd, 'status') as 'IN_TRANSIT', description: str(fd, 'description') });
    return { message: 'تم التحديث' };
  });
  revalidatePath(`/seller/orders/${id}`);
  return res;
}

export async function shipmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/orders');
  const id = str(fd, 'sellerOrderId');
  const res = await runAction(async () => {
    await saveShipment(actor, id, { carrierName: str(fd, 'carrierName'), trackingNumber: str(fd, 'trackingNumber'), shippedAt: str(fd, 'shippedAt') as unknown as Date, expectedDeliveryAt: str(fd, 'expectedDeliveryAt') ? (str(fd, 'expectedDeliveryAt') as unknown as Date) : null, note: str(fd, 'note') }, await fileOf(fd, 'waybill'));
    if (bool(fd, 'markShipped')) await markShipped(actor, id);
    return { message: bool(fd, 'markShipped') ? 'تم تسجيل الشحن وإبلاغ العميل' : 'تم حفظ بيانات الشحن' };
  });
  revalidatePath(`/seller/orders/${id}`);
  return res;
}

export async function shippingRatesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/shipping');
  const ids = fd.getAll('gov').map(String);
  const res = await runAction(async () => {
    await setShippingRates(
      actor,
      ids.map((g) => ({
        governorateId: Number(g),
        enabled: bool(fd, `en_${g}`),
        fee: str(fd, `fee_${g}`) ? money(str(fd, `fee_${g}`), 'سعر الشحن') : 0,
        etaMinDays: int(fd, `min_${g}`) ?? 1,
        etaMaxDays: int(fd, `max_${g}`) ?? 3,
      })),
    );
    return { message: 'تم حفظ أسعار الشحن' };
  });
  revalidatePath('/seller/shipping');
  return res;
}

/* ───────── Returns, reviews ───────── */

export async function sellerReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/returns');
  const id = str(fd, 'returnId');
  const op = str(fd, 'op');
  const res = await runAction(async () => {
    if (op === 'approve') await approveReturn(actor, id, str(fd, 'note'));
    else if (op === 'reject') await rejectReturn(actor, id, str(fd, 'reason'));
    else if (op === 'received') await markReturnReceived(actor, id);
    else if (op === 'inspect') await startInspection(actor, id);
    else if (op === 'refund') await acceptReturnRefund(actor, id, { amount: str(fd, 'amount') ? money(str(fd, 'amount'), 'المبلغ') : undefined, includeShipping: bool(fd, 'includeShipping'), restock: bool(fd, 'restock'), note: str(fd, 'note') });
    else if (op === 'dispute') await escalateReturn(actor, id, str(fd, 'reason'));
    return { message: 'تم التحديث' };
  });
  revalidatePath(`/seller/returns/${id}`);
  return res;
}

export async function respondReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/reviews');
  const res = await runAction(async () => {
    await respondToReview(actor, str(fd, 'type') === 'SELLER' ? 'SELLER' : 'PRODUCT', str(fd, 'reviewId'), str(fd, 'response'));
    return { message: 'تم نشر ردك' };
  });
  revalidatePath('/seller/reviews');
  return res;
}

export async function sellerDisputeMessageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/orders');
  return runAction(async () => addDisputeMessage(actor, str(fd, 'disputeId'), str(fd, 'body'), false, await fileOf(fd, 'attachment')));
}

/* ───────── Finance ───────── */

export async function requestWithdrawalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/withdrawals');
  const res = await runAction(async () => {
    const r = await requestWithdrawal(actor, { amount: str(fd, 'amount'), clientKey: str(fd, 'clientKey') });
    return { message: r.created ? `تم تقديم طلب السحب #${r.withdrawal.number}. المستهدف تنفيذه خلال 48 ساعة عمل.` : 'تم استلام هذا الطلب بالفعل.' };
  });
  revalidatePath('/seller/withdrawals');
  return res;
}

export async function cancelWithdrawalAction(fd: FormData) {
  const actor = await requireSellerActor('/seller/withdrawals');
  await runAction(async () => cancelWithdrawal(actor, str(fd, 'id')));
  revalidatePath('/seller/withdrawals');
}

/* ───────── Store & settings ───────── */

export async function storeSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/store');
  const res = await runAction(async () => {
    await updateStoreSettings(
      actor,
      {
        name: str(fd, 'name'),
        description: str(fd, 'description'),
        returnAddress: str(fd, 'returnAddress'),
        supportPhone: str(fd, 'supportPhone'),
        acceptsVoluntaryReturns: bool(fd, 'acceptsVoluntaryReturns'),
        voluntaryReturnDays: int(fd, 'voluntaryReturnDays') ?? null,
        returnConditions: str(fd, 'returnConditions'),
        returnConditionKeys: fd.getAll('rp_conditions').map(String) as never,
        returnShippingPayer: (str(fd, 'rp_shippingPayer') || 'BY_REASON') as never,
        shippingPolicy: str(fd, 'shippingPolicy'),
        defaultProcessingDays: int(fd, 'defaultProcessingDays') ?? 2,
        freeShippingThreshold: str(fd, 'freeShippingThreshold') ? money(str(fd, 'freeShippingThreshold'), 'حد الشحن المجاني') : null,
      },
      { logo: await fileOf(fd, 'logo'), banner: await fileOf(fd, 'banner') },
    );
    return { message: 'تم حفظ إعدادات المتجر' };
  });
  revalidatePath('/seller/store');
  return res;
}

export async function payoutMethodAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/settings');
  const [u] = await db.select().from(users).where(eq(users.id, actor.userId!));
  return runAction(async () => {
    // If the seller enabled 2FA, payout changes require a valid code (step-up).
    if (u.totpEnabledAt) {
      const ok = await verifyTotpForUser(u.id, str(fd, 'totp'), await requestMeta());
      if (!ok) throw validation('رمز المصادقة الثنائية غير صحيح');
    }
    const type = str(fd, 'payoutType');
    await addPayoutMethod(
      actor,
      type === 'BANK_ACCOUNT'
        ? { type: 'BANK_ACCOUNT', holderName: str(fd, 'holderName'), bankName: str(fd, 'bankName'), accountNumber: str(fd, 'accountNumber'), iban: str(fd, 'iban') }
        : type === 'MOBILE_WALLET'
          ? { type: 'MOBILE_WALLET', holderName: str(fd, 'holderName'), walletProvider: str(fd, 'walletProvider'), walletNumber: str(fd, 'walletNumber') }
          : { type: 'INSTAPAY', holderName: str(fd, 'holderName'), instapayAddress: str(fd, 'instapayAddress') },
    );
    revalidatePath('/seller/settings');
    return { message: 'تمت إضافة وسيلة السحب. لحمايتك يتم مراجعتها وتعليق السحب مؤقتاً.' };
  });
}

export async function staffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/settings');
  const res = await runAction(async () => {
    if (str(fd, 'op') === 'remove') await removeStaffMember(actor, str(fd, 'userId'));
    else await addStaffMember(actor, str(fd, 'email'), str(fd, 'role'));
    return { message: 'تم التحديث' };
  });
  revalidatePath('/seller/settings');
  return res;
}

export async function sellerTotpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/settings');
  const res = await runAction(async () => {
    if (str(fd, 'op') === 'begin') {
      const secret = await beginTotpEnrollment(actor.userId!);
      return { message: 'أضف هذا المفتاح لتطبيق المصادقة ثم أدخل الرمز للتأكيد', data: { secret } };
    }
    const ok = await verifyTotpForUser(actor.userId!, str(fd, 'code'), await requestMeta());
    if (!ok) return { ok: false, error: 'الرمز غير صحيح' };
    return { message: 'تم تفعيل المصادقة الثنائية' };
  });
  revalidatePath('/seller/settings');
  return res;
}

export async function sellerTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireSellerActor('/seller/support');
  let id = '';
  const res = await runAction(async () => {
    if (str(fd, 'ticketId')) {
      await replyToTicket(actor, str(fd, 'ticketId'), str(fd, 'body'), { attachment: await fileOf(fd, 'attachment') });
      return;
    }
    const t = await openTicket(actor, { type: str(fd, 'type') as 'SELLER', subject: str(fd, 'subject'), body: str(fd, 'body') }, await fileOf(fd, 'attachment'));
    id = t.id;
  });
  if (res.ok && id) redirect(`/seller/support?t=${id}`);
  revalidatePath('/seller/support');
  return res;
}
