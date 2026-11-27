# PKG-FOLLOWUP-01 — إجابات الأسئلة الثلاثة (على قاعدة `fc0406a`)

## س1) إيه اللي اتعلّم «لم يتم التحقق» غير بنود المالك؟

كل البنود دي اتعلّمت لأن بيئة العمل ما فيهاش Postgres ولا Flutter ولا staging ولا k6، **مش** لأنها محتاجة مفتاح من المالك. كل بند معاه أمر الإثبات في تعليق الحزمة.

| الحزمة | البند اللي «لم يتم التحقق» (مش مفتاح مالك) | الأمر الذي يثبته |
|---|---|---|
| SEC-04 | `npm run typecheck` الكامل (OOM وقتها) | `npm run typecheck` (اتشغّل بنجاح في FOLLOWUP-01) |
| SEC-04 | Vitest الكامل + اختبارات triggers الـmigration 0035 (لا Postgres) | `npm run test` على Postgres |
| SEC-04 | `flutter analyze/test` | `flutter analyze` |
| SEC-04 | `nginx -t` لملفات `limit_req` | `nginx -t` على السيرفر |
| SEC-04 | سلوك كوكيز `__Host-` | متصفح على HTTPS |
| PERF-01 v3 | اختبار التزامن `checkout-concurrency` | `npx vitest run tests/integration/checkout-concurrency.test.ts` |
| PERF-01 v3 | keyset pagination على قاعدة حقيقية (صفحتين) | مقارنة `nextCursor` مع offset |
| PERF-01 v3 | فهارس الـFK | `psql "$DATABASE_URL" -f scripts/sql/fk-indexes.sql` |
| PERF-01 v3 | k6 (مفيش أرقام أداء) | `npm run perf:k6` |
| PERF-01 v3 | typecheck الكامل | `npm run typecheck` |
| INFRA-01 v3 | `promtool` وقواعد التنبيه، وضع Redis، تمرين استرجاع PITR | حسب تعليق INFRA-01 v1 وتعليق دمج Claude (7218768705) |
| MOBILE-REL-01 | بناء AAB فعلي | تشغيل الـworkflow |
| MOBILE-REL-01 | التوقيع يرفض البناء بدون مفتاح | `flutter build appbundle --release` بدون keystore لازم يفشل |
| MOBILE-REL-01 | رفض الشهادة الخاطئة (pinning) | بناء بالبصمة الغلط على staging |
| MOBILE-REL-01 | تحذير الجهاز المعدَّل (root) | جهاز rooted |
| MOBILE-REL-01 | `flutter pub get` + `flutter analyze` لتطبيق الإدارة | نفس الأمرين |
| NOTIFY-01 | الـfallback لما المزوّد يفشل | تعطيل الأساسي على staging ومراقبة `outbound.sms_fallback` |
| NOTIFY-01 | الـrate limit تحت ضغط | 100 رسالة اختبار على staging |
| NOTIFY-01 | typecheck الكامل | `npm run typecheck` |
| WALLET-02 | كل مسارات الصرف والاسترجاع | `npx vitest run tests/integration/wallet-spend.test.ts` |
| WALLET-02 | migration 0036 على قاعدة حقيقية | `npm run db:migrate` ثم فحص `pg_proc` وصف WALLET |
| E2E-02 | رحلات vitest الست وسيناريوهات المحفظة | `npx vitest run tests/integration/journeys-e2e02.test.ts` |
| E2E-02 | تغطية Playwright «كل الشاشات الأساسية» | `npm run test:e2e` |
| UX-02 | مواصفة UX/a11y (تحتاج تطبيق + قاعدة) | `npm run test:e2e -- tests/e2e/ux-a11y.spec.ts` |
| UX-02 | تعديلات Flutter | `flutter analyze` (3.47.8) في التطبيقين |
| READY-01 | كل الدرجات «المتوقعة» مربوطة بأوامر لم تعمل (Postgres / Flutter / smoke / أداء) | الأوامر أعلاه |

بنود تحتاج مالك فعلًا (مش داخلة في الجدول): مفاتيح FCM/APNs، حساب SMS Misr (الإرسال الحقيقي)، مفتاح توقيع Android وأسرار الرفع، ملصقات الخصوصية في App Store Connect، حسابات التحويل، السيرفر، موظفان للموافقة المزدوجة، اختبار الاختراق.

## س2) فين تاني الدفع بيفترض ORDER_PAYMENT بس؟ (بحث في كل `src/` و`drizzle/`)

