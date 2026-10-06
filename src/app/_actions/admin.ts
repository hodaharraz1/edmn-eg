'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { hashPassword, passwordProblems, STAFF_POLICY } from '@/server/auth/password';
import { requirePermission, requireStepUp } from '@/server/core/actor';
import { parseEgp, parsePercentToBps } from '@/server/core/money';
import { validation } from '@/server/core/errors';
import { normalizeEgyptMobile } from '@/server/core/text';
import { db } from '@/server/db/client';
import { riskFlags, rolePermissions, roles, userRoles, users, notificationTemplates } from '@/server/db/schema';
import { addPolicyRule, saveAttribute, saveBrand, saveCategory, setCategoryAttribute, togglePolicyRule } from '@/server/modules/catalog/taxonomy';
import { moderateProduct, moderateRevision, type ModerationDecision } from '@/server/modules/catalog/products';
import {
  cancelSellerOrder,
  decideCancellationRequest,
  recordDeliveryEvent,
  recordShipmentException,
  releaseSellerOrder,
  resolveShipmentException,
  reviewDeliveryException,
  setFinancialHold,
} from '@/server/modules/commerce/fulfilment';
import type { CancellationReasonCode, ShipmentExceptionCode } from '@/domain/machines';
import { createRule, setRuleEnabled } from '@/server/modules/finance/commissions';
import { approveWithdrawal, createAdjustment, decideAdjustment, markDealPayoutPaid, markRefundPaid, markWithdrawalPaid, markWithdrawalProcessing, revealPayoutDetails, rejectWithdrawal, reviewWithdrawal, runScheduledSettlement } from '@/server/modules/finance/withdrawals';
import { confirmPayment, rejectPayment, saveDestination, startReview, updatePaymentMethod } from '@/server/modules/payments/service';
import { addDisputeMessage, assignDispute, closeDispute, resolveDispute, setDisputeStatus } from '@/server/modules/postpurchase/disputes';
import { acceptReturnRefund, approveReturn, rejectReturn } from '@/server/modules/postpurchase/returns';
import { moderateReview } from '@/server/modules/reviews/service';
import { decideSeller, revealNationalId, verifyPayoutMethod, type SellerDecision } from '@/server/modules/sellers/service';
import { replyToTicket, updateTicket } from '@/server/modules/support/service';
import { deleteBlock, publishLegal, saveBlock, saveLegalDraft, savePage, type BlockType, type LegalCode } from '@/server/modules/cms/service';
import { SETTINGS_SCHEMA, updateSetting, type SettingKey } from '@/server/modules/settings';
import { ALL_PERMISSIONS, type Permission } from '@/server/rbac/permissions';
import { bool, fileOf, int, runAction, str, type ActionState } from '@/server/web/action';
import { requireAdmin } from '@/server/web/session';

/** Runs an admin action; if a fresh 2FA step-up is required, sends the admin to re-authenticate. */
async function adminRun(fd: FormData, fn: (actor: Awaited<ReturnType<typeof requireAdmin>>) => Promise<ActionState | void>, revalidate?: string[]) {
  const actor = await requireAdmin();
  const res = await runAction(() => fn(actor));
  for (const p of (revalidate ?? []).filter(Boolean)) revalidatePath(p);
  const back = str(fd, 'back');
  if (res.code === 'STEP_UP_REQUIRED') redirect(`/admin/step-up?next=${encodeURIComponent(back || '/admin')}`);
  return res;
}
const done = (message = 'تم التنفيذ') => ({ message });
const money = (v: string) => {
  try {
    return parseEgp(v);
  } catch {
    throw validation('المبلغ غير صحيح');
  }
};

