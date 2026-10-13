/**
 * Arabic labels for enumerations (statuses, reasons, methods). This is the single source of
 * enum wording; `label()` falls back to the raw code so a missing translation never breaks the UI.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand' | 'accent';

export const STATUS: Record<string, { ar: string; tone: Tone }> = {
  // Seller
  DRAFT: { ar: 'مسودة', tone: 'neutral' },
  PENDING_REVIEW: { ar: 'قيد المراجعة', tone: 'warning' },
  MORE_INFO_REQUIRED: { ar: 'مطلوب معلومات إضافية', tone: 'warning' },
  APPROVED: { ar: 'معتمد', tone: 'success' },
  RESTRICTED: { ar: 'مقيّد', tone: 'warning' },
  SUSPENDED: { ar: 'موقوف', tone: 'danger' },
  REJECTED: { ar: 'مرفوض', tone: 'danger' },
  // Product
  SUBMITTED: { ar: 'مُرسل للمراجعة', tone: 'warning' },
  UNDER_REVIEW: { ar: 'قيد المراجعة', tone: 'warning' },
  LIVE: { ar: 'منشور', tone: 'success' },
  ARCHIVED: { ar: 'مؤرشف', tone: 'neutral' },
  // Orders
  PENDING_PAYMENT: { ar: 'بانتظار الدفع', tone: 'warning' },
  PAYMENT_UNDER_REVIEW: { ar: 'الدفع قيد المراجعة', tone: 'info' },
  PAID: { ar: 'تم تأكيد الدفع', tone: 'brand' },
  SELLER_CONFIRMED: { ar: 'أكّده البائع', tone: 'brand' },
  PROCESSING: { ar: 'قيد التجهيز', tone: 'info' },
  READY_TO_SHIP: { ar: 'جاهز للشحن', tone: 'info' },
  SHIPPED: { ar: 'تم الشحن', tone: 'info' },
  AWAITING_BUYER_RESPONSE: { ar: 'تم تسجيل التسليم — مهلة رد المشتري', tone: 'info' },
  // Seller order DELIVERED = an entitlement basis exists (see sellerOrderStatusLabel for the exact basis).
  DELIVERED: { ar: 'تم تسجيل التسليم', tone: 'success' },
  COMPLETED: { ar: 'مكتمل', tone: 'success' },
  PARTIALLY_COMPLETED: { ar: 'مكتمل جزئيًا', tone: 'warning' },
  CLOSED_UNFULFILLED: { ar: 'مغلق بدون تسليم', tone: 'neutral' },
  DELIVERY_FAILED: { ar: 'تعذّر التسليم', tone: 'danger' },
  CANCELLED: { ar: 'ملغي', tone: 'neutral' },
  // Payment
  AWAITING_PAYMENT: { ar: 'بانتظار الدفع', tone: 'warning' },
  PAYMENT_SUBMITTED: { ar: 'تم رفع الإثبات', tone: 'info' },
  CONFIRMED: { ar: 'تم تأكيد الدفع', tone: 'success' },
  EXPIRED: { ar: 'منتهي', tone: 'neutral' },
  ACCEPTED: { ar: 'مقبول', tone: 'success' },
  NEW_PROOF_REQUESTED: { ar: 'مطلوب إثبات جديد', tone: 'warning' },
  SUPERSEDED: { ar: 'مستبدل', tone: 'neutral' },
  // Shipment
  CREATED: { ar: 'تم الإنشاء', tone: 'neutral' },
  IN_TRANSIT: { ar: 'في الطريق', tone: 'info' },
  FAILED: { ar: 'تعذّر التسليم', tone: 'danger' },
  EXCEPTION: { ar: 'مشكلة شحن', tone: 'danger' },
  RETURNED_TO_SELLER: { ar: 'رجع للبائع', tone: 'danger' },
  LOST: { ar: 'مفقود', tone: 'danger' },
  // Returns
  REQUESTED: { ar: 'تم الطلب', tone: 'warning' },
  RETURN_IN_TRANSIT: { ar: 'المرتجع في الطريق', tone: 'info' },
  RECEIVED: { ar: 'استلم البائع المرتجع', tone: 'info' },
  INSPECTION: { ar: 'قيد الفحص', tone: 'info' },
  REFUND_PENDING: { ar: 'الاسترداد قيد الاعتماد والتحويل', tone: 'warning' },
  REFUNDED: { ar: 'تم الاسترداد', tone: 'success' },
  DISPUTED: { ar: 'نزاع', tone: 'danger' },
  // Deals
  INVITED: { ar: 'تمت دعوة البائع', tone: 'info' },
  PAYMENT_PENDING: { ar: 'بانتظار الدفع', tone: 'warning' },
  ACTIVE: { ar: 'نشطة', tone: 'brand' },
  BUYER_CONFIRMATION_PENDING: { ar: 'بانتظار تأكيد المشتري', tone: 'warning' },
  SELLER_JOINED: { ar: 'انضم البائع', tone: 'info' },
  IN_PROGRESS: { ar: 'قيد المعالجة', tone: 'info' },
  WITHDRAWN: { ar: 'مسحوب للتعديل', tone: 'neutral' },
  REVOKED: { ar: 'تم إلغاء الرابط', tone: 'neutral' },
  OFFER_PENDING_BUYER: { ar: 'عرض بانتظار المشتري', tone: 'warning' },
  CHANGE_REQUESTED: { ar: 'طلب تعديل', tone: 'warning' },
  DEAL_SHIPPED: { ar: 'تم الشحن — بانتظار التسليم', tone: 'info' },
  DELIVERY_HANDOVER_VERIFIED: { ar: 'تم التحقق من التسليم', tone: 'brand' },
  BUYER_CONFIRMED_RECEIPT: { ar: 'أكد المشتري الاستلام', tone: 'success' },
  ENTITLED_AWAITING_RELEASE: { ar: 'مستحق — بانتظار موافقة الإدارة على الإتاحة', tone: 'warning' },
  // Disputes
  OPEN: { ar: 'مفتوح', tone: 'warning' },
  AWAITING_INFORMATION: { ar: 'بانتظار معلومات', tone: 'warning' },
  RESOLVED: { ar: 'تم الحل', tone: 'success' },
  CLOSED: { ar: 'مغلق', tone: 'neutral' },
  // Withdrawals / refunds / payouts
  PENDING: { ar: 'معلّق', tone: 'warning' },
  PENDING_CHECKER: { ar: 'بانتظار المعتمد الثاني', tone: 'warning' },
  CONSUMED: { ar: 'نُفذت', tone: 'success' },
  UNMATCHED: { ar: 'غير متطابقة', tone: 'warning' },
  SUGGESTED_MATCH: { ar: 'مطابقة مقترحة', tone: 'info' },
  MATCHED: { ar: 'متطابقة', tone: 'success' },
  MISMATCH: { ar: 'عدم تطابق', tone: 'danger' },
  IGNORED_WITH_REASON: { ar: 'مستبعدة بسبب', tone: 'neutral' },
  BLOCKED: { ar: 'متوقف', tone: 'danger' },
  POSTED: { ar: 'تم القيد', tone: 'success' },
  PENDING_APPROVAL: { ar: 'بانتظار الاعتماد', tone: 'warning' },
  PENDING_VERIFICATION: { ar: 'بانتظار التحقق', tone: 'warning' },
  // Support
  WAITING_CUSTOMER: { ar: 'بانتظار العميل', tone: 'warning' },
  WAITING_SELLER: { ar: 'بانتظار البائع', tone: 'warning' },
  ESCALATED: { ar: 'مُصعّد', tone: 'danger' },
  // Reviews
  PUBLISHED: { ar: 'منشور', tone: 'success' },
  HIDDEN: { ar: 'مخفي', tone: 'neutral' },
  REMOVED: { ar: 'محذوف', tone: 'danger' },
  // Identity / receiving destinations
  INCOMPLETE: { ar: 'لم يكتمل', tone: 'neutral' },
  REVERIFICATION_REQUIRED: { ar: 'مطلوب إعادة التحقق', tone: 'warning' },
  // Movements / deal terms
  EXECUTED: { ar: 'نُفذت', tone: 'success' },
  PROPOSED: { ar: 'بانتظار الرد', tone: 'warning' },
  // Accounts / conversations
  LOCKED: { ar: 'مقفول', tone: 'danger' },
  DISABLED: { ar: 'معطّل', tone: 'neutral' },
  // Withdrawal allocations
  RESERVED: { ar: 'محجوز', tone: 'warning' },
  RELEASED: { ar: 'رجع للمصدر', tone: 'neutral' },
  RETURNED: { ar: 'ارتد', tone: 'danger' },
  // Withdrawals (same wording as kind 'withdrawal', so a chip without `kind` never leaks a code)
  TRANSFER_UNCERTAIN: { ar: 'نتيجة التحويل غير مؤكدة — المبلغ محجوز', tone: 'danger' },
  FAILED_BEFORE_TRANSFER: { ar: 'فشل قبل التحويل — أُعيد للرصيد', tone: 'neutral' },
  // Admin-only enums (inventory, pricing, legal, reports, files, jobs, notifications, ledger health)
  COMMITTED: { ar: 'مُثبّت', tone: 'success' },
  VALIDATED: { ar: 'تم التحقق', tone: 'info' },
  RETIRED: { ar: 'متوقف العمل به', tone: 'neutral' },
  ACTIONED: { ar: 'تم اتخاذ إجراء', tone: 'success' },
  DISMISSED: { ar: 'مرفوض البلاغ', tone: 'neutral' },
  UNSCANNED: { ar: 'لم يُفحص', tone: 'neutral' },
  QUARANTINED: { ar: 'معزول', tone: 'warning' },
  SCANNING: { ar: 'جارٍ الفحص', tone: 'info' },
  CLEAN: { ar: 'سليم', tone: 'success' },
  INFECTED: { ar: 'مصاب', tone: 'danger' },
  SCAN_FAILED: { ar: 'تعذّر الفحص', tone: 'danger' },
  RUNNING: { ar: 'قيد التشغيل', tone: 'info' },
  DONE: { ar: 'تم', tone: 'success' },
  SUCCEEDED: { ar: 'نجح', tone: 'success' },
  ABANDONED: { ar: 'متروك', tone: 'neutral' },
  QUEUED: { ar: 'في الانتظار', tone: 'neutral' },
  SENDING: { ar: 'جارٍ الإرسال', tone: 'info' },
  SENT: { ar: 'تم الإرسال', tone: 'success' },
  SUPPRESSED: { ar: 'تم الحجب', tone: 'neutral' },
  OPENED: { ar: 'تم الفتح', tone: 'success' },
  BOUNCED: { ar: 'ارتد', tone: 'danger' },
  OK: { ar: 'سليم', tone: 'success' },
  WARNING: { ar: 'تحذير', tone: 'warning' },
  CRITICAL: { ar: 'حرج', tone: 'danger' },
};

/**
 * Entity-specific wording where the shared label would be financially ambiguous (operator safety):
 * an APPROVED refund/withdrawal is NOT paid, PROCESSING is NOT paid, a FAILED refund is a failed transfer.
 */
