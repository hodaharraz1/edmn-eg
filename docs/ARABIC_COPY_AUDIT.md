# EDMN / اضمن — Arabic copy audit + fix (final)

Date: 2026-10-13 · Scope: all of `src/` (388 .ts/.tsx/.md files). Copy-only changes; no business logic, fee engine, pricing values, Maker/Checker, KYC, OTP, refund-accounting, allocation or alert-rule changes.
Files not touched, as instructed: `src/server/modules/sellers/service.ts`, `src/app/_actions/seller.ts`, `src/app/seller/(center)/settings/page.tsx`, `src/server/db/schema/**`, `drizzle/**`, every path containing "invitation", `src/app/(shop)/account/layout.tsx`, and the coordinator's additions in `labels.ts` (the `storeInvitation` group) and `_actions/account.ts`. `account.ts` was not edited.

## Method (exact, re-runnable)

1. **Label/enum diff script** (`scratchpad/label-diff.ts`, run with `npx tsx`). It imports every exported `readonly string[]` of UPPER_CASE literals from `src/domain/machines.ts` and `src/server/db/schema/index.ts`. Each array is diffed against its `LABELS.<group>` (19 explicit mappings) or, for `*STATUS*|*STATES|*STAGES` arrays, against `STATUS`. Unmapped enums are listed so their render sites can be grepped.
2. **Raw enum render sites in JSX**:
   `grep -rnE "\{[a-zA-Z_.?]+\.(status|type|kind|reason|stage|role|channel|purpose|source|sourceType|state|action|decision|method|condition|priority|context|scanStatus|basis|receiptBasis|model|economicClass|taxTreatment|costType|borneBy|nature|payerPolicy|senderRole|subjectType|environment|scope)\}" src --include=*.tsx | grep -v "label(\|statusLabel\|StatusChip"`
   plus `\?\? *x\.(status|reason|…)\}` fallbacks, and `${x.status|code|to…}` interpolations inside Arabic or DomainError strings in `src/server`, `src/app/_actions` and `src/app`.
3. **Financial phrasing**: every line outside `src/app/admin` and `seed/` that matches `تحو|صرف|إتاح|اتاح|متاح|مستحق|سحب|استرد|رصيد|فلوس|المبلغ|اترد` (536 lines, saved to `scratchpad/fin.txt`) was read in full. Targeted greps on top of that:
   - `تلقائي|أوتوماتيك`
   - `تم التحويل|اتحول|هيتحول|هتتحول|بيتحول|تتحول|يتحول|اتصرف|هيتصرف|اترد|فلوسك`
   - `(ياخد|هياخد|بياخد|يستلم…)…(فلوس|مستحق|المبلغ)`
   - `رمز (الاستلام|التسليم)`
   - `(رمز|الكود|OTP)…(تحوي|صرف|إتاحة…)`
   - `Push|SMS|رسالة نصية|واتساب|إشعارات المتصفح`
   - `المبالغ الكبيرة|حد الرقابة|شخص واحد`
   - Admin money buttons: `<(SubmitButton|ConfirmSubmit)…>…(صرف|تحويل|إتاح|اعتماد|تسوية|استرداد|سحب)`
   - Every `notify(` call that sets `status|kind|decision` vars, checked against `EVENT_TEMPLATES`.
4. **Terminology**:
   - `محفظ|escrow|wallet`
   - `رسوم …` frequency table
   - `الضمان|الضمانة|رسوم الضمان`
   - `أرباح|فلوسك|محفظتك|رصيد المشتري`
   - `وسيلة السحب|بيانات السحب|حساب السحب`
   - `استرجاع|ارجاع|رد المبلغ|ترجيع`
   - `صفقة مضمونة|وسيط`
   - Brand variants `إضمن|أضمن|EDMN` in user-facing strings
5. **Placeholders**:
   - `lorem|TODO|FIXME|xxx|قريب(ا|اً|ًا)|example\.(com|org)|0100000000|01[0125]\d{8}|آلاف|ملايين|support@|info@`
   - Marketing claims: `\+\d|\d+\+|★|4\.\d|5/5|testimonial|الأول في|أكبر|أسرع|100%|مضمون`
   - CMS seed blocks and the home page were read.
