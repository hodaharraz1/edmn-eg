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
  ORDER_CREATED: { title: 'تم إنشاء طلبك #{{order}}', body: 'المبلغ المطلوب {{amount}}. يرجى إتمام الدفع ورفع إثبات الدفع قبل {{due}}.', sms: true },
  PAYMENT_SUBMITTED: { title: 'تم استلام إثبات الدفع', body: 'استلمنا إثبات الدفع للطلب #{{order}} وجارٍ التحقق منه.', sms: false },
  PAYMENT_CONFIRMED: { title: 'تم تأكيد الدفع', body: 'تم تأكيد دفع الطلب #{{order}}. سيبدأ البائع في تجهيز طلبك.', sms: true },
  PAYMENT_REJECTED: { title: 'لم يتم قبول إثبات الدفع', body: 'لم نتمكن من تأكيد الدفع للطلب #{{order}}. السبب: {{reason}}. يمكنك رفع إثبات جديد.', sms: true },
  SELLER_NEW_ORDER: { title: 'طلب جديد #{{order}}', body: 'لديك طلب جديد مدفوع بقيمة {{amount}}. يرجى تأكيده وتجهيزه.', sms: true },
  SELLER_ORDER_CONFIRMED: { title: 'البائع أكد طلبك', body: 'قام {{store}} بتأكيد طلبك #{{order}} وجارٍ تجهيزه.', sms: false },
  SELLER_ORDER_CANCELLED: { title: 'تم إلغاء جزء من طلبك', body: 'تم إلغاء الطلب #{{order}} من {{store}}. السبب: {{reason}}. سيتم رد المبلغ.', sms: true },
  ORDER_SHIPPED: { title: 'تم شحن طلبك', body: 'تم شحن الطلب #{{order}} عبر {{carrier}}. رقم التتبع: {{tracking}}', sms: true },
  BUYER_RECEIPT_CONFIRMED: { title: 'العميل أكد استلام الطلب', body: 'أكد العميل استلام الطلب #{{order}}. تمت إضافة {{amount}} إلى رصيدك المتاح.', sms: false },
  DELIVERY_FOLLOW_UP: { title: 'هل استلمت طلبك؟', body: 'تم شحن الطلب #{{order}} منذ فترة. إذا استلمته يرجى تأكيد الاستلام، أو تواصل معنا إن كانت هناك مشكلة.', sms: true },
  RETURN_REQUESTED: { title: 'طلب إرجاع جديد', body: 'تم تقديم طلب إرجاع #{{ret}} على الطلب #{{order}}.', sms: false },
  RETURN_UPDATED: { title: 'تحديث على طلب الإرجاع', body: 'حالة طلب الإرجاع #{{ret}}: {{status}}', sms: false },
  REFUND_PAID: { title: 'تم رد المبلغ', body: 'تم رد مبلغ {{amount}} إليك. مرجع العملية: {{reference}}', sms: true },
  DISPUTE_OPENED: { title: 'تم فتح نزاع', body: 'تم فتح النزاع #{{dispute}}. سيقوم فريق اضمن بمراجعته.', sms: false },
  DISPUTE_UPDATED: { title: 'تحديث على النزاع', body: 'هناك تحديث على النزاع #{{dispute}}.', sms: false },
  DISPUTE_RESOLVED: { title: 'تم حسم النزاع', body: 'تم حسم النزاع #{{dispute}}. القرار: {{decision}}', sms: true },
  WITHDRAWAL_REQUESTED: { title: 'تم استلام طلب السحب', body: 'طلب السحب #{{wd}} بمبلغ {{amount}} قيد المراجعة.', sms: false },
  WITHDRAWAL_UPDATED: { title: 'تحديث على طلب السحب', body: 'حالة طلب السحب #{{wd}}: {{status}}', sms: true },
  PAYOUT_METHOD_CHANGED: { title: 'تم تغيير بيانات السحب', body: 'تمت إضافة وسيلة سحب جديدة لحسابك. إذا لم تقم بذلك تواصل معنا فوراً.', sms: true },
  EXTERNAL_DEAL_INVITED: { title: 'دعوة لصفقة محمية', body: '{{buyer}} يدعوك لإتمام صفقة محمية عبر اضمن: {{deal}} بقيمة {{amount}}. {{link}}', sms: true },
  EXTERNAL_DEAL_ACCEPTED: { title: 'البائع وافق على الصفقة', body: 'وافق البائع على الصفقة #{{deal}}. يرجى إتمام الدفع.', sms: true },
  EXTERNAL_DEAL_REJECTED: { title: 'البائع رفض الصفقة', body: 'رفض البائع الصفقة #{{deal}}. السبب: {{reason}}', sms: false },
  EXTERNAL_DEAL_ACTIVE: { title: 'الصفقة أصبحت نشطة', body: 'تم تأكيد الدفع للصفقة #{{deal}}. يمكن للبائع الآن تسليم المنتج.', sms: true },
  EXTERNAL_DEAL_DELIVERED: { title: 'البائع أعلن التسليم', body: 'أعلن البائع تسليم الصفقة #{{deal}}. يرجى الفحص ثم تأكيد الاستلام أو فتح نزاع.', sms: true },
  EXTERNAL_DEAL_COMPLETED: { title: 'اكتملت الصفقة', body: 'اكتملت الصفقة #{{deal}}. شكراً لاستخدامك اضمن.', sms: false },
  SUPPORT_REPLY: { title: 'رد جديد على تذكرة الدعم', body: 'هناك رد جديد على التذكرة #{{ticket}}.', sms: false },
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