/* Sellers */
export async function sellerDecisionAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => { await decideSeller(a, str(fd, 'sellerId'), str(fd, 'decision') as SellerDecision, str(fd, 'reason')); return done('تم تسجيل القرار'); }, ['/admin/seller-verification', `/admin/sellers/${str(fd, 'sellerId')}`]);
}
export async function revealNationalIdAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => ({ message: 'تم الكشف (مسجل في سجل التدقيق)', data: { nationalId: await revealNationalId(a, str(fd, 'sellerId')) } }));
}
export async function verifyPayoutAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => { await verifyPayoutMethod(a, str(fd, 'payoutMethodId'), str(fd, 'decision') === 'approve', str(fd, 'reason')); return done(); }, [`/admin/sellers/${str(fd, 'sellerId')}`]);
}
export async function riskFlagAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    if (str(fd, 'op') === 'resolve') {
      const [flag] = await db.select().from(riskFlags).where(eq(riskFlags.id, str(fd, 'flagId')));
      if (!flag) throw validation('المؤشر غير موجود');
      // Deal delivery-review flags hold money: resolving one needs deal authority + a fresh 2FA and a reason.
      if (flag.entityType === 'external_deal') {
        requirePermission(a, 'deals.manage');
        requireStepUp(a);
        if (str(fd, 'reason').length < 3) throw validation('اكتب سبب إغلاق المؤشر');
      } else requirePermission(a, 'sellers.suspend');
      await db.update(riskFlags).set({ status: 'RESOLVED', resolvedBy: a.userId, resolvedAt: new Date() }).where(and(eq(riskFlags.id, flag.id), eq(riskFlags.status, 'OPEN')));
      await audit(db, a, { action: 'risk.flag_resolved', entityType: flag.entityType, entityId: flag.entityId, newValues: { flagId: flag.id, code: flag.code }, reason: str(fd, 'reason') || null });
      return done('تم إغلاق المؤشر');
    } else {
      requirePermission(a, 'sellers.suspend');
      const note = str(fd, 'note');
      if (note.length < 3) throw validation('اكتب الملاحظة');
      await db.insert(riskFlags).values({ entityType: str(fd, 'entityType'), entityId: str(fd, 'entityId'), code: str(fd, 'code') || 'MANUAL', severity: str(fd, 'severity') || 'MEDIUM', note, createdBy: a.userId });
    }
    await audit(db, a, { action: 'risk.flag_' + (str(fd, 'op') || 'added'), entityType: str(fd, 'entityType'), entityId: str(fd, 'entityId') });
    return done();
  }, [str(fd, 'back')]);
}

/* Catalog */
export async function categoryAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    await saveCategory(a, str(fd, 'id') || null, {
      parentId: str(fd, 'parentId') || null, nameAr: str(fd, 'nameAr'), nameEn: str(fd, 'nameEn'), slug: str(fd, 'slug'), descriptionAr: str(fd, 'descriptionAr'), icon: str(fd, 'icon'),
      isActive: bool(fd, 'isActive'), sortOrder: int(fd, 'sortOrder') ?? 0, seoTitle: str(fd, 'seoTitle'), seoDescription: str(fd, 'seoDescription'), isRestricted: bool(fd, 'isRestricted'), isProhibited: bool(fd, 'isProhibited'),
    }, await fileOf(fd, 'image'));
    return done('تم حفظ التصنيف');
  }, ['/admin/categories']);
}
export async function categoryAttributeAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    await setCategoryAttribute(a, str(fd, 'categoryId'), str(fd, 'attributeId'), str(fd, 'op') === 'remove' ? null : { isRequired: bool(fd, 'isRequired'), isFilterable: bool(fd, 'isFilterable'), isVariantAxis: bool(fd, 'isVariantAxis'), sortOrder: int(fd, 'sortOrder') ?? 0 });
    return done();
  }, ['/admin/categories']);
}
export async function brandAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => { await saveBrand(a, str(fd, 'id') || null, { name: str(fd, 'name'), nameAr: str(fd, 'nameAr'), slug: str(fd, 'slug'), isActive: bool(fd, 'isActive'), seoTitle: str(fd, 'seoTitle'), seoDescription: str(fd, 'seoDescription') }, await fileOf(fd, 'logo')); return done('تم الحفظ'); }, ['/admin/brands']);
}
export async function attributeAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const options = str(fd, 'options').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [value, labelAr] = l.split('|').map((x) => x.trim());
      return { value, labelAr: labelAr || value };
    });
    await saveAttribute(a, str(fd, 'id') || null, { code: str(fd, 'code'), nameAr: str(fd, 'nameAr'), nameEn: str(fd, 'nameEn'), type: str(fd, 'type') as 'TEXT', unit: str(fd, 'unit'), options });
    return done('تم الحفظ');
  }, ['/admin/attributes']);
}
export async function policyRuleAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    if (str(fd, 'op') === 'toggle') await togglePolicyRule(a, str(fd, 'id'), bool(fd, 'isActive'), str(fd, 'reason'));
    else await addPolicyRule(a, { kind: str(fd, 'kind') as 'BLOCK_KEYWORD', pattern: str(fd, 'pattern'), reasonCode: str(fd, 'reasonCode'), description: str(fd, 'description') });
    return done();
  }, ['/admin/policy']);
}
export async function moderateProductAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => { await moderateProduct(a, str(fd, 'productId'), str(fd, 'decision') as ModerationDecision, str(fd, 'reason'), str(fd, 'reasonCode') || null); return done('تم تسجيل القرار'); }, ['/admin/moderation', `/admin/products/${str(fd, 'productId')}`]);
}
export async function moderateRevisionAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => { await moderateRevision(a, str(fd, 'revisionId'), str(fd, 'decision') === 'approve', str(fd, 'reason')); return done('تم تسجيل القرار'); }, ['/admin/moderation']);
}