export type StatusKind = 'refund' | 'withdrawal' | 'payout' | 'deal';
const STATUS_BY_KIND: Record<StatusKind, Record<string, { ar: string; tone: Tone }>> = {
  // A deal reaches REFUNDED when the refund is APPROVED, before any transfer (returns keep «تم الاسترداد»).
  deal: {
    REFUNDED: { ar: 'تم اعتماد الاسترداد — راجع حالة التحويل', tone: 'warning' },
  },
  refund: {
    REQUESTED: { ar: 'طلب استرداد — قيد المراجعة', tone: 'warning' },
    APPROVED: { ar: 'تم اعتماد الاسترداد — لم يُحوَّل بعد', tone: 'warning' },
    PROCESSING: { ar: 'جارٍ تحويل الاسترداد — لم يكتمل', tone: 'info' },
    FAILED: { ar: 'تعذّر تحويل الاسترداد — المبلغ ما زال مستحقًا', tone: 'danger' },
    COMPLETED: { ar: 'تم تحويل الاسترداد', tone: 'success' },
    PAID: { ar: 'تم تحويل الاسترداد', tone: 'success' },
    PENDING: { ar: 'استرداد معلّق — لم يُحوَّل بعد', tone: 'warning' },
    REJECTED: { ar: 'رُفض الاسترداد', tone: 'danger' },
  },
  withdrawal: {
    REQUESTED: { ar: 'طلب سحب — لم يُحجز مبلغ', tone: 'warning' },
    APPROVED: { ar: 'معتمد ومحجوز — لم يُحوَّل بعد', tone: 'warning' },
    PROCESSING: { ar: 'جارٍ التحويل — لم يكتمل بعد', tone: 'info' },
    TRANSFER_UNCERTAIN: { ar: 'نتيجة التحويل غير مؤكدة — المبلغ محجوز', tone: 'danger' },
    PAID: { ar: 'تم التحويل', tone: 'success' },
    FAILED_BEFORE_TRANSFER: { ar: 'فشل قبل التحويل — أُعيد للرصيد', tone: 'neutral' },
    RETURNED: { ar: 'ارتد التحويل — أُعيد للرصيد', tone: 'danger' },
  },
  payout: {
    PENDING: { ar: 'مستحق — لم يُحوَّل بعد', tone: 'warning' },
    PAID: { ar: 'تم التحويل', tone: 'success' },
  },
};

