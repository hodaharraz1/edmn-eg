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
| Flutter | 3.47.x stable (نفس إصدار CI: 3.47.8) | نفسه. لا حاجة لـ CocoaPods: المشروع يستخدم Swift Package Manager |
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
- البائعون: `techzone@demo.edmn.local`، `anaqa@demo.edmn.local`، `homestyle@demo.edmn.local`، `used@demo.edmn.local`

اختياري: شغّل في طرفية ثانية `npm run worker`. هذا العامل يسلّم رسائل البريد وSMS التجريبية (تُطبع في الطرفية) ويشغّل المهام الدورية.
- الإشعارات داخل التطبيق تعمل بدونه.
- روابط إعادة كلمة السر **لا تُطبع أبدًا** في السجل، حتى في التطوير (انظر الاختبار 10).

## 4. Android على جهاز فعلي

### 4أ. أسرع طريقة: ملف APK جاهز عبر كابل USB

ملف `app-arm64-v8a-debug.apk` (يناسب كل الهواتف الحديثة) مبني من النسخة الموحدة:
- عنوان الخادم فيه هو `http://127.0.0.1:3000`؛
- `adb reverse` يوجّه هذا العنوان عبر الكابل إلى المنفذ 3000 على حاسوبك؛
- لذلك لا تحتاج عنوان IP ولا إعداد Wi-Fi أو جدار حماية.

```bash
adb devices                                  # الهاتف يظهر بحالة device
adb reverse tcp:3000 tcp:3000                # أعدها بعد كل فصل/توصيل للكابل
adb install -r app-arm64-v8a-debug.apk
```

افتح «اضمن» على الهاتف، وتأكد أن الخادم (القسم 3) يعمل على الحاسوب.
- لو ظهرت رسالة انقطاع الاتصال: تحقق من `adb reverse --list`.
- للهواتف القديمة 32-bit استخدم `app-armeabi-v7a-debug.apk`.
- البناء يُعاد بنفس الأمر أدناه مع `EDMN_API_BASE_URL=http://127.0.0.1:3000`.

### 4ب. البناء والتشغيل من الكود (Wi-Fi أو USB)

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

## 5. iPhone على Mac (Debug Development Build فقط)

### 5أ. فحص بيئة الـ Mac (مرة واحدة)

```bash
sw_vers                      # إصدار macOS
xcodebuild -version          # Xcode: الإصدار الذي يطلبه Flutter 3.47
xcode-select -p              # يجب أن يشير إلى /Applications/Xcode.app/...
sudo xcodebuild -runFirstLaunch
flutter --version            # 3.47.x stable
flutter doctor -v            # قسم Xcode يجب أن يكون ✓
xcrun devicectl list devices # الـ iPhone يظهر بعد توصيله والثقة بالـ Mac
```

- **لا تحتاج CocoaPods ولا `pod install`.** المشروع يستخدم Swift Package Manager: Xcode مربوط بـ `FlutterGeneratedPluginSwiftPackage`، ولا يوجد `Podfile`.
- الإضافات الثلاث (`file_picker_darwin` و`flutter_secure_storage_darwin` و`path_provider_foundation`) تدعم Swift Package Manager، وتحتاج iOS 13–14. المشروع يستهدف iOS 15.
- لو ظهر في `flutter doctor` أن CocoaPods مطلوب، فهذا فقط لأن Swift Package Manager معطَّل في إعداداتك. فعّله بالأمر `flutter config --enable-swift-package-manager` بدل تثبيت CocoaPods.

### 5ب. التوقيع (Development فقط، بلا شهادات توزيع)

```bash
cd apps/customer_mobile
flutter pub get
open ios/Runner.xcworkspace
```

في Xcode:
1. اختر Runner، ثم **Signing & Capabilities**:
   - اترك **Automatically manage signing** مفعّلًا؛
   - في **Team** اختر حسابك. حساب Apple مجاني (Personal Team) يكفي.
   - Xcode ينشئ شهادة **Apple Development** فقط. **لا تنشئ** شهادة Distribution، ولا تستخدم Archive، ولا Distribute App.
