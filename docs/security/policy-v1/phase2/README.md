# المرحلة 2: تقوية أمنية قبل الإنتاج

**التاريخ:** 19 نوفمبر 2026

**الفرع:** `claude/security-integration`. القاعدة: `claude/security-policy-v1` (4210079)، وهو يحتوي كل commits `claude/mobile-unified-integration` (تحقق: 0 commits ناقصة).

**القيود:** Real Money OFF. لا نشر. لا فحص هجومي. لا دمج. لا أسرار.

| الوثيقة | المحتوى |
|---|---|
| `SECRETS_S7_S10_PLAN.md` | لكل سر: المالك، الاستخدام، الاعتماديات، خطوات الإلغاء، والتحقق بـ 401، بلا قيم |
| `GOVERNANCE_STEPS.md` | حماية `main` (تحقق: غير محمي)، CODEOWNERS، MFA، أقل صلاحية |
| `FILE_UPLOAD_SECURITY.md` | الأسطح، البوابة fail-closed، خيارات فحص البرمجيات الخبيثة وتكلفتها، عيب HEIC |
| `DR_NEON_PITR_PLAN.md` | تمرين PITR على فرع معزول، وRPO/RTO مقترحان غير معتمدين |
| `DAST_AND_PENTEST_PLAN.md` | نطاق DAST وتصريحه، ومتطلبات الاختبار اليدوي (IDOR/BOLA/المالية/التزامن/MASTG) |
| `MOBILE_SECURITY_REVIEW.md` | البنود السبعة مع الدليل، وما يحتاج جهازًا |

## Commits المرحلة

| Commit | التغيير |
|---|---|
| `5ae2a2c` | CODEOWNERS + قالب PR بقائمة تحقق أمنية |
| `76d8395` | اختبار بوابة فحص الرفع في الإنتاج |
| `c4a16c8` | الموبايل: مسح الجلسة بعد إعادة التثبيت، غطاء الخصوصية لتطبيق الإدارة، حذف كاش المنتقي |
| `31d0d47` | الموبايل: إزالة HEIC من المنتقي |
| (هذا) | وثائق المرحلة 2، وتصحيح S7–S10، وتحديث السجلات |

## الفحوص المحلية (19/11)

| الفحص | النتيجة |
|---|---|
| `npm run lint` | ✓ |
| `npm run typecheck` | ✓ |
| `openapi.ts --check` / `generate-dart-api.ts --check` | ✓ / ✓ |
| `secret-scan.ts` + `--history` | 0 / 0 |
| `npm audit --omit=dev --audit-level=high` | 0 ثغرات |
| `vitest run` | 811/811 (64 ملفًا) |
| Flutter analyze (5 حزم) | 0 مشاكل |
| Flutter test | core 16، design 9، api 3، customer 43، admin 5: كلها ✓ |
| بناء APK release | **لم يُشغَّل**: لا Android SDK في البيئة. CI يغطي analyze/test |

نتائج CI على الـ PR تُسجَّل في وصف الـ PR.