6. **URLs**: `grep -rnE "vercel\.app|localhost|127\.0\.0\.1|edmn-staging" src`.
7. **Pricing**:
   - `عمول|\d+ ?[%٪]|في المي` and `\d+ (ج\.م|جنيه|EGP)` (PCRE with `LC_ALL=C.UTF-8`)
   - Fee-engine sources read: `pricing/engine.ts` (deal split is per-version data) and `finance/commissions.ts`, which has no importer apart from the admin rule CRUD, so it is legacy.
8. **Tests**: before each change, `grep -rnF "<old string>" tests` was run (unit, integration, e2e, helpers). None of the changed strings is asserted, so no test edits were needed.

---

## 1. Raw user-visible codes

FOUND 17 (5 in scope + 12 admin-only) · FIXED 4 · covered by the coordinator 1 · REMAINING 12 (admin-only)

| # | file:line | before → after | status |
|---|---|---|---|
| 1 | src/server/modules/commerce/fulfilment.ts:535 | The refund reason shown to the customer in /account/payments read `إلغاء قبل الشحن (OUT_OF_STOCK): …` → it now uses `enumLabel('cancelReason', code)`, e.g. `(نفاد المخزون)` | FIXED |
| 2 | src/server/modules/commerce/fulfilment.ts:701 | `فشل التوصيل (RETURNED_TO_SELLER|LOST): …` → `statusLabel(to)` (`رجع للبائع` / `مفقود`) | FIXED |
| 3 | src/lib/i18n/labels.ts:287 | `LABELS.financialAction` was missing `REFUND_REVOCATION`, so the raw code showed in the finance-control approvals table → added `'إلغاء اعتماد استرداد قبل التحويل'` | FIXED |
| 4 | src/app/admin/(console)/receiving-destinations/page.tsx:45 | A binary ternary labelled every non-bank destination, INSTAPAY included, as `محفظة موبايل`. That is the wrong channel type for the reviewer → `label('payoutType', d.type)` | FIXED |
| 5 | schema `SELLER_INVITATION_STATUSES.DECLINED` not in `STATUS` | Rendered through the coordinator's new `LABELS.storeInvitation` group | covered (not edited) |

Remaining (admin console, raw code shown but wording is not operationally wrong; scope rule):
- `customers/page.tsx:33`, `customers/[id]/page.tsx:35`: `u.status`
- `withdrawals/[id]/page.tsx:50`: seller status
- `ops/page.tsx:42,44,90,109`: environment, fingerprint, channel and ledger status
- `finance-control/page.tsx:90`: health status
- `finance/pricing/refund-policy/page.tsx:42,64`: status, lifecycleStage, reasonCode, responsibleParty
- `reconciliation/page.tsx:51,77`: channel and status
- `finance/pricing/payout-costs/page.tsx:74`: channel
- `categories/page.tsx:84`: attribute type
- `cms/page.tsx:34`: block type
- `identity/[id]/page.tsx:86`: history action and status codes
- `audit` / `customers` / `sellers` action codes, which are intentional `<code>`

No customer or seller page renders a raw enum after the fixes. Every `label()` group is complete for its enum per the diff script. `ALERT_STAGES` and `REFUND_LIFECYCLE_STAGES` appear only in admin, through local maps or as raw admin values.

## 2. Misleading financial phrases

FOUND 20 · FIXED 20 · REMAINING 0