2. لو ظهر تعارض في **Bundle Identifier** (لأن `com.edmneg.edmnCustomer` مسجَّل في فريق آخر):
   - غيّره محليًا، مثلًا `com.edmneg.edmnCustomer.dev.<اسمك>`؛
   - **لا تعمل commit** لهذا التغيير: `git checkout ios/Runner.xcodeproj` بعد الاختبار.
3. وصّل الـ iPhone بكابل، واضغط «ثق» على الهاتف.
4. على الهاتف: الإعدادات ← الخصوصية والأمان ← **Developer Mode** ← تشغيل، ثم أعد تشغيل الهاتف.
5. بعد أول تثبيت: الإعدادات ← عام ← VPN وإدارة الجهاز ← ثق بالمطوّر.

### 5ج. التشغيل على الهاتف

الـ iPhone لا يملك مثل `adb reverse`، لذا يتصل بالـ Mac عبر **نفس شبكة Wi-Fi**. استخدم اسم الـ Mac على الشبكة المحلية:
```bash
scutil --get LocalHostName      # مثال: Hodas-MacBook  ←  العنوان: http://Hodas-MacBook.local:3000
```

افتح `http://<الاسم>.local:3000` من Safari على الـ iPhone أولًا للتأكد من الوصول، ثم:
```bash
flutter devices
flutter run --debug -d <معرّف-الـiPhone> \
  --dart-define=EDMN_ENV=local \
  --dart-define=EDMN_API_BASE_URL=http://<الاسم>.local:3000 \
  --dart-define=EDMN_APP_VERSION=1.0.0-device-test
```

- عناوين `.local` مغطاة صراحةً باستثناء `NSAllowsLocalNetworking` في `Info.plist`. لو استخدمت عنوان IP بدلًا منها (مثل `http://192.168.1.20:3000`) ورفض iOS الاتصال، فارجع إلى اسم `.local`.
- عند أول اتصال سيسأل iOS عن **الوصول إلى الشبكة المحلية**. اختر «سماح»، وإلا لن يصل التطبيق للخادم. لو رفضت بالخطأ: الإعدادات ← الخصوصية والأمان ← الشبكة المحلية ← اضمن.
- كل العناوين العامة ما زالت تتطلب HTTPS. نسخ staging وproduction ترفض أي عنوان غير HTTPS.
- شهادة Personal Team تنتهي بعد 7 أيام. أعد `flutter run` لتجديدها.
- **لقطات الشاشة:** زر الجانب + رفع الصوت على الهاتف، أو `xcrun devicectl device info …`. **سجل التطبيق:** نافذة `flutter run` نفسها.
- لا TestFlight ولا App Store ولا Archive.

### 5د. فحوص خاصة بالـ iPhone (تُضاف إلى الـ 13)

| # | ما نتحقق منه | المتوقع |
|---|---|---|
| i1 | منتقي الملفات (صورة من «الصور» عبر تطبيق «الملفات»، وPDF) في المحادثة والدعم والإرجاع | يفتح المنتقي، يُرفع الملف، والصورة تظهر مصغّرة |
| i2 | لوحة المفاتيح العربية والإيموجي في حقول الشات والدعم | لا يختفي الحقل خلف اللوحة؛ الاتجاه صحيح للعربي والإنجليزي المختلط |
| i3 | الإيماءات: السحب من حافة الشاشة للرجوع في RTL | الرجوع يعمل ولا يتعارض مع القوائم |
| i4 | Dynamic Type (أكبر حجم خط من الإعدادات) | لا قص ولا تداخل في البطاقات المالية وأزرار الدفع |
| i5 | حذف التطبيق ثم تثبيته من جديد | **سجّل ما يحدث**: بيانات Keychain تبقى بعد الحذف على iOS، فقد يفتح التطبيق مسجّلًا بالحساب السابق. المطلوب قرار: هل هذا مقبول؟ |
| i6 | قفل الهاتف أثناء رفع مرفق ثم فتحه | لا انهيار؛ إما يكتمل الرفع أو تظهر رسالة خطأ واضحة مع إعادة محاولة لا تُكرّر |

### 5هـ. محاكي iOS على الـ Mac (قبل الهاتف الحقيقي)

