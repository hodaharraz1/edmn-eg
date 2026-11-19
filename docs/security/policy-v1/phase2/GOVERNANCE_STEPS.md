# الحوكمة: حماية الفروع، المراجعة، MFA، أقل صلاحية

**التاريخ:** 19 نوفمبر 2026

## ما تحقق منه بالدليل

| البند | النتيجة | الدليل |
|---|---|---|
| حماية `main` | **غير مفعّلة** (`protected: false`) | GitHub API: قائمة الفروع، كل الفروع بما فيها `main` غير محمية |
| CI | يعمل على `pull_request`، `permissions: contents: read`، الإجراءات مثبتة بـ SHA، بوابة `npm audit` | `.github/workflows/ci.yml` |
| أسرار CI | سر واحد فقط: `STAGING_MIGRATION_DATABASE_URL` في بيئة `staging` | `.github/workflows/migrate-staging.yml` |
| النشر التلقائي للمعاينة | معطّل لفروع `claude/**` و`codex/**` | `vercel.json` ← `git.deploymentEnabled` |

## ما نفذته في نطاق التطوير

- `.github/CODEOWNERS`: المالك مراجِع إلزامي لكل الملفات، مع ذكر صريح للمسارات الحساسة (المصادقة، المالية، الصفقات، التخزين، الترحيلات، CI، إعدادات Android وiOS).
- `.github/pull_request_template.md`: قائمة تحقق أمنية لكل PR.

لن يكون لهذين أثر إلزامي إلا بعد تفعيل حماية الفرع بالخطوات التالية.

## خطوات المالك (لا أملك صلاحية إعدادات المستودع)

### 1. حماية `main` (وأي فرع إصدار)
GitHub ← المستودع ← **Settings** ← **Branches** (أو **Rules ← Rulesets**) ← **Add rule** ← Branch name pattern: `main`، ثم فعّل:
- **Require a pull request before merging**
  - Required approvals: **1**
  - **Dismiss stale pull request approvals when new commits are pushed**
  - **Require review from Code Owners**
- **Require status checks to pass before merging**
  - **Require branches to be up to date**
  - الفحوص المطلوبة (تظهر بعد أول تشغيل): `gates` وكل مهام `mobile (...)`
- **Require conversation resolution before merging**
- **Block force pushes** + **Restrict deletions**
- **Do not allow bypassing the above settings** (يشمل المديرين)

**التحقق:** دفع مباشر إلى `main` يُرفض، ودمج PR بفحص أحمر غير متاح.

### 2. بيئات GitHub
**Settings** ← **Environments** ← `staging` ← **Required reviewers**: المالك، و**Deployment branches**: فروع محددة فقط.

وعند إنشاء `production` لاحقًا تُطبَّق الإعدادات نفسها، مع wait timer اختياري.

### 3. MFA
| الخدمة | المسار | المطلوب |
|---|---|---|
| GitHub | Settings ← **Password and authentication** | مفتاح أمان (Passkey/FIDO2) أو تطبيق TOTP، وحفظ رموز الاسترداد خارج الإنترنت |
| Vercel | Account Settings ← **Authentication** ← Two-Factor | تفعيل، وإزالة طرق الدخول غير المستخدمة |
| Neon | Account ← **Security**، أو الدخول عبر GitHub/Google بحساب عليه MFA | MFA على مزود الهوية نفسه |
| مسجل النطاق | لوحة المسجل ← Security | MFA + **Registrar Lock / Transfer Lock** + بريد استرداد محمي بـ MFA |
| البريد المرتبط بالحسابات | إعدادات الأمان للبريد | MFA: هو مفتاح استرداد كل ما سبق |

**التحقق:** لقطة شاشة لكل صفحة تُظهر «Enabled»، تُحفظ خارج المستودع. أنا لا أستطيع التحقق من ذلك.

### 4. أقل صلاحية وصلاحيات النشر
- **GitHub:** راجع Settings ← **Collaborators** وأزل من لا يحتاج. صلاحية Write فقط لمن يطوّر، وAdmin للمالك وحده.
- **GitHub Apps:** راجع Settings ← **Integrations** ← GitHub Apps، وقيّد كل تطبيق بالمستودعات اللازمة.
- **Vercel:** Team ← Members. النشر إلى Production للمالك فقط. ابقِ «Preview» للفروع المحددة، وأبقِ `deploymentEnabled` معطّلًا لفروع الوكلاء.
- **Neon:**
  - دور تطبيق بصلاحيات DML فقط على قاعدة التطبيق؛
  - دور ترحيل منفصل بصلاحيات DDL، يُستخدم من CI فقط؛
  - لا دور مالك في `DATABASE_URL`.
- **رموز API:** لا رموز دائمة بلا تاريخ انتهاء (انظر `SECRETS_S7_S10_PLAN.md`).

## الأثر على السجل

SEC-111 وSEC-112 = **FAIL** (حالة تحقق منها: `main` غير محمي). تتحول إلى PASS فقط بعد الخطوة 1 مع دليل.