| # | file:line | before → after |
|---|---|---|
| 1 | src/server/modules/notifications/events.ts:59 (EXTERNAL_DEAL_COMPLETED) | `مستحقات البائع هتتحوّل على بيانات استلام الأموال المسجّلة، وهنبلغك عند التحويل` (an automatic payout to the offer destination, which `markDealPayoutPaid` keeps closed) → `اكتملت بعد موافقة الإدارة على إتاحة مستحقات البائع. المستحقات بقت في «رصيد الصفقات المحمية» للبائع، وتحويلها بيتم بس لما البائع يطلب سحب على «بيانات استلام الأموال» المتحقق منها والإدارة تعتمده.` |
| 2 | src/app/_components/seller-finance-summary.tsx:7 | available hint `في الصفقات المحمية: مستحق يتحوّل على بيانات استلام الأموال المسجلة في الصفقة` → `…التحويل بيتم بس بعد طلب سحب تعتمده الإدارة: رصيد المتجر على بيانات استلام أموال المتجر، ومستحقات الصفقات المحمية على «بيانات استلام الأموال» المتحقق منها.` |
| 3 | src/app/_components/seller-finance-summary.tsx:52 | `مستحقات كل صفقة تتحوّل على بيانات استلام الأموال اللي سجلتها في عرضك` → `مستحقات الصفقات بتتحوّل بس لما تطلب سحب من «مستحقاتي من البيع» على «بيانات استلام الأموال» المتحقق منها والإدارة تعتمده.` |
| 4 | src/app/(shop)/account/deals/[id]/page.tsx:152 | Row label `بيانات استلام الأموال` on the destination typed into the offer → `وسيلة الاستلام المسجّلة في العرض (للمرجع)` |
| 5 | same:320 | `البائع مش هياخد مستحقه غير بعد خطوتين: … رمز الاستلام، وبعدها تأكيدك` (omitted the timeout and the Admin release) → `البائع مش هيستحق المبلغ غير بعد التحقق … برمز الاستلام، وبعدها تأكيدك … (أو انتهاء مهلتك بدون اعتراض)، ومش هيتاح له غير بموافقة الإدارة.` |
| 6 | same:419 | `والمبلغ بيتحول له بس بموافقة الإدارة` (release presented as a transfer) → `والمبلغ مش بيتاح له غير بموافقة الإدارة.` |
| 7 | same:462 (COMPLETED, seller) | `مستحقك X هيتحوّل على <offer destination>` → `الإدارة أتاحت مستحقك X في «رصيد الصفقات المحمية». الحالة: …` plus, when unpaid, `اطلب سحبه من «مستحقاتي من البيع» على «بيانات استلام الأموال» المتحقق منها.` |
| 8 | same:559 (offer PayoutFields legend) | `بيانات استلام الأموال` → `وسيلة الاستلام (بتتسجل مع العرض)` plus a note: for reference only, not used for payout; payout happens through a withdrawal request to a verified destination. The fields are unchanged because the service still requires them. |
| 9 | src/app/(shop)/protected-deal/page.tsx:22 | `وبعد موافقة الإدارة المبلغ يتحوّل للبائع` → `تأكيدك بيثبت استحقاق البائع، والمبلغ مش بيتاح له غير بموافقة الإدارة.` |
| 10 | src/app/(shop)/deal/invite/[token]/page.tsx:35 | `…وموافقة الإدارة بيتحوّل لك مستحقك` → `…وموافقة الإدارة مستحقك بيتاح لك، وتقدر تطلب سحبه على «بيانات استلام الأموال» المتحقق منها.` |
| 11 | src/app/(shop)/account/orders/[id]/page.tsx:156 | `والإدارة بتراجع وتوافق على تحويله له` → `…على إتاحته له` |
| 12 | src/app/_actions/deals.ts:99 | `مستحقات البائع هتتحوّل بس بعد مراجعة وموافقة الإدارة` → `مستحقات البائع مش هتتاح له غير بعد مراجعة وموافقة الإدارة.` |
| 13 | src/app/_components/shop-footer.tsx:25 | `والبائع بياخد فلوسه بعد الاستلام وموافقة الإدارة` → `ومستحقات البائع مش بتتاح له غير بعد الاستلام وموافقة الإدارة` |
| 14 | src/app/_components/shop-footer.tsx:28 | `قبل ما الطلب يتسلّم وتعدّي مهلة الاعتراض وتوافق الإدارة` (wrongly requires the timeout even after a confirmation) → `قبل ما الطلب يتسلّم، وتأكد الاستلام أو تعدّي مهلة الاعتراض، وتوافق الإدارة` |
| 15 | src/app/(shop)/cart/page.tsx:107 | same as #14 |
| 16 | src/app/(shop)/product/[slug]/page.tsx:202 | `قبل استلامك للطلب وانتهاء مهلة الاعتراض وموافقة الإدارة` → `قبل استلامك للطلب، وتأكيدك أو انتهاء مهلة الاعتراض، وموافقة الإدارة` |
| 17 | src/lib/i18n/labels.ts:294 | `financialAction.DEAL_REFUND: 'استرداد صفقة'` (the action is the approval, per refunds.ts:230) → `'اعتماد استرداد صفقة'` |
| 18 | src/app/admin/(console)/returns/[id]/page.tsx:63,64,69 | Heading and button `اعتماد الاسترداد` plus `يُنشأ سجل استرداد يُصرف يدوياً` (the action only creates a REQUESTED refund) → heading `قبول الإرجاع وتسجيل طلب استرداد`, text `يُنشأ طلب استرداد فقط — لا يتحرك أي مبلغ هنا. الاعتماد المالي (منشئ ومعتمد مختلفان) ثم تسجيل الصرف يتمان من صفحة المستردات.`, button `تسجيل طلب الاسترداد` |
| 19 | src/app/seller/(center)/returns/[id]/page.tsx:56,61,62 | `قبول الاسترداد` / `تأكيد الاسترداد` / `سيتم خصم المبلغ … من رصيدك` → `قبول الإرجاع وطلب الاسترداد` / `قبول الإرجاع وتسجيل طلب الاسترداد` / `سيُسجَّل طلب استرداد للعميل. بعد اعتماد الإدارة يُخصم المبلغ … ثم يحوّل فريق اضمن المبلغ للعميل.` |
| 20 | src/app/admin/(console)/withdrawals/page.tsx:29 | `… المبالغ الكبيرة تتطلب شخصين مختلفين` (wrong: every payout is two-person, threshold 0) plus a hardcoded `48 ساعة` → `هدف الخدمة: الصرف خلال ${withdrawals.slaBusinessHours} ساعة عمل … كل صرف يحتاج شخصين مختلفين بدون حد أدنى للمبلغ.`. The value is read with `getSetting`, display only. |