export function statusLabel(code: string | null | undefined, kind?: StatusKind): string {
  if (!code) return '—';
  return (kind && STATUS_BY_KIND[kind][code]?.ar) || STATUS[code]?.ar || code;
}
export function statusTone(code: string | null | undefined, kind?: StatusKind): Tone {
  return (code && ((kind && STATUS_BY_KIND[kind][code]?.tone) || STATUS[code]?.tone)) || 'neutral';
}

/** Seller-order status that names the actual basis: delivery recorded ≠ buyer confirmed ≠ timeout ≠ dispute decision. */
export function sellerOrderStatusLabel(status: string | null | undefined, receiptBasis?: string | null): string {
  if (status === 'DELIVERED') {
    if (receiptBasis === 'BUYER_CONFIRMED') return 'أكّد المشتري الاستلام — بانتظار موافقة الإدارة على الإتاحة';
    if (receiptBasis === 'TIMEOUT_ENTITLEMENT') return 'مستحق بانتهاء مهلة المشتري — بانتظار موافقة الإدارة على الإتاحة';
    if (receiptBasis === 'DISPUTE_DECISION') return 'مستحق بقرار نزاع — بانتظار موافقة الإدارة على الإتاحة';
    return 'تم تسجيل التسليم';
  }
  return statusLabel(status);
}