/* Payments */
export async function paymentDecisionAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const op = str(fd, 'op');
    if (op === 'review') await startReview(a, str(fd, 'paymentId'));
    else if (op === 'confirm') {
      const r = await confirmPayment(a, str(fd, 'paymentId'), str(fd, 'submissionId'), str(fd, 'note'));
      return done(r.alreadyConfirmed ? 'تم تأكيد هذا الدفع مسبقاً (لم يتم تكرار أي قيد)' : 'تم تأكيد الدفع وإبلاغ العميل والبائعين');
    } else await rejectPayment(a, str(fd, 'paymentId'), str(fd, 'submissionId'), str(fd, 'reason'), op === 'newproof');
    return done();
  }, ['/admin/payments', `/admin/payments/${str(fd, 'paymentId')}`]);
}
export async function destinationAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const details: Record<string, string> = {};
    for (const k of ['bankName', 'accountName', 'accountNumber', 'iban', 'instapayAddress', 'walletNumber']) if (str(fd, k)) details[k] = str(fd, k);
    await saveDestination(a, str(fd, 'id') || null, { methodCode: str(fd, 'methodCode') as 'INSTAPAY', label: str(fd, 'label'), details, instructionsAr: str(fd, 'instructionsAr'), isEnabled: bool(fd, 'isEnabled'), isTest: bool(fd, 'isTest'), sortOrder: int(fd, 'sortOrder') ?? 0 }, str(fd, 'reason'));
    return done('تم الحفظ');
  }, ['/admin/payment-settings']);
}
export async function paymentMethodAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => { await updatePaymentMethod(a, str(fd, 'code') as 'INSTAPAY', { isEnabled: bool(fd, 'isEnabled'), instructionsAr: str(fd, 'instructionsAr'), sortOrder: int(fd, 'sortOrder') ?? 0 }, str(fd, 'reason')); return done('تم الحفظ'); }, ['/admin/payment-settings']);
}