Checked and correct, so not counted:
- OTP copy everywhere says the code proves delivery only and never releases money.
- Alert channels: `admin/alerts` says in-app plus email queue. Push copy exists only for buyer↔seller messages, which have a real Web Push channel.
- Withdrawal and refund kind labels.
- REFUND_PAID and return `REFUNDED` are sent only after the payout is recorded (`onReturnRefundPaid`).
- BUYER_RECEIPT_CONFIRMED is sent only on a real confirmation; timeouts use TIMEOUT_ENTITLEMENT / DEAL_ENTITLED.
- `sellerOrderStatusLabel` separates confirmed, timeout and dispute bases.
- `sms: true` on customer transactional templates is delivery configuration, not a claim in the copy.

## 3. Inconsistent terms

FOUND 10 in scope · FIXED 10 · REMAINING 24 (admin, legal, forbidden files)

| # | file:line | before → after |
|---|---|---|
| 1 | src/server/modules/identity/service.ts:36 | `PAYOUT_DESTINATION: 'إضافة وسيلة سحب'` (shown in the identity-gate error) → `'إضافة بيانات استلام الأموال'` |
| 2 | src/app/(shop)/account/deals/[id]/page.tsx:146 | `رسوم الضمان على البائع` → `رسوم خدمة الضمان على البائع`, the published /legal/fees name |
| 3 | same:517 | same |
| 4 | src/app/(shop)/deal/invite/[token]/page.tsx:50 | `رسوم الضمان عليك …` → `رسوم خدمة الضمان عليك …` |
| 5 | src/server/modules/notifications/providers.ts:41 | email subject fallback `'EDMN'` → `'اضمن'` |
| 6 | src/app/seller/(center)/balance/page.tsx:48 | `لوسيلة السحب المعتمدة` → `على بيانات استلام الأموال المعتمدة` |
| 7–10 | src/server/modules/finance/withdrawals.ts:376,380,478,910 | `تغيير بيانات السحب` ×2, `وسيلة السحب المطلوبة`, `notFound('وسيلة السحب')` → `بيانات استلام الأموال` |

Verified clean:
- There is no buyer wallet, balance or escrow wording. `محفظة` appears only as the mobile-wallet payout type, and the receiving page explicitly says «دي مش محفظة».
- `اضمن` is spelled consistently.
- إرجاع and استرداد are used correctly.
- `صفقة محمية` is used consistently.

REMAINING (not edited):
- **Admin-only, scope rule:**
  - `أرباح` for seller earnings in `admin/releases/page.tsx:12,41`, `releases/[id]/page.tsx:21,41,69`, `approvals/page.tsx:22`, `layout.tsx:54`, `rbac/permissions.ts:56`, `finance/controls.ts:16,316` and staff alert `alerts/rules.ts:181`.
  - `الضمانة` as the admin name of the protected-deal pricing model in `finance/pricing/_view.tsx:16,28,49`, `simulator/page.tsx:49`, `protected-deals/page.tsx:4`, `profitability/page.tsx:65,68,71,82`, `finance/controls.ts:512` and `pricing/service.ts:583`.
  - `وسيلة سحب` in `admin/identity/page.tsx:27`.
- **Forbidden file:** `src/server/modules/sellers/service.ts:314,318,320,347` (`وسيلة السحب`).
- **Legal, superseded v1.0 text:** `src/server/db/seed/legal-texts.ts:93,193` (`استلام الأرباح`). It is not edited because it is legal text and versions v1.1 and v1.2 supersede it.

