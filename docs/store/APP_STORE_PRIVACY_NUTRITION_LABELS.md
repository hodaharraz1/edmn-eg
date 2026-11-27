# ملصقات الخصوصية لـApp Store (Privacy Nutrition Labels)

تُملأ في App Store Connect ← صفحة التطبيق ← App Privacy. الإجابات أدناه جاهزة للنسخ. القاعدة: أجب عن كل
البيانات التي يجمعها التطبيق **أو يرسلها للخادم**، حتى لو التخزين على الخادم فقط.

## تطبيق العملاء (EDMN)

| القسم في Connect | الإجابة |
| --- | --- |
| Contact Info — Name / Email / Phone | YES — مرتبطة بالهوية، لغرض App Functionality (الحساب والتسليم والدفع) |
| Contact Info — Physical Address | YES — عناوين التسليم، App Functionality |
| Identifiers — User ID | YES — رقم الحساب الداخلي، App Functionality |
| Identifiers — Device ID | YES — معرّف التثبيت (installation id) للإشعارات والجلسات، App Functionality + Analytics داخلي |
| Financial Info — Payment Info | YES — يعالجه مزوّد الدفع (Paymob) ولا تلمسه خوادمنا؛ أجب YES لأن التطبيق يعرض عمليات الدفع — Product Personalization لا، App Functionality نعم |
| Purchases — Purchase History | YES — سجل الطلبات، App Functionality |
| Location — Precise Location | YES (اختياري، بإذن المستخدم) — لتحديد عنوان التسليم فقط، App Functionality. **لا** نجمع الموقع في الخلفية |
| User Content — Photos/Videos | YES — صورة الملف الشخصي وصور المنتجات للبائع، App Functionality |
| Usage Data — Product Interaction | YES — تحليلات داخلية لتحسين التطبيق، Analytics |
| Diagnostics — Crash Data | YES — تقارير الأعطال، Analytics |
| Tracking | **NO** — لا نتتبع عبر التطبيقات والمواقع الأخرى ولا نشارك مع مزوّدي إعلانات، فلا يلزم ATT prompt |

## تطبيق الإدارة (EDMN Admin)

نفس الإجابات الخاصة بالحساب والجهاز والتحليلات، بدون الموقع الدقيق والعناوين والمشتريات. التطبيق داخلي
للموظفين — إن وُزّع عبر Apple Business Manager المخصص (Custom App Distribution) تُملأ نفس الصفحة.

## ملاحظات إلزامية قبل الإرسال

- رابط سياسة الخصوصية مطلوب في Connect ويجب أن يطابق هذه الإجابات حرفيًا (انظر `docs/store/PLAY_DATA_SAFETY_FORM.md`).
- صفحة حذف الحساب المنشورة: انظر `docs/store/ACCOUNT_DELETION_PAGE.md` — رابطها يُذكر في وصف التطبيق.
- أي ميزة جديدة تجمع بيانات جديدة ⇒ حدّث هذه الصفحة قبل إرسال التحديث للمراجعة.

## لم يتم التحقق

لم تُملأ في App Store Connect فعليًا (تحتاج حساب المالك). الإثبات: مطابقة هذه الصفحة مع ما أُرسل في Connect
وقبول المراجعة.