/* Orders, returns, disputes */
export async function adminOrderAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const op = str(fd, 'op');
    const so = str(fd, 'sellerOrderId');
    if (op === 'cancel') await cancelSellerOrder(a, so, str(fd, 'reason'), (str(fd, 'code') || 'ADMIN_OPERATIONAL') as CancellationReasonCode);
    else if (op === 'hold') await setFinancialHold(a, so, true, str(fd, 'reason'));
    else if (op === 'release') await setFinancialHold(a, so, false, str(fd, 'reason'));
    else if (op === 'releaseFunds') await releaseSellerOrder(a, so, { expectedSellerAmount: Number(str(fd, 'expectedAmount')), reason: str(fd, 'reason') });
    else if (op === 'deliveryEvent') await recordDeliveryEvent(a, so, { reference: str(fd, 'reference') });
    else if (op === 'establishDelivery') await reviewDeliveryException(a, so, 'ESTABLISH', str(fd, 'reason'));
    else if (op === 'shipmentException') await recordShipmentException(a, so, str(fd, 'code') as ShipmentExceptionCode, str(fd, 'reason'));
    else if (op === 'reship') await resolveShipmentException(a, so, 'RESHIP', str(fd, 'reason'));
    else if (op === 'returnedToSeller') await resolveShipmentException(a, so, 'RETURNED_TO_SELLER', str(fd, 'reason'));
    else if (op === 'lost') await resolveShipmentException(a, so, 'LOST', str(fd, 'reason'));
    else if (op === 'acceptCancellation') await decideCancellationRequest(a, str(fd, 'requestId'), true, str(fd, 'reason'));
    else if (op === 'rejectCancellation') await decideCancellationRequest(a, str(fd, 'requestId'), false, str(fd, 'reason'));
    return done();
  }, [str(fd, 'back')]);
}
export async function adminReturnAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const op = str(fd, 'op');
    const id = str(fd, 'returnId');
    if (op === 'approve') await approveReturn(a, id, str(fd, 'note'));
    else if (op === 'reject') await rejectReturn(a, id, str(fd, 'reason'));
    else if (op === 'refund') await acceptReturnRefund(a, id, { amount: str(fd, 'amount') ? money(str(fd, 'amount')) : undefined, includeShipping: bool(fd, 'includeShipping'), restock: bool(fd, 'restock'), note: str(fd, 'note') });
    return done();
  }, ['/admin/returns']);
}
export async function disputeAdminAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const op = str(fd, 'op');
    const id = str(fd, 'disputeId');
    if (op === 'message') await addDisputeMessage(a, id, str(fd, 'body'), bool(fd, 'internal'), await fileOf(fd, 'attachment'));
    else if (op === 'status') await setDisputeStatus(a, id, str(fd, 'status') as 'UNDER_REVIEW', str(fd, 'note'));
    else if (op === 'assign') await assignDispute(a, id, a.userId!);
    else if (op === 'resolve') await resolveDispute(a, id, { decision: str(fd, 'decision') as 'FULL_REFUND', amount: str(fd, 'amount'), reasonCode: str(fd, 'reasonCode'), note: str(fd, 'note') });
    else if (op === 'close') await closeDispute(a, id);
    return done();
  }, [`/admin/disputes/${str(fd, 'disputeId')}`]);
}
export async function reviewModerationAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => { await moderateReview(a, str(fd, 'type') as 'PRODUCT', str(fd, 'reviewId'), str(fd, 'status') as 'HIDDEN', str(fd, 'reason')); return done(); }, ['/admin/reviews']);
}
export async function ticketAdminAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const id = str(fd, 'ticketId');
    if (str(fd, 'op') === 'reply') await replyToTicket(a, id, str(fd, 'body'), { internal: bool(fd, 'internal'), attachment: await fileOf(fd, 'attachment') });
    else await updateTicket(a, id, { status: (str(fd, 'status') || undefined) as 'RESOLVED' | undefined, priority: (str(fd, 'priority') || undefined) as 'HIGH' | undefined, assigneeId: str(fd, 'assign') === 'me' ? a.userId : undefined });
    return done();
  }, [`/admin/support/${str(fd, 'ticketId')}`]);
}

