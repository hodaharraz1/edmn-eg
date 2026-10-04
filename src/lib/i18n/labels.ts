/**
 * Arabic labels for enumerations (statuses, reasons, methods). English equivalents live in
 * `en.ts`; `label()` falls back to the raw code so a missing translation never breaks the UI.
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
  PAYMENT_UNDER_REVIEW: { ar: 'الدفع قيد التحقق', tone: 'info' },
  PAID: { ar: 'مدفوع', tone: 'brand' },
  SELLER_CONFIRMED: { ar: 'أكده البائع', tone: 'brand' },
  PROCESSING: { ar: 'قيد التجهيز', tone: 'info' },
  READY_TO_SHIP: { ar: 'جاهز للشحن', tone: 'info' },
  SHIPPED: { ar: 'تم الشحن', tone: 'info' },
  DELIVERED: { ar: 'تم الاستلام', tone: 'success' },
  COMPLETED: { ar: 'مكتمل', tone: 'success' },
  CANCELLED: { ar: 'ملغي', tone: 'neutral' },
  // Payment
  AWAITING_PAYMENT: { ar: 'بانتظار الدفع', tone: 'warning' },
  PAYMENT_SUBMITTED: { ar: 'تم رفع الإثبات', tone: 'info' },
  CONFIRMED: { ar: 'مؤكد', tone: 'success' },
  EXPIRED: { ar: 'منتهي', tone: 'neutral' },
  ACCEPTED: { ar: 'مقبول', tone: 'success' },
  NEW_PROOF_REQUESTED: { ar: 'مطلوب إثبات جديد', tone: 'warning' },
  SUPERSEDED: { ar: 'مستبدل', tone: 'neutral' },
  // Shipment
  CREATED: { ar: 'تم الإنشاء', tone: 'neutral' },
  IN_TRANSIT: { ar: 'في الطريق', tone: 'info' },
  FAILED: { ar: 'تعذّر التسليم', tone: 'danger' },
  // Returns
  REQUESTED: { ar: 'تم الطلب', tone: 'warning' },
  RETURN_IN_TRANSIT: { ar: 'المرتجع في الطريق', tone: 'info' },
  RECEIVED: { ar: 'تم الاستلام', tone: 'info' },
  INSPECTION: { ar: 'قيد الفحص', tone: 'info' },
  REFUND_PENDING: { ar: 'بانتظار الاسترداد', tone: 'warning' },
  REFUNDED: { ar: 'تم الاسترداد', tone: 'success' },
  DISPUTED: { ar: 'نزاع', tone: 'danger' },
  // Deals
  INVITED: { ar: 'تمت دعوة البائع', tone: 'info' },
  PAYMENT_PENDING: { ar: 'بانتظار الدفع', tone: 'warning' },
  ACTIVE: { ar: 'نشطة', tone: 'brand' },
  BUYER_CONFIRMATION_PENDING: { ar: 'بانتظار تأكيد المشتري', tone: 'warning' },
  // Disputes
  OPEN: { ar: 'مفتوح', tone: 'warning' },
  AWAITING_INFORMATION: { ar: 'بانتظار معلومات', tone: 'warning' },
  RESOLVED: { ar: 'تم الحل', tone: 'success' },
  CLOSED: { ar: 'مغلق', tone: 'neutral' },
  // Withdrawals / refunds / payouts
  PENDING: { ar: 'معلق', tone: 'warning' },
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
};

export function statusLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return STATUS[code]?.ar ?? code;
}
export function statusTone(code: string | null | undefined): Tone {
  return (code && STATUS[code]?.tone) || 'neutral';
}

export const LABELS = {
  paymentMethod: { BANK_TRANSFER: 'تحويل بنكي', INSTAPAY: 'إنستاباي', VODAFONE_CASH: 'فودافون كاش' } as Record<string, string>,
  payoutType: { BANK_ACCOUNT: 'حساب بنكي', INSTAPAY: 'إنستاباي', MOBILE_WALLET: 'محفظة موبايل' } as Record<string, string>,
  condition: { NEW: 'جديد', USED: 'مستعمل' } as Record<string, string>,
  usedGrade: { LIKE_NEW: 'كالجديد', VERY_GOOD: 'جيد جداً', GOOD: 'جيد', ACCEPTABLE: 'مقبول' } as Record<string, string>,
  sellerType: { INDIVIDUAL: 'فرد', BUSINESS: 'شركة / نشاط تجاري' } as Record<string, string>,
  returnReason: {
    CHANGED_MIND: 'غيّرت رأيي',
    WRONG_ITEM: 'وصلني منتج خطأ',
    DAMAGED: 'وصل تالفاً',
    DEFECTIVE: 'به عيب / لا يعمل',
    MISSING_PARTS: 'ناقص أجزاء',
    NOT_AS_DESCRIBED: 'غير مطابق للوصف',
    COUNTERFEIT_SUSPECTED: 'أشك أنه غير أصلي',
    OTHER: 'سبب آخر',
  } as Record<string, string>,
  ticketType: { ORDER: 'طلب', PAYMENT: 'دفع', SHIPPING: 'شحن', RETURN: 'إرجاع', PRODUCT: 'منتج', SELLER: 'بائع', EXTERNAL_DEAL: 'صفقة محمية', ACCOUNT: 'الحساب' } as Record<string, string>,
  priority: { LOW: 'منخفضة', NORMAL: 'عادية', HIGH: 'مرتفعة', URGENT: 'عاجلة' } as Record<string, string>,
  docKind: {
    NATIONAL_ID_FRONT: 'البطاقة (وجه)',
    NATIONAL_ID_BACK: 'البطاقة (ظهر)',
    COMMERCIAL_REGISTRATION: 'السجل التجاري',
    TAX_CARD: 'البطاقة الضريبية',
    AUTHORIZATION_LETTER: 'خطاب تفويض',
    OTHER: 'مستند آخر',
  } as Record<string, string>,
  sellerRole: { STORE_OWNER: 'مالك المتجر', STORE_MANAGER: 'مدير المتجر', CATALOG_MANAGER: 'مسؤول المنتجات', ORDER_MANAGER: 'مسؤول الطلبات', FINANCE: 'المالية', SUPPORT: 'الدعم' } as Record<string, string>,
};

export function label(group: keyof typeof LABELS, code: string | null | undefined): string {
  if (!code) return '—';
  return LABELS[group][code] ?? code;
}
