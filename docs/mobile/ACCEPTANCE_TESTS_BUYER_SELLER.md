# Buyer and seller acceptance tests on real devices (Android and iPhone)

**Status:** ready to run. **None of these cases has been run on a physical device or an emulator yet**: the build
environment had no device, no emulator (no KVM) and no Mac. Everything below was verified on the Flutter **web** build
of the same code against the same local server (see "Evidence so far"). Fill the result table when you run it.

Setup (server, demo data, building, installing, iOS signing): follow [`DEVICE_TESTING.md`](DEVICE_TESTING.md).
Real Money OFF: every payment below is a TEST receipt confirmed by EDMN staff, every payout a TEST reference.

## 1. Build and install

| Target | Command (from the repo root) | Notes |
|---|---|---|
| Android, debug | `cd apps/customer_mobile && flutter build apk --debug --dart-define=EDMN_ENV=local --dart-define=EDMN_API_BASE_URL=http://<LAN-IP>:3000` | Cleartext is allowed only in debug (local server) |
| Android, install | `adb install -r build/app/outputs/flutter-apk/app-debug.apk` | `adb devices` must list the phone |
| Android, release smoke | `flutter build apk --release --dart-define=EDMN_ENV=staging --dart-define=EDMN_API_BASE_URL=https://<staging>` | Debug-key signed; no production key |
| iOS simulator (Mac) | `cd apps/customer_mobile && flutter run -d "iPhone 16" --dart-define=EDMN_ENV=local --dart-define=EDMN_API_BASE_URL=http://127.0.0.1:3000` | `xcrun simctl list devices` |
| iPhone (Mac + cable) | `flutter run -d <udid> --dart-define=EDMN_ENV=local --dart-define=EDMN_API_BASE_URL=http://<Mac-LAN-IP>:3000` | Development signing only (`DEVICE_TESTING.md` §5) |

Staff steps (payment confirmation, approvals, refunds) run in the **web console** at `http://<server>:3000/admin`
with the demo staff accounts and their 2FA (`finance@`, `checker@`, `payments@`, `catalog@`, `admin@edmn.local`).

## 2. Accounts (local demo database only)

Buyer `mona@demo.edmn.local`, seller `techzone@demo.edmn.local`, second seller `homestyle@demo.edmn.local`, password
`Demo@12345`. A new seller is registered during case S1 (any unused test number; the code is read from the local SMS
outbox: `select body from outbound_messages where channel='SMS' order by created_at desc limit 1`).

## 3. Cases

Each case: do the steps on the phone, then run the check query (`psql $DATABASE_URL -tAc "…"`) and compare.