/* Finance */
export async function commissionRuleAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    if (str(fd, 'op') === 'toggle') {
      await setRuleEnabled(a, str(fd, 'ruleId'), bool(fd, 'isEnabled'), str(fd, 'reason'));
      return done();
    }
    const tiers = str(fd, 'tiers').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [upTo, pct] = l.split(':').map((x) => x.trim());
      return { upTo: upTo === '*' || upTo === '' ? null : money(upTo), bps: parsePercentToBps(pct) };
    });
    await createRule(a, {
      categoryId: str(fd, 'categoryId') || null,
      label: str(fd, 'label'),
      percentBps: parsePercentToBps(str(fd, 'percent')),
      minFee: str(fd, 'minFee') ? money(str(fd, 'minFee')) : null,
      tiers: tiers.length ? tiers : null,
      effectiveFrom: str(fd, 'effectiveFrom') ? new Date(str(fd, 'effectiveFrom')) : new Date(),
      notes: str(fd, 'notes'),
    });
    return done('تمت إضافة نسخة جديدة من قاعدة العمولة (الطلبات السابقة لا تتأثر)');
  }, ['/admin/commissions']);
}
export async function withdrawalAdminAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const op = str(fd, 'op');
    const id = str(fd, 'withdrawalId');
    if (op === 'review') await reviewWithdrawal(a, id);
    else if (op === 'approve') await approveWithdrawal(a, id, str(fd, 'note'));
    else if (op === 'processing') await markWithdrawalProcessing(a, id);
    else if (op === 'paid') await markWithdrawalPaid(a, id, str(fd, 'reference'), await fileOf(fd, 'proof'));
    else if (op === 'reject') await rejectWithdrawal(a, id, str(fd, 'reason'));
    return done();
  }, ['/admin/withdrawals', `/admin/withdrawals/${str(fd, 'withdrawalId')}`]);
}
export async function revealPayoutAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const rows = await revealPayoutDetails(a, str(fd, 'kind') === 'deal_payout' ? 'deal_payout' : 'withdrawal', str(fd, 'id'));
    return { data: { payout: rows } };
  });
}
export async function refundPaidAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    if (str(fd, 'kind') === 'deal') await markDealPayoutPaid(a, str(fd, 'id'), str(fd, 'reference'), await fileOf(fd, 'proof'));
    else await markRefundPaid(a, str(fd, 'id'), str(fd, 'reference'), await fileOf(fd, 'proof'));
    return done('تم تسجيل الصرف');
  }, ['/admin/refunds']);
}
export async function adjustmentAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const op = str(fd, 'op');
    if (op === 'create') await createAdjustment(a, { sellerId: str(fd, 'sellerId'), amount: str(fd, 'amount'), reasonCode: str(fd, 'reasonCode'), reason: str(fd, 'reason') });
    else await decideAdjustment(a, str(fd, 'adjustmentId'), op === 'approve', str(fd, 'reason'));
    return done();
  }, ['/admin/ledger']);
}
export async function runSettlementAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    requirePermission(a, 'settlements.manage');
    const r = await runScheduledSettlement(new Date());
    return done('created' in r && r.created ? `تم إنشاء ${r.created} طلب سحب ضمن التسوية` : `لم يتم إنشاء طلبات (${'skipped' in r ? r.skipped : 'لا يوجد بائعون مؤهلون'})`);
  }, ['/admin/withdrawals']);
}