## 4. Placeholders / fake contacts / demo claims

FOUND 3 · FIXED 2 · REMAINING 1

| # | file:line | before → after | status |
|---|---|---|---|
| 1 | src/app/_components/shop-footer.tsx:25 | Unverifiable claim `من بائعين كتير` → `من بائعين تمت مراجعتهم`, which reflects the real seller review process | FIXED |
| 2 | src/server/db/seed/reference.ts:421 (CMS TRUST seed) | `شحن لكل المحافظات` (not guaranteed, since each seller chooses governorates) → `شحن حسب المحافظة`. This only affects new databases; existing CMS rows are edited from Admin → CMS. | FIXED |
| 3 | src/server/core/env.ts:37 | `MAIL_FROM` defaults to `EDMN <no-reply@example.com>`. It is required only in PRODUCTION (runtime-env.ts:69), so staging could email users from example.com. | REMAINING: this is config, not copy. Set `MAIL_FROM` in staging. No domain was invented. |

Not defects:
- `قريبًا` at `deals/service.ts:78`, `auth/service.ts:295` and `ops/commerce-gate.ts:25`. Each shows only while SMS is unavailable or the platform is not launched, so the feature really is unavailable at that point.
- `مثال: 01012345678` registration hints (×2) are a format example, not a contact.
- `push.ts:133` `mailto:support@edmneg.com` is a VAPID protocol subject and is never shown.

None found: lorem, visible TODO/FIXME, xxx, 0100000000, آلاف/ملايين, fake ratings or testimonials.

## 5. Hardcoded staging URLs (src/ only)

FOUND 0 hardcoded staging/`*.vercel.app` URLs · FIXED 0 · REMAINING 0

`localhost:3000` appears only as dev fallbacks: `core/env.ts:19-21`, `app/robots.ts:3`, `_components/seo.tsx:1`, `(shop)/account/deals/[id]/page.tsx:49`, `app/layout.tsx:11`, `app/sitemap.ts:8`. Hosted environments fail closed: `APP_URL` is REQUIRED in all hosted envs and must be https (`runtime-env.ts:48,120`, `env.ts:64`). `seed/demo.ts:213` is a localhost safety guard. These were not changed because they are configuration, not copy.

## 6. Obsolete pricing copy

FOUND 12 · FIXED 7 · REMAINING 5 (legal and admin)

| # | file:line | before → after |
|---|---|---|
| 1 | src/app/(shop)/protected-deal/page.tsx:50 | `ومقسومة بالتساوي بين المشتري والبائع` (the split is per pricing-version data, `buyerBps/sellerBps`) → `ومقسومة بين المشتري والبائع حسب التسعير المنشور. نصيب كل طرف بيظهر قبل ما تأكد.` |
| 2 | src/app/(shop)/account/deals/new/page.tsx:59 | `ومقسومة بالتساوي بينك وبين البائع` → `ومقسومة بينك وبين البائع حسب التسعير المنشور، وهتشوف نصيب كل طرف …` |
| 3 | src/app/seller/(center)/products/new/page.tsx:45 | hint `يحدد المواصفات المطلوبة والعمولة` → `…وفئة رسوم خدمة اضمن` |
| 4 | src/app/admin/(console)/commissions/page.tsx:21 | `العمولة تُحسب لكل بند … وفق القاعدة السارية` (false: legacy rules price nothing) → `أرشيف: قواعد العمولة القديمة لم تعد تُستخدم في تسعير الطلبات الجديدة … من إصدار التسعير المنشور …` |
| 5 | src/app/admin/(console)/categories/page.tsx:31 | `العمولة الافتراضية: X%` → `العمولة القديمة الافتراضية (أرشيف — لا تُستخدم في التسعير): X%. الرسوم الفعلية من إصدار التسعير المنشور …` |
| 6 | same:44 | `عمولة X%` / `العمولة الموروثة` → `عمولة قديمة (أرشيف) X%` / `العمولة القديمة الموروثة (أرشيف)` |
| 7 | src/app/admin/(console)/layout.tsx:30 | nav `التصنيفات والعمولات` → `التصنيفات` |

