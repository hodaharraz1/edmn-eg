/** Domain events that produce notifications. Templates use {{var}} placeholders. */
export const EVENT_TEMPLATES = {
  SELLER_APPLICATION_SUBMITTED: { title: 'تم استلام طلب الانضمام كبائع', body: 'استلمنا طلبك لمتجر "{{store}}" وهو الآن قيد المراجعة.', sms: false },
  SELLER_APPROVED: { title: 'تمت الموافقة على حساب البائع', body: 'مبروك! تمت الموافقة على متجرك "{{store}}". يمكنك الآن إضافة منتجاتك.', sms: true },
  SELLER_REJECTED: { title: 'تحديث على طلب الانضمام', body: 'لم تتم الموافقة على طلبك. السبب: {{reason}}', sms: false },
  SELLER_MORE_INFO_REQUIRED: { title: 'مطلوب معلومات إضافية', body: 'نحتاج معلومات إضافية لاستكمال مراجعة طلبك: {{reason}}', sms: false },
  SELLER_STATUS_CHANGED: { title: 'تغيير حالة حساب البائع', body: 'تم تغيير حالة حسابك إلى: {{status}}. السبب: {{reason}}', sms: false },
  PRODUCT_SUBMITTED: { title: 'تم إرسال المنتج للمراجعة', body: 'المنتج "{{product}}" قيد المراجعة الآن.', sms: false },
  PRODUCT_APPROVED: { title: 'تمت الموافقة على المنتج', body: 'تمت الموافقة على "{{product}}" وأصبح متاحاً للعملاء.', sms: false },
  PRODUCT_REJECTED: { title: 'المنتج يحتاج تعديلات', body: 'لم تتم الموافقة على "{{product}}". السبب: {{reason}}', sms: false },
  PRODUCT_SUSPENDED: { title: 'تم إيقاف منتج', body: 'تم إيقاف "{{product}}". السبب: {{reason}}', sms: false },
  ORDER_CREATED: { title: 'طلبك #{{order}} اتسجل', body: 'المبلغ المطلوب {{amount}}. ادفع وارفع إثبات الدفع قبل {{due}}.', sms: true },
  PAYMENT_SUBMITTED: { title: 'إثبات الدفع وصلنا', body: 'إثبات الدفع للطلب #{{order}} وصلنا، وبنراجعه دلوقتي.', sms: false },
  PAYMENT_CONFIRMED: { title: 'الدفع اتأكد', body: 'دفع الطلب #{{order}} اتأكد. البائع هيبدأ يجهّز طلبك.', sms: true },
  PAYMENT_REJECTED: { title: 'إثبات الدفع اترفض', body: 'مقدرناش نأكد الدفع للطلب #{{order}}. السبب: {{reason}}. تقدر ترفع إثبات جديد.', sms: true },
  SELLER_NEW_ORDER: { title: 'طلب جديد #{{order}}', body: 'لديك طلب جديد مدفوع بقيمة {{amount}}. يرجى تأكيده وتجهيزه.', sms: true },
  SELLER_ORDER_CONFIRMED: { title: 'البائع أكّد طلبك', body: '{{store}} أكّد طلبك #{{order}} وبيجهّزه دلوقتي.', sms: false },
  SELLER_ORDER_CANCELLED: { title: 'جزء من طلبك اتلغى', body: 'الطلب #{{order}} من {{store}} اتلغى. السبب: {{reason}}. هنرجّعلك المبلغ.', sms: true },
  ORDER_SHIPPED: { title: 'طلبك اتشحن', body: 'الطلب #{{order}} اتشحن مع {{carrier}}. رقم التتبع: {{tracking}}', sms: true },
  BUYER_RECEIPT_CONFIRMED: { title: 'العميل أكد استلام الطلب', body: 'أكد العميل استلام الطلب #{{order}}. تمت إضافة {{amount}} إلى رصيدك المتاح.', sms: false },
  DELIVERY_FOLLOW_UP: { title: 'طلبك وصلك؟', body: 'الطلب #{{order}} اتشحن من فترة. لو استلمته أكّد الاستلام، ولو فيه مشكلة تواصل معانا.', sms: true },
  RETURN_REQUESTED: { title: 'طلب إرجاع جديد', body: 'تم تقديم طلب إرجاع #{{ret}} على الطلب #{{order}}.', sms: false },
  RETURN_UPDATED: { title: 'تحديث على طلب الإرجاع', body: 'حالة طلب الإرجاع #{{ret}}: {{status}}', sms: false },
  REFUND_PAID: { title: 'المبلغ اترد', body: 'اترد لك مبلغ {{amount}}. رقم المرجع: {{reference}}', sms: true },
  DISPUTE_OPENED: { title: 'النزاع اتفتح', body: 'النزاع #{{dispute}} اتفتح، وفريق اضمن هيراجعه.', sms: false },
  DISPUTE_UPDATED: { title: 'تحديث على النزاع', body: 'فيه تحديث جديد على النزاع #{{dispute}}.', sms: false },
  DISPUTE_RESOLVED: { title: 'النزاع اتحسم', body: 'النزاع #{{dispute}} اتحسم. القرار: {{decision}}', sms: true },
  WITHDRAWAL_REQUESTED: { title: 'تم استلام طلب السحب', body: 'طلب السحب #{{wd}} بمبلغ {{amount}} قيد المراجعة.', sms: false },
  WITHDRAWAL_UPDATED: { title: 'تحديث على طلب السحب', body: 'حالة طلب السحب #{{wd}}: {{status}}', sms: true },
  PAYOUT_METHOD_CHANGED: { title: 'تم تغيير بيانات السحب', body: 'تمت إضافة وسيلة سحب جديدة لحسابك. إذا لم تقم بذلك تواصل معنا فوراً.', sms: true },
  EXTERNAL_DEAL_INVITED: { title: 'دعوة لصفقة محمية', body: '{{buyer}} بيدعوك لصفقة محمية على اضمن: {{deal}} بقيمة {{amount}}. {{link}}', sms: true },
  EXTERNAL_DEAL_ACCEPTED: { title: 'البائع وافق على الصفقة', body: 'البائع وافق على الصفقة #{{deal}}. كمّل الدفع.', sms: true },
  EXTERNAL_DEAL_REJECTED: { title: 'البائع رفض الصفقة', body: 'البائع رفض الصفقة #{{deal}}. السبب: {{reason}}', sms: false },
  EXTERNAL_DEAL_ACTIVE: { title: 'الصفقة بقت نشطة', body: 'الدفع للصفقة #{{deal}} اتأكد. البائع يقدر يسلّم المنتج دلوقتي.', sms: true },
  EXTERNAL_DEAL_DELIVERED: { title: 'البائع شحن الصفقة', body: 'البائع سجّل شحن الصفقة #{{deal}}. ما تدّيش رمز الاستلام للبائع أو المندوب غير بعد ما تستلم المنتج فعليًا.', sms: false },
  /** Carries the one-time code: sent by SMS to the buyer only, redacted at rest after delivery / expiry, never logged. */
  DEAL_DELIVERY_OTP: { title: 'رمز استلام الصفقة', body: 'رمز استلام صفقة اضمن #{{deal}}: {{code}} — لا تعطه لأحد إلا عند استلام المنتج فعليًا. صالح حتى {{expires}}.', sms: true },
  DEAL_HANDOVER_VERIFIED: { title: 'التسليم اتأكد', body: 'تسليم الصفقة #{{deal}} اتأكد. افحص المنتج وبعدها اختار: استلمته والمنتج مطابق، أو فيه مشكلة، أو ما استلمتوش.', sms: false },
  DEAL_DELIVERY_REVIEW: { title: 'الصفقة عند فريق العمليات', body: 'الصفقة #{{deal}} اتحوّلت لمراجعة فريق العمليات، والمبلغ محجوز لحد القرار.', sms: false },
  EXTERNAL_DEAL_COMPLETED: { title: 'الصفقة اكتملت', body: 'الصفقة #{{deal}} اكتملت. شكرًا إنك استخدمت اضمن.', sms: false },
  SUPPORT_REPLY: { title: 'رد جديد على تذكرة الدعم', body: 'فيه رد جديد على التذكرة #{{ticket}}.', sms: false },
  REVIEW_RECEIVED: { title: 'تقييم جديد', body: 'حصلت على تقييم جديد ({{rating}}/5).', sms: false },
  ACCOUNT_SECURITY: { title: 'تنبيه أمني', body: '{{message}}', sms: false },
} as const;

export type EventName = keyof typeof EVENT_TEMPLATES;

export function render(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? '' : String(v);
  });
}
