# الروابط المباشرة للتطبيق (PKG-LINKS-01)

روابط المتجر المتشاركة (واتساب، SMS، إيميل) بتفتح جوه تطبيق العميل مباشرة لما المنصة تتحقق من ملكية
الدومين، وبتفضل تفتح الموقع لو التطبيق مش متسطب أو لو التحقق مش متظبط لسه. مفيش وضع وسط بيدّعي ملكية
من غير إثبات.

## الروابط المقصودة ومصيرها

| الرابط على الويب | في التطبيق |
| --- | --- |
| `/product/{slug}` | `/products/{slug}` (شاشة المنتج) |
| `/account/orders/{id}` و`/account/orders/{id}/pay` | `/orders/{id}` (شاشة الطلب وفيها حالة الدفع) |
| `/deal/invite/{token}` | `/deals/join?token={token}` (شاشة الانضمام للصفقة) |
| `/deal-invite/{token}` (قديم) | نفس سطر الانضمام |
| `/products/*` و`/orders/*` و`/deals/*` (روابط التطبيق نفسه) | بتفتح كما هي |

أي مسار تاني بيفضل على الموقع (ده المقصود: الموقع هو البديل الآمن دايمًا).
الروابط المحمية بتعدّي على نفس فحص الجلسة الموجود: لو العميل مش مسجّل دخوله بيتحوّل لتسجيل الدخول
ويرجع لنفس الرابط بعدها.

## ملفات التحقق (الويب)

- `/.well-known/assetlinks.json` — أندرويد App Links.
- `/.well-known/apple-app-site-association` — iOS Universal Links (JSON من غير توقيع، من غير امتداد).

الاتنين بيطلعوا **فاضيين عمدًا** لحد ما القيم الحقيقية تتحط وقت النشر. الفاضي آمن: المنصة بتكمل تفتح الموقع.

## خطوات النشر (بالقيم الحقيقية)

1. **أندرويد:** من Play Console ← التطبيق ← Setup/App integrity ← App signing، خد بصمات SHA-256 بتاعة
   مفتاح التوقيع (ومفتاح الرفع لو بتستخدمه محليًا)، وحطها في متغير البيئة
   `APP_LINKS_ANDROID_SHA256` مفصولة بفواصل. اسم الحزمة الافتراضي `com.edmneg.edmn_customer`
   (يتغيّر بـ `APP_LINKS_ANDROID_PACKAGE` لو اتغيّر فعلًا).
2. **iOS:** Team ID من حساب Apple Developer (Membership details)، وحطه في `APP_LINKS_IOS_TEAM_ID`.
   معرّف الحزمة الافتراضي `com.edmneg.edmnCustomer` (يتغيّر بـ `APP_LINKS_IOS_BUNDLE_ID`).
3. **اتأكد بعد النشر:**
   - `curl https://www.edmneg.com/.well-known/assetlinks.json` يرجع البصمات الحقيقية (مش فاضي).
   - `curl https://www.edmneg.com/.well-known/apple-app-site-association` يرجع appID كامل
     (Team ID + Bundle ID).
   - أندرويد: `adb shell am start -a android.intent.action.VIEW -d "https://www.edmneg.com/product/..." com.edmneg.edmn_customer`
     أو من App Links verification في Play Console.
   - iOS: افتح الرابط من ملاحظات/رسايل على جهاز حقيقي (المحاكي بيفتح Universal Links برضه
     بـ `xcrun simctl openurl booted "https://www.edmneg.com/product/..."`).

## ممنوع

- ممنوع كتابة بصمة أو Team ID أو أي قيمة توقيع جوه الكود أو الاختبارات، حتى كمثال شكلي — القيم بتيجي من
  البيئة وقت النشر بس.
- ممنوع تفعيل `autoVerify` على دومين من غير ما ملف التحقق يكون منشور بالقيم الحقيقية.

## التنفيذ (للمراجعة)

- الويب: `src/server/core/app-links.ts` (بناء الحمولتين، فاضي آمن)، المسارين تحت `src/app/.well-known/`.
- التطبيق: `lib/src/deep_links.dart` (تحويل مسار الويب لمسار التطبيق)، مربوط في `router.dart`، فلاتر
  الأندرويد في `AndroidManifest.xml` (مع `autoVerify`)، وUniversal Links في `Runner.entitlements`.
- اختبارات: `tests/unit/app-links.test.ts` (ويب)، `apps/customer_mobile/test/deep_links_test.dart` (تطبيق).

## ملاحظة للمالك: Associated Domains على iOS
لازم تفعيل قدرة **Associated Domains** في حساب Apple Developer (معرّف التطبيق `com.edmneg.edmnCustomer`) وفي ملف الـprovisioning وقت النشر، وإلا فشل توقيع بناء الأجهزة. ملف `apple-app-site-association` بيفضل فاضي لحد ما المالك يدّينا Team ID.