/* CMS & legal */
export async function cmsBlockAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    if (str(fd, 'op') === 'disable') {
      await deleteBlock(a, str(fd, 'id'));
      return done();
    }
    let data: unknown;
    try {
      data = JSON.parse(str(fd, 'data') || '{}');
    } catch {
      throw validation('بيانات JSON غير صالحة');
    }
    await saveBlock(a, str(fd, 'id') || null, { placement: str(fd, 'placement') || 'HOME', type: str(fd, 'type') as BlockType, title: str(fd, 'title'), data, isActive: bool(fd, 'isActive'), sortOrder: int(fd, 'sortOrder') ?? 0 }, await fileOf(fd, 'image'));
    return done('تم الحفظ');
  }, ['/admin/cms', '/']);
}
export async function cmsPageAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => { await savePage(a, str(fd, 'id') || null, { slug: str(fd, 'slug'), title: str(fd, 'title'), body: str(fd, 'body'), isPublished: bool(fd, 'isPublished') }); return done('تم الحفظ'); }, ['/admin/cms']);
}
export async function legalAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const code = str(fd, 'code') as LegalCode;
    if (str(fd, 'op') === 'publish') await publishLegal(a, code, str(fd, 'version'), bool(fd, 'approvedByCounsel'), str(fd, 'reason'));
    else await saveLegalDraft(a, code, str(fd, 'version'), str(fd, 'title'), str(fd, 'body'));
    return done('تم الحفظ');
  }, ['/admin/legal']);
}
export async function templateAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    requirePermission(a, 'notifications.manage');
    const values = { event: str(fd, 'event'), channel: str(fd, 'channel'), subject: str(fd, 'subject') || null, body: str(fd, 'body'), isEnabled: bool(fd, 'isEnabled'), updatedBy: a.userId };
    if (values.body.length < 3) throw validation('نص القالب مطلوب');
    await db.insert(notificationTemplates).values(values).onConflictDoUpdate({ target: [notificationTemplates.event, notificationTemplates.channel], set: values });
    await audit(db, a, { action: 'notifications.template_saved', entityType: 'notification_template', entityId: `${values.event}:${values.channel}` });
    return done('تم الحفظ');
  }, ['/admin/notifications']);
}

