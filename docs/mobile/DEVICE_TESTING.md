# تشغيل تطبيق اضمن على هاتف فعلي (Android وiPhone)

هذا الدليل يشغّل **النسخة الموحدة** (`claude/mobile-unified-integration`) على هاتف حقيقي، متصل بخادم تطوير محلي على جهازك.

القواعد التي يلتزم بها:
- لا يُنشر شيء على Vercel أو Staging أو Production.
- لا تُستخدم أموال حقيقية: Real Money OFF.
- لا TestFlight، ولا متجر.
- لا مفاتيح توقيع إنتاجية، ولا Firebase، ولا APNs.

> **ملاحظة عن التوقيع:** بناء Debug على Android يستخدم مفتاح Debug المحلي الذي تولّده أدوات Android تلقائيًا على جهازك. هذا مفتاح تطوير مؤقت، لا يُرفع ولا يصلح للمتجر.
> وعلى iPhone يوقّع Xcode بحساب Apple الشخصي بشهادة تطوير مجانية (Personal Team)، لا بشهادة توزيع.
> أي توقيع إنتاجي يحتاج موافقة صريحة.

## 1. ما تحتاجه

| البند | Android | iPhone |
|---|---|---|
| الجهاز | أي حاسوب (Windows / macOS / Linux) | **Mac** عليه Xcode (الإصدار الذي يطلبه Flutter 3.47) |
| Flutter | 3.47.x stable (نفس إصدار CI: 3.47.8) | نفسه، + CocoaPods |
| الهاتف | Android 7+ مع تفعيل «خيارات المطوّر» و«تصحيح USB» | iOS 15+ مع تفعيل **Developer Mode** |
| الشبكة | الحاسوب والهاتف على **نفس شبكة Wi-Fi** | نفس الشيء |
| الخادم | Node.js 22+ وPostgreSQL 16 على الحاسوب | نفسه |

## 2. سحب النسخة الموحدة

```bash
git clone https://github.com/hodaharraz1/edmn-eg.git && cd edmn-eg
git fetch origin claude/mobile-unified-integration
git checkout claude/mobile-unified-integration
```

## 3. تشغيل الخادم المحلي (مرة واحدة لكل جهاز)

1. أنشئ قاعدة بيانات تطوير **محلية** (ليست قاعدة Staging أو Production):
   ```bash
   createuser -s edmn 2>/dev/null; createdb -O edmn edmn_dev
   psql -c "alter user edmn with password 'edmn'"
   ```
2. أنشئ ملف `.env.local`. هذه قيم تطوير محلية تولّدها بنفسك على جهازك، ولا تُرفع إلى GitHub أبدًا (الملف مستبعد من git):
   ```bash
   cp .env.example .env.local
   # عدّل في .env.local:
   #   DATABASE_URL=postgresql://edmn:edmn@localhost:5432/edmn_dev
   #   SESSION_SECRET=<ناتج: openssl rand -base64 32>
   #   DATA_ENCRYPTION_KEY=<ناتج: openssl rand -base64 32>
   #   STORAGE_DRIVER=local   MAIL_DRIVER=log   SMS_DRIVER=log
   #   COOKIE_SECURE=false    ENFORCE_HOSTS=false
   ```
   - لا تضع مفاتيح دفع حقيقية.
   - لا تضع `DELIVERY_OTP_KEY` ولا `MOBILE_TOKEN_KEY`.
   - وضع الأموال يبقى تجريبيًا (Real Money OFF هو الافتراضي).
3. ثبّت الحزم وجهّز البيانات التجريبية، ثم شغّل الخادم على كل واجهات الشبكة:
   ```bash
   npm ci
   npm run db:setup              # migrate + demo seed
   npx next dev -H 0.0.0.0 -p 3000
   ```
4. اعرف عنوان الحاسوب على الشبكة:
   - على macOS: `ipconfig getifaddr en0`
   - على Linux: `hostname -I`
   - على Windows: `ipconfig`

   في الأمثلة التالية نفترض أنه `192.168.1.20`.
5. افتح `http://192.168.1.20:3000` من متصفح الهاتف. لو ظهر الموقع، فالشبكة سليمة. لو لم يظهر، اسمح للمنفذ 3000 في جدار الحماية.

**حسابات الاختبار** (كلمة السر `Demo@12345`):
- المشترون: `mona@demo.edmn.local`، `ahmed@demo.edmn.local`، `omar@demo.edmn.local`
- البائعون: `techzone@demo.edmn.local`، `homestyle@demo.edmn.local`، `used@demo.edmn.local`

## 4. Android على جهاز فعلي

```bash
cd apps/customer_mobile
flutter pub get
flutter devices                      # يجب أن يظهر الهاتف بعد قبول نافذة «السماح بتصحيح USB»
flutter run --debug \
  --dart-define=EDMN_ENV=local \
  --dart-define=EDMN_API_BASE_URL=http://192.168.1.20:3000
```