REMAINING:
- `src/server/db/seed/legal-texts.ts:185-190,345,362-364,372`: v1.0 commission clauses, superseded by v1.2. Legal text, so reported only.
- `legal-texts-v1_1.ts:155`: `(المشتري 0% / البائع 100%)`, superseded by v1.2. Legal text.
- `legal-texts-v1_2.ts:34`: `مقسومة بالتساوي … ما لم يُعلن غير ذلك` is the legal draft and is qualified, so it was left as is.
- `admin/(console)/orders/[id]/page.tsx:61`: `عمولة x%`, showing the effective fee-bps snapshot. Admin only, label term only.
- `admin/(console)/finance/profitability/page.tsx:57`: `(المستهدف 50%)`, an admin analytics target from a code default.

No pricing value, Fee Engine file or money-computing path was changed.

---

## Verification
- `npx tsc --noEmit -p .`: clean
- `npm run lint`: clean
- `npx vitest run`: 31 files, 481/481 passed. The count is above the 471 quoted in the brief, presumably from tests added in parallel.
- Playwright was not run, nothing was committed or pushed, and no remote service was touched.

## Files changed (26)
- src/server/modules/commerce/fulfilment.ts
- src/lib/i18n/labels.ts
- src/server/modules/notifications/events.ts
- src/server/modules/notifications/providers.ts
- src/server/modules/identity/service.ts
- src/server/modules/finance/withdrawals.ts
- src/server/db/seed/reference.ts
- src/app/_actions/deals.ts
- src/app/_components/seller-finance-summary.tsx
- src/app/_components/shop-footer.tsx
- src/app/(shop)/account/deals/[id]/page.tsx
- src/app/(shop)/account/deals/new/page.tsx
- src/app/(shop)/account/orders/[id]/page.tsx
- src/app/(shop)/deal/invite/[token]/page.tsx
- src/app/(shop)/protected-deal/page.tsx
- src/app/(shop)/cart/page.tsx
- src/app/(shop)/product/[slug]/page.tsx
- src/app/seller/(center)/products/new/page.tsx
- src/app/seller/(center)/returns/[id]/page.tsx
- src/app/seller/(center)/balance/page.tsx
- src/app/admin/(console)/receiving-destinations/page.tsx
- src/app/admin/(console)/returns/[id]/page.tsx
- src/app/admin/(console)/withdrawals/page.tsx
- src/app/admin/(console)/commissions/page.tsx
- src/app/admin/(console)/categories/page.tsx
- src/app/admin/(console)/layout.tsx

No test files changed: none of the changed strings is asserted in tests/.

## ALL FIXED: NO
Every in-scope customer and seller defect in all six categories is fixed. What remains:
- 12 admin-only raw codes and 24 admin, legal and forbidden-file terminology items (scope rule, "do not edit" list, and the legal rule).
- One config default (`MAIL_FROM` example.com, reachable on staging).
- Five superseded legal clauses and admin analytics items about pricing.

---

## Closure addendum (coordinator pass after the audit)

- **Inconsistent terms, closed:**
  - `وسيلة السحب` → `بيانات استلام الأموال` in `sellers/service.ts` (4 messages) and in the admin identity, sellers/[id] and withdrawals/[id] pages.
  - `أرباح البائع(ين)` → `مستحقات البائع(ين)` in admin releases, approvals, layout, orders/[id] and finance-control, in the `finance.release` permission label, and in the kill-switch label and invariant text in `finance/controls.ts`.
  - Deliberately left unchanged: the alert rule title in `alerts/rules.ts`, because alert rules are out of scope for this pass.
- **Raw codes in the admin console, closed:**
  - User status (new `userStatus` group), seller status, ledger-health and fingerprint status, reconciliation import status, refund-policy version status, and identity-history statuses now show Arabic labels.
  - Channels use the new `moneyChannel` and `notifyChannel` groups, attribute types use `attributeType`, and CMS block types use `cmsBlock`.
- **Intentionally kept as technical identifiers (admin/ops only, never customer- or seller-facing):**
  - The deployment environment code on Ops (STAGING/PRODUCTION, asserted by the staging E2E).
  - Notification event codes in the Ops dead-letter list.
  - Audit and identity-history action codes.
  - The internal refund-policy matrix columns in the pricing console.
- **Accurate, not obsolete:** the admin order line `عمولة x%` shows that line's frozen pricing snapshot.
- **Legal, superseded, not rewritten:** the v1.0 commission clauses and the v1.1 split line. v1.2 is the current text; lawyer review is pending.
- **Config, not copy:** the default `MAIL_FROM` (example.com) is refused in production. Staging must set `MAIL_FROM` before real email delivery.