**المرحلة 0 — حالة المشروع** (لا تغيّر شيئًا قبلها):
```bash
cd <مسار-المستودع>
git status --short                       # احفظ أي تعديل محلي (مثل pubspec.lock): لا تستخدم reset ولا checkout عليه
git fetch origin claude/mobile-unified-integration
git log --oneline -1 origin/claude/mobile-unified-integration
git merge --ff-only origin/claude/mobile-unified-integration   # آمن مع تعديل pubspec.lock المحلي: لم يتغير في الفرع بعد 07d0df2
grep -c NSAllowsLocalNetworking apps/customer_mobile/ios/Runner/Info.plist   # يجب أن يكون 1 (من commit 74af50d)
```

**المرحلة 1 — الخادم المحلي:** نفّذ القسم 3 كاملًا على الـ Mac (Postgres 16 محلي، `.env.local`، `npm run db:setup`، ثم `npx next dev -H 0.0.0.0 -p 3000`). بعدها تحقّق:
```bash
curl -s http://localhost:3000/api/v1/app/config   # يجب أن يحتوي "realMoneyEnabled":false و"currency":"EGP"
```

**المرحلة 2 — عنوان الـ API للمحاكي:**
- محاكي iOS يشارك شبكة الـ Mac نفسها، فالعنوان الصحيح هو `http://localhost:3000`.
- العنوان الافتراضي في الكود `http://10.0.2.2:3000` خاص بمحاكي Android، ولا يعمل على iOS.
- لا تغيّر الكود؛ مرّر العنوان عند التشغيل:
```bash
cd apps/customer_mobile
xcrun simctl list devices booted         # تأكد أن المحاكي المطلوب يعمل
flutter run --debug -d <معرّف-المحاكي> \
  --dart-define=EDMN_ENV=local \
  --dart-define=EDMN_API_BASE_URL=http://localhost:3000 \
  --dart-define=EDMN_APP_VERSION=1.0.0-device-test
```
- لو رفض iOS الاتصال برسالة App Transport Security، استخدم اسم الـ Mac: `http://$(scutil --get LocalHostName).local:3000`. اسم `.local` مغطى صراحةً بـ `NSAllowsLocalNetworking`.

**المرحلة 3 — رحلة آمنة من الواجهة إلى قاعدة البيانات** (بلا أي عملية مالية):
1. سجّل الدخول بحساب `mona@demo.edmn.local` / `Demo@12345`. **المتوقع:** الصفحة الرئيسية تعرض منتجات من الخادم.
2. افتح «طلباتي». **المتوقع:** الطلب 100002 بثلاثة بائعين.
3. افتح الإشعارات. **المتوقع:** 8 إشعارات. ثم «قراءة الكل».
4. افتح تذكرة دعم من نوع «مشكلة تقنية» بعنوان `اختبار محاكي iOS`.
5. تحقّق من قاعدة البيانات أن الكتابة وصلت:
   ```bash
   psql postgresql://edmn:edmn@localhost:5432/edmn_dev -c \
     "select number, type, status, subject from support_tickets order by created_at desc limit 1"
   psql postgresql://edmn:edmn@localhost:5432/edmn_dev -c \
     "select count(*) filter (where read_at is null) as unread from notifications n join users u on u.id=n.user_id where u.email='mona@demo.edmn.local'"
   ```
   **المتوقع:** التذكرة الجديدة بحالة `OPEN`، وعدد غير المقروء 0.
6. اختياري: افتح المحفظة بحساب `techzone@demo.edmn.local`. **المتوقع:** المتاح 20,544.21 ج.م. **لا ترسل** طلب سحب في هذه الرحلة.

### 5و. خطأ التوقيع «resource fork, Finder information, or similar detritus not allowed»

**السبب:** `codesign` يرفض أي ملف أو مجلد عليه الخاصية الممتدة `com.apple.FinderInfo`. عندما يكون المستودع داخل `~/Desktop` أو `~/Documents`، ومزامنة iCloud لهذين المجلدين مفعّلة، يضيف نظام المزامنة هذه الخصائص على ملفات البناء أثناء إنشائها. لهذا ينجح الحذف اليدوي ثم يعود الخطأ عند إعادة البناء.

**تحقّق أولًا:**
```bash
xattr -lr apps/customer_mobile/build 2>/dev/null | grep -c FinderInfo
ls -ld@ ~/Desktop                  # خصائص com.apple.file-provider* تعني أن المجلد تحت مزامنة iCloud
```

