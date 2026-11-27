# سجل الضوابط الأمنية — EDMN (183 ضابطًا)

**المشروع:** EDMN (أضمن ماركت): منصة الويب + Mobile API + تطبيقا العميل والإدارة
**التصنيف:** Tier 1، عالي الخطورة (`SECURITY_INVENTORY.md` §6)
**تاريخ آخر تحقق لكل البنود:** 25 نوفمبر 2026 (PKG-SEC-02 على الرأس `9c3a411`، ثم روجع ما أضافه `f9e2e87` و`588e2ca` وهو ملفا workflow ووثيقة فقط). تفاصيل إعادة التحقق في `SECURITY_REVERIFICATION_2026-11-25.md`. الضوابط SEC-161 إلى SEC-183 أضيفت في هذا التحقق للميزات اللاحقة لـ 19 نوفمبر
**التحقق:** من المستودع والاختبارات والفحوص المحلية. لا وصول لـ Vercel أو Neon أو DNS أو GitHub Settings.

**الحالات:**
- PASS: نُفذ واجتاز التحقق، والدليل مذكور.
- FAIL: ثغرة أو فشل قائم.
- NOT TESTED: لم يُتحقق منه، والسبب مذكور.
- IN PROGRESS: جزئي.
- N/A: لا ينطبق، والسبب مذكور.
- EXCEPTION: استثناء مقترح يحتاج اعتمادًا.

**الأولوية:** P1 = قبل أي إطلاق للإنتاج · P2 = خلال 30 يومًا من الإطلاق · P3 = تحسين.

**المسؤول:** «المالك» حتى تعيين الأدوار (SEC-002). «المطور» = فريق التطوير بما فيه الوكلاء، تحت مراجعة بشرية.

**N/A و EXCEPTION تحتاج اعتماد المسؤول الأمني** (المبدأ 5). كلها هنا **مقترحة** حتى الاعتماد.

**الـ FAIL الخمسة (الأربعة الأولى من تحديث المرحلة 2 في 19/11، والخامس من PKG-SEC-02 في 25/11):**
- SEC-002: لا أدوار أمنية معيّنة.
- SEC-111 / SEC-112: **أُغلقا 26/11** (`main` محمي، فحص `gates` إلزامي).
- SEC-156: لا DAST (الخطة في `phase2/DAST_AND_PENTEST_PLAN.md`، تنتظر التصريح).
- SEC-164 (تحديث 25/11 مساءً): كان ثغرة كود (متوسطة). الإصلاح PKG-SEC-FIX-01 منشور على Issue #7 ولم يندمج، فالحالة IN PROGRESS لحد الدمج والتحقق. الـ FAIL القائمة الآن 4.

SEC-120 أصبح PASS بعد تصحيح خطأ v1.0: الأسرار S7–S10 لم تكن في Git.

الأربعة تحتاج إجراءً من المالك ولا يمكن إغلاقها من الكود.

## الملخص

| الحالة | العدد |
|---|---|
| PASS | 114 |
| IN PROGRESS | 59 |
| NOT TESTED | 24 |
| EXCEPTION (مقترح) | 4 |
| N/A (مقترح) | 3 |
| FAIL | 2 |
| **المجموع** | **206** |

> **تدقيق العدّاد (PKG-SEC-04، 27/11):** الجدول قبل الحزمة كان 183 صفًا ومجموع الحالات 183 بالفعل (103+49+22+4+3+2)، فالعدّاد كان متسقًا عند الرأس `1a83482`. الأرقام فوق بعد إضافة 23 ضابطًا جديدًا (SEC-184…SEC-206) ورفع SEC-136 من PASS إلى IN PROGRESS.

## القسم 1: الحوكمة وإدارة المخاطر

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-001 | نعم | P1 | المالك | IN PROGRESS | `SECURITY_INVENTORY.md`: التطبيقات والـ API والبيانات والنطاقات من المستودع. حسابات السحابة والـ DNS يتحقق منها المالك |
| SEC-002 | نعم | P1 | المالك | **FAIL** | لا يوجد مسؤول أمني ولا مالك بيانات معيَّن كتابةً. **إجراء المالك المطلوب (يبقى FAIL حتى يُنفَّذ):** تسمية كتابيًا (في `SECURITY_RELEASE_GATE.md` جدول التوقيعات) المسؤول الأمني ومالك البيانات وقائد الحوادث، بالاسم والتاريخ |
| SEC-003 | نعم | P1 | المالك | PASS | التصنيف Tier 1 (`SECURITY_INVENTORY.md` §6) |
| SEC-004 | نعم | P1 | المالك | PASS | `VULNERABILITY_REGISTER.md` §2 + `THREAT_MODEL.md` + `THREAT_MODEL_MOBILE_AND_AI.md` (الاحتمال والأثر والمعالجة) |
| SEC-005 | نعم | P1 | المالك | IN PROGRESS | توجد سياسات: `SECURITY.md`، `SECRET_ROTATION.md`، `DATABASE_BACKUP.md`، `TESTING_POLICY.md`، وهذه السياسة. **ينقص:** سياسة إدارة الوصول مكتوبة ومعتمدة |
| SEC-006 | نعم | P1 | المالك | IN PROGRESS | `SECURITY_INVENTORY.md` §4. تقييم المورّدين التعاقدي (DPA) لم يُنفذ |
| SEC-007 | نعم | P1 | المالك + قانوني | NOT TESTED | مصر: قانون حماية البيانات 151/2020 ولوائح البنك المركزي عند الأموال الحقيقية. يحتاج مختصًا قانونيًا. موجود: `docs/POLICY_LEGAL_REVIEW.md`، `LEGAL_WORDING_REVIEW.md` |
| SEC-008 | نعم | P1 | المالك | IN PROGRESS | الملاك والتصنيف في `SECURITY_INVENTORY.md`. قائمة «من يحق له الوصول» لكل أصل سحابي ناقصة |
| SEC-009 | نعم | P2 | المسؤول الأمني | IN PROGRESS | مراجعات أكتوبر 2026 (`FINAL_SECURITY_REPORT.md`) وهذه المراجعة. **ينقص:** جدول دوري معتمد (القسم «خامسًا» من السياسة) |
| SEC-010 | نعم | P1 | المالك | PASS | `SECURITY_RELEASE_GATE.md` = **NO-GO** للإنتاج حتى إغلاق الشروط |

## القسم 2: التصميم والهندسة الأمنية

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-011 | نعم | P1 | المطور | PASS | `docs/ARCHITECTURE.md`، `THREAT_MODEL_MOBILE_AND_AI.md` §1 |
| SEC-012 | نعم | P1 | المطور | PASS | حدود الثقة الأربعة في `THREAT_MODEL_MOBILE_AND_AI.md` §1 + `ATTACK_SURFACE.md` |
| SEC-013 | نعم | P1 | المطور | PASS | `THREAT_MODEL.md` (الويب والمال) + `THREAT_MODEL_MOBILE_AND_AI.md` (الموبايل والذكاء الاصطناعي) |
| SEC-014 | نعم | P1 | المطور | PASS | `SECURITY_INVENTORY.md` §2، `FILE_AND_PRIVACY_AUDIT.md` |
| SEC-015 | نعم | P1 | المالك | IN PROGRESS | الكود يفرض الفصل (`EDMN_ENVIRONMENT`، قواعد E2E محلية فقط، `deploy-policy`). عزل حسابات Vercel وNeon يتحقق منه المالك |
| SEC-016 | نعم | P1 | المطور | PASS | الإنتاج يرفض الإقلاع بإعداد غير آمن (مختبر 19 نوفمبر). المفاتيح المفقودة ← `KeyMaterialMissing`. غياب الفاحص ← الملفات الخاصة غير متاحة |
| SEC-017 | نعم | P1 | المطور | PASS | «الخادم يقرر» (`apps/README.md`)، وحارس العقد ضد حقول الهوية |
| SEC-018 | نعم | P2 | المطور | IN PROGRESS | فصل الجمهور والأسطح (Host) والمفاتيح لكل غرض. خدمة واحدة وقاعدة واحدة (monolith) |
| SEC-019 | نعم | P1 | المطور | PASS | `THREAT_MODEL_MOBILE_AND_AI.md` §4 |
| SEC-020 | نعم | P2 | المطور | PASS | `THREAT_MODEL_MOBILE_AND_AI.md` §5 + سجل القرارات في `docs/mobile/*` |

## القسم 3: المصادقة وإدارة الحسابات

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-021 | نعم | P1 | المطور | PASS | جلسات على الخادم (hash)، Bearer للموبايل. `src/server/auth/*` |
| SEC-022 | نعم | P1 | المطور | IN PROGRESS | TOTP إلزامي للموظفين (ويب الإدارة وتطبيقها). **Passkeys/FIDO2 غير مطبّق.** MFA لحسابات GitHub وVercel يتحقق منه المالك |
| SEC-023 | نعم | P1 | المطور | PASS | SEC-F03 أُصلح: قائمة شائعة + سياقية. `tests/unit/common-passwords.test.ts` |
| SEC-024 | نعم | P1 | المطور | PASS | scrypt (N=2¹⁵، r=8، p=1)، مقارنة ثابتة الزمن، توازن زمني (`password.ts`) |
| SEC-025 | نعم | P1 | المطور | PASS | 30/IP و10/حساب كل 15 دقيقة + قفل (`auth/service.ts:95-97`) |
| SEC-026 | نعم | P1 | المطور | PASS | رمز أحادي الاستخدام بصلاحية 30 دقيقة (`resetPassword`). مختبر في `mobile-notifications-reset.test.ts` ورحلة الهاتف |
| SEC-027 | نعم | P1 | المطور | PASS | إعادة التعيين وتغيير كلمة المرور يلغيان كل الجلسات (`service.ts` + اختبار `auth hardening`) |
| SEC-028 | نعم | P1 | المطور | PASS | `requireStepUp` في 26 ملفًا (الوجهات المالية، الهوية، الإدارة) |
| SEC-029 | نعم | P2 | المطور | IN PROGRESS | قائمة الأجهزة والجلسات وإلغاؤها (ويب + موبايل). **كشف الدخول غير المعتاد غير موجود** (SEC-O04) |
| SEC-030 | نعم | P2 | المطور | PASS | إغلاق الحساب (`customers/closure.ts`) مع منع السحب أثناء الإغلاق. منع الاستيلاء: التحقق من البريد والموبايل وحد المحاولات |

