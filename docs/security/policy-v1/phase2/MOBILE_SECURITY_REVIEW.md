# مراجعة أمن الموبايل (تطبيق العميل وتطبيق الإدارة)

**التاريخ:** 19 نوفمبر 2026

**أساس الحكم:** مراجعة كود + اختبارات آلية. **لم يُختبر شيء على جهاز حقيقي في هذه المرحلة.** لا جهاز iOS ولا Android SDK في بيئة العمل. لم تُطلب ولم تُستخدم مفاتيح توقيع إنتاجية.

| البند | النتيجة | الدليل | يحتاج جهازًا؟ |
|---|---|---|---|
| **1. البيانات الحساسة في التخزين المحلي** | PASS (كود) | `session_store.dart`: لا يُخزَّن إلا refresh token ومعرّف التثبيت، في `flutter_secure_storage`. رمز الوصول في الذاكرة فقط. لا SharedPreferences لبيانات حساسة. التليمتري مُنقّح (`observability`) | تأكيد على جهاز rooted (MASTG) |
| **2. دورة الجلسة وKeychain** | **أُغلق في الكود** (كان Q-1) | `SecureSessionStore._ensureFreshInstall`: عند أول تشغيل بعد التثبيت (لا يوجد ملف علامة في Application Support) تُمسح الجلسة من Keychain. iOS يُبقي Keychain بعد حذف التطبيق، فإعادة التثبيت كانت تستعيد الجلسة. المسح ضمن namespace التطبيق فقط. 3 اختبارات في `session_store_test.dart`. Keychain بإعداد `first_unlock_this_device` (لا ينتقل لجهاز آخر). commit `c4a16c8` | **نعم:** حذف التطبيق وإعادة تثبيته على iPhone، ثم التأكد من طلب تسجيل الدخول |
| **3. خصوصية لقطات الشاشة، iOS للإدارة** | **أُغلق في الكود** (كان SEC-O03) | `EdmnPrivacyShield` يغطي الواجهة بغطاء بلون العلامة عند أي حالة غير `resumed`، فلقطة مُبدّل التطبيقات لا تُظهر بيانات. اختبار دورة الحياة في `admin_app_test.dart`. Android: `FLAG_SECURE` (v1.0). **ملاحظة:** iOS لا يسمح بمنع لقطة الشاشة اليدوية. الغطاء يحمي مُبدّل التطبيقات فقط | **نعم:** فتح مُبدّل التطبيقات على iPhone |
| **4. النسخ الاحتياطي على Android** | PASS (إعداد) | `allowBackup=false`، `fullBackupContent=false`، `data_extraction_rules.xml` يستبعد كل النطاقات للتطبيقين (v1.0، commit `9644033`) | تأكيد: `adb backup` / Device-to-device لا ينقل بيانات |
| **5. HTTPS** | PASS (كود) | `BuildConfig` يرفض أي مخطط غير https لبيئتي staging وproduction (خطأ عند الإقلاع). لا مفتاح تشغيل لتغيير ذلك. cleartext مسموح فقط في `src/debug/AndroidManifest.xml`. في iOS فقط `NSAllowsLocalNetworking`، لا `NSAllowsArbitraryLoads` | تأكيد: بناء release يرفض http. **Certificate pinning غير مطبق**، مقترح لاحق وليس شرطًا |
| **6. التعامل مع الملفات** | **تحسّن** | نسخ المنتقي في الكاش تُحذف بعد القراءة (`FilePicker.clearTemporaryFiles`، commit `c4a16c8`). المرفقات الخاصة لا تُحفظ على القرص إلا بأمر صريح. القائمة مطابقة للخادم، وأُزيل HEIC (SEC-F09، commit `31d0d47`) | تأكيد مسح الكاش على Android |
| **7. فصل Debug/Release** | PASS (كود)، البناء غير متحقق | البيئة تُحدَّد وقت البناء (`--dart-define`)، لا من إعداد يغيّره المستخدم. cleartext في manifest الـ debug فقط. **لم يُبنَ APK release هنا** (لا Android SDK). CI يبني ويختبر | بناء release وفحص `aapt dump xmltree` للـ manifest المدمج |

## الاختبارات بعد التغييرات

| الحزمة | النتيجة |
|---|---|
| `edmn_core` | 16 ✓ |
| `edmn_design` | 9 ✓ |
| `edmn_api` | 3 ✓ |
| `customer_mobile` | 43 ✓ |
| `admin_mobile` | 5 ✓ |

`flutter analyze`: لا مشاكل في الحزم الخمس.

## المتبقي
- كل بند «نعم» في عمود الجهاز = اختبار يدوي قبل PASS نهائي.
- اختبار MASTG مستقل (انظر `DAST_AND_PENTEST_PLAN.md`).
- Root/jailbreak detection وcertificate pinning غير مطبقين. اختياريان حسب تقييم المخاطر، ولا أقرّر قبولهما نيابة عنك.
