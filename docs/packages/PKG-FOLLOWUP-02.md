# PKG-FOLLOWUP-02

## اللي اتغيّر
1. **/admin/transactions**: فلتر وعمود "طريقة الدفع" (تحويل بنكي، إنستاباي، محفظة إلكترونية، الدفع عند الاستلام، رصيد المحفظة). بتظهر الإيداعات (wallet_topups) بحالتها، و WALLET_SPEND و SPEND_REVERSAL بتسميات عربي. كل المبالغ بـ formatEGP. الإيداعات مش بتظهر إلا لمن عنده payments.view. استرداد المحفظة بيظهر مرتين عن قصد: مستند REFUND وقيد SPEND_REVERSAL.
2. **/admin/risk**: بيقرا العدّادات من نفس مصدر الـ rate limit عبر دالة واحدة `scanCounters` (Redis بـ SCAN مش KEYS، أو ذاكرة السيرفر). لو مفيش REDIS_URL الصفحة بتقول إن الأرقام للسيرفر الحالي فقط. علم LOGIN_BRUTE_FORCE شغّال. قاعدة SEC_LOGIN_FAILURE_SPIKE كانت بتقرا rate_limits هي كمان (ومبتشتغلش من PERF-01) واتصلّحت.
3. **CAPTCHA**: الافتراضي `off`. الموقع (عميل/بائع/أدمن) بيعرض الـ CAPTCHA بس لما السيرفر يطلبه (`after_failures` أو `always`). تطبيقا Flutter (عميل/أدمن) بيفتحوا WebView على `/captcha/mobile` ويبعتوا `captchaToken` مع الدخول. التطبيق مفيهوش أي مفتاح سري ولا تتبّع؛ المفتاح العام بس من الإعداد `auth.captchaSiteKey`.

## متى يكون آمن نقلب لـ after_failures / always
- اضبط `CAPTCHA_PROVIDER` و `CAPTCHA_SECRET` في بيئة السيرفر، و `auth.captchaSiteKey` (المفتاح العام) في الإعدادات. السيرفر بيرفض تشغيل الوضع من غير المفتاح العام.
- نطاق الموقع لازم يكون مسموح في لوحة المزوّد.
- جرّب على staging الأول.
- `after_failures` آمن بعد نزول نسخة التطبيقين اللي فيها الـ WebView (TestFlight/Play).
- `always` ممنوع قبل ما كل المستخدمين يحدّثوا التطبيق، وإلا النسخ القديمة هتتقفل.
- الـ CSP بيتوسّع فقط على صفحات الدخول و `/captcha/mobile` وفقط لما `CAPTCHA_SECRET` موجود.

## لم يتم التحقق
- `tests/integration/followup02-transactions.test.ts` وSQL الجديد في `listTransactions` (محتاج Postgres): `DATABASE_URL=… npx vitest run tests/integration/followup02-transactions.test.ts tests/integration/sec194-195-login-delay-and-otp-lock.test.ts`
- الـ WebView على جهاز حقيقي، وتوكن مزوّد حقيقي، والـ CSP على صفحة المزوّد الحية.