/* Settings & roles */
export async function settingAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const key = str(fd, 'key') as SettingKey;
    if (!(key in SETTINGS_SCHEMA)) throw validation('إعداد غير معروف');
    const raw = str(fd, 'value');
    let value: unknown = raw;
    if (raw === 'true' || raw === 'false') value = raw === 'true';
    else if (/^-?\d+$/.test(raw)) value = Number(raw);
    else if (raw.startsWith('[')) {
      try {
        value = JSON.parse(raw);
      } catch {
        throw validation('قيمة غير صالحة');
      }
    }
    await updateSetting(a, key, value, str(fd, 'reason'));
    return done('تم الحفظ');
  }, ['/admin/settings']);
}
export async function rolePermissionAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    requirePermission(a, 'roles.manage');
    requireStepUp(a);
    const role = str(fd, 'role');
    if (role === 'SUPER_ADMIN') throw validation('لا يمكن تعديل صلاحيات المدير العام');
    const perms = fd.getAll('perm').map(String).filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
    // No self-escalation: you cannot change a role you hold, and only a super admin can hand out role management.
    const mine = await db.select({ code: userRoles.roleCode }).from(userRoles).where(eq(userRoles.userId, a.userId!));
    if (mine.some((m) => m.code === role)) throw validation('لا يمكنك تعديل صلاحيات دور تحمله أنت');
    if (perms.includes('roles.manage' as Permission) && !mine.some((m) => m.code === 'SUPER_ADMIN')) throw validation('منح صلاحية إدارة الأدوار متاح للمدير العام فقط');
    const old = await db.select().from(rolePermissions).where(eq(rolePermissions.roleCode, role));
    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleCode, role));
      if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ roleCode: role, permission: p })));
      await audit(tx, a, { action: 'rbac.role_permissions_changed', entityType: 'role', entityId: role, oldValues: { permissions: old.map((o) => o.permission) }, newValues: { permissions: perms }, reason: str(fd, 'reason') || null });
    });
    return done('تم تحديث الصلاحيات');
  }, ['/admin/roles']);
}
export async function staffUserAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    requirePermission(a, 'roles.manage');
    requireStepUp(a);
    const op = str(fd, 'op');
    if (op === 'create') {
      const email = str(fd, 'email').toLowerCase();
      const phone = normalizeEgyptMobile(str(fd, 'phone'));
      const pw = str(fd, 'password');
      const problem = passwordProblems(pw, STAFF_POLICY);
      if (problem) throw validation(problem);
      if (!phone) throw validation('رقم الموبايل غير صحيح');
      const [u] = await db.insert(users).values({ email, phone, fullName: str(fd, 'fullName'), passwordHash: await hashPassword(pw), isStaff: true, passwordChangedAt: new Date() }).returning();
      const role = str(fd, 'role');
      const [r] = await db.select().from(roles).where(eq(roles.code, role));
      if (!r) throw validation('دور غير صالح');
      await db.insert(userRoles).values({ userId: u.id, roleCode: role, grantedBy: a.userId });
      await audit(db, a, { action: 'rbac.staff_created', entityType: 'user', entityId: u.id, newValues: { email, role } });
    } else if (op === 'grant' || op === 'revoke') {
      const uid = str(fd, 'userId');
      const role = str(fd, 'role');
      if (uid === a.userId) throw validation('لا يمكنك تعديل أدوارك بنفسك');
      const [target] = await db.select({ isStaff: users.isStaff }).from(users).where(eq(users.id, uid));
      if (!target?.isStaff) throw validation('الأدوار الإدارية لحسابات فريق العمل فقط');
      const mine = await db.select({ code: userRoles.roleCode }).from(userRoles).where(eq(userRoles.userId, a.userId!));
      const roleGrantsRbac = (await db.select().from(rolePermissions).where(and(eq(rolePermissions.roleCode, role), eq(rolePermissions.permission, 'roles.manage')))).length > 0;
      if ((role === 'SUPER_ADMIN' || roleGrantsRbac) && !mine.some((m) => m.code === 'SUPER_ADMIN')) throw validation('منح أو سحب هذا الدور متاح للمدير العام فقط');
      if (op === 'grant') await db.insert(userRoles).values({ userId: uid, roleCode: role, grantedBy: a.userId }).onConflictDoNothing();
      else await db.delete(userRoles).where(and(eq(userRoles.userId, uid), eq(userRoles.roleCode, role)));
      await audit(db, a, { action: `rbac.role_${op}`, entityType: 'user', entityId: uid, newValues: { role } });
    } else if (op === 'disable') {
      const uid = str(fd, 'userId');
      if (uid === a.userId) throw validation('لا يمكنك تعطيل حسابك');
      const [target] = await db.select({ isStaff: users.isStaff }).from(users).where(eq(users.id, uid));
      if (!target?.isStaff) throw validation('تعطيل حسابات العملاء يتم من صفحة العملاء');
      await db.update(users).set({ status: str(fd, 'status') === 'ACTIVE' ? 'ACTIVE' : 'DISABLED' }).where(eq(users.id, uid));
      await audit(db, a, { action: 'rbac.staff_status', entityType: 'user', entityId: uid, newValues: { status: str(fd, 'status') } });
    }
    return done();
  }, ['/admin/roles']);
}
export async function customerStatusAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    requirePermission(a, 'customers.manage');
    const uid = str(fd, 'userId');
    const status = str(fd, 'status') === 'ACTIVE' ? 'ACTIVE' : 'DISABLED';
    const reason = str(fd, 'reason');
    if (reason.length < 3) throw validation('اذكر السبب');
    await db.update(users).set({ status }).where(and(eq(users.id, uid), eq(users.isStaff, false)));
    await audit(db, a, { action: 'customer.status_changed', entityType: 'user', entityId: uid, newValues: { status }, reason });
    return done();
  }, [`/admin/customers/${str(fd, 'userId')}`]);
}

/** Operations hold on an external deal (deals.manage + step-up, audited). */
export async function dealHoldAction(_p: ActionState, fd: FormData) {
  return adminRun(fd, async (a) => {
    const { setDealFinancialHold } = await import('@/server/modules/deals/service');
    const hold = str(fd, 'hold') === '1';
    await setDealFinancialHold(a, str(fd, 'dealId'), hold, str(fd, 'reason'));
    return done(hold ? 'تم إيقاف الصرف للصفقة لحين المراجعة' : 'تم رفع الإيقاف عن الصفقة');
  }, ['/admin/deals', `/admin/deals/${str(fd, 'dealId')}`]);
}