| ID | Steps on the device | Expected on screen | Check in the database |
|---|---|---|---|
| S1 | Register → verify phone → ID (front/back photos from the **camera**) → seller application: governorate via the picker (search «اسكندر») → store + logo → ID documents → InstaPay → submit | Picker finds «الإسكندرية»; checklist all green; «بانتظار المراجعة» | `select governorate_id, status from sellers s join users u on u.id=s.owner_user_id where u.email='<new>'` → Alexandria id, `PENDING_REVIEW` |
| S2 | Staff approve ID and seller (web console) → reopen the app | Seller Center visible | `status = 'APPROVED'` |
| S3 | Seller: shipping «الشحن حسب المحافظة»: switch on أسوان, fee 92.50, 3–6 days → save; leave and reopen | 92.50 still shown; a min > max save is refused on the phone | `select enabled, fee from seller_shipping_rates where governorate_id=22 and seller_id=…` → `t`, `9250` |
| S4 | Seller: new product with a **camera** photo → price, stock → submit; staff approve | Product live; out-of-stock and archive buttons work | `products.status` LIVE → ARCHIVED after archive |
| B1 | Buyer: product → cart → checkout (InstaPay) → order; upload the receipt from the **gallery** | Order «في انتظار الدفع» then receipt under review | `payments.status = 'PAYMENT_SUBMITTED'` |
| B2 | Staff confirm the payment; seller: «قبول الطلب» → «بدء التجهيز» → «جاهز للشحن» → shipment with a waybill photo → «تم الشحن» | Seller labels: جديد → مقبول → قيد التجهيز → جاهز للشحن → تم الشحن; buyer sees «في طريقه إليك» and the waybill number | `seller_orders.status = 'SHIPPED'`, waybill file `PRIVATE` |
| B3 | Buyer: «تأكيد الاستلام» | «تم التوصيل» | `status='DELIVERED'`, `receipt_confirmed_by` = buyer; no `SELLER_RELEASE` entry |
| B4 | Buyer: on another unpaid order «إلغاء الطلب» | «ملغي» | `orders.status='CANCELLED'`, reservation released |
| C1 | Buyer: «مراسلة البائع» from the order, send (double-tap) | One message | `select count(*) from conversation_messages where …` = 1 |
| C2 | Seller: «رسائل المتجر» → open → reply; buyer sees the reply (also with the app in the **background**, then resumed) | Unread badge clears | `conversation_reads.last_read_at` updated |
| R1 | Buyer: «طلب إرجاع» → «وصل تالف» **without** photos → send | Error «ارفع صور توضّح المشكلة»; nothing created | no `returns` row |
| R2 | Buyer: «غيرت رأيي» → send; seller «الموافقة على الإرجاع» | Buyer sees «اتقبل» and «ابعت المنتج على …» with the store's return address | `returns.status='APPROVED'` |
| R3 | Buyer: «بعت المنتج للبائع» → carrier + tracking | «في الطريق للبائع» | `RETURN_IN_TRANSIT`, carrier/tracking stored |
| R4 | Seller: «استلمت المنتج المرتجع» → «بدء الفحص» → «قبول الإرجاع وطلب الاسترداد» | «قيد الفحص لدى البائع», then «الاسترداد قيد الاعتماد» | one `refunds` row `REQUESTED`; no new journal entry |
| R5 | Web console: `finance@` «طلب اعتماد استرداد»; `checker@` «اعتماد استرداد»; `finance@` «تسجيل صرف» with `TEST-…` | Buyer: «المبلغ اترد», refund «تم الاسترداد» with the TEST reference; every timeline step done | refund `COMPLETED`, return `REFUNDED`, one `REFUND_PAID` entry, journal balanced |
| R6 | Same as R2–R5 but `finance@` records «تسجيل فشل التحويل» first | Buyer sees no reference; `checker@` «إثبات أن التحويل لم يخرج» → `finance@` pays | `FAILED` → `APPROVED` → `COMPLETED`; exactly one `REFUND_PAID` |
| R7 | Seller rejects a return with a reason; buyer «تحويل لفريق أضمن» | Buyer sees the reason; dispute opens | one `disputes` row `OPEN`; no refund |
| X1 | Device-only: rotate, large font (200 %), TalkBack / VoiceOver on the order, return and shipping screens | Every button is read by name; no clipped text | — |
| X2 | Device-only: airplane mode during a save (shipping rates, return request, message) → back online → retry | Error shown; one row after retry | no duplicate rows |
| X3 | Device-only: app switcher hides content (privacy shield); background → foreground keeps the session | — | — |

## 4. Results (fill in)

| ID | Android (model / OS) | iPhone (model / iOS) | Tester / date | Notes |
|---|---|---|---|---|
| S1–S4 | NOT RUN | NOT RUN | | |
| B1–B4 | NOT RUN | NOT RUN | | |
| C1–C2 | NOT RUN | NOT RUN | | |
| R1–R7 | NOT RUN | NOT RUN | | |
| X1–X3 | NOT RUN | NOT RUN | | |

## 5. Evidence so far (web build of the same code, local server, not a device)

| Journey script | Result | Cases |
|---|---|---|
| `docs/mobile/journeys/batch6-flow.mjs` | see `docs/mobile/screenshots/batch6/results.txt` | R1–R6 (refund in the web console with two staff, TEST payouts) |
| `docs/mobile/journeys/batch5-flow.mjs` | see `docs/mobile/screenshots/batch5/results.txt` | S3, B1–B4, C1–C2, R7 |
| `docs/mobile/journeys/seller-flow.mjs` | see `docs/mobile/screenshots/seller/results.txt` | S1, S2, S4, B2 |

Android release APKs (customer and admin) are built and their manifests checked with `aapt2`; they have not been
installed on a device. iOS has not been built (no Mac).