export const LABELS = {
  paymentMethod: { BANK_TRANSFER: 'تحويل بنكي', INSTAPAY: 'إنستاباي', VODAFONE_CASH: 'فودافون كاش' } as Record<string, string>,
  payoutType: { BANK_ACCOUNT: 'حساب بنكي', INSTAPAY: 'إنستاباي', MOBILE_WALLET: 'محفظة موبايل' } as Record<string, string>,
  condition: { NEW: 'جديد', USED: 'مستعمل' } as Record<string, string>,
  usedGrade: { LIKE_NEW: 'زي الجديد', VERY_GOOD: 'جيد جداً', GOOD: 'جيد', ACCEPTABLE: 'مقبول' } as Record<string, string>,
  /** Single source for dispute-decision wording (also used by postpurchase/disputes.ts DECISION_LABELS). */
  disputeDecision: { FULL_REFUND: 'استرداد كامل للمشتري', PARTIAL_REFUND: 'استرداد جزئي', RETURN_REQUIRED: 'يلزم إرجاع المنتج أولاً', REPLACEMENT: 'استبدال المنتج', RELEASE_TO_SELLER: 'إتاحة المستحقات للبائع بعد اعتماد الإدارة', REJECT_CLAIM: 'رفض الشكوى' } as Record<string, string>,
  payoutChannel: { INSTAPAY: 'إنستاباي', BANK_TRANSFER: 'تحويل بنكي', MOBILE_WALLET: 'محفظة موبايل', FUTURE_PSP: 'مزود دفع', OTHER: 'أخرى' } as Record<string, string>,
  moderationAction: {
    SUBMIT: 'أُرسل للمراجعة',
    START_REVIEW: 'بدأت المراجعة',
    APPROVE: 'تمت الموافقة',
    REJECT: 'مرفوض',
    REQUEST_CHANGES: 'مطلوب تعديلات',
    SUSPEND: 'إيقاف',
    REINSTATE: 'إعادة تفعيل',
    REVISION_SUBMIT: 'تعديل أُرسل للمراجعة',
    REVISION_APPROVE: 'اعتماد التعديل',
    REVISION_REJECT: 'رفض التعديل',
  } as Record<string, string>,
  sellerType: { INDIVIDUAL: 'فرد', BUSINESS: 'شركة / نشاط تجاري' } as Record<string, string>,
  returnReason: {
    CHANGED_MIND: 'غيّرت رأيي',
    WRONG_ITEM: 'وصلني منتج غلط',
    DAMAGED: 'وصل تالف',
    DEFECTIVE: 'فيه عيب / مش شغال',
    MISSING_PARTS: 'ناقص أجزاء',
    NOT_AS_DESCRIBED: 'غير مطابق للوصف',
    COUNTERFEIT_SUSPECTED: 'شاكك إنه مش أصلي',
    OTHER: 'سبب آخر',
  } as Record<string, string>,
  ticketType: { ORDER: 'طلب', PAYMENT: 'دفع', SHIPPING: 'شحن', RETURN: 'مرتجع', PRODUCT: 'منتج', SELLER: 'بائع', EXTERNAL_DEAL: 'صفقة محمية', ACCOUNT: 'الحساب', IDENTITY: 'التحقق من الهوية', RECEIVING_DESTINATION: 'بيانات استلام الأموال', REFUND: 'استرداد', DISPUTE: 'نزاع', SELLER_FINANCE: 'مستحقات البائع', WITHDRAWAL: 'سحب', TECHNICAL: 'مشكلة تقنية' } as Record<string, string>,
  priority: { LOW: 'منخفضة', NORMAL: 'عادية', HIGH: 'مرتفعة', URGENT: 'عاجلة' } as Record<string, string>,
  docKind: {
    NATIONAL_ID_FRONT: 'البطاقة (وجه)',
    NATIONAL_ID_BACK: 'البطاقة (ظهر)',
    COMMERCIAL_REGISTRATION: 'السجل التجاري',
    TAX_CARD: 'البطاقة الضريبية',
    AUTHORIZATION_LETTER: 'خطاب تفويض',
    OTHER: 'مستند آخر',
  } as Record<string, string>,
  receiptBasis: {
    BUYER_CONFIRMED: 'أكّد المشتري الاستلام',
    TIMEOUT_ENTITLEMENT: 'انتهت مهلة المشتري بدون اعتراض',
    DISPUTE_DECISION: 'قرار نزاع',
    LEGACY_ADMIN_ON_BEHALF: 'تأكيد إداري قديم (قبل التحصين)',
    LEGACY_PRE_HARDENING: 'سجل قديم (قبل التحصين)',
  } as Record<string, string>,
  cancelReason: {
    BUYER_REQUEST: 'طلب المشتري',
    SELLER_UNABLE_TO_FULFIL: 'البائع لا يستطيع التنفيذ',
    OUT_OF_STOCK: 'نفاد المخزون',
    PAYMENT_FAILURE: 'فشل/انتهاء الدفع',
    RISK_REVIEW: 'مراجعة مخاطر',
    ADMIN_OPERATIONAL: 'سبب تشغيلي',
    DUPLICATE_ORDER: 'طلب مكرر',
    OTHER: 'سبب آخر',
  } as Record<string, string>,
  shipmentException: {
    DELIVERY_ATTEMPT_FAILED: 'فشلت محاولة التوصيل',
    BUYER_UNAVAILABLE: 'المشتري غير متاح',
    BUYER_REFUSED: 'المشتري رفض الاستلام',
    WRONG_ADDRESS: 'عنوان غير صحيح',
    RETURN_TO_SELLER: 'راجع للبائع',
    LOST_IN_TRANSIT: 'مفقود أثناء الشحن',
    DAMAGED_IN_TRANSIT: 'تلف أثناء الشحن',
    CARRIER_EXCEPTION: 'مشكلة عند شركة الشحن',
  } as Record<string, string>,
  deliveryException: {
    SELLER_EVIDENCE_LATE: 'دليل التسليم وصل متأخر (بعد 24 ساعة)',
    SELLER_EVIDENCE_MISSING: 'البائع لم يرسل دليل التسليم خلال 24 ساعة',
    DELIVERY_EVENT_MISSING: 'لا يوجد حدث تسليم موثق بعد الموعد المتوقع',
    TIMEOUT_BLOCKED: 'انتهت مهلة المشتري لكن يوجد مانع',
    // Shipment exceptions are raised as `SHIPMENT_${code}` (fulfilment.ts); same wording as `shipmentException`.
    SHIPMENT_DELIVERY_ATTEMPT_FAILED: 'فشلت محاولة التوصيل',
    SHIPMENT_BUYER_UNAVAILABLE: 'المشتري غير متاح',
    SHIPMENT_BUYER_REFUSED: 'المشتري رفض الاستلام',
    SHIPMENT_WRONG_ADDRESS: 'عنوان غير صحيح',
    SHIPMENT_RETURN_TO_SELLER: 'راجع للبائع',
    SHIPMENT_LOST_IN_TRANSIT: 'مفقود أثناء الشحن',
    SHIPMENT_DAMAGED_IN_TRANSIT: 'تلف أثناء الشحن',
    SHIPMENT_CARRIER_EXCEPTION: 'مشكلة عند شركة الشحن',
  } as Record<string, string>,
  refundSource: { ORDER_CANCELLATION: 'إلغاء قبل الشحن', RETURN: 'مرتجع', DISPUTE: 'قرار نزاع', DEAL: 'صفقة محمية', DELIVERY_FAILURE: 'تعذّر التسليم', ADMIN: 'قرار إداري' } as Record<string, string>,
  financialAction: {
    PAYMENT_CONFIRMATION: 'تأكيد دفع',
    SELLER_RELEASE: 'إتاحة مستحقات بائع',
    REFUND_APPROVAL: 'اعتماد استرداد',
    REFUND_PAYOUT: 'صرف استرداد',
    REFUND_REVOCATION: 'إلغاء اعتماد استرداد قبل التحويل',
    WITHDRAWAL_RESERVATION: 'اعتماد وحجز سحب',
    WITHDRAWAL_RELEASE_RESERVATION: 'فك حجز سحب',
    WITHDRAWAL_PAYOUT: 'صرف سحب',
    MANUAL_ADJUSTMENT: 'تسوية يدوية',
    DEAL_PAYMENT_CONFIRMATION: 'تأكيد دفع صفقة',
    DEAL_RELEASE: 'تسوية صفقة',
    DEAL_REFUND: 'اعتماد استرداد صفقة',
    DEAL_PAYOUT: 'صرف مستحق صفقة',
    WITHDRAWAL_PAYOUT_RETURN: 'ارتداد تحويل سحب',
  } as Record<string, string>,
  storeInvitation: { PENDING: 'مستنية رد', ACCEPTED: 'اتقبلت', DECLINED: 'اترفضت', REVOKED: 'اتلغت', EXPIRED: 'انتهت صلاحيتها' } as Record<string, string>,
  sellerRole: { STORE_OWNER: 'مالك المتجر', STORE_MANAGER: 'مدير المتجر', CATALOG_MANAGER: 'مسؤول المنتجات', ORDER_MANAGER: 'مسؤول الطلبات', FINANCE: 'المالية', SUPPORT: 'الدعم' } as Record<string, string>,
};

export function label(group: keyof typeof LABELS, code: string | null | undefined): string {
  if (!code) return '—';
  return LABELS[group][code] ?? code;
}
