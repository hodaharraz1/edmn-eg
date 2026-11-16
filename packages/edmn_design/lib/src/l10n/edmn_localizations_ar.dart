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

  @override
  String get idApproved => 'الهوية موثّقة';

  @override
  String get idPending => 'الهوية تحت المراجعة';

  @override
  String get idMoreInfo => 'مطلوب استكمال بيانات الهوية';

  @override
  String get idRejected => 'اترفض توثيق الهوية';

  @override
  String get idIncomplete => 'الهوية لسه مش موثّقة';

  @override
  String get identityTitle => 'توثيق الهوية';

  @override
  String get identityWhy =>
      'توثيق البطاقة مطلوب قبل البيع وبعض العمليات المالية. فريق أضمن بيراجع الصور، والرقم القومي بيتخزن مشفّر ومش بيظهر تاني.';

  @override
  String identityLast4(Object last4) {
    return 'آخر 4 أرقام: $last4';
  }

  @override
  String get legalNameHint => 'الاسم الكامل كما في البطاقة (ثلاثي)';

  @override
  String get nationalIdHint => 'الرقم القومي (14 رقم)';

  @override
  String get idFront => 'صورة البطاقة (الوجه)';

  @override
  String get idBack => 'صورة البطاقة (الظهر)';

  @override
  String get pickImage => 'اختار صورة';

  @override
  String get pickDocument => 'اختار صورة أو PDF';

  @override
  String get submitForReview => 'إرسال للمراجعة';

  @override
  String get sentForReview => 'اتبعت للمراجعة';

  @override
  String get becomeSeller => 'ابدأ البيع على أضمن';

  @override
  String get becomeSellerBody =>
      'افتح متجرك: اختار نوع البائع، وثّق هويتك، ضيف بيانات المتجر والمستندات وحساب استلام الأموال، وبعدها فريق أضمن بيراجع الطلب.';

  @override
  String get checklist => 'خطوات الطلب';

  @override
  String get sellerTermsNote =>
      'بإرسال الطلب أنت موافق على اتفاقية البائع والعمولات وسياسات أضمن السارية.';

  @override
  String get ownerDetails => 'بيانات صاحب المتجر';

  @override
  String get businessDetails => 'بيانات النشاط';

  @override
  String get storeDetails => 'بيانات المتجر';

  @override
  String get payoutAccount => 'حساب استلام الأموال';

  @override
  String get documents => 'المستندات';

  @override
  String get sellerIndividual => 'فرد';

  @override
  String get sellerBusiness => 'شركة / نشاط تجاري';

  @override
  String get startApplication => 'ابدأ الطلب';

  @override
  String get acceptSellerAgreement => 'أوافق على اتفاقية البائع';

  @override
  String get readAgreement => 'اقرأ الاتفاقية';

  @override
  String get applicationIncomplete => 'كمّل كل الخطوات ووثّق هويتك الأول';

  @override
  String get businessName => 'الاسم القانوني للنشاط';

  @override
  String get commercialRegistration => 'رقم السجل التجاري';

  @override
  String get taxRegistration => 'رقم البطاقة الضريبية';

  @override
  String get businessAddress => 'عنوان النشاط';

  @override
  String get authorizedRepresentative => 'الممثل القانوني';

  @override
  String get storeName => 'اسم المتجر';

  @override
  String get storeDescription => 'وصف المتجر';

  @override
  String get returnAddress => 'عنوان الإرجاع';

  @override
  String get supportPhone => 'رقم خدمة العملاء (اختياري)';

  @override
  String get storeLogo => 'شعار المتجر (اختياري)';

  @override
  String get upload => 'رفع';

  @override
  String get holderName => 'اسم صاحب الحساب';

  @override
  String get walletProvider => 'مزود المحفظة';

  @override
  String get mobileWallet => 'محفظة موبايل';

  @override
  String get payoutAccountNote => 'فريق أضمن بيتحقق من الحساب قبل أي تحويل.';

  @override
  String get addProduct => 'إضافة منتج';

  @override
  String get productNameHint => 'اسم المنتج';

  @override
  String get category => 'القسم';

  @override
  String get editProduct => 'تعديل المنتج';

  @override
  String get moderationNote => 'ملاحظة المراجعة';

  @override
  String get revisionPending => 'في تعديل تحت المراجعة';

  @override
  String get beforeSubmit => 'قبل الإرسال للمراجعة';

  @override
  String get photos => 'الصور';

  @override
  String get tapToAdd => 'اضغط للإضافة';

  @override
  String get priceAndStock => 'السعر والمخزون';

  @override
  String get setPrice => 'حدد السعر والكمية';

  @override
  String get addVariant => 'إضافة نوع (مقاس / لون)';

  @override
  String productReturnCustom(int days) {
    return 'سياسة خاصة: إرجاع خلال $days يوم';
  }

  @override
  String get productReturnStoreDefault => 'سياسة المتجر الافتراضية';

  @override
  String get returnPolicyNotSet => 'لسه ما اتحددتش سياسة الإرجاع';

  @override
  String get hideProduct => 'إخفاء المنتج من المتجر';

  @override
  String get showProduct => 'إظهار المنتج في المتجر';

  @override
  String get viewAsBuyer => 'عرض كمشتري';

  @override
  String get keyFeaturesHint => 'مميزات المنتج (سطر لكل ميزة)';

  @override
  String get variantLabelHint => 'النوع (مثلاً: أسود / 128GB)';

  @override
  String get priceEgp => 'السعر (ج.م)';

  @override
  String get compareAtEgp => 'السعر قبل الخصم (اختياري)';

  @override
  String get customReturnPolicy => 'سياسة إرجاع خاصة بالمنتج';

  @override
  String get acceptsReturns => 'بيقبل الإرجاع الاختياري';

  @override
  String get processingDaysHint => 'أيام التجهيز';

  @override
  String get returnDaysHint => 'مدة الإرجاع (أيام)';

  @override
  String get shippingRates => 'الشحن حسب المحافظة';

  @override
  String get checkRates => 'راجع الأرقام قبل الحفظ';

  @override
  String get shippingRatesNote =>
      'فعّل المحافظات اللي بتشحن لها وحدد رسوم ومدة التوصيل. المشتري بيشوف الرسوم دي في السلة.';

  @override
  String get feeEgp => 'الرسوم';

  @override
  String get etaMin => 'من';

  @override
  String get etaMax => 'إلى';

  @override
  String get storeSettings => 'إعدادات المتجر';

  @override
  String get payoutRequests => 'طلبات السحب';

  @override
  String get requestPayout => 'طلب سحب';

  @override
  String get payoutHistory => 'سجل الطلبات';

  @override
  String get noPayouts => 'مفيش طلبات سحب';

  @override
  String get payoutRequestNote =>
      'طلب السحب بيتراجع من شخصين في فريق أضمن قبل التحويل. التطبيق مش بيحوّل فلوس.';

  @override
  String get payoutUnderReview => 'تحت المراجعة';

  @override
  String get payoutProcessing => 'جاري التنفيذ';

  @override
  String get payoutPaid => 'تم التحويل';

  @override
  String get payoutUncertain => 'جاري التحقق من التحويل';

  @override
  String get payoutRejected => 'مرفوض';

  @override
  String get payoutNotTransferred => 'لم يتم التحويل';

  @override
  String get payoutUncertainNote =>
      'مش واضح لسه إذا التحويل وصل. فريق أضمن بيتحقق، ومحدش هيعيد التحويل قبل التأكد.';

  @override
  String paidReference(Object ref) {
    return 'مرجع التحويل: $ref';
  }

  @override
  String get cancelRequest => 'إلغاء الطلب';

  @override
  String get cancelPayoutConfirm => 'تلغي طلب السحب ده؟';

  @override
  String maxWithdrawable(Object amount) {
    return 'أقصى مبلغ متاح: $amount';
  }

  @override
  String get amountEgp => 'المبلغ (ج.م)';

  @override
  String get transferCost => 'تكلفة التحويل';

  @override
  String get youReceive => 'هتستلم';

  @override
  String get reviewAmount => 'مراجعة المبلغ';

  @override
  String get sendRequest => 'إرسال الطلب';

  @override
  String get payoutRequested => 'اتبعت طلب السحب للمراجعة';

  @override
  String get payoutAlreadyRequested => 'الطلب ده متسجل بالفعل';

  @override
  String get continueApplication => 'كمّل طلب البائع';

  @override
  String get acceptChange => 'قبول التعديل';

  @override
  String get acceptOffer => 'قبول العرض';

  @override
  String get acceptOfferConfirm =>
      'بقبول العرض تصبح الشروط ملزمة للطرفين وتنتقل للدفع.';

  @override
  String get cancelDeal => 'إلغاء الصفقة';

  @override
  String get changeMessageHint => 'اكتب التعديل المطلوب بوضوح';

  @override
  String get codeWarning => 'لا تعطِ الكود إلا عند استلام المنتج فعليًا وفحصه.';

  @override
  String get copyLink => 'نسخ الرابط';

  @override
  String get dealAwaitingRelease => 'بانتظار تحويل المبلغ للبائع';

  @override
  String get dealBuyerOnly => 'المشتري هو من يبدأ الصفقة ثم يدعو البائع برابط.';

  @override
  String get dealBuyerPays => 'إجمالي ما تدفعه';

  @override
  String get dealChangeRequested => 'مطلوب تعديل';

  @override
  String get dealConfirmReceiptConfirm =>
      'بتأكيد الاستلام تقرّ بأن المنتج مطابق، ويُستحق المبلغ للبائع بعد مراجعة أضمن.';

  @override
  String get dealDeadlineHint => 'مدة التسليم بالأيام';

  @override
  String get dealDelivered => 'تم الشحن';

  @override
  String get dealDeliveryHint => 'طريقة التسليم (مندوب، شركة شحن، استلام يدوي)';

  @override
  String get dealDescriptionHint => 'وصف المنتج وحالته بالتفصيل';

  @override
  String get dealDraft => 'مسودة';

  @override
  String get dealFeesNote =>
      'رسوم الخدمة ومبلغ الشحن يحسبهما أضمن ويظهران قبل الدفع.';

  @override
  String get dealFundsHeld => 'المبلغ محجوز لدى أضمن';

  @override
  String get dealHubBody =>
      'ادفع بأمان لأي شخص خارج المتجر. أضمن يحجز المبلغ لحد ما تستلم.';

  @override
  String get dealInspection => 'فترة الفحص';

  @override
  String get dealInspectionHint => 'أيام الفحص بعد الاستلام';

  @override
  String get dealInvited => 'تمت دعوة البائع';

  @override
  String get dealLinkHint => 'رابط الإعلان (اختياري)';

  @override
  String get dealLocationPrivacy => 'عنوانك لا يظهر للبائع إلا بعد الدفع.';

  @override
  String get dealMoneyNote =>
      'المبالغ محسوبة من أضمن ولا تتغير إلا بموافقة الطرفين.';

  @override
  String get dealNoReleaseNote =>
      'تحويل المبلغ أو استرداده يتم من فريق أضمن بعد المراجعة، وليس من التطبيق.';

  @override
  String get dealOfferPending => 'عرض بانتظار ردك';

  @override
  String get dealOnHold => 'الصفقة موقوفة مؤقتًا للمراجعة.';

  @override
  String get dealRoleBuyer => 'أنت المشتري';

  @override
  String get dealRoleSeller => 'أنت البائع';

  @override
  String get dealSaved => 'تم حفظ الصفقة';

  @override
  String get dealSavedBody => 'راجع التفاصيل ثم أرسل رابط الدعوة للبائع.';

  @override
  String get dealSellerJoined => 'انضم البائع';

  @override
  String get dealSellerNameHint => 'اسم البائع';

  @override
  String get dealSellerPhoneHint => 'رقم موبايل البائع';

  @override
  String get dealSellerReceives => 'صافي ما تستلمه';

  @override
  String get dealStepDeliver => 'التسليم';

  @override
  String get dealStepDelivery => 'التسليم';

  @override
  String get dealStepHold => 'حجز المبلغ';

  @override
  String get dealStepItem => 'المنتج';

  @override
  String get dealStepLocation => 'العنوان';

  @override
  String get dealStepPrice => 'السعر';

  @override
  String get dealStepRelease => 'تحويل للبائع';

  @override
  String get dealTermsAccept => 'أوافق على شروط أضمن صفقة.';

  @override
  String get dealTermsHint => 'شروط إضافية (اختياري)';

  @override
  String get dealTermsHistory => 'سجل الشروط';

  @override
  String get dealTimeline => 'مراحل الصفقة';

  @override
  String get dealTitleHint => 'اسم المنتج';

  @override
  String get dealTlAgreed => 'اتفاق الطرفين';

  @override
  String get dealTlConfirmed => 'تأكيد الاستلام';

  @override
  String get dealTlCreated => 'إنشاء الصفقة';

  @override
  String get dealTlHandover => 'التحقق من التسليم';

  @override
  String get dealTlHeld => 'حجز المبلغ';

  @override
  String get dealTlInvited => 'دعوة البائع';

  @override
  String get dealTlPaid => 'مراجعة الدفع';

  @override
  String get dealTlReleased => 'تحويل المبلغ';

  @override
  String get dealTlShipped => 'الشحن';

  @override
  String get dealUnitPriceHint => 'سعر الوحدة بالجنيه';

  @override
  String get dealsActive => 'جارية';

  @override
  String get dealsClosed => 'منتهية';

  @override
  String get declineDeal => 'رفض الصفقة';

  @override
  String get deliveryCode => 'كود التسليم';

  @override
  String get enterDeliveryCode => 'إدخال كود التسليم';

  @override
  String get haveInvitation => 'معايا رابط دعوة';

  @override
  String get howDealWorks => 'إزاي أضمن صفقة بتشتغل؟';

  @override
  String get howDealWorksBody =>
      '1. المشتري ينشئ الصفقة ويدعو البائع.\n2. البائع يرسل عرضه والمشتري يوافق.\n3. المشتري يدفع وأضمن يراجع الإيصال ويحجز المبلغ.\n4. البائع يشحن، والمشتري يعطيه كود التسليم.\n5. بعد الفحص والتأكيد يحوّل أضمن المبلغ للبائع.';

  @override
  String get inviteLinkHint => 'الصق رابط الدعوة';

  @override
  String get inviteLinkReady => 'رابط الدعوة جاهز — أرسله للبائع فقط';

  @override
  String get inviteSeller => 'دعوة البائع';

  @override
  String get joinDeal => 'الانضمام للصفقة';

  @override
  String get joinDealBody => 'لو البائع أنت، الصق الرابط اللي وصلك من المشتري.';

  @override
  String get makeOffer => 'إرسال عرض';

  @override
  String get markShippedDeal => 'تم الشحن';

  @override
  String get newDeal => 'صفقة جديدة';

  @override
  String get newDeliveryCode => 'إرسال كود جديد';

  @override
  String get newInviteLink => 'رابط دعوة جديد';

  @override
  String get noActiveCode => 'لا يوجد كود تسليم نشط حاليًا.';

  @override
  String get noDeals => 'لا توجد صفقات';

  @override
  String get offerSent => 'تم إرسال العرض';

  @override
  String get quantityHint => 'الكمية';

  @override
  String get rejectChange => 'رفض التعديل';

  @override
  String get rejectOffer => 'رفض العرض';

  @override
  String get rejectOfferConfirm => 'رفض العرض ينهي التفاوض على هذه الصفقة.';

  @override
  String get requestChange => 'طلب تعديل';

  @override
  String get reviewDeal => 'مراجعة الصفقة';

  @override
  String get revokeInvite => 'إلغاء رابط الدعوة';

  @override
  String get sendOffer => 'إرسال العرض';

  @override
  String get shipNoteHint => 'تفاصيل الشحن (الشركة، رقم البوليصة)';

  @override
  String get showDeliveryCode => 'عرض كود التسليم';

  @override
  String codeExpires(String time, int attempts) {
    return 'صالح حتى $time · المحاولات المتبقية $attempts';
  }

  @override
  String get dealMoneyOffer =>
      'مبالغ العرض الحالي محسوبة من أضمن، وتصبح نهائية بعد موافقة الطرفين.';

  @override
  String get dealMoneyIndicative =>
      'مبالغ تقديرية لحين وصول عرض البائع؛ الرسوم النهائية تُحسب عند الاتفاق.';

  @override
  String get dealAwaitingBuyer => 'بانتظار رد المشتري';

  @override
  String get dealAwaitingSeller => 'بانتظار رد البائع';

  @override
  String get dealPartySeller => 'البائع';

  @override
  String get dealPartyBuyer => 'المشتري';

  @override
  String get termsProposed => 'مقترح';

  @override
  String get termsAccepted => 'مقبول';

  @override
  String get termsRejected => 'مرفوض';

  @override
  String get termsSuperseded => 'استُبدل بنسخة أحدث';

  @override
  String get attachFile => 'إرفاق ملف';

  @override
  String get attachmentHint => 'صورة أو PDF (اختياري)';

  @override
  String get conversationReadOnly => 'المحادثة دي للقراءة بس دلوقتي.';

  @override
  String get dealConversation => 'محادثة الصفقة';

  @override
  String get edmnTeam => 'فريق أضمن';

  @override
  String get filterAll => 'الكل';

  @override
  String get filterDeals => 'الصفقات';

  @override
  String get filterOrders => 'الطلبات';

  @override
  String get filterUnread => 'غير مقروءة';

  @override
  String get helpWithDeal => 'مساعدة بخصوص الصفقة';

  @override
  String get helpWithOrder => 'مساعدة بخصوص الطلب';

  @override
  String get imageAttachment => 'صورة مرفقة';

  @override
  String get messageBuyer => 'مراسلة المشتري';

  @override
  String get messageHidden => 'الرسالة دي اتخفت بواسطة فريق أضمن';

  @override
  String get messageNotSentRetry =>
      'الرسالة ما اتبعتتش. اضغط إرسال تاني، ومش هتتكرر.';

  @override
  String get messageSeller => 'مراسلة البائع';

  @override
  String get messages => 'الرسائل';

  @override
  String get messagesEvidenceNote =>
      'الرسائل للتواصل بس: أي تأكيد استلام أو تغيير في السعر لازم يتم من أزرار الطلب أو الصفقة. ما تبعتش بيانات دفع أو كلمات سر.';

  @override
  String get myTickets => 'تذاكري';

  @override
  String get newTicket => 'تذكرة جديدة';

  @override
  String get noConversations => 'لا توجد محادثات';

  @override
  String get noConversationsBody =>
      'المحادثة بتتفتح من الطلب بعد تأكيد الدفع، أو من الصفقة بعد انضمام البائع.';

  @override
  String get noTickets => 'مافيش تذاكر لحد دلوقتي';

  @override
  String get pdfAttachment => 'ملف PDF مرفق';

  @override
  String get rateService => 'قيّم الخدمة';

  @override
  String get ratingCommentHint => 'تعليق (اختياري)';

  @override
  String get reopenReasonHint => 'ليه عايز تعيد فتح التذكرة؟';

  @override
  String get reopenTicket => 'إعادة فتح التذكرة';

  @override
  String get replyReopensTicket => 'ردك هيعيد فتح التذكرة.';

  @override
  String get reportDataRequest => 'طلب بيانات مش محتاجها';

  @override
  String get reportFraud => 'محاولة نصب';

  @override
  String get reportInappropriate => 'محتوى غير لائق';

  @override
  String get reportMessage => 'الإبلاغ عن الرسالة';

  @override
  String get reportMessageBody =>
      'البلاغ بيوصل لفريق أضمن للمراجعة. محدش بيتعاقب تلقائيًا.';

  @override
  String get reportNoteHint => 'تفاصيل إضافية (اختياري)';

  @override
  String get reportOther => 'سبب آخر';

  @override
  String get reportSent => 'تم إرسال البلاغ';

  @override
  String get seenByOther => 'اتقرت';

  @override
  String get send => 'إرسال';

  @override
  String get sendReport => 'إرسال البلاغ';

  @override
  String get sendTicket => 'إرسال التذكرة';

  @override
  String get sent => 'اتبعتت';

  @override
  String get startConversation => 'ابدأ المحادثة';

  @override
  String get storeMessages => 'رسائل المتجر';

  @override
  String get supportIntro =>
      'فريق أضمن موجود يساعدك في الطلبات والدفع والصفقات والحساب.';

  @override
  String get thanksForRating => 'شكرًا على تقييمك';

  @override
  String get ticketAboutThis =>
      'التذكرة هتترتبط بالطلب أو الصفقة اللي فتحتها منها.';

  @override
  String get ticketBody => 'اشرح المشكلة بالتفصيل';

  @override
  String get ticketBodyShort => 'اشرح طلبك في 10 حروف على الأقل';

  @override
  String get ticketClosed => 'مغلقة';

  @override
  String get ticketEscalated => 'محوّلة لفريق متخصص';

  @override
  String get ticketInProgress => 'جاري العمل عليها';

  @override
  String get ticketOpen => 'مفتوحة';

  @override
  String get ticketPrivacyNote =>
      'ما تكتبش كلمة السر أو رقم البطاقة. فريق أضمن عمره ما هيطلبهم.';

  @override
  String get ticketResolved => 'تم الحل';

  @override
  String get ticketSent => 'تم إرسال التذكرة';

  @override
  String get ticketSubject => 'الموضوع';

  @override
  String get ticketSubjectShort => 'اكتب موضوع واضح (5 حروف على الأقل)';

  @override
  String get ticketTitle => 'تذكرة دعم';

  @override
  String get ticketType => 'نوع المشكلة';

  @override
  String get ticketTypeAccount => 'الحساب';

  @override
  String get ticketTypeOrder => 'طلب';

  @override
  String get ticketTypePayment => 'الدفع';

  @override
  String get ticketTypeProduct => 'منتج';

  @override
  String get ticketTypeRefund => 'استرداد';

  @override
  String get ticketTypeReturn => 'إرجاع';

  @override
  String get ticketTypeSellerFinance => 'أرباح المتجر';

  @override
  String get ticketTypeShipping => 'الشحن';

  @override
  String get ticketTypeTechnical => 'مشكلة تقنية';

  @override
  String get ticketWaitingSeller => 'في انتظار البائع';

  @override
  String get ticketWaitingYou => 'في انتظار ردك';

  @override
  String get typeMessage => 'اكتب رسالتك';

  @override
  String get writeReply => 'اكتب ردك';

  @override
  String get you => 'أنت';

  @override
  String maxAttachments(int count) {
    return 'تقدر ترفق $count ملفات بالكتير';
  }

  @override
  String get faq => 'الأسئلة الشائعة';

  @override
  String get returnsPolicy => 'سياسة الإرجاع';

  @override
  String get protectedDealTerms => 'شروط أضمن صفقة';

  @override
  String get accountHolderMustMatch =>
      'اسم صاحب الحساب لازم يطابق اسمك في التحقق من الهوية.';

  @override
  String get accountNeedsInfo => 'مطلوب معلومات';

  @override
  String get accountNumberHint => 'رقم الحساب (اختياري لو كتبت الـ IBAN)';

  @override
  String get accountRejected => 'مرفوض';

  @override
  String get accountSubmitted => 'اتبعت للمراجعة. هيتفعّل بعد تحقق فريق أضمن.';

  @override
  String get accountUnderReview => 'قيد المراجعة';

  @override
  String get accountVerified => 'متحقق منه';

  @override
  String get activityTestNotice =>
      'عملية تجريبية: الأموال الحقيقية مقفولة ومفيش فلوس اتحولت.';

  @override
  String get addReceivingAccount => 'إضافة حساب استلام';

  @override
  String get amountEgpHint => 'المبلغ بالجنيه';

  @override
  String get amountInvalid => 'اكتب مبلغ صحيح (جنيه وقروش لحد رقمين)';

  @override
  String get availableToWithdraw => 'متاح للسحب';

  @override
  String get balanceAvailable => 'متاح';

  @override
  String get balanceAvailableHint => 'تقدر تطلب سحبه دلوقتي';

  @override
  String get balanceAwaitingRelease => 'مستحق وبانتظار الاعتماد';

  @override
  String get balanceAwaitingReleaseHint =>
      'المشتري أكد، وفريق أضمن بيعتمد التحويل لرصيدك';

  @override
  String get balanceBreakdown => 'تفاصيل الرصيد';

  @override
  String get balanceBySource => 'حسب المصدر';

  @override
  String get balanceClaims => 'مطالبات مفتوحة';

  @override
  String get balanceClaimsHint => 'مطالبات نزاع/إرجاع مش مغطاة برصيد — مش فلوس';

  @override
  String get balanceDebt => 'مديونية';

  @override
  String get balanceDebtHint => 'لازم تتسوّى قبل أي سحب';

  @override
  String get balanceHeld => 'محجوز';

  @override
  String get balanceHeldHint => 'بسبب نزاع أو مراجعة — مش قابل للسحب';

  @override
  String get balancePaidOut => 'اتحوّل لك';

  @override
  String get balancePending => 'معلّق';

  @override
  String get balancePendingHint => 'اتدفع ولسه في فترة التوصيل أو رد المشتري';

  @override
  String get balanceReserved => 'محجوز لطلب سحب';

  @override
  String get balanceReservedHint => 'طلب سحب اتعتمد ولسه بيتحوّل';

  @override
  String get bankNameHint => 'اسم البنك';

  @override
  String get checkAmount => 'مراجعة المبلغ';

  @override
  String get dateLabel => 'التاريخ';

  @override
  String get destDealsOnly => 'مستحقات الصفقات المحمية فقط';

  @override
  String get destStoreAndDeals => 'حساب المتجر: المتجر + الصفقات';

  @override
  String get destinationLabel => 'الوجهة';

  @override
  String get edmnFees => 'رسوم أضمن';

  @override
  String get filterPayments => 'مدفوعات';

  @override
  String get filterPayouts => 'سحب';

  @override
  String get filterRefunds => 'مستردات';

  @override
  String get financialStatement => 'كشف الحساب';

  @override
  String get fundsByOrder => 'المبالغ حسب الطلب أو الصفقة';

  @override
  String get holderNameFull => 'اسم صاحب الحساب كامل';

  @override
  String get ibanHint => 'IBAN (EG + 27 رقم)';

  @override
  String get ledgerEntries => 'الحركات';

  @override
  String get methodBank => 'تحويل بنكي';

  @override
  String get methodInstapay => 'إنستاباي';

  @override
  String get methodLabel => 'الطريقة';

  @override
  String get methodWallet => 'محفظة موبايل';

  @override
  String get noActivity => 'مفيش حركات لحد دلوقتي';

  @override
  String get noPayoutRequests => 'مفيش طلبات سحب';

  @override
  String get noPrepaidBalance =>
      'أضمن ما بيحتفظش برصيد مدفوع مقدمًا: الدفع بيكون لكل طلب أو صفقة، والمستردات بترجع لوسيلة الدفع الأصلية.';

  @override
  String get noReceivingAccounts => 'مفيش حسابات استلام';

  @override
  String get noteLabel => 'ملاحظة';

  @override
  String get openFromHistory => 'افتح العملية من سجل المعاملات';

  @override
  String get payoutBlockDebt => 'عليك مديونية لازم تتسوّى قبل أي سحب.';

  @override
  String get payoutBlockIdentity => 'لازم تتحقق من هويتك قبل طلب أي سحب.';

  @override
  String get payoutBlockNoAccount =>
      'أضف حساب استلام واستنى التحقق منه قبل السحب.';

  @override
  String get payoutBlockNothing => 'مفيش رصيد متاح للسحب دلوقتي.';

  @override
  String get payoutDestination => 'هيتحوّل على';

  @override
  String get payoutDoesNotFit => 'المبلغ أكبر من المتاح للسحب على الوجهة دي.';

  @override
  String get payoutPreviewNote =>
      'ده تقدير من الخادم. التوزيع النهائي بيتحدد وقت الاعتماد.';

  @override
  String get payoutRequestAlreadySent => 'الطلب ده اتسجل قبل كده';

  @override
  String get payoutRequestSent => 'تم استلام طلب السحب';

  @override
  String get payoutTestNotice =>
      'طلب تجريبي: الأموال الحقيقية مقفولة، ومفيش أي تحويل هيتم.';

  @override
  String get receivingAccounts => 'حسابات الاستلام';

  @override
  String get receivingAccountsNote =>
      'أي حساب جديد بيتراجع من فريق أضمن قبل ما يستقبل فلوس.';

  @override
  String get recentActivity => 'آخر الحركات';

  @override
  String get referenceNumber => 'الرقم المرجعي';

  @override
  String get refundsTotal => 'مستردات';

  @override
  String get removeAccount => 'إيقاف الحساب';

  @override
  String get removeAccountConfirm =>
      'مش هتقدر تستخدم الحساب ده تاني في طلبات جديدة.';

  @override
  String get searchByReference => 'ابحث برقم الطلب أو المرجع';

  @override
  String get sendPayoutRequest => 'إرسال طلب السحب';

  @override
  String get sourceStore => 'مبيعات المتجر';

  @override
  String get testTag => 'تجريبي';

  @override
  String get totalSales => 'إجمالي المبيعات';

  @override
  String get transactionDetails => 'تفاصيل العملية';

  @override
  String get transactionHistory => 'سجل المعاملات';

  @override
  String get transferReference => 'مرجع التحويل';

  @override
  String get viewAll => 'عرض الكل';

  @override
  String get walletNumberHint => 'رقم المحفظة';

  @override
  String get walletProviderHint => 'مزود المحفظة (فودافون كاش، اتصالات كاش…)';

  @override
  String get walletTestNotice =>
      'أرصدة تجريبية: الأموال الحقيقية مقفولة، والمبالغ دي مش فلوس حقيقية قابلة للتحويل.';

  @override
  String activityPayment(String ref) {
    return 'دفع $ref';
  }

  @override
  String activityRefund(String ref) {
    return 'استرداد $ref';
  }

  @override
  String activityPayout(String ref) {
    return 'طلب سحب $ref';
  }

  @override
  String orderRef(String ref) {
    return 'طلب $ref';
  }

  @override
  String payoutMinimum(String amount) {
    return 'الحد الأدنى $amount';
  }

  @override
  String payoutRequestResult(String number) {
    return 'رقم الطلب #$number. فريق أضمن هيراجعه ويعتمده، ومفيش فلوس بتتحرك قبل الاعتماد.';
  }

  @override
  String payoutConfirmBody(String amount, String destination) {
    return 'هتطلب سحب $amount على $destination. الطلب بيتراجع ويتعتمد من فريق أضمن.';
  }

  @override
  String get noEarningsYet =>
      'لسه مفيش مستحقات ليك. لما تبيع في متجرك أو كبائع في صفقة محمية، مستحقاتك هتظهر هنا.';

  @override
  String get previousPage => 'الصفحة السابقة';

  @override
  String get downloadPdf => 'تنزيل ملف PDF';

  @override
  String get activityMoneyModeUnknown =>
      'نوع الأموال لهذه العملية القديمة غير متاح. راجع الدعم للتأكد.';

  @override
  String get payoutNetAmount => 'صافي المبلغ المتوقع استلامه';
}
