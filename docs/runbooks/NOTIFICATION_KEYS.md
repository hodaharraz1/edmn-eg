# إدخال مفاتيح الإشعارات (Firebase / Apple) وتشغيل الإرسال الفعلي

> مبني على `src/server/modules/notifications/device-push.ts` و`device-push-senders.ts` وصفحة `/admin/notifications`. **المفاتيح مالك فقط:** بيتم إنشاؤها من حساب Firebase وحساب Apple Developer التابعين للشركة.

## الوضع الافتراضي (آمن)
- `notifications.devicePushEnabled` = مقفول، و`notifications.devicePushDriver` = `log`. الإرسال لا يحصل فعليًا. التطبيقات بتسجّل رمز الجهاز فقط.
- المفاتيح بتتحفظ **مشفّرة** في السيرفر، ولا تتعرض تاني ولا تتسجّل في أي لوج. لا تحطها في الكود ولا في متغيرات البيئة ولا في دردشة.

## المتطلبات
- صلاحية `settings.manage` + تأكيد هوية.
- Firebase: ملف حساب الخدمة (JSON) من Firebase Console (Project settings، Service accounts). بيحتوي project_id وclient_email والمفتاح الخاص.
- Apple: Team ID وKey ID وBundle ID (تطبيق iOS للعميل: `com.edmneg.edmnCustomer`) ومحتوى ملف المفتاح `.p8` من Apple Developer (Keys، مع تفعيل APNs).

## الخطوات
1. ادخل `/admin/notifications` وأكمل تأكيد الهوية. قسم «مفاتيح الإرسال الفعلي (Firebase / Apple)» لا يظهر إلا لصاحب `settings.manage`.
2. **Firebase:** الصق محتوى ملف JSON كما نزّلته في الخانة واضغط «حفظ مشفّرًا». لو الملف ناقص بيرفض بـ«بيانات Firebase غير مكتملة».
3. **Apple:** املأ Team ID وKey ID وBundle ID والصق محتوى ملف `.p8`. علّم «بيئة Sandbox» لو بتجرّب بنسخة تطوير فقط. ثم «حفظ مشفّرًا».
4. بعد الحفظ الشاشة بتعرض بيانات غير سرية فقط (المزوّد، مين حدّث وإمتى).
5. **التجربة قبل الإنتاج:** ابدأ بـ Sandbox لـ Apple وجهاز تجريبي واحد.
6. التشغيل (بقرار المالك، كل خطوة بتأكيد هوية من `/admin/settings`): فعّل `notifications.devicePushDriver` = `live` ثم `notifications.devicePushEnabled`.
7. راقب أعداد الأجهزة في نفس الصفحة وأخطاء الإرسال. الرموز غير الصالحة (404 أو 410 أو 400) بتتعلّم تلقائيًا. مزوّد من غير مفاتيح صالحة **يفشل مغلقًا** (لا إرسال).

## الطوارئ
- إيقاف فوري: `notifications.devicePushEnabled` = مقفول (بيتقرأ مع كل إرسال).
- لو المفتاح اتسرّب: ألغه من Firebase/Apple فورًا، أنشئ بديل، واحفظه بنفس الخطوات، واتبع `SECRET_ROTATION.md` و`INCIDENT_RESPONSE.md`.

## ملاحظات
- Associated Domains (iOS) لازم تتفعّل في حساب Apple Developer وملف الـprovisioning وقت النشر وإلا ما تتوقّعش بناء على الأجهزة (راجع `docs/mobile/DEEP_LINKS.md`).