**الحل الدائم المقترح:** انقل المستودع خارج المجلدات المتزامنة. مثلًا `mv ~/Desktop/edmn-eg ~/Developer/edmn-eg`:
- النقل يحتفظ بكل التعديلات غير المحفوظة، ومنها `pubspec.lock`؛
- بعد النقل احذف الرابط المؤقت: `rm apps/customer_mobile/build`؛
- ثم `flutter clean` لهذا التطبيق فقط.

**لو كان لا بد من بقاء المستودع على سطح المكتب:** أبقِ `build` رابطًا رمزيًا، لكن إلى مكان دائم بدل `/tmp`، لأن `/tmp` يُمسح عند إعادة التشغيل:
```bash
mkdir -p ~/Library/Caches/edmn/customer_mobile-build
rm apps/customer_mobile/build        # يحذف الرابط فقط، لا الملفات
ln -s ~/Library/Caches/edmn/customer_mobile-build apps/customer_mobile/build
echo "/apps/customer_mobile/build" >> .git/info/exclude   # إخفاء الرابط محليًا من git status
```

- `.gitignore` في التطبيق يتجاهل `/build/` بشرطة في آخره، وهذه تطابق المجلدات فقط. git يعامل الرابط الرمزي كملف، لذلك يظهر الرابط «غير متتبع» ويمكن أن يُضاف إلى commit بالخطأ.
- السطر في `.git/info/exclude` إعداد محلي لا يُرفع.

## 6. قائمة الفحص على الهاتف

ابدأ ببيانات تجريبية جديدة: `npm run db:setup` على قاعدة فارغة. البيانات المذكورة أدناه هي ما تنشئه هذه الخطوة.
سجّل النتائج في `docs/mobile/DEVICE_TEST_RUN.md`: لكل بند ✅ / ❌ مع لقطة شاشة، ولكل عيب خطوات إعادة إنتاجه.

