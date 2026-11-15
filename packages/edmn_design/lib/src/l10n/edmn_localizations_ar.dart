// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'edmn_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class EdmnLocalizationsAr extends EdmnLocalizations {
  EdmnLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appNameCustomer => 'اضمن';

  @override
  String get appNameAdmin => 'اضمن — الإدارة';

  @override
  String get retry => 'حاول تاني';

  @override
  String get cancel => 'إلغاء';

  @override
  String get confirm => 'تأكيد';

  @override
  String get signIn => 'تسجيل الدخول';

  @override
  String get signOut => 'تسجيل الخروج';

  @override
  String get identifierLabel => 'البريد الإلكتروني أو رقم الموبايل';

  @override
  String get passwordLabel => 'كلمة المرور';

  @override
  String get fieldRequired => 'الحقل ده مطلوب';

  @override
  String get home => 'الرئيسية';

  @override
  String get categories => 'الأقسام';

  @override
  String get searchHint => 'ابحث عن منتج';

  @override
  String get noResults => 'مفيش نتائج';

  @override
  String get inStock => 'متوفر';

  @override
  String get outOfStock => 'غير متوفر';

  @override
  String get account => 'حسابي';

  @override
  String get devices => 'الأجهزة المسجّل دخولها';

  @override
  String get thisDevice => 'الجهاز ده';

  @override
  String get signOutDevice => 'خروج من الجهاز ده';

  @override
  String get signOutOtherDevices => 'خروج من كل الأجهزة التانية';

  @override
  String signedOutOthers(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'تم الخروج من $count جهاز',
      many: 'تم الخروج من $count جهاز',
      few: 'تم الخروج من $count أجهزة',
      two: 'تم الخروج من جهازين',
      one: 'تم الخروج من جهاز واحد',
      zero: 'مفيش أجهزة تانية',
    );
    return '$_temp0';
  }

  @override
  String get testMoneyBanner =>
      'وضع تجريبي: المدفوعات تجريبية ولا يتم تحويل أموال حقيقية';

  @override
  String get updateRequiredTitle => 'تحديث مطلوب';

  @override
  String get updateRequiredBody =>
      'النسخة دي من التطبيق قديمة. حدّث التطبيق علشان تكمل.';

  @override
  String get mfaTitle => 'التحقق بخطوتين';

  @override
  String get mfaEnterCode => 'اكتب الرمز المكوّن من 6 أرقام من تطبيق المصادقة';

  @override
  String get mfaEnrollHint =>
      'أضف الحساب ده في تطبيق المصادقة باستخدام المفتاح التالي، وبعدين اكتب الرمز';

  @override
  String get verify => 'تحقق';

  @override
  String get permissions => 'الصلاحيات';

  @override
  String get language => 'اللغة';

  @override
  String get errorValidation => 'راجع البيانات اللي كتبتها';

  @override
  String get errorUnauthenticated =>
      'انتهت الجلسة أو بيانات الدخول غير صحيحة. سجّل الدخول تاني';

  @override
  String get errorForbidden => 'مش مسموح لك تعمل الإجراء ده';

  @override
  String get errorNotFound => 'مش لاقيين اللي بتدور عليه';

  @override
  String get errorConflict => 'حصل تعارض. حدّث الصفحة وحاول تاني';

  @override
  String get errorInvalidState => 'الإجراء ده مش متاح في الحالة الحالية';

  @override
  String get errorInsufficientStock => 'الكمية المطلوبة مش متوفرة';

  @override
  String get errorInsufficientBalance => 'الرصيد غير كافٍ';

  @override
  String get errorRateLimited => 'محاولات كتير. استنى شوية وجرّب تاني';

  @override
  String get errorMfaRequired => 'لازم تكمّل التحقق بخطوتين';

  @override
  String get errorStepUpRequired => 'أكّد هويتك برمز التحقق قبل الإجراء ده';

  @override
  String get errorIdentityRequired => 'لازم توثّق هويتك الأول';

  @override
  String get errorSellerRequired => 'الإجراء ده للبائعين بس';

  @override
  String get errorIdempotency => 'الطلب ده بيتنفّذ أو اتنفّذ قبل كده';

  @override
  String get errorInternal => 'حصلت مشكلة غير متوقعة. جرّب تاني';

  @override
  String errorReference(String reference) {
    return 'رقم المرجع: $reference';
  }

  @override
  String get errorNetwork => 'مفيش اتصال بالإنترنت. اتأكد من الشبكة وجرّب تاني';

  @override
  String get errorUnknown => 'حصلت مشكلة. جرّب تاني';

  @override
  String get loading => 'جاري التحميل…';

  @override
  String get loadMore => 'عرض المزيد';

  @override
  String get stateOfflineTitle => 'مفيش اتصال بالإنترنت';

  @override
  String get stateSessionExpiredTitle => 'انتهت جلستك';

  @override
  String get stateNoPermissionTitle => 'مش مسموح لك تشوف الصفحة دي';

  @override
  String get stateNotFoundTitle => 'مش موجود';

  @override
  String get stateErrorTitle => 'حصلت مشكلة';

  @override
  String get marketLabel => 'ماركت';

  @override
  String get appTagline => 'تسوق بأمان\nوضمان حقيقي';

  @override
  String get onboardingShopTitle => 'تسوق بأمان\nوضمان حقيقي';

  @override
  String get onboardingProtectTitle => 'فلوسك محفوظة\nلحد ما تستلم';

  @override
  String get onboardingDealTitle => 'أضمن صفقة\nلأي بيع وشراء';

  @override
  String get startNow => 'ابدأ الآن';

  @override
  String get skip => 'تخطي';

  @override
  String get next => 'التالي';

  @override
  String get haveAccount => 'لديك حساب بالفعل؟';

  @override
  String get welcomeTitle => 'مرحباً بك في أضمن ماركت';

  @override
  String get welcomeSubtitle =>
      'سجّل دخولك لمتابعة التسوق\nوإدارة طلباتك بسهولة';

  @override
  String get phoneHint => 'رقم الهاتف أو البريد';

  @override
  String get forgotPassword => 'نسيت كلمة المرور؟';

  @override
  String get or => 'أو';

  @override
  String get noAccount => 'ليس لديك حساب؟';

  @override
  String get createAccount => 'إنشاء حساب جديد';

  @override
  String get registerTitle => 'إنشاء حساب';

  @override
  String get fullNameHint => 'الاسم بالكامل';

  @override
  String get phoneOnlyHint => 'رقم الموبايل (01xxxxxxxxx)';

  @override
  String get emailOptionalHint => 'البريد الإلكتروني';

  @override
  String get newPasswordHint => 'كلمة المرور (8 حروف على الأقل)';

  @override
  String get acceptTerms =>
      'بإنشاء الحساب أنت موافق على الشروط وسياسة الخصوصية';

  @override
  String get invalidPhone => 'رقم موبايل مصري غير صحيح';

  @override
  String get passwordTooShort => 'كلمة المرور لازم تكون 8 حروف على الأقل';

  @override
  String get nameTooShort => 'اكتب اسمك بالكامل';

  @override
  String get forgotTitle => 'استعادة كلمة المرور';

  @override
  String get forgotBody =>
      'اكتب رقم موبايلك أو بريدك، وهنبعتلك رابط تغيير كلمة المرور لو الحساب موجود.';

  @override
  String get sendResetLink => 'إرسال الرابط';

  @override
  String get resetLinkSent =>
      'لو الحساب موجود، هيوصلك رابط تغيير كلمة المرور خلال دقائق.';

  @override
  String get verifyTitle => 'تأكيد الحساب';

  @override
  String get verifyPhoneBody => 'بعتنالك كود من 6 أرقام على رقمك. اكتبه هنا.';

  @override
  String get verifyEmailBody => 'بعتنالك كود من 6 أرقام على بريدك. اكتبه هنا.';

  @override
  String get codeHint => 'الكود (6 أرقام)';

  @override
  String get resendCode => 'إعادة إرسال الكود';

  @override
  String resendIn(int seconds) {
    return 'إعادة الإرسال بعد $seconds ث';
  }

  @override
  String get codeSent => 'تم إرسال الكود';

  @override
  String get verified => 'تم التأكيد';

  @override
  String get verifyPhone => 'تأكيد رقم الموبايل';

  @override
  String get verifyEmail => 'تأكيد البريد الإلكتروني';

  @override
  String get notVerified => 'غير مؤكد';

  @override
  String get signOutConfirm => 'عايز تسجل خروج من الجهاز ده؟';

  @override
  String get continueAsGuest => 'تصفح بدون تسجيل';

  @override
  String get homeTagline => 'توصيل سريع وآمن';

  @override
  String get shopSafeBadge => 'تسوق بأمان\nوضمان حقيقي';

  @override
  String get searchProductsHint => 'ابحث عن منتج أو متجر أو علامة تجارية';

  @override
  String get searchCategoryHint => 'ابحث عن قسم أو منتج';

  @override
  String get featuredProducts => 'منتجات مميزة';

  @override
  String get latestProducts => 'أحدث المنتجات';

  @override
  String get seeAll => 'عرض الكل';

  @override
  String get add => 'أضف';

  @override
  String get addToCart => 'أضف إلى السلة';

  @override
  String get addedToCart => 'اتضاف للسلة';

  @override
  String get protectedDealBannerTitle => 'أضمن صفقة';

  @override
  String get protectedDealBannerBody => 'تسوق بأمان وضمان حقيقي';

  @override
  String get shopNow => 'تسوق الآن';

  @override
  String get selectGovernorate => 'اختار المحافظة';

  @override
  String get deliverTo => 'التوصيل إلى';

  @override
  String get productTitle => 'المنتج';

  @override
  String brandLabel(Object name) {
    return 'العلامة التجارية: $name';
  }

  @override
  String soldBy(Object name) {
    return 'البائع: $name';
  }

  @override
  String get verifiedSeller => 'بائع موثّق';

  @override
  String get available => 'متوفر';

  @override
  String get unavailable => 'غير متوفر';

  @override
  String get productDescription => 'وصف المنتج';

  @override
  String get specifications => 'المواصفات';

  @override
  String get conditionNew => 'جديد';

  @override
  String get conditionUsed => 'مستعمل';

  @override
  String get conditionNotes => 'حالة المنتج';

  @override
  String get defects => 'العيوب';

  @override
  String get includedAccessories => 'الملحقات';

  @override
  String get warranty => 'الضمان';

  @override
  String get returnPolicy => 'سياسة الاسترجاع';

  @override
  String processingDays(int days) {
    return 'التجهيز خلال $days يوم';
  }

  @override
  String get reviews => 'التقييمات';

  @override
  String get noReviews => 'لسه مفيش تقييمات';

  @override
  String get chooseVariant => 'اختار النوع';

  @override
  String get share => 'مشاركة';

  @override
  String get sortBy => 'ترتيب';

  @override
  String get sortNewest => 'الأحدث';

  @override
  String get sortPriceAsc => 'السعر: من الأقل';

  @override
  String get sortPriceDesc => 'السعر: من الأعلى';

  @override
  String get sortRating => 'الأعلى تقييماً';

  @override
  String get filterCondition => 'الحالة';

  @override
  String get all => 'الكل';

  @override
  String get noProductsTitle => 'مفيش منتجات هنا';

  @override
  String get noProductsBody => 'جرّب كلمة تانية أو قسم تاني.';

  @override
  String get recentSearches => 'عمليات البحث الأخيرة';

  @override
  String get clear => 'مسح';

  @override
  String get searchTitle => 'البحث';

  @override
  String get subcategories => 'الأقسام الفرعية';

  @override
  String get reorder => 'إعادة الطلب';

  @override
  String get myOrders => 'طلباتي';

  @override
  String get cartTitle => 'السلة';

  @override
  String cartCount(int count) {
    return '($count منتجات)';
  }

  @override
  String get cartEmptyTitle => 'السلة فاضية';

  @override
  String get cartEmptyBody => 'ضيف منتجات من الأقسام وارجع هنا.';

  @override
  String get browseProducts => 'تصفح المنتجات';

  @override
  String get subtotal => 'الإجمالي الفرعي';

  @override
  String get shippingFee => 'رسوم التوصيل';

  @override
  String get buyerFee => 'رسوم الخدمة';

  @override
  String get discount => 'الخصم';

  @override
  String get total => 'الإجمالي';

  @override
  String get checkoutCta => 'إتمام الشراء';

  @override
  String get shippingNotPriced => 'هيتحدد بعد اختيار العنوان';

  @override
  String get noShippingToArea => 'البائع مش بيوصّل للمحافظة دي';

  @override
  String get issueUnavailable => 'غير متوفر حالياً';

  @override
  String get issueInsufficientStock => 'الكمية المطلوبة مش متوفرة';

  @override
  String issuePriceChanged(Object old) {
    return 'السعر اتغير من $old';
  }

  @override
  String get issueSellerUnavailable => 'البائع مش متاح حالياً';

  @override
  String get acknowledgePrices => 'موافق على الأسعار الجديدة';

  @override
  String get remove => 'حذف';

  @override
  String get removeFromCartConfirm => 'تحذف المنتج من السلة؟';

  @override
  String get signInToCheckout => 'سجّل دخولك علشان تكمل الشراء';

  @override
  String get checkoutTitle => 'إتمام الطلب';

  @override
  String get stepAddress => 'العنوان';

  @override
  String get stepDelivery => 'التوصيل';

  @override
  String get stepPayment => 'الدفع';

  @override
  String get stepConfirm => 'تأكيد';

  @override
  String get deliveryAddress => 'عنوان التوصيل';

  @override
  String get addAddress => 'إضافة عنوان';

  @override
  String get paymentMethod => 'طريقة الدفع';

  @override
  String get orderSummary => 'ملخص الطلب';

  @override
  String get itemsTotal => 'إجمالي المنتجات';

  @override
  String get placeOrder => 'تأكيد الطلب';

  @override
  String get continueLabel => 'متابعة';

  @override
  String paymentWindow(int hours) {
    return 'لازم تحوّل المبلغ خلال $hours ساعة، وبعدها الطلب بيتلغي تلقائياً.';
  }

  @override
  String get priceChangedReview =>
      'الإجمالي اتغير. راجع السعر الجديد قبل التأكيد.';

  @override
  String get orderPlacedTitle => 'تم إنشاء طلبك';

  @override
  String get orderPlacedBody => 'حوّل المبلغ وارفع الإيصال علشان نراجع الدفع.';

  @override
  String deliveryEta(int min, int max) {
    return 'التوصيل خلال $min–$max يوم';
  }

  @override
  String get noAddressesTitle => 'مفيش عناوين محفوظة';

  @override
  String get addressesTitle => 'عناوين التوصيل';

  @override
  String get addressLabelHint => 'اسم العنوان (البيت، الشغل…)';

  @override
  String get recipientHint => 'اسم المستلم';

  @override
  String get governorate => 'المحافظة';

  @override
  String get cityHint => 'المدينة / المنطقة';

  @override
  String get districtHint => 'الحي (اختياري)';

  @override
  String get streetHint => 'الشارع';

  @override
  String get buildingHint => 'رقم العمارة';

  @override
  String get floorHint => 'الدور';

  @override
  String get apartmentHint => 'الشقة';

  @override
  String get landmarkHint => 'علامة مميزة (اختياري)';

  @override
  String get defaultAddress => 'العنوان الأساسي';

  @override
  String get save => 'حفظ';

  @override
  String get saved => 'تم الحفظ';

  @override
  String get edit => 'تعديل';

  @override
  String get delete => 'حذف';

  @override
  String get deleteAddressConfirm =>
      'تحذف العنوان ده؟ الطلبات القديمة مش هتتأثر.';

  @override
  String get ordersEmptyTitle => 'لسه مفيش طلبات';

  @override
  String get searchOrdersHint => 'ابحث في طلباتك';

  @override
  String get filterInProgress => 'قيد التنفيذ';

  @override
  String get filterDelivered => 'تم التوصيل';

  @override
  String get filterCancelled => 'ملغي';

  @override
  String get orderDetails => 'تفاصيل الطلب';

  @override
  String get trackOrder => 'تتبع الطلب';

  @override
  String get orderStatus => 'حالة الطلب';

  @override
  String get cancelOrder => 'إلغاء الطلب';

  @override
  String get cancelOrderConfirm =>
      'تلغي الطلب؟ المنتجات هترجع للبائع ومفيش فلوس اتدفعت.';

  @override
  String get orderCancelled => 'تم إلغاء الطلب';

  @override
  String get payNow => 'ادفع وارفع الإيصال';

  @override
  String get paymentTitle => 'الدفع';

  @override
  String get transferTo => 'حوّل المبلغ على';

  @override
  String get amountDue => 'المبلغ المطلوب';

  @override
  String payBefore(Object date) {
    return 'ادفع قبل $date';
  }

  @override
  String get testPaymentNotice =>
      'دفعة تجريبية: الأموال الحقيقية مقفولة. متحوّلش أي فلوس حقيقية.';

  @override
  String get uploadReceipt => 'إيصال التحويل';

  @override
  String get uploadReceiptHint => 'اختار صورة أو PDF للإيصال';

  @override
  String get claimedAmountHint => 'المبلغ اللي حوّلته (ج.م)';

  @override
  String get referenceHint => 'رقم العملية (اختياري)';

  @override
  String get payerNameHint => 'اسم المحوِّل (اختياري)';

  @override
  String get submitReceipt => 'إرسال الإيصال للمراجعة';

  @override
  String get receiptSubmitted =>
      'الإيصال وصل وتحت المراجعة. الدفع مش هيتأكد غير بعد مراجعة فريق أضمن.';

  @override
  String get receiptUnderReview => 'الإيصال تحت المراجعة';

  @override
  String receiptRejected(Object reason) {
    return 'الإيصال اترفض: $reason';
  }

  @override
  String get paymentConfirmed => 'تم تأكيد الدفع';

  @override
  String get paymentExpired => 'انتهت مهلة الدفع';

  @override
  String get submissions => 'الإيصالات المرسلة';

  @override
  String get confirmReceipt => 'تأكيد الاستلام';

  @override
  String get confirmReceiptConfirm =>
      'أكّد إنك استلمت الشحنة دي وكل حاجة سليمة؟ ده بيبدأ مستحقات البائع.';

  @override
  String get receiptConfirmed => 'تم تأكيد الاستلام';

  @override
  String get requestCancellation => 'طلب إلغاء';

  @override
  String get cancellationReasonHint => 'سبب الإلغاء';

  @override
  String get cancellationRequested => 'اتبعت طلب الإلغاء للبائع';

  @override
  String get reportProblem => 'الإبلاغ عن مشكلة';

  @override
  String get problemNotReceived => 'الشحنة موصلتش';

  @override
  String get problemProductIssue => 'مشكلة في المنتج';

  @override
  String get problemDescriptionHint =>
      'اوصف المشكلة بالتفصيل (10 حروف على الأقل)';

  @override
  String get problemReported => 'اتسجلت المشكلة وفريق أضمن هيتابع معاك';

  @override
  String sellerOrderLabel(Object store) {
    return 'شحنة من $store';
  }

  @override
  String trackingNumber(Object number) {
    return 'رقم الشحنة: $number';
  }

  @override
  String get refundStatus => 'حالة الاسترداد';

  @override
  String get refundUncertain => 'جاري التحقق من التحويل';

  @override
  String get disputeOpen => 'في نزاع مفتوح';

  @override
  String get shippingAddress => 'عنوان الشحن';

  @override
  String get statusPendingPayment => 'في انتظار الدفع';

  @override
  String get statusPaymentUnderReview => 'الدفع تحت المراجعة';

  @override
  String get statusPaid => 'تم الدفع';

  @override
  String get statusProcessing => 'قيد التنفيذ';

  @override
  String get statusCompleted => 'مكتمل';

  @override
  String get statusPartiallyCompleted => 'مكتمل جزئياً';

  @override
  String get statusClosedUnfulfilled => 'مغلق دون تنفيذ';

  @override
  String get statusCancelled => 'ملغي';

  @override
  String get stepOrderPlaced => 'تم إنشاء الطلب';

  @override
  String get stepPaymentConfirmed => 'تم تأكيد الدفع';

  @override
  String get stepOrderConfirmed => 'تم تأكيد الطلب';

  @override
  String get stepPreparing => 'جاري تجهيز الطلب';

  @override
  String get stepShipped => 'تم الشحن';

  @override
  String get stepOnTheWay => 'في طريقه إليك';

  @override
  String get stepDelivered => 'تم التوصيل';

  @override
  String get stepReceiptConfirmed => 'تأكيد الاستلام';

  @override
  String get stepCompleted => 'اكتمال الطلب';

  @override
  String get accountTitle => 'حسابي';

  @override
  String get personalInfo => 'البيانات الشخصية';

  @override
  String get paymentMethods => 'طرق الدفع';

  @override
  String get wallet => 'المحفظة';

  @override
  String get notifications => 'الإشعارات';

  @override
  String get helpSupport => 'المساعدة والدعم';

  @override
  String get aboutEdmn => 'عن أضمن ماركت';

  @override
  String get security => 'الأمان';

  @override
  String get changePassword => 'تغيير كلمة المرور';

  @override
  String get currentPasswordHint => 'كلمة المرور الحالية';

  @override
  String get passwordChanged =>
      'تم تغيير كلمة المرور وتم تسجيل الخروج من الأجهزة التانية';

  @override
  String get sellerCenter => 'مركز البائع';

  @override
  String get protectedDeal => 'أضمن صفقة';

  @override
  String get legal => 'الشروط والسياسات';

  @override
  String get signInPromptTitle => 'سجّل دخولك';

  @override
  String get signInPromptBody => 'سجّل دخولك علشان تتابع طلباتك وعناويـنك.';

  @override
  String get comingFromServer => 'الخدمة دي لسه مش متاحة في التطبيق';

  @override
  String get notAvailableYetBody =>
      'الخدمة دي شغالة على موقع أضمن، ولسه بنجهز لها واجهة في التطبيق.';

  @override
  String get openOnWebsite => 'افتح على الموقع';

  @override
  String get emailHint => 'البريد الإلكتروني';

  @override
  String get deliveryFailed => 'فشل التوصيل';

  @override
  String get paymentRejected => 'الإيصال اترفض';

  @override
  String get refundCompleted => 'تم الاسترداد';

  @override
  String get refundNotPaid => 'لم يتم الاسترداد';

  @override
  String get refundInProgress => 'الاسترداد جاري';

  @override
  String get sendCode => 'إرسال الكود';

  @override
  String get productsCount => 'منتج';

  @override
  String storeReturns(int days) {
    return 'المتجر بيقبل الاسترجاع خلال $days يوم';
  }

  @override
  String get storeNoVoluntaryReturns =>
      'المتجر مش بيقبل استرجاع اختياري، وحقوقك القانونية محفوظة';

  @override
  String get superseded => 'مستبدل';

  @override
  String get reorderEmptyTitle => 'مفيش طلبات مكتملة لسه';

  @override
  String get reorderEmptyBody => 'لما طلب يكتمل هتقدر تطلبه تاني من هنا بضغطة.';

  @override
  String get reorderNotice =>
      'إعادة الطلب بتضيف نفس المنتجات للسلة بسعر النهارده، وتقدر تراجعها قبل الدفع.';

  @override
  String get orderAgain => 'اطلب تاني';

  @override
  String reorderAdded(int count) {
    return 'اتضاف $count منتج للسلة';
  }

  @override
  String reorderPartial(int added, int failed) {
    return 'اتضاف $added منتج، و$failed مش متاح حالياً';
  }

  @override
  String get paymentMethodsNote =>
      'بتختار طريقة الدفع مع كل طلب. أضمن مش بيحفظ بيانات أي كارت.';

  @override
  String get destBankName => 'البنك';

  @override
  String get destAccountName => 'اسم الحساب';

  @override
  String get destAccountNumber => 'رقم الحساب';

  @override
  String get destInstapayAddress => 'عنوان إنستاباي';

  @override
  String get destWalletNumber => 'رقم المحفظة';

  @override
  String get sellerActive => 'نشط';

  @override
  String get sellerRestricted => 'مقيّد';

  @override
  String get sellerDraft => 'طلب لم يُرسل';

  @override
  String get sellerPendingReview => 'طلبك تحت المراجعة';

  @override
  String get sellerMoreInfo => 'مطلوب بيانات إضافية';

  @override
  String get sellerSuspended => 'موقوف';

  @override
  String get sellerRejected => 'مرفوض';

  @override
  String get notSellerTitle => 'انت مش بائع على أضمن لسه';

  @override
  String get notSellerBody =>
      'التسجيل كبائع ومراجعة المستندات بيتم حالياً من موقع أضمن (مركز البائع). بعد الموافقة هتدير متجرك من هنا.';

  @override
  String get sellerNotOperatingBody =>
      'هتقدر تستقبل الطلبات بعد موافقة فريق أضمن. تابع حالة طلبك من موقع أضمن.';

  @override
  String sellerRole(Object role) {
    return 'دورك: $role';
  }

  @override
  String get salesToday => 'المبيعات اليوم';

  @override
  String get ordersLast30 => 'الطلبات (30 يوم)';

  @override
  String get ordersToHandle => 'طلبات محتاجة تنفيذ';

  @override
  String get productsLive => 'المنتجات المعروضة';

  @override
  String get ratingLabel => 'التقييم';

  @override
  String get manageProducts => 'إدارة المنتجات';

  @override
  String get sellerOrders => 'الطلبات';

  @override
  String get earningsBalance => 'الأرباح والرصيد';

  @override
  String get viewMyStore => 'صفحة متجري للمشترين';

  @override
  String get sellerWebOnlyNote =>
      'إضافة منتج جديد وتعديل الصور والأسعار وأسعار الشحن وطلبات السحب متاحة حالياً من مركز البائع على الموقع.';

  @override
  String get soNew => 'جديد';

  @override
  String get soAccepted => 'مقبول';

  @override
  String get soReady => 'جاهز للشحن';

  @override
  String get noSellerOrders => 'مفيش طلبات هنا';

  @override
  String get stepConfirmOrder => 'قبول الطلب';

  @override
  String get stepStartProcessing => 'بدء التجهيز';

  @override
  String get stepMarkReady => 'جاهز للشحن';

  @override
  String get stepMarkShipped => 'تم الشحن';

  @override
  String get stepAcceptCancellation => 'الموافقة على الإلغاء';

  @override
  String get sellerStepConfirm => 'هتغيّر حالة الطلب. المشتري هيشوف التحديث.';

  @override
  String get acceptCancellationConfirm =>
      'هيتلغي الطلب والمبلغ هيرجع للمشتري حسب سياسة أضمن.';

  @override
  String get acceptCancellationNote => 'البائع وافق على طلب الإلغاء من التطبيق';

  @override
  String get commission => 'عمولة أضمن';

  @override
  String get sellerNet => 'صافي البائع';

  @override
  String get sellerNetNote =>
      'الصافي بيتحول لرصيدك بعد الاستلام وانتهاء الضمانات، مش فوراً.';

  @override
  String get waybillAttached => 'بوليصة الشحن مرفوعة';

  @override
  String get addShipment => 'بيانات الشحن';

  @override
  String get editShipment => 'تعديل بيانات الشحن';

  @override
  String get shipmentDetails => 'بيانات الشحن';

  @override
  String get carrierHint => 'شركة الشحن';

  @override
  String get trackingHint => 'رقم البوليصة (اختياري)';

  @override
  String get waybill => 'إثبات الشحن (بوليصة)';

  @override
  String get waybillHint => 'اختار صورة أو PDF للبوليصة';

  @override
  String stockLine(int onHand, int reserved, int available) {
    return 'المخزون $onHand · محجوز $reserved · متاح $available';
  }

  @override
  String get editStock => 'تعديل المخزون';

  @override
  String get stockOnHand => 'الكمية الموجودة';

  @override
  String reservedFloor(int reserved) {
    return 'لا تقل عن $reserved (محجوزة لطلبات قائمة)';
  }

  @override
  String get productLive => 'معروض';

  @override
  String get productDraft => 'مسودة';

  @override
  String get productInReview => 'تحت المراجعة';

  @override
  String get productRejected => 'مرفوض';

  @override
  String get productSuspended => 'موقوف';

  @override
  String get productArchived => 'مؤرشف';

  @override
  String get withdrawable => 'قابل للسحب';

  @override
  String get fundsPending => 'معلّق (لسه ما اتحررش)';

  @override
  String get fundsAvailable => 'رصيد متاح بالدفاتر';

  @override
  String get fundsHeld => 'محجوز لنزاعات/مرتجعات';

  @override
  String get fundsReserved => 'محجوز لسحب معتمد';

  @override
  String get fundsDebt => 'مديونية مسجلة';

  @override
  String get fundsUnsecured => 'مطالبات غير مغطاة';

  @override
  String get fundsNote =>
      'الأرقام من دفاتر أضمن. المحجوز والمديونية والمطالبات مش قابلة للسحب.';

  @override
  String openPayouts(int count) {
    return 'عندك $count طلب سحب قيد التنفيذ';
  }

  @override
  String get payoutOnWebNote =>
      'طلب السحب ومتابعته متاحين حالياً من مركز البائع على الموقع، ويتم اعتماده بمراجعة مزدوجة من فريق أضمن.';

  @override
  String get switchToSeller => 'مركز البائع';

  @override
  String get roleOwner => 'صاحب المتجر';

  @override
  String get roleManager => 'مدير المتجر';

  @override
  String get roleCatalog => 'مسؤول المنتجات';

  @override
  String get roleOrders => 'مسؤول الطلبات';

  @override
  String get roleFinance => 'المالية';

  @override
  String get roleSupport => 'الدعم';
}
