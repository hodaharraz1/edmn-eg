# توقيع وبناء Android للمتجر (AAB)

الهدف: نسخة إصدار موقّعة بمفتاح إصدار حقيقي — لا يُستخدم مفتاح الـdebug في أي نسخة release أبدًا.
البناء الرسمي يحصل في GitHub Actions (`.github/workflows/android-play.yml`) والأسرار تعيش في GitHub Secrets فقط.

## 1) إنشاء مفتاح الإصدار (مرة واحدة، على جهاز المالك)

```bash
keytool -genkeypair -v -keystore edmn-release.jks -keyalg RSA -keysize 4096 -validity 10000 \
  -alias edmn-release -storetype JKS
```

- خزّن الملف في مكان آمن خارج المستودع (مدير كلمات مرور/خزنة). فقدان المفتاح يعني استحالة تحديث التطبيق على Play.
- اختار كلمتي مرور قويتين ومختلفتين للمخزن وللمفتاح.

## 2) رفع الأسرار إلى GitHub (مرة واحدة)

```bash
base64 -w0 edmn-release.jks   # على macOS: base64 -i edmn-release.jks | tr -d '\n'
```

في المستودع: Settings → Secrets and variables → Actions، بيئة `play` المحمية:

| الاسم | النوع | القيمة |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | secret | ناتج الأمر أعلاه |
| `EDMN_KEYSTORE_PASSWORD` | secret | كلمة مرور المخزن |
| `EDMN_KEY_PASSWORD` | secret | كلمة مرور المفتاح |
| `EDMN_KEY_ALIAS` | variable | `edmn-release` |

فعّل حماية البيئة (Required reviewers) حتى لا يعمل الـworkflow بدون موافقة.

## 3) البناء والنشر

1. ادفع commit رسالته تبدأ بـ`[play]` على فرع التكامل (أو شغّل الـworkflow يدويًا).
2. حمّل artifact باسم `<app>-aab` (فيه `app-release.aab` ومجلد رموز التنقيح `symbols/`).
3. أول رفع لكل تطبيق يكون يدويًا من Play Console → Internal testing. **احتفظ بمجلد `symbols/`** — يرفع على
   Play Console مع الـAAB حتى تكون تقارير الأعطال مقروءة بعد الـobfuscation، وفي Firebase Crashlytics عند ربطها.

## 4) البناء المحلي للتجربة (اختياري)

أنشئ `apps/<app>/android/keystore.properties` (ملف محلي، ممنوع رفعه — وهو ضمن .gitignore):

```
storeFile=/المسار/الكامل/edmn-release.jks
storePassword=...
keyAlias=edmn-release
keyPassword=...
```

بدون هذا الملف، بناء الـrelease يفشل برسالة واضحة — وهذا مقصود.

## 5) تدوير المفتاح

إذا تسرّب المفتاح: أنشئ مفتاحًا جديدًا، اطلب ترقية مفتاح التوقيع من Play Console (Play App Signing يسمح بذلك)،
وحدّث الأسرار الأربعة. سجّل التدوير في سجل الضوابط الأمنية.

## لم يتم التحقق في هذه البيئة

لم يُبنَ AAB فعليًا هنا (لا Flutter SDK ولا أسرار). الإثبات: تشغيل الـworkflow على GitHub بعد إتمام الخطوة 2،
والتأكد من نجاح خطوة `Build the signed AAB` وظهور الـartifact.