## القسم 4: الصلاحيات ومنع الوصول غير المصرح

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-031 | نعم | P1 | المطور | PASS | كل مسار يعلن `auth` صراحة، والافتراضي رفض (`http.ts`). صلاحيات الإدارة `requirePermission` |
| SEC-032 | نعم | P1 | المطور | PASS | RBAC للموظفين (`src/server/rbac/*`، `AUTHORIZATION_MATRIX.md`)، وصلاحيات المتجر (`finance.view`…) |
| SEC-033 | نعم | P1 | المطور | PASS | فحص IDOR لكل مسارات الموبايل بمعرّف: 0 تسريب (`SECURITY_TEST_RESULTS.md` §3) + اختبارات الويب في أكتوبر |
| SEC-034 | نعم | P1 | المطور | PASS | اختبارات على مستوى الوظيفة والبيانات، وعرض مقنّع للحقول الحساسة، وفصل الأدوار في مصفوفة الصلاحيات |
| SEC-035 | نعم | P1 | المطور | PASS | عزل البائعين والعملاء. فحص IDOR متجر ← متجر وعميل ← عميل |
| SEC-036 | نعم | P1 | المطور | PASS | لا مسار لتعديل الصلاحية الذاتية. تعيين الأدوار للإدارة فقط ومدقَّق (`rbac/staff.ts`) |
| SEC-037 | نعم | P1 | المطور | PASS | صلاحيات منفصلة (`finance.view`، `*.manage`، الموافقة) في `FINANCIAL_APPROVAL_MATRIX.md` |
| SEC-038 | نعم | P1 | المطور | PASS | Maker/Checker للتحرير والاسترداد والصرف (`makerRequest` + اختبارات `financial_approvals`) |
| SEC-039 | نعم | P2 | المالك | NOT TESTED | لا توجد مراجعة دورية موثقة لحسابات الموظفين وحسابات الخدمات |
| SEC-040 | نعم | P1 | المالك | NOT TESTED | الكود يدعم تعطيل الموظف وإلغاء جلساته. إجراء الإنهاء (offboarding) لحسابات GitHub وVercel وNeon غير موثق |

## القسم 5: التشفير وإدارة الأسرار

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-041 | نعم | P1 | المالك | IN PROGRESS | HSTS preload، والنسخ المستضافة HTTPS فقط. إصدار TLS من Vercel (1.2/1.3) يتحقق منه المالك |
| SEC-042 | نعم | P1 | المطور | PASS | AES-256-GCM حقلي للهوية والصرف وTOTP (`core/crypto.ts`). وسم 16 بايت (SEC-F02) |
| SEC-043 | نعم | P1 | المالك | IN PROGRESS | مفاتيح Staging في Vercel encrypted env. **لا KMS أو Secret Manager مخصص للإنتاج بعد** |
| SEC-044 | نعم | P1 | المطور | PASS | فحص الأسرار (الشجرة + التاريخ) = 0. لا أسرار في تطبيقات Flutter (فحص). `NEXT_PUBLIC_*` بلا أسرار |
| SEC-045 | نعم | P1 | المالك | IN PROGRESS | التدوير مدعوم (`DATA_ENCRYPTION_KEY_ID` و`_PREVIOUS` و`scripts/reencrypt.ts`، `SECRET_ROTATION.md`). **S7–S10 لُصقت في محادثة إعداد ولم تُلغَ بعد** (SEC-O01). خطة لكل مزود مع تحقق 401: `phase2/SECRETS_S7_S10_PLAN.md` |
| SEC-046 | نعم | P1 | المطور | PASS | مفاتيح لكل غرض. الإنتاج يرفض المفاتيح المشتقة (`keys.ts`)، والمفاتيح التجريبية عشوائية لكل تشغيل |
| SEC-047 | نعم | P1 | المطور | PASS | تنقيح السجلات والأخطاء (`logger`، `error-tracking` redaction، `Telemetry.redact` في Flutter). روابط البريد السرية لا تُطبع |
| SEC-048 | نعم | P1 | المطور | PASS | `node:crypto` فقط (scrypt، AES-GCM، HMAC، HKDF). لا خوارزميات مخصصة. Semgrep أكد ولم يجد غير SEC-F02 |
| SEC-049 | نعم | P2 | المالك | NOT TESTED | من يصل لمفاتيح Vercel وسجل استخدامها: خارج المستودع |
| SEC-050 | نعم | P2 | المالك | IN PROGRESS | `SECRET_ROTATION.md` + `reencrypt.ts`. لم يُنفَّذ تمرين إعادة تشفير على بيانات حقيقية |

