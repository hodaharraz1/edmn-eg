# تشغيل إشعارات الـPush ورسائل SMS (خطوات المالك)

الكود كله جاهز؛ اللي ناقص مفاتيح خارجية تجيبها أنت من حساباتك. أول ما تتحط على staging، الإشعارات والرسائل
تشتغل بدون أي تعديل كود.

## 1) Firebase Cloud Messaging (أندرويد + تطبيق العملاء)

1. ادخل <https://console.firebase.google.com> وأنشئ مشروعًا (أو استخدم القائم).
2. من ⚙️ Project settings ← Service accounts ← **Generate new private key**: ينزّل ملف JSON.
3. حوّله base64 سطر واحد:
   ```bash
   base64 -w0 service-account.json   # macOS: base64 -i service-account.json | tr -d '\n'
   ```
4. حط الناتج في env باسم `FCM_SERVICE_ACCOUNT_JSON_B64` (سر — في لوحة الاستضافة أو GitHub Secrets، مش في الكود).
5. في تطبيق الموبايل: Project settings ← General ← أضف تطبيق Android باسم الحزمة `com.edmneg.edmn_customer`
   ونزّل `google-services.json` لمشروع Flutter (خطوة خاصة بتطبيق الموبايل عند إضافة firebase_messaging له).

## 2) Apple Push Notifications (آيفون)

1. ادخل <https://developer.apple.com/account/resources/authkeys> وأنشئ مفتاح **APNs** جديدًا: ينزّل ملف
   `AuthKey_XXXX.p8` (يُنزَّل مرة واحدة فقط — احتفظ به).
2. سجّل: **Key ID** (في اسم الملف) و**Team ID** (أعلى يمين حساب المطوّر).
3. حوّل المفتاح base64: `base64 -w0 AuthKey_XXXX.p8` وحطه في `APNS_KEY_P8_B64`.
4. أكمل env: `APNS_KEY_ID` و`APNS_TEAM_ID` و`APNS_BUNDLE_ID` (`com.edmneg.edmnCustomer`) و
   `APNS_SANDBOX=false` (استخدم `true` فقط لبناءات التطوير).
5. فعّل قدرة Push Notifications على الـApp ID من بوابة المطوّر.

## 3) مزوّد SMS مصري (SMS Misr)

1. أنشئ حسابًا على <https://smsmisr.com> واطلب تفعيل **اسم المرسل** (Sender ID) — يحتاج موافقة الشبكات (عادة أيام عمل).
2. من حسابك خذ **username** و**password** الخاصين بالـAPI.
3. env:
   ```
   SMS_DRIVER=smsmisr
   SMS_MISR_USERNAME=...
   SMS_MISR_PASSWORD=...
   SMS_SENDER_ID=اسم_المرسل_المعتمد
   SMS_RATE_LIMIT_PER_MINUTE=60        # حد داخلي لكل عملية (حدود المزوّد نفسها قائمة)
   SMS_FALLBACK_DRIVER=http            # اختياري: مزوّد احتياطي عام عند فشل الأساسي
   SMS_HTTP_URL=...                    # endpoint المزوّد الاحتياطي (لو فعّلت fallback)
   SMS_HTTP_TOKEN=...
   ```
   النداء الفعلي: `POST {SMS_MISR_BASE_URL}/api/SMS/` بنموذج المزوّد (username/password/sender/mobile/message/language=2 عربي).
4. في production بدون مزوّد مضبوط الإرسال **يفشل بشكل ظاهر** (لا توجد محاكاة تسليم) — دي سياسة مقصودة.

## 4) البديل: الشاشة الإدارية (بدون env)

من شاشة الإدارة ← الإشعارات (تحتاج `settings.manage` + خطوة تأكيد) تقدر تحفظ مفاتيح FCM/APNs مشفّرة في قاعدة
البيانات. لو الاتنين موجودين، **قاعدة البيانات تكسب** — فلو غيّرت المفاتيح في env امسح الصف القديم من الشاشة.

## 5) التحقق على staging (بالترتيب)

1. `EDMN_ENVIRONMENT=staging` مع المفاتيح فوق، وشغّل السيرفر والـworker.
2. فعّل الإعدادين من قاعدة البيانات: `notifications.devicePushEnabled = true` و`notifications.devicePushDriver = 'live'`.
3. سجّل دخول من تطبيق الموبايل (تسجيل التوكن تلقائي) ثم نفّذ حدثًا (مثلًا رسالة محادثة من حساب آخر) —
   الإشعار يوصل الجهاز خلال ثوانٍ. راجع جدول `device_push_deliveries` للحالة.
4. SMS: نفّذ حدثًا يولّد رسالة (كود تحقق) — تصل على الرقم. عند فشل الأساسي مع fallback مفعّل يظهر
   `outbound.sms_fallback` في السجلات.

## لم يتم التحقق في بيئة العمل

لم تُجرَ مكالمة فعلية لـFCM أو APNs أو SMS Misr (مفيش مفاتيح حقيقية هنا). إثبات كل واحدة هو خطوة 5 أعلاه
على staging. كود الـdrivers مبني على واجهات موثّقة ولم يُختبر ضد المزوّد الحقيقي — لو ردّ المزوّد مختلف،
الإصلاح في ملف واحد: `src/server/modules/notifications/providers.ts` (SMS) أو `device-push-senders.ts` (push).
