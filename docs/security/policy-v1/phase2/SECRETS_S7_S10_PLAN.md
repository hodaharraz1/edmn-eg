# خطة معالجة الأسرار المكشوفة S7–S10

**التاريخ:** 19 نوفمبر 2026

**المصادر:** `docs/security/SECRET_EXPOSURE_REGISTER.md`، `docs/runbooks/SECRET_ROTATION.md`، `docs/STAGING_DEPLOYMENT_REPORT.md`، وفحص المستودع.

**لا تحتوي هذه الوثيقة أي قيمة سرية.** لم يُدوَّر أي سر. التدوير ينتظر موافقة المالك.

## تصحيح لتقرير Policy v1.0

S7–S10 **لم تُرفع إلى Git أبدًا**. كُشفت لأنها **لُصقت في محادثة أثناء الإعداد**:
- السجل الأصلي يذكر ذلك صراحة.
- فحص التاريخ الكامل للمستودع على القيم نفسها أعطى 0.

تقرير v1.0 وصفها خطأً بأنها «مكشوفة في Git». صُحّح ذلك في السجلات المحدّثة:
- SEC-120 (أسرار Git) = PASS.
- الخطر الحقيقي = SEC-045 (سر مكشوف خارج Git، يجب إلغاؤه).

## الجدول

| | S7 | S8 | S9 | S10 |
|---|---|---|---|---|
| **النوع** | رمز نشر Vercel (Deploy/Access Token) | Neon: مفتاح API + بيانات اتصال قاعدة Staging | مفتاح Render API | رمز Hugging Face |
| **الخدمة المالكة** | Vercel (حساب المالك) | Neon (مشروع Staging) | Render | Hugging Face |
| **هل ما زال مستخدمًا؟** | **غالبًا لا.** المستودع لا يستخدمه في أي workflow أو سكربت. النشر يتم عبر ربط Vercel بـ GitHub. كان لازمًا لأوامر CLI أثناء الإعداد فقط | **مفتاح API: لا** (لا شيء في المستودع يستدعي Neon API). **كلمة مرور القاعدة: نعم**، تعتمد عليها `DATABASE_URL` في Vercel و`STAGING_MIGRATION_DATABASE_URL` في بيئة GitHub `staging` | **لا.** جُرّب Render ثم تُرك لأنه يطلب بطاقة دفع (`STAGING_DEPLOYMENT_REPORT.md`) | **لا.** جُرّبت Spaces ثم تُركت لأنها تحتاج اشتراك PRO |
| **هل أُلغي؟** | **غير مؤكد**: لا وصول للتحقق | غير مؤكد | غير مؤكد | غير مؤكد |
| **يحتاج إعادة إصدار؟** | لا، إلا إذا احتجت CLI. وقتها رمز جديد بنطاق مشروع واحد وتاريخ انتهاء | مفتاح API: لا. **كلمة مرور القاعدة: نعم** (تغيير كلمة مرور الدور، لا قاعدة جديدة) | لا | لا |
| **ما يعتمد عليه** | لا شيء معروف | Vercel env (`DATABASE_URL` و`DATABASE_URL_UNPOOLED` إن وُجد) + سر GitHub `STAGING_MIGRATION_DATABASE_URL` | لا شيء | لا شيء |
| **الأثر عند الإلغاء** | لا شيء على النشر عبر GitHub | Staging يتوقف حتى تُحدَّث القيم (دقائق) | لا شيء | لا شيء |

## الخطوات لكل مزود (ينفذها المالك بنفسه، بلا لصق أي قيمة في المحادثة)

**قبل البدء:** افتح الطرفية على جهازك فقط. لا تُدخل القيم القديمة في أي محادثة أو تذكرة.

### S7: Vercel
1. Vercel ← صورة الحساب ← **Account Settings** ← **Tokens**.
2. احذف كل رمز أُنشئ وقت الإعداد (Delete). لا تُنشئ بديلًا إلا عند الحاجة.
3. عند الحاجة: Create بنطاق Team أو مشروع `edmn-staging` فقط، مع **Expiration** (مثلًا 30 يومًا).

### S8: Neon
1. **مفتاح API:** Neon Console ← **Account settings** ← **API keys** ← Revoke للمفاتيح القديمة.
2. **كلمة مرور القاعدة:** Project `edmn_staging` ← **Roles** ← الدور المستخدم ← **Reset password**. افعل ذلك لدور التشغيل ولدور الترحيل إذا كانا منفصلين.
3. حدّث فورًا:
   - Vercel ← المشروع ← Settings ← **Environment Variables** ← `DATABASE_URL` (وأي متغير اتصال آخر) لبيئة Preview/Production المستخدمة لـ Staging.
   - GitHub ← المستودع ← Settings ← **Environments** ← `staging` ← Secrets ← `STAGING_MIGRATION_DATABASE_URL`.
4. Redeploy لـ Staging من Vercel (بموافقتك، فهو نشر).

### S9: Render
Render Dashboard ← **Account Settings** ← **API Keys** ← Revoke. وإذا لم يعد مستخدمًا: احذف أي خدمة قديمة، أو احذف الحساب.

### S10: Hugging Face
huggingface.co ← **Settings** ← **Access Tokens** ← Invalidate/Delete لكل رمز قديم. احذف أي Space قديمة للمشروع إن وُجدت.

## التحقق من إبطال القديم (على جهازك، دون كتابة القيمة في السجل)

```bash
read -rs OLD            # الصق القيمة القديمة هنا (لا تظهر على الشاشة ولا تُحفظ في history)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OLD" https://api.vercel.com/v2/user              # S7 → 401/403
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OLD" https://console.neon.tech/api/v2/projects   # S8 API → 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OLD" https://api.render.com/v1/owners           # S9 → 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OLD" https://huggingface.co/api/whoami-v2       # S10 → 401
unset OLD
```

- **S8 (كلمة مرور القاعدة):** `psql "<رابط الاتصال القديم>" -c 'select 1'` يجب أن يفشل بـ `password authentication failed`. اكتب الرابط من ملف محلي مؤقت ثم احذفه.
- **المطلوب:** 401 أو 403 لكل رمز، وفشل المصادقة للقاعدة. أي 200 يعني أن الرمز ما زال صالحًا.

## بعد التنفيذ

حدّث `SECRET_EXPOSURE_REGISTER.md`: الحالة «أُلغي في <التاريخ>، تحقق 401»، بلا قيم. بعدها تتحول SEC-045 وSEC-O01 إلى PASS بدليل.