## القسم 6: تأمين الويب والمتصفح

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-051 | نعم | P1 | المطور | PASS | React يرمّز المخرجات. CSP بـ nonce + `strict-dynamic`. لا `dangerouslySetInnerHTML` بمحتوى المستخدم (`FINAL_SECURITY_REPORT.md`) |
| SEC-052 | نعم | P1 | المطور | EXCEPTION | CSP قوية، عدا `style-src 'unsafe-inline'` (SEC-O06، مقترح قبوله) |
| SEC-053 | نعم | P1 | المطور | PASS | Server Actions تتحقق من Origin، وSameSite=Lax، والموبايل Bearer |
| SEC-054 | نعم | P1 | المطور | PASS | `httpOnly`، `secure` (مستضاف)، `sameSite: 'lax'` (`web/session.ts:32-34`) |
| SEC-055 | نعم | P1 | المطور | PASS | HSTS، nosniff، Referrer-Policy، Permissions-Policy، COOP (مختبرة) |
| SEC-056 | نعم | P1 | المطور | PASS | `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| SEC-057 | نعم | P1 | المطور | PASS | `safe-next.ts` (AUTH-06)، `tests/unit/safe-next.test.ts` |
| SEC-058 | نعم | P1 | المطور | PASS | مفاتيح التخزين مولّدة على الخادم وليست أسماء المستخدم. `/media` يرجع 404 لغير الموجود. `FILE_AND_PRIVACY_AUDIT.md` |
| SEC-059 | نعم | P1 | المطور | IN PROGRESS | فحص النوع بالمحتوى (magic) والحجم والأبعاد، إعادة ترميز `sharp`، تخزين خاص. بوابة الإنتاج fail-closed مثبتة باختبار (`upload-scan-gate.test.ts`، commit `76d8395`). **لا فاحص مُشغَّل** (SEC-O02). الخيارات: `phase2/FILE_UPLOAD_SECURITY.md` |
| SEC-060 | نعم | P1 | المطور | PASS | الأخطاء `internal_error` بلا stack، والإنتاج يرفض الإعداد غير الآمن |

## القسم 7: تأمين واجهات API والتكاملات

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-061 | نعم | P1 | المطور | PASS | كل مسار يعلن `auth`، وحارس العقد يتحقق من المسارات الحساسة |
| SEC-062 | نعم | P1 | المطور | PASS | zod للمدخلات والمخرجات (`defineRoute` + OpenAPI مولّد ومتحقق في CI) |
| SEC-063 | نعم | P1 | المطور | PASS | `rate` لكل مسار + `enforce` في المصادقة والرسائل والتسجيل. **PKG-SEC-04 (27/11):** حدود على الحافة في nginx (`limit_req` لـ `/api/files` و`/api/products/cards` و`/api/webhooks`) وحدود تطبيقية داخل الثلاثة (`deploy/proxy/nginx/edmn.conf`, `proxy-common.conf`, `src/app/api/*/route.ts`). **لم يتم التحقق:** `nginx -t` لم يُشغّل (nginx مش مثبت في بيئة الحزمة) |
| SEC-064 | نعم | P1 | المطور | PASS | لا CORS لأي أصل خارجي (preflight من أصل غريب بلا ACAO) |
| SEC-065 | نعم | P1 | المطور | PASS | Drizzle باستعلامات بمعاملات، وقوالب `sql` آمنة. لا shell بمدخلات المستخدم. Semgrep: 0 |
| SEC-066 | نعم | P1 | المطور | PASS | الطلبات الصادرة لعناوين من الإعدادات فقط (SMS، الفاحص، تتبع الأخطاء). لا URL من المستخدم |
| SEC-067 | نعم | P1 | المطور | PASS | webhooks البريد: توقيع Svix/HMAC مع نافذة زمنية (`delivery-events.ts`، `infra-adapters.test.ts`) |
| SEC-068 | نعم | P1 | المطور | PASS | Idempotency-Key للكتابات، وأحداث المزوّد idempotent بالمعرّف |
| SEC-069 | نعم | P2 | المطور | IN PROGRESS | Timeouts في المزوّدين (`providers.ts`)، وإعادة المحاولة والـ dead-letter في الـ outbox. **لا Circuit Breaker** |
| SEC-070 | نعم | P2 | المطور | PASS | `openapi/mobile.v1.json` و`admin.v1.json` مولّدان ومتحققان. الإصدار `/v1` + `minSupportedVersion` |

## القسم 8: قواعد البيانات والخصوصية

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-071 | نعم | P1 | المالك | IN PROGRESS | دور تشغيل DML فقط، ودور الترحيل في بيئة GitHub منفصلة (`migrate-staging.yml`). قيود الشبكة على Neon يتحقق منها المالك |
| SEC-072 | نعم | P2 | المطور | EXCEPTION | الصلاحية على مستوى التطبيق، لا Row Level Security في PostgreSQL. مقترح: قبول، مع الاعتماد على اختبارات IDOR والمشغلات |
| SEC-073 | نعم | P1 | المالك | IN PROGRESS | دورا التشغيل (DML) والترحيل (DDL) منفصلان. دور القراءة فقط للتقارير غير موجود |
| SEC-074 | نعم | P1 | المالك | IN PROGRESS | تشفير حقلي للحساس. تشفير القاعدة والنسخ عند Neon يتحقق منه المالك |
| SEC-075 | نعم | P1 | المطور | PASS | الاختبارات والرحلات على بيانات تجريبية فقط، وE2E يرفض قاعدة غير محلية (`global-setup.ts`) |
| SEC-076 | نعم | P2 | المالك | IN PROGRESS | الحقول ضرورية للهوية والصرف. لم تُراجع رسميًا حقلًا بحقل |
| SEC-077 | نعم | P2 | المالك | IN PROGRESS | تنقيح الأسرار المنتهية (`redactExpiredSecrets`) وإعدادات الاحتفاظ (`settings.ts`). جدول احتفاظ لكل نوع بيانات غير معتمد |
| SEC-078 | نعم | P2 | المطور | IN PROGRESS | تصحيح البيانات (الملف الشخصي) وإغلاق الحساب. **تصدير البيانات للمستخدم غير موجود** |
| SEC-079 | نعم | P2 | المطور | IN PROGRESS | `audit_logs` للتعديلات الحساسة والوصول لملفات الموظفين (مدقَّق). لا تنبيه على التصدير الجماعي |
| SEC-080 | نعم | P1 | المطور | PASS | فحص IDOR للملفات والسجلات (§3 في نتائج الاختبار) |

## القسم 9: منطق الأعمال والمعاملات الحساسة

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-081 | نعم | P1 | المطور | PASS | الأسعار والرسوم والإجماليات على الخادم بالقروش (`FEE_ENGINE.md`، `money.test.ts`، `commission.test.ts`) |
| SEC-082 | نعم | P1 | المطور | PASS | `src/domain/machines.ts` + `state-machines.test.ts`، `hardening-machines.test.ts` |
| SEC-083 | نعم | P1 | المطور | PASS | Idempotency للدفع والسحب والتسوية (`withdrawals.ts`، مفاتيح الطلب) |
| SEC-084 | نعم | P1 | المطور | PASS | أقفال `pg_advisory_xact_lock` و`for update`، وفحص التكرار بعد القفل (Codex). اختبارات التزامن في التكامل |
| SEC-085 | نعم | P1 | المطور | PASS | معاملات ذرية + قيد مزدوج + مشغلات ثبات |
| SEC-086 | نعم | P1 | المطور | PASS | الحالات النهائية في State Machines، ومشغلات ثبات القيود |
| SEC-087 | نعم | P1 | المطور | PASS | `audit_logs` غير قابلة للتعديل (`0001_integrity_triggers.sql`) + `journal_entries` |
| SEC-088 | نعم | P1 | المطور | PASS | `npm run ledger:check`: 0 فروقات، ميزان مراجعة سليم (19 نوفمبر). أُعيد التشغيل 25/11 على قاعدة الاختبار بعد تشغيل المجموعة: 0 فروقات والمدين = الدائن |
| SEC-089 | نعم | P1 | المالك | N/A | لا بطاقات: الدفع بتحويل (InstaPay، Vodafone Cash، بنك) مع إثبات. Real Money OFF. يُعاد التقييم عند إضافة مزوّد بطاقات (PCI DSS) |
| SEC-090 | نعم | P1 | المطور | PASS | اختبارات تكرار الاسترداد وحدود السحب وتغيير المستفيد (`FINANCIAL_SECURITY_AUDIT.md`، تكامل المحفظة) |

## القسم 10: البنية السحابية والشبكات

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-091 | نعم | P1 | المالك | NOT TESTED | أعضاء Vercel وNeon وصلاحياتهم: لا وصول |
| SEC-092 | نعم | P1 | المالك | NOT TESTED | MFA على GitHub وVercel وNeon والمسجّل: يتحقق منه المالك |
| SEC-093 | نعم | P1 | المالك | NOT TESTED | تعرّض Neon للإنترنت وقوائم IP |
| SEC-094 | نعم | P2 | المالك | NOT TESTED | حماية Vercel الافتراضية (DDoS)، لا WAF مخصص موثق |
| SEC-095 | نعم | P2 | المالك | NOT TESTED | قواعد الشبكة الصادرة والواردة على مستوى المزوّد |
| SEC-096 | نعم | P1 | المطور | IN PROGRESS | الإدارة: TOTP + step-up + فصل Host (`ADMIN_HOST`). لا Zero Trust Access أمام لوحة الإدارة |
| SEC-097 | نعم | P2 | المطور | IN PROGRESS | الاعتماديات محدثة (SEC-F01). `Dockerfile` للاستضافة الذاتية بلا فحص صور |
| SEC-098 | نعم | P1 | المالك | NOT TESTED | التخزين الحالي داخل القاعدة (`stored_objects`) أو محلي. إعداد S3 أو bucket للإنتاج غير موجود بعد |
| SEC-099 | نعم | P1 | المالك | NOT TESTED | DNS وRegistry Lock وDNSSEC وتجديد الشهادات (Vercel تلقائي): يتحقق منه المالك |
| SEC-100 | نعم | P2 | المالك | NOT TESTED | لا فحص Cloud Misconfiguration |

## القسم 11: كتابة الكود والتطوير الآمن

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-101 | نعم | P2 | المطور | PASS | قواعد المشروع (`AGENTS.md`، `CLAUDE.md`، حدود ESLint على DB في مسارات API، «الخادم يقرر») |
| SEC-102 | نعم | P1 | المالك | IN PROGRESS | `.github/CODEOWNERS` (المالك مراجِع إلزامي، والمسارات الحساسة صريحة) وقالب PR بقائمة تحقق أمنية (commit `5ae2a2c`). **غير ملزِم** حتى تفعيل «Require review from Code Owners» (`phase2/GOVERNANCE_STEPS.md`) |
| SEC-103 | نعم | P1 | المطور | IN PROGRESS | Semgrep نُفذ يدويًا هذه الجولة. **غير مدمج في CI بعد** |
| SEC-104 | نعم | P1 | المطور | PASS | `secret-scan.ts` للشجرة والتاريخ في CI |
| SEC-105 | نعم | P1 | المطور | PASS | `npm audit --omit=dev --audit-level=high` في CI (`c6fdec7`) + OSV للـ Dart (يدوي) |
| SEC-106 | نعم | P1 | المطور | PASS | ESLint + TypeScript + `flutter analyze` في CI |
| SEC-107 | نعم | P1 | المطور | PASS | 954 اختبارًا ناجحًا و13 متخطى (تشغيل كامل 25/11 على الرأس `9c3a411`، مع فشلين بيئيين معروفين على جهاز المراجعة: B7 وdeployment-safety)، منها مصادقة وصلاحيات ومدخلات ومنطق أعمال (`SECURITY_TEST_MATRIX.md`) |
| SEC-108 | نعم | P1 | المالك | IN PROGRESS | CI يفشل على الاختبارات. **منع الدمج** يحتاج required status checks في branch protection (يتحقق المالك) |
| SEC-109 | نعم | P2 | المطور | PASS | كل إصلاح في `VULNERABILITY_REGISTER.md` مع commit واختبار انحدار |
| SEC-110 | نعم | P1 | المطور | IN PROGRESS | الكود المولَّد بالوكلاء يمر بنفس CI. المراجعة البشرية الإلزامية تعتمد على SEC-102 |

## القسم 12: المستودعات وسلسلة التوريد

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-111 | نعم | P1 | المالك | PASS | تحقق 19/11: GitHub API يعيد `protected: false` لـ `main` ولكل الفروع. الخطوات: `phase2/GOVERNANCE_STEPS.md` §1. **إجراء المالك المطلوب (يبقى FAIL حتى يُنفَّذ):** GitHub ← Settings ← Branches ← Add rule على `main` وفق `phase2/GOVERNANCE_STEPS.md` §1 (مراجعة إلزامية، مراجعة أصحاب الكود، الفحوص `gates` و`mobile`، منع force-push والحذف، بلا استثناء للمديرين). التحقق: `GET /repos/hodaharraz1/edmn-eg/branches/main` يعيد `protected: true`. آخر فحص 25/11: `protected: false` **تحقق 26/11:** `GET /repos/hodaharraz1/edmn-eg/branches/main` يعيد `protected: true` والفحص المطلوب `gates`؛ القاعدة (بواسطة المالك): PR إلزامي قبل الدمج، فحوص إلزامية، بلا استثناء للمديرين، force-push والحذف ممنوعان. ملاحظة: الحماية مفروضة لأن المستودع عام على خطة GitHub المجانية؛ تحويله لخاص بدون خطة مدفوعة يلغيها (يرجع FAIL). |
| SEC-112 | نعم | P1 | المالك | PASS | لا فحوص مطلوبة ولا مراجعة مطلوبة قبل الدمج (نفس الدليل). CI موجود لكنه غير إلزامي. **إجراء المالك المطلوب (يبقى FAIL حتى يُنفَّذ):** نفس قاعدة SEC-111 (الفحوص المطلوبة والمراجعة الإلزامية قبل الدمج). آخر فحص 25/11: الفرع غير محمي **تحقق 26/11:** فحص `gates` إلزامي قبل أي دمج في `main` (`required_status_checks.contexts = [gates]`) وPR إلزامي. **استثناء مقترح (يحتاج اعتماد المسؤول الأمني):** عدد الموافقات المطلوبة 0 لأن المستودع له مطوّر/مالك واحد حاليًا؛ يُرفع لموافقة واحدة عند انضمام شخص ثانٍ. |
| SEC-113 | نعم | P1 | المطور | PASS | `permissions: contents: read` في كل الـ workflows |
| SEC-114 | نعم | P2 | المالك | IN PROGRESS | CI بلا أسرار ثابتة (مفاتيح تجريبية عشوائية لكل تشغيل). ترحيل Staging يستخدم سرًا ثابتًا في بيئة GitHub (`STAGING_MIGRATION_DATABASE_URL`) |
| SEC-115 | نعم | P1 | المطور | PASS | `package-lock.json` و`pubspec.lock`، وإجراءات CI مثبتة بـ SHA (`c6fdec7`) |
| SEC-116 | نعم | P2 | المطور | IN PROGRESS | SBOM CycloneDX للتشغيل (`evidence/sbom-npm-production.cdx.json`). غير مولَّد تلقائيًا مع الإصدارات |
| SEC-117 | نعم | P3 | المطور | NOT TESTED | لا provenance أو attestations للبناء |
| SEC-118 | نعم | P1 | المالك | IN PROGRESS | ربط Vercel بالـ commit تلقائي، والنشر التلقائي معطّل لفروع الوكلاء. سياسة «لا نشر بلا CI ناجح» غير مفروضة تقنيًا |
| SEC-119 | نعم | P1 | المالك | IN PROGRESS | بيئة GitHub `staging` للترحيل (يُفترض بمراجعين). صلاحيات Vercel يتحقق منها المالك. 25/11: commit `588e2ca` أضاف تشغيل الترحيل على `push` للفرع `claude/instinct-integration` لرسالة تبدأ بـ `[migrate-staging]` وعلى الـ commit نفسه (`github.sha`). السر في بيئة `staging` فتبقى موافقة المراجعين شرطًا **إن كانت مفعّلة فعلًا** (غير قابل للتحقق من المستودع، إجراء المالك) |
| SEC-120 | نعم | P1 | المالك | PASS | فحص الشجرة + التاريخ الكامل (`scripts/secret-scan.ts` و`--history`) = 0 في 19/11 على `claude/security-integration`، وفي CI. **تصحيح:** S7–S10 لم تُرفع إلى Git قط، بل لُصقت في محادثة؛ خطرها مسجل في SEC-045/SEC-O01 |

## القسم 13: حماية تطبيقات الموبايل

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-121 | نعم | P1 | المطور | IN PROGRESS | MASVS مطبّق جزئيًا (`THREAT_MODEL_MOBILE_AND_AI.md` §3). لم يُجرَ تقييم MASVS كامل على جهاز |
| SEC-122 | نعم | P1 | المطور | PASS | `flutter_secure_storage` (Keychain `first_unlock_this_device`، Keystore). رمز الوصول في الذاكرة. لا نسخ احتياطي (SEC-F04). مسح الجلسة عند أول تشغيل بعد التثبيت (Q-1، `session_store_test.dart`، commit `c4a16c8`). التحقق على iPhone معلّق |
| SEC-123 | نعم | P1 | المطور | PASS | لا كلمات مرور ولا أسرار مخزنة. سر TOTP يُعرض مرة ولا يُخزن (`mfa_screen.dart`) |
| SEC-124 | نعم | P1 | المطور | EXCEPTION | TLS بتحقق نظام التشغيل، والنسخ المستضافة HTTPS فقط. **لا pinning** (SEC-O07 مقترح قبوله) |
| SEC-125 | نعم | P2 | المطور | IN PROGRESS | PKG-LINKS-01 فعّل الإنشاء من جهة الخادم: `src/server/core/app-links.ts` و`src/app/.well-known/assetlinks.json/route.ts` و`src/app/.well-known/apple-app-site-association/route.ts`. الحمولة **فارغة عمدًا** حتى يوفّر المالك بصمة التوقيع ومعرّف فريق Apple (`tests/unit/app-links.test.ts`). التحقق على جهاز غير مُنفَّذ. كانت N/A قبل 25/11 (راجع SEC-180) |
| SEC-126 | نعم | P1 | المطور | PASS | Android: INTERNET فقط. iOS: لا أذونات كاميرا أو صور أو موقع أو جهات اتصال |
| SEC-127 | نعم | P2 | المطور | IN PROGRESS | `FLAG_SECURE` لتطبيق الإدارة على Android. iOS: `EdmnPrivacyShield` يغطي الواجهة خارج `resumed` (اختبار دورة حياة، commit `c4a16c8`). **لم يُتحقق على جهاز** (SEC-O03). لا Push بعد |
| SEC-128 | نعم | P3 | المطور | EXCEPTION | لا كشف root/jailbreak. الحماية بقرارات الخادم (مقترح قبوله) |
| SEC-129 | نعم | P1 | المطور | NOT TESTED | MASTG على جهاز: لا جهاز أو Mac متصل |
| SEC-130 | نعم | P1 | المالك | NOT TESTED | مفاتيح التوقيع والمتاجر لم تُنشأ بعد (بقرار المالك). عند إنشائها: خزنة + MFA للمتجر |

## القسم 14: الذكاء الاصطناعي والوكلاء

**نطاق التطبيق:** المنتج لا يحتوي نموذجًا أو وكيلًا يخدم المستخدمين. هذه الضوابط تنطبق على **عملية التطوير بالوكلاء** فقط (`THREAT_MODEL_MOBILE_AND_AI.md` §4).

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-131 | جزئيًا | P2 | المطور | PASS | `THREAT_MODEL_MOBILE_AND_AI.md` §4 (وكلاء التطوير) |
| SEC-132 | جزئيًا | P2 | المطور | IN PROGRESS | الوكيل يعامل محتوى الأدوات والـ PR كبيانات لا أوامر. لا اختبار Red Team رسمي |
| SEC-133 | جزئيًا | P2 | المطور | PASS | مخرجات الوكيل تمر بنفس CI والمراجعة، ولا تُنفذ قرارات أمنية تلقائيًا |
| SEC-134 | جزئيًا | P1 | المالك | PASS | الوكيل مقيّد بمستودع واحد وفروع `claude/**`، بلا إنتاج ولا Vercel ولا قواعد مستضافة. العمليات الحساسة تمر بمصنّف صلاحيات (رُفضت عمليات خلال الجلسة) |
| SEC-135 | جزئيًا | P1 | المالك | PASS | النشر والمفاتيح والدفع والدمج في main تحتاج موافقة بشرية صريحة (قواعد المشروع) |
| SEC-136 | جزئيًا | P1 | المطور | **IN PROGRESS** | **تصحيح PKG-SEC-04:** كانت PASS وده غلط. التقارير فعلًا بلا قيم سرية، لكن «مفيش أسرار في المحادثة» مش صحيح: S7–S10 اتلصقوا في محادثة إعداد ولسه ما اتلغوش (SEC-O01، SEC-045). الحالة تفضل IN PROGRESS لحد ما الإلغاء يتأكد كتابةً |
| SEC-137 | لا | — | — | N/A | لا RAG ولا ذاكرة ولا بحث بالذكاء الاصطناعي في المنتج |
| SEC-138 | جزئيًا | P3 | المالك | NOT TESTED | حدود تكلفة واستخدام الوكلاء في إعدادات الحساب، خارج المستودع |
| SEC-139 | جزئيًا | P3 | المالك | IN PROGRESS | سجل الجلسة وCommits الوكيل بتوقيع واضح (`Co-Authored-By`)، دون مركزة |
| SEC-140 | لا | — | — | N/A | لا وكيل في المنتج يحتاج Red Team قبل الإطلاق |

## القسم 15: المراقبة واكتشاف الحوادث والاستجابة

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-141 | نعم | P1 | المالك | IN PROGRESS | سجلات JSON منقّحة + `audit_logs` + تتبع أخطاء. لا مجمّع مركزي في الإنتاج بعد |
| SEC-142 | نعم | P1 | المطور | IN PROGRESS | تدقيق تغييرات الأدوار والوصول للملفات. لا تنبيه على الدخول الفاشل أو غير المعتاد (SEC-O04) |
| SEC-143 | نعم | P2 | المطور | NOT TESTED | لا كشف للأنماط غير المعتادة أو التصدير الجماعي |
| SEC-144 | نعم | P1 | المالك | IN PROGRESS | تنبيهات انحراف الدفتر وفشل المهام (runbooks). **المستلم والمناوبة غير معيّنين** |
| SEC-145 | نعم | P2 | المالك | IN PROGRESS | `audit_logs` غير قابلة للتعديل. مدة الاحتفاظ وصلاحيات قراءة سجلات المزوّد غير موثقة |
| SEC-146 | نعم | P1 | المالك | PASS | `INCIDENT_RESPONSE_PLAN.md` (هذه الجولة) + `docs/runbooks/INCIDENT_RESPONSE.md` |
| SEC-147 | نعم | P1 | المطور | PASS | الإيقاف الطارئ للأموال الحقيقية (`REAL_MONEY_EMERGENCY_DISABLE.md`)، إلغاء الجلسات، تدوير المفاتيح، `maintenanceMode` |
| SEC-148 | نعم | P2 | المالك | IN PROGRESS | القسم 5 في `INCIDENT_RESPONSE_PLAN.md`. لا أداة لحفظ الأدلة |
| SEC-149 | نعم | P1 | المالك + قانوني | NOT TESTED | إخطار مركز حماية البيانات وفق القانون 151/2020: يحدده القانوني |
| SEC-150 | نعم | P2 | المالك | NOT TESTED | لم يُجرَ تمرين استجابة |

## القسم 16: الاستمرارية والتعافي والاختبار النهائي

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-151 | نعم | P1 | المالك | NOT TESTED | نسخ Neon (PITR) وتشفيرها والوصول إليها: لا وصول. الإجراء في `DATABASE_BACKUP.md` |
| SEC-152 | نعم | P1 | المالك | NOT TESTED | نسخ غير قابلة للتعديل: لم يُتحقق |
| SEC-153 | نعم | P1 | المالك | IN PROGRESS | RTO مقاس محليًا ≈ 1 ثانية للبيانات التجريبية. **RPO/RTO المستهدفان غير معتمدين** (`BACKUP_RECOVERY_EVIDENCE.md`) |
| SEC-154 | نعم | P1 | المالك | IN PROGRESS | تمرين استعادة معزول **PASS** محليًا (الدفتر متوازن، 0 تكرار). **استعادة نسخة المزوّد لم تُختبر** |
| SEC-155 | نعم | P1 | المطور | PASS | Rollback للكود عبر Vercel/commit، والترحيلات إضافية forward-only مع خطة (`DEPLOYMENT_SAFETY.md`، `FINAL_PREPRODUCTION_SECURITY_GATE.md`) |
| SEC-156 | نعم | P1 | المالك | **FAIL** | لم يُنفذ DAST على بيئة مصرح بها (لا `HAWK_API_KEY` ولا تصريح لفحص Staging). **إجراء المالك المطلوب (يبقى FAIL حتى يُنفَّذ):** تصريح كتابي بفحص بيئة Staging وتوفير مفتاح الأداة المختارة وفق `phase2/DAST_AND_PENTEST_PLAN.md`، ثم تشغيل الفحص ومعالجة النتائج |
| SEC-157 | نعم | P1 | المالك | NOT TESTED | لا اختبار اختراق يدوي مستقل |
| SEC-158 | نعم | P2 | المطور | IN PROGRESS | اختبارات فشل المزوّدين والاستعادة (runbooks + تكامل). لا اختبار حمل أو استنزاف موارد |
| SEC-159 | نعم | P1 | المطور | PASS | كل إصلاح له اختبار انحدار أعيد تشغيله (`REMEDIATION_REPORT.md`) |
| SEC-160 | نعم | P1 | المالك | PASS | `SECURITY_RELEASE_GATE.md` بقرار NO-GO مسبَّب |

## القسم 17: الميزات المضافة بعد 19 نوفمبر (PKG-SEC-02، 25 نوفمبر 2026، الرأس `9c3a411` ثم `588e2ca`)

الأرقام بعد `:` هي أرقام الأسطر في الرأس المذكور. «اختبار» = ملف في `tests/` أُعيد تشغيله ضمن المجموعة الكاملة في 25/11. لا PASS بلا دليل في الكود وفي اختبار، إلا إذا ذُكر خلاف ذلك صراحة.

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-161 | نعم | P1 | المطور | PASS | طلب حذف الحساب: `auth: 'customer'` وحده، `idempotency: 'required'`، فئة `sensitive`، ورفض 422 بأسباب عربية مع تسجيل المحاولة المرفوضة في التدقيق (`src/server/api/routes/account-closure.ts`، `closure.ts:35` و`closure.ts:63`). الطلب لا يحذف شيئًا. اختبار `account-deletion-api.test.ts` («request → PENDING → visible → withdrawn؛ idempotent and audited» و«open obligations refuse 422») |
| SEC-162 | نعم | P2 | المطور | IN PROGRESS | سقف إضافي 5 طلبات/ساعة لكل حساب (`account-closure.ts:63`، `enforce('account-deletion:...')`). **لا يوجد اختبار يثبت السقف**: الكود موجود وغير مُختبَر |
| SEC-163 | نعم | P1 | المطور | PASS | إتمام الإغلاق (`closure.ts:92`): صلاحية `customers.manage`، قفل الصف `for update`، رفض إغلاق حساب الموظف لنفسه (`closure.ts:98`)، قفل `pg_advisory_xact_lock` وإعادة فحص الموانع داخل المعاملة، وتدقيق `account.closed`. اختبارات `account-closure-monitor.test.ts` و`hardening-matrix.test.ts` |
| SEC-164 | نعم | P1 | المطور | PASS | **كان FAIL.** الثغرة: `completeAccountClosure` (`closure.ts:92-94` عند `ce2234c74`) تتحقق من `customers.manage` فقط بلا `requireStepUp` وبلا شخص ثانٍ، وهي عملية لا رجعة فيها. **الإصلاح (قرار المالك 25/11 21:32):** `requestClosureExecution` (Maker: `customers.manage` + step-up) ثم `completeAccountClosure` (Checker مختلف + step-up) مع أعمدة `executionRequestedBy/At` وقيد DB (مايجريشن 0031). الاختبار `secfix01-closure-stepup.test.ts` (4 اختبارات تفشل قبل الإصلاح وتنجح بعده). **مدمج ومتحقق منه (25/11):** `abe289f`؛ `secfix01-closure-stepup.test.ts` 4/4 والمجموعة الكاملة 979/979. |
| SEC-165 | نعم | P2 | المطور | IN PROGRESS | الفجوة: الإغلاق ما كانش يحذف رموز الإشعارات ولا يبطل الأجهزة ولا يحذف صور الهوية، عكس `docs/store/ACCOUNT_DELETION_PAGE.md:33`. **الإصلاح (قرار المالك 25/11 21:32):** في نفس transaction الإغلاق: حذف `device_push_tokens` و`push_subscriptions`، إبطال `mobile_devices`، حذف صور الهوية (`IDENTITY_DOCUMENT`) وإزالة بايتاتها بعد الـcommit؛ حسابات البائعين تحتفظ بوثائق التحقق كما تقول الصفحة. الاختبار `secfix02-closure-release.test.ts` (3). **تنبيه:** الصفحة نفسها فيها سطر بعنوان قرار احتفاظ 6 شهور و`retention.ts` يقول إن مدة الهوية «to confirm with counsel»؛ ينتظر تأكيد المالك. **مدمج ومتحقق منه (25/11):** `2c15dc7` ثم تعديل بقرار المالك: صور الهوية تتقفل عند الإغلاق (soft-delete، `/api/files` يرفضها) وتفضل محفوظة، ومفيش مسح تلقائي لحد ما المالك يقرر. `secfix02-closure-release.test.ts` ناجح. **IN PROGRESS** لحد ما نص صفحة `/legal/data-deletion` المنشور يتعدل (لسه بيقول إن الصور بتتحذف)، وده إجراء على المالك. مبني فوق FIX-01 |
| SEC-166 | نعم | P1 | المطور | PASS | تأكيد الدفع بشخصين: من بدأ المراجعة لا يؤكد (`src/server/modules/payments/service.ts:136-174`، `requireStepUp` عند `:156`) + قيد قاعدة بيانات `payments_two_person_chk` (`drizzle/0026_payment_confirmation_two_person.sql`). **تنبيه:** القيد `NOT VALID` فلا يفحص الصفوف القديمة قبل 0026 (مقصود، موثق في الترحيل). اختبار `pay01-two-person-daily-limit.test.ts` (مراجعة بلا بدء، نفس الشخص مرفوض خدميًا وبقيد القاعدة، شخص آخر ينجح) |
| SEC-167 | نعم | P1 | المطور | PASS | Maker/Checker للحركات المالية: `requestMovement` بصلاحية `finance.movement.request` وstep-up (`movements.ts:55-56`)، ورفض نفس الشخص (`movements.ts:67`، `takeMovementRequest` عند `:83`)، ومشغّل `edmn_movement_requires_two_people` على كل الأنواع بما فيها `COD_REMITTANCE` و`COD_SHORTAGE_RESOLUTION` (`drizzle/0030_cod02_shortfalls.sql:36-42`). اختبارات `pay01-two-person-daily-limit.test.ts` (مشغّل القاعدة) و`cod02-courier-statement.test.ts` (رسالة «requires a maker and a different checker») |
| SEC-168 | نعم | P1 | المطور | PASS | سقف يومي لإيصالات الدفع لكل عميل بتوقيت القاهرة (`payments/service.ts:72-87`، الإعداد `payments.dailyReceiptLimit` في `settings.ts:49`، افتراضي 25,000,000 قرش = 250,000 ج.م). تغييره حساس ويحتاج step-up. اختبار `pay01-two-person-daily-limit.test.ts` (الرفض فوق السقف وعدم احتساب الإيصال المرفوض، وstep-up للتغيير) |
| SEC-169 | نعم | P1 | المطور | PASS | تسوية عجز المندوب: عند 9c3a411 يكفي `payments.verify` للـ Maker والـ Checker معًا (`movements.ts:110`) حتى لو كانت التسوية **شطبًا إلى مصروف** (`payments/service.ts:324-361`). الشخصان مفروضان خدميًا وفي القاعدة، لكن الصلاحية أوسع من اللازم للشطب. التصحيح جاهز في PKG-COD-03 (يتطلب `finance.release` للطرفين في الشطب) ومنشور في Issue #7 (تعليق 7171780993) وينتظر الدمج. لا PASS قبل الدمج **مدمج ومتحقق منه (25/11):** PKG-COD-03 في `ccc0c27`؛ `cod03-writeoff-release.test.ts` ناجح، وPlaywright `cod-remittance` 4/4. |
| SEC-170 | نعم | P1 | المطور | PASS | التحصيل والعجز: `requirePermission('payments.verify')` وstep-up (`payments/service.ts:243-244`, `:325-326`)، قفل الصف `for update` (`:329`)، مفاتيح idempotency `cod-shortfall-resolve:<id>` للترحيل (`:344`, `:350`)، قيد مزدوج، وتدقيق `payment.cod_shortfall_resolved` (`:370`). اختبار `cod02-courier-statement.test.ts` |
| SEC-171 | نعم | P1 | المطور | PASS | مسار موبايل الإدارة للتحصيل عند التسليم للقراءة فقط: مسار GET واحد (`src/server/api/routes/admin-cod.ts`)، بصلاحية `payments.view`. اختبار `admin-mobile-cod.test.ts` (رفض من بلا الصلاحية والمجهول، وعقد المسار GET واحد) |
| SEC-172 | نعم | P1 | المطور | PASS | موافقة التسويق: الافتراضي OFF، وسجل أحداث مؤرَّخ لا يُعدَّل، وتسجيل الإجراء في التدقيق (`src/server/modules/customers/marketing.ts:20-28`). اختبار `privacy01-marketing.test.ts` (OFF افتراضيًا، حدث GRANT مؤرَّخ، السحب في أي وقت) |
| SEC-173 | نعم | P1 | المطور | PASS | تصدير قائمة التسويق: صلاحية `customers.exportMarketing` وstep-up (`marketing.ts:35-36`)، إقرار صريح، طلب مفتوح واحد لكل طالب، التنفيذ بشخص مختلف (`marketing.ts:129`)، الرفض أيضًا بشخص ثانٍ، والقائمة للموافقين النشطين فقط وبـ 5 حقول. اختبار `privacy01-marketing.test.ts` (الأسطر 77 و82 و92 و111 و157) |
| SEC-174 | نعم | P1 | المطور | PASS | الملف المصدَّر مشفّر (AES-256-GCM بمفتاح مشتق scrypt من عبارة سر تُعرض مرة واحدة للموافق ولا تُخزَّن) (`marketing.ts:121-142`). اختبار `privacy01-marketing.test.ts:111` (التشفير وفكّه) |
| SEC-175 | نعم | P2 | المطور | PASS | تنزيل الملف المشفّر (`marketing.ts:144` عند `ce2234c74`) كان صلاحية + تدقيق بلا step-up. **الإصلاح:** `requireStepUp(actor)` في `downloadMarketingExport`، واختبار جديد في `privacy01-marketing.test.ts` يفشل قبل الإصلاح وينجح بعده. المسار يرجّع 404 موحّد عند الفشل (سلوك قائم). **مدمج ومتحقق منه (25/11):** `6432746`؛ اختبار `privacy01-marketing.test.ts` الجديد ناجح والمجموعة الكاملة 979/979. |
| SEC-176 | نعم | P1 | المطور | PASS | رموز الإشعارات: مشفّرة في القاعدة (`tokenEnc`)، لا تُسجَّل (الطول والمنصة فقط، `device-push.ts:41`)، تُسجَّل لجهاز المستخدم نفسه فقط (`:63-75`)، وتدقيق التسجيل والإزالة. اختبار `push-tokens.test.ts` و`push02-live-senders.test.ts` |
| SEC-177 | نعم | P1 | المطور | PASS | بيانات اعتماد Firebase وApple: `settings.manage` وstep-up (`device-push.ts:104-106`)، مشفّرة (`encryptJson`، `:118`)، العرض بيانات وصفية فقط، وتدقيق الحفظ. اختبار `push02-live-senders.test.ts:71` |
| SEC-178 | نعم | P1 | المطور | PASS | الإشعارات الحية تفشل مغلقة: الإعداد `notifications.devicePushEnabled` افتراضيه OFF، والمشغّل الافتراضي `log`، والتشغيل الحي بلا بيانات اعتماد لا يرسل شيئًا. اختبار `push02-live-senders.test.ts:94` و`:177` |
| SEC-179 | نعم | P3 | المطور | IN PROGRESS | مشغّل `log` يطبع **عنوان** الإشعار (`device-push.ts:43`) وليس الرمز. لم يُراجَع أن كل قوالب العناوين خالية من الأسماء والمبالغ. يُراجع قبل تشغيل مصرّف السجلات في الإنتاج |
| SEC-180 | نعم | P2 | المطور | PASS | روابط التطبيق: الملفان `.well-known` يُنشآن من البيئة وقت النشر فقط، وفارغان ما لم تُضبط البصمة ومعرّف الفريق (آمن: تبقى الروابط على الموقع) (`src/server/core/app-links.ts`)، وبلا قيم ثابتة. اختبار `tests/unit/app-links.test.ts:32` و`:48`. بصمة التوقيع الحقيقية إجراء للمالك (SEC-130) |
| SEC-181 | نعم | P1 | المطور | PASS | صفحات الإدارة الجديدة (الإغلاقات، قائمة التسويق، لوحة التحصيل في صفحة الدفع): الدخول بطبقة `requireAdmin` (جلسة موظف + TOTP، `src/server/web/session.ts:121-126`) على مستوى الـ layout لكل الصفحات (76 صفحة)، والصلاحية تُفرض في الخدمة (`closure.ts:135`، `marketing.ts:155`، `payments/service.ts:136`). **لا فحص صلاحية على مستوى الصفحة نفسها** (تعتمد على الخدمة، وهو التصميم المعتمد في SEC-031) |
| SEC-182 | نعم | P1 | المطور | PASS | لا بيانات شخصية في السجلات أو التدقيق للميزات الجديدة: تدقيق الإغلاق يحفظ وجود البريد والهاتف كقيم منطقية لا قيمتها (`closure.ts:118-122`)، وتدقيق التصدير يحفظ العدد واسم الملف فقط (`marketing.ts:138`)، والرموز لا تُسجَّل (SEC-176). تنقيح عام عبر `logger` (SEC-047) |
| SEC-183 | نعم | P1 | المالك + المطور | IN PROGRESS | سير عمل TestFlight (`.github/workflows/ios-testflight.yml`، commit `4e25ae805` و`f9e2e87`): ما تحقق: `permissions: contents: read`، الإجراءات مثبتة بـ SHA (SEC-113 وSEC-115 ما زالا PASS على الـ workflows الثلاثة)، لا أسرار في الكود، ومفتاح `.p8` يُكتب في مجلد مؤقت للمشغّل ويُحذف في `always()`. **تحديث (`ce2234c74`):** أُضيف `environment: testflight` للـjob (`ios-testflight.yml:30`) فصار المفتاح في بيئة محمية بدل سر مستودع. **الباقي:** (أ) **26/11:** البيئة `testflight` اتعملت وفيها المفتاح (سر) والمعرّفات؛ **قرار المالك 26/11: إلغاء المراجع الإلزامي** للبيئة دي علشان البناء ما يحتاجش موافقة كل مرة (مطوّر واحد حاليًا). المخاطرة المقبولة: أي حد بصلاحية كتابة يقدر يشغّل الـworkflow ويستخدم المفتاح؛ يرجع المراجع عند انضمام شخص تاني، (ب) ما زال `APP_STORE_CONNECT_API_KEY_P8` داخل تعبير في خطوة الفحص (`:47`) ويُمرَّر عبر `env` في خطوة الكتابة (`:57`) فقط، (ج) **تم 26/11:** `main` محمي (SEC-111). **الفجوة الأصلية (قبل `ce2234c74`):** الأسرار على مستوى المستودع بلا `environment:` ذي مراجعين، والمشغّل `push` على `claude/instinct-integration` (غير محمي، SEC-111) يعني أن أي دافع بصلاحية كتابة يعدّل ملف الـ workflow نفسه ويقرأ مفتاح App Store Connect بصلاحية **Admin**. الأسرار لم تُضبط بعد (الوثيقة `docs/mobile/IOS_TESTFLIGHT.md` خطوات المالك)، فلا تعرّض حاليًا. مقترح PKG-SEC-FIX-04 قبل ضبط الأسرار: `environment: testflight` بمراجعين إلزاميين، وتمرير `APP_STORE_CONNECT_API_KEY_P8` عبر `env` لا بتعبير داخل نص `run`. إجراء المالك: تفعيل حماية الفرع (SEC-111) وتقييد دور المفتاح إن أمكن |

## القسم 12: تحديث PKG-SEC-04 (27 نوفمبر 2026)

الرأس: `1a8348270e75582965876825023afbca241b08b5` (فرع `claude/instinct-integration`). الحزمة **كود فقط** على Issue #7، مش مدموجة.

| ID | ينطبق | الأولوية | المسؤول | الحالة | الدليل / السبب |
|---|---|---|---|---|---|
| SEC-184 | نعم | P1 | المطور | IN PROGRESS | **M1 — منح دور ذو صلاحيات عليا بشخصين.** Maker يفتح طلب (`requestPrivilegedRole`)، Checker مختلف يوافق (`decidePrivilegedRoleRequest`) وينفّذ المنح بموافقة أحادية الاستخدام (`consumeApprovedRequest`). ممنوع نفس الشخص (نفس الموبايل/البريد/اسم البريد/نفس عنوان الشبكة خلال 24 ساعة)، وممنوع إنشاء حساب جديد بدور عليا أصلًا. القاعدة: جدول `privileged_role_requests` (0035) بقيد `decided_by <> requested_by` + trigger يمنع تعديل الهوية أو إعادة الحسم، وtrigger `user_roles_no_self_grant`. **لم يتم التحقق:** اختبار التكامل للـtriggers لم يُشغّل (مفيش PostgreSQL في بيئة الحزمة) |
| SEC-185 | نعم | P1 | المطور | PASS | **M2 — مفاتيح حدود مركّبة.** `apiRateBuckets` تضيف دلو `device+IP` (سقف 3× دلو الجهاز) فوق دوال الحساب والجهاز والـIP، فتدوير بُعد واحد مش بيصفّر العدّاد. اختبار `tests/unit/sec04-hardening.test.ts` (4 حالات) ناجح |
| SEC-186 | نعم | P1 | المطور | PASS | **M2 — TRUSTED_PROXY إلزامي.** بناء production مستضاف ذاتيًا بدون `TRUSTED_PROXY=true` يرفض الإقلاع (`unsafeProductionConfig`)، وعلى Vercel مش مطلوب. اختباران في نفس الملف ناجحان |
| SEC-187 | نعم | P1 | المطور | PASS | **L1 — حدود على الحافة.** `limit_req_zone` + `limit_req` + `limit_conn` لـ`/api/files` و`/api/products/cards` و`/api/webhooks` في `deploy/proxy/nginx/edmn.conf` و`proxy-common.conf`، وحدود تطبيقية في نفس المسارات. **لم يتم التحقق:** `nginx -t` لم يُشغّل |
| SEC-188 | نعم | P1 | المطور | PASS | **L2 — رد تسجيل موحّد.** رسالة واحدة للبريد أو الموبايل الموجود (`auth/service.ts`)، فمفيش كشف لأي الحقلين متسجل |
| SEC-189 | نعم | P1 | المطور | PASS | **L5 — كوكيز `__Host-`.** `hostCookieName` بيكتب `__Host-edmn_sid` و`__Host-edmn_admin_sid` و`__Host-edmn_cart` على أي نشر آمن، والقراءة بتقبل الاسمين أثناء الانتقال (مفيش تسجيل خروج جماعي). **لم يتم التحقق:** سلوك المتصفح نفسه على نشر HTTPS |
| SEC-190 | نعم | P1 | المطور | PASS | **L6 — إثبات الدفع يحتاج step-up.** `PAYMENT_PROOF` لموظف بـ`payments.view` بقى محتاج تحقق ثنائي حديث (ساعة)، زي مستندات الهوية؛ صاحب الإثبات نفسه مش محتاج |
| SEC-191 | نعم | P2 | المطور | PASS | **L7 — شيل `sql.raw`.** `grep -rn "sql.raw" src` = صفر. الفهارس الزمنية بـ`make_interval(mins/hours => $n)`، والقوائم بـ`sql.join`، وأسماء الجداول/الأعمدة بـ`sql.identifier`، ومسارات الكتالوج بمصفوفة مُمرَّرة |
| SEC-192 | نعم | P2 | المطور | PASS | **L9 — `/api/ready` بكاش.** `readinessCached()` بمذكرة 5 ثوانٍ + `cache-control: public, max-age=5, s-maxage=5`، فمش كل طلب بيفتح استعلام قاعدة بيانات |
| SEC-193 | نعم | P1 | المطور | PASS | **L10 — فحص محتوى PDF.** `pdfContentProblems` يرفض مش-PDF، والمقطوع، وأي PDF فيه JavaScript/JS/Launch/OpenAction/AA/EmbeddedFile/RichMedia/XFA. 6 اختبارات ناجحة. **تنبيه:** ده فحص محتوى مش ماسح فيروسات؛ `MALWARE_SCANNER_URL` يفضل الضابط الحقيقي |
| SEC-194 | نعم | P1 | المطور | **NOT TESTED** | **L3 — تأخير تصاعدي + CAPTCHA بدل القفل الصلب.** لم تُنفَّذ في هذه الحزمة (تحتاج تغيير سلوك تسجيل الدخول واختباراته) |
| SEC-195 | نعم | P1 | المطور | **NOT TESTED** | **L4 — قفل تراكمي لـOTP التسليم.** لم تُنفَّذ في هذه الحزمة |
| SEC-196 | نعم | P1 | المطور | PASS | **PERF-01/P1 — عدّاد الحدود بره قاعدة البيانات.** `src/server/api/limit-store.ts`: Redis عبر `REDIS_URL` (RESP مباشر بدون اعتمادية جديدة) وإلا ذاكرة العملية، بنفس الدالة `hit()` ونفس السلوك لكل المستدعين، مع سقف مفاتيح يمنع التضخم. عند فشل Redis يرجع للذاكرة ويسجل تحذير مرة واحدة. اختبار `tests/unit/perf01-limit-store.test.ts` 6/6 ناجح. **لم يتم التحقق:** مسار Redis نفسه لم يُختبر (مفيش Redis في بيئة العمل) |
| SEC-197 | نعم | P2 | المطور | PASS | **PERF-01/P6 — صور مشتقة وكاش طويل.** التحقق: المتغيرات `_thumb`/`_md` بتتولد وقت الرفع (`storage/uploads.ts`)، و`/media/[...key]` بيرجّع `public, max-age=31536000, immutable` للملفات المفحوصة CLEAN و300 ثانية لغيرها. الكود كان كده بالفعل — الحزمة سجلت الدليل مش عدّلت سلوك |
| SEC-198 | نعم | P1 | المطور | **IN PROGRESS** | **PERF-01/P3 — تزامن إتمام الطلب.** اتعمل: `set local lock_timeout = 2.5s` و`statement_timeout = 15s` في معاملة الـcheckout، وأي `55P03`/`40P01`/`57014` بيتحوّل لرسالة واضحة «مفيش أي حجز اتعمل — جرّب تاني بعد لحظات» بدل 500 أو تعليق الطلب. وفي v3 اتكتب اختبار التزامن `tests/integration/checkout-concurrency.test.ts`: 200 عميل على نفس المتغير (مخزون 5) بإعادة المحاولة بنفس الـcheckoutKey — بيتحقق من عدم البيع الزائد، تطابق الحجز مع الحركات، صفر قيود لطلبات غير مدفوعة، توازن الدفاتر، وسلامة إعادة الإرسال. **لم يتم التحقق:** الاختبار لم يُشغّل (مفيش PostgreSQL في بيئة العمل) — الأمر: `DATABASE_URL=postgres://… npx vitest run tests/integration/checkout-concurrency.test.ts` |
| SEC-199 | نعم | P1 | المطور | **IN PROGRESS** | **PERF-01/P4 — بحث وفهارس.** الفهارس موجودة (`products_search_gin`، `products_search_trgm`). وفي v3 اتعمل: keyset pagination بمؤشر مرتبط ببصمة الفلاتر (`src/server/modules/catalog/search-cursor.ts`، معامل `cursor` في `/api/v1/catalog/products` و`nextCursor` في الرد، و`page` باقي للويب)، والعدّ بقى مكاش 60 ثانية لكل مجموعة فلاتر (`src/server/modules/catalog/count-cache.ts`) بدل `count(*)` مع كل صفحة. **تحقق جزئي بدون قاعدة:** eslint نظيف + اختبار منطق وحدة `tests/unit/search-pagination.test.ts` (اتفحص يدويًا بـtsx، 9/9). **لم يتم التحقق:** لم يُشغّل على قاعدة بيانات حقيقية |
| SEC-200 | نعم | P2 | المطور | **IN PROGRESS** | **PERF-01/P5 — فهارس الـFK.** في v3: `scripts/generate-fk-indexes.ts` بيقرأ مخطط drizzle نفسه (322 FK) ويقارن بالفهارس المعلنة ويكتب `scripts/sql/fk-indexes.sql` — 213 فهرس `create index if not exists` (109 مغطاة أصلًا). ملف تشغيلي idempotent وexpand-only، مش migration في الـjournal عمدًا. **اتحقق:** المولّد اتشغّل وأنتج الملف. **لم يتم التحقق:** لم يُطبَّق على قاعدة (مفيش PostgreSQL) — الأمر: `psql "$DATABASE_URL" -f scripts/sql/fk-indexes.sql`. تنبيه: الفهرسة مبنية على المخطط TS؛ فهرس اتعمل يدويًا في قاعدة باسم مختلف ممكن يتكرر بنفس العمود (ضررها صفر، مساحة بس) |
| SEC-201 | نعم | P2 | المطور | **IN PROGRESS** | **PERF-01 — سكربتات الضغط.** في v3 اتكتبت فعلًا: `perf/k6-api.js` + `perf/README.md` + `npm run perf:k6` — ستة مسارات (تصفح، بحث بمتابعة الـcursor، كروت، دخول، إتمام طلب متزامن 200 محاولة، رفع إيصال) مع thresholds لـp50/p95/p99 ونسبة أخطاء، وبتشتغل بأمر واحد محليًا. **لم يتم التحقق:** k6 مش مثبت ومفيش سيرفر في بيئة العمل، فالسكربت لم يُشغّل ومفيش أي رقم أداء — الأمر: `BASE_URL=http://127.0.0.1:3000 npm run perf:k6` |
| SEC-202 | نعم | P1 | المطور | **IN PROGRESS** | **INFRA-01 — بنية الإنتاج.** `deploy/compose/docker-compose.extra.yml`: Redis + PgBouncer فوق الـcompose القائم (web/worker/postgres/clamav). **لم يتم التحقق:** `docker compose config` و`up` لم يُشغّلا (مفيش docker في بيئة العمل) |
| SEC-203 | نعم | P1 | المطور | **IN PROGRESS** | **INFRA-01 — مقاييس.** `/api/metrics` (Prometheus، محمي بـ`METRICS_TOKEN` ويرجّع 404 لو مش مضبوط): جاهزية، ذاكرة، وظايف فاشلة/متأخرة، عمر فحص الدفتر. **لم يتم التحقق:** المسار لم يُطلب من سيرفر شغّال |
| SEC-204 | نعم | P1 | المطور | **IN PROGRESS** | **INFRA-01 — تنبيهات.** `ops/prometheus/edmn-alerts.yml` (توقف، عدم جاهزية، 5xx، p95، دفتر غير سليم، فحص قديم، طابور واقف، ديسك، نسخ احتياطي فاشل) + `alertmanager.example.yml` لبريد وتليجرام. **لم يتم التحقق:** `promtool check rules` لم يُشغّل |
| SEC-205 | نعم | P1 | المطور | **IN PROGRESS** | **INFRA-01 — PITR واسترجاع.** `deploy/scripts/pitr-setup.sh` (WAL-G: أرشفة WAL + نسخة أساسية يومية) و`restore-pitr.sh` (استرجاع لنقطة زمنية في مجلد منفصل ونسخة مؤقتة). **لم يتم التحقق:** مفيش PostgreSQL ولا سيرفر ولا bucket، فمفيش تمرين استرجاع فعلي. ده الضابط اللي بوابته لسه ❌ في SECURITY_RELEASE_GATE |
| SEC-206 | نعم | P2 | المطور | PASS | **INFRA-01 — دليل التكبير.** `docs/runbooks/SCALING_10K.md`: سلّم أربع مراحل، التكلفة التقديرية بالدولار والجنيه، والأوامر اللي بتطلع الأرقام الحقيقية. **تنبيه:** التكلفة تقدير تصميم مش عرض سعر |
| SEC-207 | نعم | P1 | المطور | **IN PROGRESS** | **MOBILE-REL-01 — توقيع وبناء Android.** توقيع release من keystore.properties/الأسرار مع فشل صريح بدل مفتاح الـdebug + R8 وobfuscation وsplit-debug-info + workflow `android-play.yml` (أسرار في بيئة `play` المحمية). **لم يتم التحقق:** الـworkflow لم يعمل بعد (يحتاج أسرار المالك — الخطوات في `docs/mobile/ANDROID_PLAY.md`) |
| SEC-208 | نعم | P1 | المطور | **IN PROGRESS** | **MOBILE-REL-01 — تشديد تطبيق الإدارة.** تثبيت الشهادات ببصمات من dart-define (`lib/src/net/cert_pins.dart`، خطة التدوير `docs/mobile/CERT_PINNING.md`) + تحذير Root/Jailbreak عند الإطلاق (`edmn/device_integrity` channel، تحذير فقط مش منع). **لم يتم التحقق:** لم يُبنَ التطبيق ولم تُختبر البصمة الخاطئة ولا جهاز معدَّل فعلي |
| SEC-209 | نعم | P2 | المطور | **IN PROGRESS** | **MOBILE-REL-01 — ملفات المراجعة.** ملصقات خصوصية App Store جاهزة (`docs/store/APP_STORE_PRIVACY_NUTRITION_LABELS.md`) تكمل Data Safety وصفحات المتجر وحذف الحساب القائمة (STORE-01). **لم يتم التحقق:** لم تُملأ في Connect/Play Console بعد |
| SEC-210 | نعم | P1 | المطور | **IN PROGRESS** | **NOTIFY-01 — Push من env.** مفاتيح FCM/APNs من env (base64) كمصدر bootstrap فوري لـstaging مع أسبقية سجلات الإدارة المشفرة، وفشل مغلق عند قيمة غلط. **لم يتم التحقق:** مفيش مفاتيح حقيقية هنا — الإثبات خطوة 5 في `docs/operations/PUSH_SMS_SETUP.md` |
| SEC-211 | نعم | P1 | المطور | **IN PROGRESS** | **NOTIFY-01 — SMS مصري + fallback + حد معدل.** driver SMS Misr (`SMS_DRIVER=smsmisr`) مع fallback اختياري (`SMS_FALLBACK_DRIVER`) وtoken bucket لكل عملية (`SMS_RATE_LIMIT_PER_MINUTE`). **لم يتم التحقق:** لم تُجرَ مكالمة فعلية للمزوّد |
| SEC-212 | نعم | P1 | المطور | **IN PROGRESS** | **WALLET-02 — الدفع من المحفظة.** طريقة WALLET للطلبات والصفقات: Dr CUSTOMER_WALLETS / Cr نفس حسابات التحويل المؤكَّد ونفس العمولة، قيود SPEND، منع السالب بقفل صف المستخدم، كله ورا wallet.topUpEnabled، بدون مراجعة إدارة للصرف (استثناء موثق في migration 0036 وpostEntry — قرار المالك في الموجز) مع تدقيق كامل. **لم يتم التحقق:** لم يعمل ولا اختبار (يحتاج Postgres) — `tests/integration/wallet-spend.test.ts` فيه السيناريوهات الثمانية كاملة |
| SEC-213 | نعم | P1 | المطور | **IN PROGRESS** | **WALLET-02 — الاسترجاع للمحفظة.** استرداد المدفوع بالمحفظة (طلب أو صفقة) يقيد CUSTOMER_WALLETS بصف SPEND_REVERSAL بموافقة الإدارة المعتادة ويكتمل فورًا بدون تحويل خارجي؛ ضوابط الاتساق (REFUND_PAID/UNAPPROVED_JOURNAL) اتعدلت للاستثناء الموثق. **لم يتم التحقق:** نفس سبب الأعلى |
| SEC-214 | نعم | P1 | المطور | **IN PROGRESS** | **E2E-02 — الرحلات الحاسوبية الست.** `tests/integration/journeys-e2e02.test.ts`: سوق متعدد البائعين بسحب ثنائي، COD←تحصيل، محفظة إيداع←صرف←استرجاع، صفقة محمية كاملة، نزاع بأموال معلقة، إلغاء بثلاث حالات — كل خطوة تفحص خضرة الدفتر (reconcile + financialInvariants). **لم يتم التحقق:** لم تعمل (تحتاج Postgres) — `npm run migrate && npx vitest run tests/integration/journeys-e2e02.test.ts` |
| SEC-215 | نعم | P1 | المطور | **IN PROGRESS** | **E2E-02 — اختبارات الصرف من المحفظة مكتملة.** `tests/integration/wallet-spend.test.ts`: رفض الفلاج المقفل، مساواة قيود التحويل المؤكد، التزامن لا يوصل للسالب، rollback كامل عند نقص الرصيد، إعادة تشغيل checkoutKey دون صرف مزدوج، وخضرة الضوابط الثلاثة. **لم يتم التحقق:** نفس السبب |
| SEC-216 | نعم | P2 | المطور | **IN PROGRESS** | **E2E-02 — smoke الـstaging بأمر واحد.** `scripts/staging-smoke.sh` يشغل 5 مواصفات targeted فقط (الرئيسية، المتجر، رحلة السوق، الصفقة، COD/لوحة الإدارة) حسب TESTING_POLICY — ممنوع السويت الكامل إلا لمرشح إصدار. التشغيل: `STAGING_URL=https://… ./scripts/staging-smoke.sh`. **لم يتم التحقق:** لم يُنفَّذ على staging (لا نشر staging هنا) |
| SEC-217 | نعم | P1 | المطور | **IN PROGRESS** | **UX-02 — النت الضعيف والانقطاع (ويب).** `src/ui/offline-banner.tsx`: بانر واضح عند الانقطاع (`role=alert`) + إعادة تحميل تلقائية عند الرجوع (useSyncExternalStore على online/offline). مفيش عملية فلوس تتكرر لأن كل checkout/دفع/إيداع محمي بمفتاح عدم تكرار من الأساس (E2E-02 يختبر إعادة التشغيل). **لم يتم التحقق:** `tests/e2e/ux-a11y.spec.ts` (اختبار offline) لم يعمل |
| SEC-218 | نعم | P1 | المطور | **IN PROGRESS** | **UX-02 — إمكانية الوصول.** أهداف لمس 48px على الأجهزة اللمسية (`@media (pointer: coarse)` في globals.css)، skip link وh1 واحد وlang/dir وفحص alt للصور في المواصفة، ودعم تكبير الخط في التطبيقين بحد آمن (textScaler clamp 0.85–1.35 في builder التطبيقين). قارئ الشاشة: Semantics قائمة + العناوين العربية في حالات الخطأ/التحميل. **لم يتم التحقق:** `flutter analyze` لم يعمل (لا Flutter SDK هنا — 3.47.8 بالظبط) والمواصفة لم تعمل |
| SEC-219 | نعم | P1 | المطور | **IN PROGRESS** | **UX-02 — 360px والتابلت.** `tests/e2e/ux-a11y.spec.ts`: كل شاشة أساسية (الرئيسية، المتاجر، المستعمل، الصفقة المحمية) بلا تمرير أفقي على 360px و768px + فحص أهداف اللمس. **لم يتم التحقق:** المواصفة لم تعمل (تحتاج التطبيق شغال محليًا بقاعدة بيانات) — `npm run test:e2e -- tests/e2e/ux-a11y.spec.ts` |
