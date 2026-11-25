# تشغيل تطبيقات أضمن على الآيفون عن طريق TestFlight

البناء بيتعمل تلقائيًا على سيرفر Mac في GitHub (`.github/workflows/ios-testflight.yml`) ويترفع على TestFlight.
التطبيقات بتكلّم **staging** (`https://edmn-staging.vercel.app`)، والفلوس الحقيقية مقفولة.

## المطلوب من المالك مرة واحدة

### 1) App Store Connect: إنشاء التطبيقين
- appstoreconnect.apple.com ← **Apps** ← **+** ← **New App**.
- تطبيق العميل: المنصة iOS، الاسم «أضمن»، **Bundle ID: `com.edmneg.edmnCustomer`**.
- تطبيق الإدارة: **Bundle ID: `com.edmneg.admin.edmnAdmin`**.
- لو الـBundle ID مش ظاهر في القائمة: developer.apple.com ← Certificates, Identifiers & Profiles ←
  Identifiers ← **+** ← App IDs، وسجّله. لتطبيق العميل فعّل **Associated Domains** (روابط فتح التطبيق).

### 2) مفتاح App Store Connect API
- App Store Connect ← **Users and Access** ← **Integrations** ← **App Store Connect API** ← **+**.
- الصلاحية: **Admin** (لازم علشان Xcode يعمل شهادة التوزيع والملفات لوحده).
- نزّل ملف **`.p8`** (بيتنزل مرة واحدة بس)، واكتب **Key ID** و**Issuer ID**.

### 3) Team ID
- developer.apple.com ← **Membership details** ← **Team ID** (10 حروف/أرقام).

### 4) حطّهم في GitHub (مش في الشات ولا في الكود)
GitHub ← المستودع ← **Settings** ← **Secrets and variables** ← **Actions**:

| النوع | الاسم | القيمة |
|---|---|---|
| Secret | `APP_STORE_CONNECT_API_KEY_ID` | Key ID |
| Secret | `APP_STORE_CONNECT_API_ISSUER_ID` | Issuer ID |
| Secret | `APP_STORE_CONNECT_API_KEY_P8` | محتوى ملف `.p8` كامل (افتحه بأي محرر نصوص وانسخه كله) |
| Variable | `APPLE_TEAM_ID` | Team ID |

## التشغيل
- Claude بيعمل commit فيه `[testflight]` على فرع `claude/instinct-integration` ← البناء يشتغل (حوالي 20–30 دقيقة).
- بعد ما Apple تخلص معالجة النسخة (من 10 لـ30 دقيقة): App Store Connect ← التطبيق ← **TestFlight** ←
  **Internal Testing** ← ضيف نفسك وفريقك.
- نزّل تطبيق **TestFlight** من App Store على الآيفون، وهتلاقي «أضمن» فيه.

## ملاحظات
- أول رفع ممكن Apple تطلب **Export Compliance** (التشفير): التطبيق بيستخدم HTTPS عادي بس ← اختار إنه
  مستثنى (standard encryption only).
- رقم النسخة (build number) هو رقم تشغيل GitHub، فكل بناء بيطلع برقم أكبر تلقائيًا.
- لو البناء فشل في خطوة «Check owner setup» يبقى فيه Secret أو Variable ناقص من البند 4.