| # | المسار | الحساب والبيانات | الخطوات | النتيجة المتوقعة |
|---|---|---|---|---|
| 1 | الدخول والخروج | mona | ادخل ← أغلق التطبيق من قائمة التطبيقات الحديثة ← افتحه ← الحساب ← خروج | يفتح مسجّلًا بعد إعادة الفتح؛ بعد الخروج يطلب الدخول، ولا يرجع زر «رجوع» إلى شاشات الحساب |
| 2 | التصفح والسلة والدفع التجريبي | mona | ابحث عن منتج ← أضفه للسلة ← اختر محافظة الشحن ← أكمل الطلب بطريقة دفع تجريبية | كل المبالغ بصيغة `ج.م`؛ المحافظات مصرية (27)؛ ملاحظة «دفع تجريبي» ظاهرة؛ لا يوجد دفع حقيقي |
| 3 | الطلبات والتتبع | mona — الطلب 100002 (3 بائعين) | افتح الطلب ← راجع كل جزء ← جزء «بيت الأناقة» (مشحون، وعليه النزاع 500002) | حالة وخط زمني مستقلان لكل بائع: مشحون / مدفوع / أكّده البائع؛ زر «تأكيد الاستلام» **لا يظهر** لجزء «بيت الأناقة» لأن عليه نزاعًا مفتوحًا، والنزاع ظاهر في الطلب |
| 4 | الصفقة المحمية | ahmed (مشتري) + omar (بائع) — الصفقة 500007 | افتح الصفقة ← راجع المبالغ ← ابدأ الدفع التجريبي | المشتري يدفع 33,020 ج.م، والبائع يستلم 31,140 ج.م (الأرقام من الخادم)؛ لا يوجد زر تحرير أموال |
| 5 | المحفظة | techzone | المحفظة ← النشاط ← طلب سحب ← معاينة ← إرسال ← إلغاء | المتاح للسحب 20,544.21 ج.م؛ المحجوز والمعلّق ليسا ضمن المتاح؛ الطلب «طلب فقط» ويمكن إلغاؤه قبل الاعتماد |
| 6 | المحادثة | mona ← الطلب 100002 ← «هوم ستايل» | زر المراسلة في الطلب ← أرسل نصًا ← أرفق صورة وملف PDF من منتقي الملفات | تصل الرسالة مرة واحدة؛ الصور الأصغر من 50×50 تُرفض برسالة عربية واضحة |
| 7 | الدعم | mona | الدعم ← تذكرة جديدة ← النوع «مشكلة تقنية» ← أرفق صورة ← إرسال ← رد | التذكرة تظهر «مفتوحة»، والمرفق يُفتح |
| 8 | الإرجاع والنزاع والتقييم | omar — الطلب 100005؛ mona — النزاع 500002 | omar: إرجاع لجزء «بيت الأناقة» (تم التسليم)، ثم تقييم جزء «مستعمل بضمير» (مكتمل). mona: افتح النزاع 500002 وأرسل ردًا | الإرجاع يُنشأ بالكمية المسموحة فقط؛ التقييم يُحفظ مرة واحدة؛ رد النزاع يظهر في الخط الزمني |
| 9 | الإشعارات | mona (8 إشعارات) | افتح الجرس ← اضغط إشعارًا ← «قراءة الكل» ← الإعدادات ← غيّر خيارًا ← ارجع | يفتح الشاشة الصحيحة؛ العدّاد يصبح 0؛ الإعداد يبقى بعد إعادة الفتح |
| 10 | نسيت كلمة السر | omar | «نسيت كلمة السر» ← البريد ← خذ الرابط من الحاسوب بالأمر أدناه ← «عندي رابط» ← الصقه ← كلمة سر جديدة | تتغير كلمة السر ويُسجَّل الخروج؛ القديمة مرفوضة؛ الرابط لا يعمل مرة ثانية |
| 11 | الاتجاه والخطوط | — | تصفّح كل الشاشات السابقة، ثم كبّر الخط من إعدادات الهاتف | RTL صحيح؛ لا نص مقطوع أو متداخل؛ أرقام الطلبات (#) لا تنقلب |
| 12 | انقطاع الشبكة | mona | أوقف الخادم (Ctrl+C) أثناء إرسال رسالة أو تذكرة ← أعد تشغيله ← اضغط «إرسال» مرة أخرى | رسالة خطأ واضحة؛ بعد الإعادة يظهر عنصر واحد فقط، لا اثنان |
| 13 | الخلفية والعودة | أي حساب | اترك التطبيق في الخلفية 15 دقيقة (صلاحية رمز الدخول 10 دقائق) ← عُد ← افتح الطلبات | لا انهيار؛ الجلسة تتجدد تلقائيًا دون طلب الدخول من جديد |

**رابط إعادة كلمة السر (الاختبار 10):** بريد التطوير لا يطبع الروابط السرية. اقرأ أحدث رابط من قاعدة البيانات المحلية:
```bash
psql postgresql://edmn:edmn@localhost:5432/edmn_dev -tAc \
  "select substring(body from 'token=([A-Za-z0-9_-]+)') from outbound_messages
   where event='ACCOUNT_SECURITY' and channel='EMAIL' order by created_at desc limit 1"
```

**ملاحظة عن الاختبار 12 مع APK عبر USB:** إطفاء Wi-Fi لا يقطع `adb reverse`، لأن الاتصال يمر عبر الكابل. لمحاكاة الانقطاع أوقف الخادم أو افصل الكابل.

**ملاحظة عن الأداء:** نسخة Debug أبطأ من النسخة النهائية. التقطيع البسيط في الحركة متوقع ولا يُسجَّل عيبًا. أي انهيار، أو تجمّد أطول من ثانيتين، أو خطأ في بيانات أو مبالغ يُسجَّل عيبًا.

## 7. ما لا يغطيه هذا الدليل (يحتاج موافقة أو قرار)

- **إشعارات Push الحقيقية:** تحتاج Firebase وAPNs. حاليًا الإشعارات داخل التطبيق فقط.
- **فتح الروابط من البريد (Deep links / App Links / Universal Links):** يحتاج النطاق الإنتاجي وملفات `assetlinks.json` و`apple-app-site-association`. الرابط حاليًا يُلصق يدويًا.
- **نسخة Release موقّعة أو TestFlight:** تحتاج مفاتيح توقيع وشهادات توزيع.
- **الاختبار ضد Staging:** يحتاج نشر هذه النسخة على Staging أولًا، وهذا لا يحدث دون موافقة.