- `EDMN_API_BASE_URL` ضروري لأن العنوان الافتراضي `10.0.2.2` يعمل على المحاكي فقط.
- نسخة Debug وحدها تسمح بـ HTTP غير المشفّر. هذا معرّف في `android/app/src/debug/AndroidManifest.xml`. نسخة Release لا تسمح به، والنسخ المستضافة (staging / production) ترفض أي عنوان غير HTTPS من الكود نفسه.
- لتثبيت ملف APK يدويًا على أكثر من هاتف:
  ```bash
  flutter build apk --debug \
    --dart-define=EDMN_ENV=local \
    --dart-define=EDMN_API_BASE_URL=http://192.168.1.20:3000
  # build/app/outputs/flutter-apk/app-debug.apk
  adb install -r build/app/outputs/flutter-apk/app-debug.apk
  ```

## 5. iPhone على Mac

```bash
cd apps/customer_mobile
flutter pub get
cd ios && pod install && cd ..
open ios/Runner.xcworkspace
```

في Xcode:
1. اختر Runner، ثم **Signing & Capabilities**، ثم **Team**، واختر حساب Apple الشخصي (Personal Team).
   - لو ظهر تعارض في المعرّف، غيّر **Bundle Identifier** محليًا فقط (مثلًا `com.edmneg.edmnCustomer.dev.<اسمك>`) ولا ترفع هذا التغيير.
2. وصّل الـ iPhone بكابل، وفعّل على الهاتف: الإعدادات ← الخصوصية والأمان ← Developer Mode.
3. بعد أول تثبيت: الإعدادات ← عام ← VPN وإدارة الجهاز ← ثق بالمطوّر.

ثم من الطرفية:
```bash
flutter devices
flutter run --debug \
  --dart-define=EDMN_ENV=local \
  --dart-define=EDMN_API_BASE_URL=http://192.168.1.20:3000
```

- عند أول اتصال سيسأل iOS عن **الوصول إلى الشبكة المحلية**. اختر «سماح»، وإلا لن يصل التطبيق للخادم. لو رفضت بالخطأ: الإعدادات ← الخصوصية ← الشبكة المحلية ← اضمن.
- `Info.plist` يسمح بـ HTTP فقط لعناوين الشبكة المحلية (`NSAllowsLocalNetworking`). كل العناوين العامة ما زالت تتطلب HTTPS.
- شهادة Personal Team تنتهي بعد 7 أيام. أعد `flutter run` لتجديدها.
- لا TestFlight ولا App Store دون موافقة.

## 6. قائمة الفحص على الهاتف

سجّل لكل بند: ✅ / ❌ + لقطة شاشة + طراز الهاتف وإصدار النظام.

| # | المسار | الحساب | ما نتحقق منه |
|---|---|---|---|
| 1 | الدخول والخروج | mona | الجلسة تبقى بعد إغلاق التطبيق وفتحه (التخزين الآمن)، والخروج يمسحها |
| 2 | التصفح والسلة والدفع التجريبي | mona | الأسعار بالجنيه `ج.م`، الشحن من محافظات مصرية، الدفع تجريبي فقط |
| 3 | الطلبات والتتبع | mona | الحالة والخط الزمني، وتأكيد الاستلام برمز التسليم |
| 4 | الصفقة المحمية | ahmed + techzone (هاتفان أو تبديل حساب) | العرض، طلب تعديل، القبول، المبلغ والرسوم من الخادم |
| 5 | المحفظة | techzone | المبالغ المحجوزة لا تظهر كقابلة للسحب، وطلب السحب «طلب فقط»، ولا يوجد زر صرف أو تحرير |
| 6 | المحادثة | mona ↔ homestyle | إرسال نص ومرفق صورة/PDF من الهاتف (منتقي الملفات)، وعدم تكرار الرسالة عند ضعف الشبكة |
| 7 | الدعم | mona | فتح تذكرة، إرفاق ملف، الرد |
| 8 | الإرجاع والنزاع والتقييم | mona | طلب إرجاع، تصعيد، تقييم بعد الاستلام |
| 9 | الإشعارات | أي حساب | العدّاد، تعليم كمقروء، فتح الإشعار يذهب للشاشة الصحيحة، الإعدادات تُحفظ |
| 10 | نسيت كلمة السر | omar | الرابط يُطبع في سجل الخادم (`MAIL_DRIVER=log`)، الصق الرمز في «عندي رابط»، ثم تُغيَّر كلمة السر ويُسجَّل الخروج |
| 11 | الاتجاه والخطوط | — | RTL صحيح، لا نص مقطوع على شاشة صغيرة، والوضع الليلي إن وُجد |
| 12 | انقطاع الشبكة | — | أطفئ Wi-Fi أثناء الإرسال: رسالة خطأ واضحة، وعند الإعادة لا تتكرر العملية |
| 13 | الخلفية والعودة | — | اترك التطبيق 10 دقائق ثم عُد: لا انهيار، والجلسة سليمة |

## 7. ما لا يغطيه هذا الدليل (يحتاج موافقة أو قرار)

- **إشعارات Push الحقيقية:** تحتاج Firebase وAPNs. حاليًا الإشعارات داخل التطبيق فقط.
- **فتح الروابط من البريد (Deep links / App Links / Universal Links):** يحتاج النطاق الإنتاجي وملفات `assetlinks.json` و`apple-app-site-association`. الرابط حاليًا يُلصق يدويًا.
- **نسخة Release موقّعة أو TestFlight:** تحتاج مفاتيح توقيع وشهادات توزيع.
- **الاختبار ضد Staging:** يحتاج نشر هذه النسخة على Staging أولًا، وهذا لا يحدث دون موافقة.