| المكان | الحكم |
|---|---|
| `src/server/db/schema/commerce.ts` + snapshot: `payments_two_person_chk` | **عيب (اتصحح هنا).** migration 0036 أضافت استثناء WALLET للقيد، لكن المخطط والـsnapshot فضلوا على القيد القديم. أي `db:generate`/`push` كان هيشيل الاستثناء. اتصحح في المخطط وmigration `0038` وsnapshot `0038` (قيمة حرفية `'WALLET'`). |
| `src/app/admin/(console)/transactions/page.tsx` (سطر 13 و27) | **فجوة عرض (لم تتصحح).** كل دفعة طلب تتسمى «دفع طلب (وارد)» من جدول `payments` من غير طريقة الدفع، فدفع المحفظة (مش فلوس داخلة للمنصة) والدفع عند الاستلام يظهروا بنفس التسمية. وإيداعات المحفظة (`wallet_topups`) وتحصيلات COD مش في الـunion أصلًا. الأنسب: عمود «الطريقة» + نوع `WALLET_TOPUP`. |
| `src/server/modules/finance/approvals.ts:13` `PAYMENT_CONFIRMATION: ['ORDER_PAYMENT']` | سليم بالتصميم: WALLET_SPEND معفى من الموافقة (حرس DB 0036/0037) ولا يمر بتأكيد الدفع. |
| `src/server/modules/finance/controls.ts` (188، 215، 251) | سليم: `DUPLICATE_BUSINESS_EVENT` و`MISSING_PAYMENT_JOURNAL` و`UNAPPROVED_JOURNAL` بتعرف WALLET_SPEND. |
| `src/server/modules/finance/seller-statement.ts:88` | سليم: WALLET_SPEND بمصدر `seller_order` يتحسب بيع. |
| `src/server/modules/finance/postings.ts:26` | سليم: الافتراضي ORDER_PAYMENT ويمرّر `entryType` للمحفظة. |
| `src/server/modules/finance/refunds.ts:196` و`deals/service.ts:1287` | سليم: وجهة الاسترداد WALLET معروفة. |
| `src/server/modules/payments/service.ts:425-434` (`DEAL_PAYMENT` بـPLATFORM_CASH) | سليم: مسار تحويل بنكي فقط وبيرفضه الحرس `status === UNDER_REVIEW`؛ دفعة المحفظة تتولد `CONFIRMED`. |
| `controls.ts` `MISSING_PAYMENT_JOURNAL` | **ملاحظة:** بيغطي دفعات الطلبات بس، ومفيش ضابط مماثل لدفعات الصفقات (تحويل أو محفظة). مش عيب افتراض ORDER_PAYMENT، لكنه فجوة رقابة لم تُسد. |
| `src/app/admin/(console)/risk/page.tsx` (استعلام `rate_limits`) | **ملاحظة خارج السؤال:** بيقرأ جدول `rate_limits` للمحاولات الفاشلة، لكن PERF-01 نقل العدادات لـRedis/الذاكرة، فالقاعدة دي على الأرجح فاضية. لم تتصحح. |

مفيش مكان تاني في `src/` بيفترض ORDER_PAYMENT: البحث الحرفي طلّع كل المواضع، وكلها في الجدول فوق، وبحث `payments.method` و`entry_type` في `src/` و`drizzle/*.sql` ما طلّعش غيرها.

## س3) أي اختبارات بتغيّر إعدادًا مشتركًا من غير استعادة؟

اللي كان بيسيب الإعداد مفتوح: `privacy01-marketing` و`cod03-writeoff-release` و`admin-mobile-cod` (كلهم يفتحوا `orders.codEnabled` ومفيش إغلاق)، `cod01-cash-on-delivery` و`cod02-courier-statement` (إغلاق داخل اختبارات لا يتنفّذ لو فشل اختبار قبلها)، `push02-live-senders` و`push-tokens` (`notifications.devicePushEnabled` وDriver `live`)، `pay01-two-person-daily-limit` و`wallet01-topup` (`payments.dailyReceiptLimit`)، `used-commerce` (`used.safetyScore`)، `auth.test` (`marketplace.supportPhone` و`withdrawals.dualControlThreshold`)، `batch1-hardening` (`withdrawals.dualControlThreshold` وغيره)، و`tests/e2e/cod-remittance.spec.ts` (التيردَاون كان اختبارًا يتخطاه Playwright لو فشل اختبار قبله).

الإصلاح: (1) `resetSettings()` في `afterAll` لكل ملف من دول، (2) شبكة أمان عامة `tests/helpers/settings-isolation-setup.ts` تلتقط `system_settings` قبل كل ملف وتستعيدها بعده تمامًا حتى لو فشل اختبار، وتغطي كمان الكتابة المباشرة في `system_settings` ومفاتيح `killswitch.*`، (3) تيردَاون الـe2e بقى `test.afterAll`. **لم يتم التحقق من تشغيلها (لا Postgres).**
