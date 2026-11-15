import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'edmn_localizations_ar.dart';
import 'edmn_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of EdmnLocalizations
/// returned by `EdmnLocalizations.of(context)`.
///
/// Applications need to include `EdmnLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/edmn_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: EdmnLocalizations.localizationsDelegates,
///   supportedLocales: EdmnLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the EdmnLocalizations.supportedLocales
/// property.
abstract class EdmnLocalizations {
  EdmnLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static EdmnLocalizations of(BuildContext context) {
    return Localizations.of<EdmnLocalizations>(context, EdmnLocalizations)!;
  }

  static const LocalizationsDelegate<EdmnLocalizations> delegate =
      _EdmnLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
  ];

  /// No description provided for @appNameCustomer.
  ///
  /// In ar, this message translates to:
  /// **'اضمن'**
  String get appNameCustomer;

  /// No description provided for @appNameAdmin.
  ///
  /// In ar, this message translates to:
  /// **'اضمن — الإدارة'**
  String get appNameAdmin;

  /// No description provided for @retry.
  ///
  /// In ar, this message translates to:
  /// **'حاول تاني'**
  String get retry;

  /// No description provided for @cancel.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء'**
  String get cancel;

  /// No description provided for @confirm.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد'**
  String get confirm;

  /// No description provided for @signIn.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الدخول'**
  String get signIn;

  /// No description provided for @signOut.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الخروج'**
  String get signOut;

  /// No description provided for @identifierLabel.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني أو رقم الموبايل'**
  String get identifierLabel;

  /// No description provided for @passwordLabel.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور'**
  String get passwordLabel;

  /// No description provided for @fieldRequired.
  ///
  /// In ar, this message translates to:
  /// **'الحقل ده مطلوب'**
  String get fieldRequired;

  /// No description provided for @home.
  ///
  /// In ar, this message translates to:
  /// **'الرئيسية'**
  String get home;

  /// No description provided for @categories.
  ///
  /// In ar, this message translates to:
  /// **'الأقسام'**
  String get categories;

  /// No description provided for @searchHint.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن منتج'**
  String get searchHint;

  /// No description provided for @noResults.
  ///
  /// In ar, this message translates to:
  /// **'مفيش نتائج'**
  String get noResults;

  /// No description provided for @inStock.
  ///
  /// In ar, this message translates to:
  /// **'متوفر'**
  String get inStock;

  /// No description provided for @outOfStock.
  ///
  /// In ar, this message translates to:
  /// **'غير متوفر'**
  String get outOfStock;

  /// No description provided for @account.
  ///
  /// In ar, this message translates to:
  /// **'حسابي'**
  String get account;

  /// No description provided for @devices.
  ///
  /// In ar, this message translates to:
  /// **'الأجهزة المسجّل دخولها'**
  String get devices;

  /// No description provided for @thisDevice.
  ///
  /// In ar, this message translates to:
  /// **'الجهاز ده'**
  String get thisDevice;

  /// No description provided for @signOutDevice.
  ///
  /// In ar, this message translates to:
  /// **'خروج من الجهاز ده'**
  String get signOutDevice;

  /// No description provided for @signOutOtherDevices.
  ///
  /// In ar, this message translates to:
  /// **'خروج من كل الأجهزة التانية'**
  String get signOutOtherDevices;

  /// No description provided for @signedOutOthers.
  ///
  /// In ar, this message translates to:
  /// **'{count, plural, =0{مفيش أجهزة تانية} =1{تم الخروج من جهاز واحد} =2{تم الخروج من جهازين} few{تم الخروج من {count} أجهزة} many{تم الخروج من {count} جهاز} other{تم الخروج من {count} جهاز}}'**
  String signedOutOthers(int count);

  /// No description provided for @testMoneyBanner.
  ///
  /// In ar, this message translates to:
  /// **'وضع تجريبي: المدفوعات تجريبية ولا يتم تحويل أموال حقيقية'**
  String get testMoneyBanner;

  /// No description provided for @updateRequiredTitle.
  ///
  /// In ar, this message translates to:
  /// **'تحديث مطلوب'**
  String get updateRequiredTitle;

  /// No description provided for @updateRequiredBody.
  ///
  /// In ar, this message translates to:
  /// **'النسخة دي من التطبيق قديمة. حدّث التطبيق علشان تكمل.'**
  String get updateRequiredBody;

  /// No description provided for @mfaTitle.
  ///
  /// In ar, this message translates to:
  /// **'التحقق بخطوتين'**
  String get mfaTitle;

  /// No description provided for @mfaEnterCode.
  ///
  /// In ar, this message translates to:
  /// **'اكتب الرمز المكوّن من 6 أرقام من تطبيق المصادقة'**
  String get mfaEnterCode;

  /// No description provided for @mfaEnrollHint.
  ///
  /// In ar, this message translates to:
  /// **'أضف الحساب ده في تطبيق المصادقة باستخدام المفتاح التالي، وبعدين اكتب الرمز'**
  String get mfaEnrollHint;

  /// No description provided for @verify.
  ///
  /// In ar, this message translates to:
  /// **'تحقق'**
  String get verify;

  /// No description provided for @permissions.
  ///
  /// In ar, this message translates to:
  /// **'الصلاحيات'**
  String get permissions;

  /// No description provided for @language.
  ///
  /// In ar, this message translates to:
  /// **'اللغة'**
  String get language;

  /// No description provided for @errorValidation.
  ///
  /// In ar, this message translates to:
  /// **'راجع البيانات اللي كتبتها'**
  String get errorValidation;

  /// No description provided for @errorUnauthenticated.
  ///
  /// In ar, this message translates to:
  /// **'انتهت الجلسة أو بيانات الدخول غير صحيحة. سجّل الدخول تاني'**
  String get errorUnauthenticated;

  /// No description provided for @errorForbidden.
  ///
  /// In ar, this message translates to:
  /// **'مش مسموح لك تعمل الإجراء ده'**
  String get errorForbidden;

  /// No description provided for @errorNotFound.
  ///
  /// In ar, this message translates to:
  /// **'مش لاقيين اللي بتدور عليه'**
  String get errorNotFound;

  /// No description provided for @errorConflict.
  ///
  /// In ar, this message translates to:
  /// **'حصل تعارض. حدّث الصفحة وحاول تاني'**
  String get errorConflict;

  /// No description provided for @errorInvalidState.
  ///
  /// In ar, this message translates to:
  /// **'الإجراء ده مش متاح في الحالة الحالية'**
  String get errorInvalidState;

  /// No description provided for @errorInsufficientStock.
  ///
  /// In ar, this message translates to:
  /// **'الكمية المطلوبة مش متوفرة'**
  String get errorInsufficientStock;

  /// No description provided for @errorInsufficientBalance.
  ///
  /// In ar, this message translates to:
  /// **'الرصيد غير كافٍ'**
  String get errorInsufficientBalance;

  /// No description provided for @errorRateLimited.
  ///
  /// In ar, this message translates to:
  /// **'محاولات كتير. استنى شوية وجرّب تاني'**
  String get errorRateLimited;

  /// No description provided for @errorMfaRequired.
  ///
  /// In ar, this message translates to:
  /// **'لازم تكمّل التحقق بخطوتين'**
  String get errorMfaRequired;

  /// No description provided for @errorStepUpRequired.
  ///
  /// In ar, this message translates to:
  /// **'أكّد هويتك برمز التحقق قبل الإجراء ده'**
  String get errorStepUpRequired;

  /// No description provided for @errorIdentityRequired.
  ///
  /// In ar, this message translates to:
  /// **'لازم توثّق هويتك الأول'**
  String get errorIdentityRequired;

  /// No description provided for @errorSellerRequired.
  ///
  /// In ar, this message translates to:
  /// **'الإجراء ده للبائعين بس'**
  String get errorSellerRequired;

  /// No description provided for @errorIdempotency.
  ///
  /// In ar, this message translates to:
  /// **'الطلب ده بيتنفّذ أو اتنفّذ قبل كده'**
  String get errorIdempotency;

  /// No description provided for @errorInternal.
  ///
  /// In ar, this message translates to:
  /// **'حصلت مشكلة غير متوقعة. جرّب تاني'**
  String get errorInternal;

  /// No description provided for @errorReference.
  ///
  /// In ar, this message translates to:
  /// **'رقم المرجع: {reference}'**
  String errorReference(String reference);

  /// No description provided for @errorNetwork.
  ///
  /// In ar, this message translates to:
  /// **'مفيش اتصال بالإنترنت. اتأكد من الشبكة وجرّب تاني'**
  String get errorNetwork;

  /// No description provided for @errorUnknown.
  ///
  /// In ar, this message translates to:
  /// **'حصلت مشكلة. جرّب تاني'**
  String get errorUnknown;

  /// No description provided for @loading.
  ///
  /// In ar, this message translates to:
  /// **'جاري التحميل…'**
  String get loading;

  /// No description provided for @loadMore.
  ///
  /// In ar, this message translates to:
  /// **'عرض المزيد'**
  String get loadMore;

  /// No description provided for @stateOfflineTitle.
  ///
  /// In ar, this message translates to:
  /// **'مفيش اتصال بالإنترنت'**
  String get stateOfflineTitle;

  /// No description provided for @stateSessionExpiredTitle.
  ///
  /// In ar, this message translates to:
  /// **'انتهت جلستك'**
  String get stateSessionExpiredTitle;

  /// No description provided for @stateNoPermissionTitle.
  ///
  /// In ar, this message translates to:
  /// **'مش مسموح لك تشوف الصفحة دي'**
  String get stateNoPermissionTitle;

  /// No description provided for @stateNotFoundTitle.
  ///
  /// In ar, this message translates to:
  /// **'مش موجود'**
  String get stateNotFoundTitle;

  /// No description provided for @stateErrorTitle.
  ///
  /// In ar, this message translates to:
  /// **'حصلت مشكلة'**
  String get stateErrorTitle;

  /// No description provided for @marketLabel.
  ///
  /// In ar, this message translates to:
  /// **'ماركت'**
  String get marketLabel;

  /// No description provided for @appTagline.
  ///
  /// In ar, this message translates to:
  /// **'تسوق بأمان\nوضمان حقيقي'**
  String get appTagline;

  /// No description provided for @onboardingShopTitle.
  ///
  /// In ar, this message translates to:
  /// **'تسوق بأمان\nوضمان حقيقي'**
  String get onboardingShopTitle;

  /// No description provided for @onboardingProtectTitle.
  ///
  /// In ar, this message translates to:
  /// **'فلوسك محفوظة\nلحد ما تستلم'**
  String get onboardingProtectTitle;

  /// No description provided for @onboardingDealTitle.
  ///
  /// In ar, this message translates to:
  /// **'أضمن صفقة\nلأي بيع وشراء'**
  String get onboardingDealTitle;

  /// No description provided for @startNow.
  ///
  /// In ar, this message translates to:
  /// **'ابدأ الآن'**
  String get startNow;

  /// No description provided for @skip.
  ///
  /// In ar, this message translates to:
  /// **'تخطي'**
  String get skip;

  /// No description provided for @next.
  ///
  /// In ar, this message translates to:
  /// **'التالي'**
  String get next;

  /// No description provided for @haveAccount.
  ///
  /// In ar, this message translates to:
  /// **'لديك حساب بالفعل؟'**
  String get haveAccount;

  /// No description provided for @welcomeTitle.
  ///
  /// In ar, this message translates to:
  /// **'مرحباً بك في أضمن ماركت'**
  String get welcomeTitle;

  /// No description provided for @welcomeSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'سجّل دخولك لمتابعة التسوق\nوإدارة طلباتك بسهولة'**
  String get welcomeSubtitle;

  /// No description provided for @phoneHint.
  ///
  /// In ar, this message translates to:
  /// **'رقم الهاتف أو البريد'**
  String get phoneHint;

  /// No description provided for @forgotPassword.
  ///
  /// In ar, this message translates to:
  /// **'نسيت كلمة المرور؟'**
  String get forgotPassword;

  /// No description provided for @or.
  ///
  /// In ar, this message translates to:
  /// **'أو'**
  String get or;

  /// No description provided for @noAccount.
  ///
  /// In ar, this message translates to:
  /// **'ليس لديك حساب؟'**
  String get noAccount;

  /// No description provided for @createAccount.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء حساب جديد'**
  String get createAccount;

  /// No description provided for @registerTitle.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء حساب'**
  String get registerTitle;

  /// No description provided for @fullNameHint.
  ///
  /// In ar, this message translates to:
  /// **'الاسم بالكامل'**
  String get fullNameHint;

  /// No description provided for @phoneOnlyHint.
  ///
  /// In ar, this message translates to:
  /// **'رقم الموبايل (01xxxxxxxxx)'**
  String get phoneOnlyHint;

  /// No description provided for @emailOptionalHint.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني'**
  String get emailOptionalHint;

  /// No description provided for @newPasswordHint.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور (8 حروف على الأقل)'**
  String get newPasswordHint;

  /// No description provided for @acceptTerms.
  ///
  /// In ar, this message translates to:
  /// **'بإنشاء الحساب أنت موافق على الشروط وسياسة الخصوصية'**
  String get acceptTerms;

  /// No description provided for @invalidPhone.
  ///
  /// In ar, this message translates to:
  /// **'رقم موبايل مصري غير صحيح'**
  String get invalidPhone;

  /// No description provided for @passwordTooShort.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور لازم تكون 8 حروف على الأقل'**
  String get passwordTooShort;

  /// No description provided for @nameTooShort.
  ///
  /// In ar, this message translates to:
  /// **'اكتب اسمك بالكامل'**
  String get nameTooShort;

  /// No description provided for @forgotTitle.
  ///
  /// In ar, this message translates to:
  /// **'استعادة كلمة المرور'**
  String get forgotTitle;

  /// No description provided for @forgotBody.
  ///
  /// In ar, this message translates to:
  /// **'اكتب رقم موبايلك أو بريدك، وهنبعتلك رابط تغيير كلمة المرور لو الحساب موجود.'**
  String get forgotBody;

  /// No description provided for @sendResetLink.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الرابط'**
  String get sendResetLink;

  /// No description provided for @resetLinkSent.
  ///
  /// In ar, this message translates to:
  /// **'لو الحساب موجود، هيوصلك رابط تغيير كلمة المرور خلال دقائق.'**
  String get resetLinkSent;

  /// No description provided for @verifyTitle.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الحساب'**
  String get verifyTitle;

  /// No description provided for @verifyPhoneBody.
  ///
  /// In ar, this message translates to:
  /// **'بعتنالك كود من 6 أرقام على رقمك. اكتبه هنا.'**
  String get verifyPhoneBody;

  /// No description provided for @verifyEmailBody.
  ///
  /// In ar, this message translates to:
  /// **'بعتنالك كود من 6 أرقام على بريدك. اكتبه هنا.'**
  String get verifyEmailBody;

  /// No description provided for @codeHint.
  ///
  /// In ar, this message translates to:
  /// **'الكود (6 أرقام)'**
  String get codeHint;

  /// No description provided for @resendCode.
  ///
  /// In ar, this message translates to:
  /// **'إعادة إرسال الكود'**
  String get resendCode;

  /// No description provided for @resendIn.
  ///
  /// In ar, this message translates to:
  /// **'إعادة الإرسال بعد {seconds} ث'**
  String resendIn(int seconds);

  /// No description provided for @codeSent.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال الكود'**
  String get codeSent;

  /// No description provided for @verified.
  ///
  /// In ar, this message translates to:
  /// **'تم التأكيد'**
  String get verified;

  /// No description provided for @verifyPhone.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد رقم الموبايل'**
  String get verifyPhone;

  /// No description provided for @verifyEmail.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد البريد الإلكتروني'**
  String get verifyEmail;

  /// No description provided for @notVerified.
  ///
  /// In ar, this message translates to:
  /// **'غير مؤكد'**
  String get notVerified;

  /// No description provided for @signOutConfirm.
  ///
  /// In ar, this message translates to:
  /// **'عايز تسجل خروج من الجهاز ده؟'**
  String get signOutConfirm;

  /// No description provided for @continueAsGuest.
  ///
  /// In ar, this message translates to:
  /// **'تصفح بدون تسجيل'**
  String get continueAsGuest;

  /// No description provided for @homeTagline.
  ///
  /// In ar, this message translates to:
  /// **'توصيل سريع وآمن'**
  String get homeTagline;

  /// No description provided for @shopSafeBadge.
  ///
  /// In ar, this message translates to:
  /// **'تسوق بأمان\nوضمان حقيقي'**
  String get shopSafeBadge;

  /// No description provided for @searchProductsHint.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن منتج أو متجر أو علامة تجارية'**
  String get searchProductsHint;

  /// No description provided for @searchCategoryHint.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن قسم أو منتج'**
  String get searchCategoryHint;

  /// No description provided for @featuredProducts.
  ///
  /// In ar, this message translates to:
  /// **'منتجات مميزة'**
  String get featuredProducts;

  /// No description provided for @latestProducts.
  ///
  /// In ar, this message translates to:
  /// **'أحدث المنتجات'**
  String get latestProducts;

  /// No description provided for @seeAll.
  ///
  /// In ar, this message translates to:
  /// **'عرض الكل'**
  String get seeAll;

  /// No description provided for @add.
  ///
  /// In ar, this message translates to:
  /// **'أضف'**
  String get add;

  /// No description provided for @addToCart.
  ///
  /// In ar, this message translates to:
  /// **'أضف إلى السلة'**
  String get addToCart;

  /// No description provided for @addedToCart.
  ///
  /// In ar, this message translates to:
  /// **'اتضاف للسلة'**
  String get addedToCart;

  /// No description provided for @protectedDealBannerTitle.
  ///
  /// In ar, this message translates to:
  /// **'أضمن صفقة'**
  String get protectedDealBannerTitle;

  /// No description provided for @protectedDealBannerBody.
  ///
  /// In ar, this message translates to:
  /// **'تسوق بأمان وضمان حقيقي'**
  String get protectedDealBannerBody;

  /// No description provided for @shopNow.
  ///
  /// In ar, this message translates to:
  /// **'تسوق الآن'**
  String get shopNow;

  /// No description provided for @selectGovernorate.
  ///
  /// In ar, this message translates to:
  /// **'اختار المحافظة'**
  String get selectGovernorate;

  /// No description provided for @deliverTo.
  ///
  /// In ar, this message translates to:
  /// **'التوصيل إلى'**
  String get deliverTo;

  /// No description provided for @productTitle.
  ///
  /// In ar, this message translates to:
  /// **'المنتج'**
  String get productTitle;

  /// No description provided for @brandLabel.
  ///
  /// In ar, this message translates to:
  /// **'العلامة التجارية: {name}'**
  String brandLabel(Object name);

  /// No description provided for @soldBy.
  ///
  /// In ar, this message translates to:
  /// **'البائع: {name}'**
  String soldBy(Object name);

  /// No description provided for @verifiedSeller.
  ///
  /// In ar, this message translates to:
  /// **'بائع موثّق'**
  String get verifiedSeller;

  /// No description provided for @available.
  ///
  /// In ar, this message translates to:
  /// **'متوفر'**
  String get available;

  /// No description provided for @unavailable.
  ///
  /// In ar, this message translates to:
  /// **'غير متوفر'**
  String get unavailable;

  /// No description provided for @productDescription.
  ///
  /// In ar, this message translates to:
  /// **'وصف المنتج'**
  String get productDescription;

  /// No description provided for @specifications.
  ///
  /// In ar, this message translates to:
  /// **'المواصفات'**
  String get specifications;

  /// No description provided for @conditionNew.
  ///
  /// In ar, this message translates to:
  /// **'جديد'**
  String get conditionNew;

  /// No description provided for @conditionUsed.
  ///
  /// In ar, this message translates to:
  /// **'مستعمل'**
  String get conditionUsed;

  /// No description provided for @conditionNotes.
  ///
  /// In ar, this message translates to:
  /// **'حالة المنتج'**
  String get conditionNotes;

  /// No description provided for @defects.
  ///
  /// In ar, this message translates to:
  /// **'العيوب'**
  String get defects;

  /// No description provided for @includedAccessories.
  ///
  /// In ar, this message translates to:
  /// **'الملحقات'**
  String get includedAccessories;

  /// No description provided for @warranty.
  ///
  /// In ar, this message translates to:
  /// **'الضمان'**
  String get warranty;

  /// No description provided for @returnPolicy.
  ///
  /// In ar, this message translates to:
  /// **'سياسة الاسترجاع'**
  String get returnPolicy;

  /// No description provided for @processingDays.
  ///
  /// In ar, this message translates to:
  /// **'التجهيز خلال {days} يوم'**
  String processingDays(int days);

  /// No description provided for @reviews.
  ///
  /// In ar, this message translates to:
  /// **'التقييمات'**
  String get reviews;

  /// No description provided for @noReviews.
  ///
  /// In ar, this message translates to:
  /// **'لسه مفيش تقييمات'**
  String get noReviews;

  /// No description provided for @chooseVariant.
  ///
  /// In ar, this message translates to:
  /// **'اختار النوع'**
  String get chooseVariant;

  /// No description provided for @share.
  ///
  /// In ar, this message translates to:
  /// **'مشاركة'**
  String get share;

  /// No description provided for @sortBy.
  ///
  /// In ar, this message translates to:
  /// **'ترتيب'**
  String get sortBy;

  /// No description provided for @sortNewest.
  ///
  /// In ar, this message translates to:
  /// **'الأحدث'**
  String get sortNewest;

  /// No description provided for @sortPriceAsc.
  ///
  /// In ar, this message translates to:
  /// **'السعر: من الأقل'**
  String get sortPriceAsc;

  /// No description provided for @sortPriceDesc.
  ///
  /// In ar, this message translates to:
  /// **'السعر: من الأعلى'**
  String get sortPriceDesc;

  /// No description provided for @sortRating.
  ///
  /// In ar, this message translates to:
  /// **'الأعلى تقييماً'**
  String get sortRating;

  /// No description provided for @filterCondition.
  ///
  /// In ar, this message translates to:
  /// **'الحالة'**
  String get filterCondition;

  /// No description provided for @all.
  ///
  /// In ar, this message translates to:
  /// **'الكل'**
  String get all;

  /// No description provided for @noProductsTitle.
  ///
  /// In ar, this message translates to:
  /// **'مفيش منتجات هنا'**
  String get noProductsTitle;

  /// No description provided for @noProductsBody.
  ///
  /// In ar, this message translates to:
  /// **'جرّب كلمة تانية أو قسم تاني.'**
  String get noProductsBody;

  /// No description provided for @recentSearches.
  ///
  /// In ar, this message translates to:
  /// **'عمليات البحث الأخيرة'**
  String get recentSearches;

  /// No description provided for @clear.
  ///
  /// In ar, this message translates to:
  /// **'مسح'**
  String get clear;

  /// No description provided for @searchTitle.
  ///
  /// In ar, this message translates to:
  /// **'البحث'**
  String get searchTitle;

  /// No description provided for @subcategories.
  ///
  /// In ar, this message translates to:
  /// **'الأقسام الفرعية'**
  String get subcategories;

  /// No description provided for @reorder.
  ///
  /// In ar, this message translates to:
  /// **'إعادة الطلب'**
  String get reorder;

  /// No description provided for @myOrders.
  ///
  /// In ar, this message translates to:
  /// **'طلباتي'**
  String get myOrders;

  /// No description provided for @cartTitle.
  ///
  /// In ar, this message translates to:
  /// **'السلة'**
  String get cartTitle;

  /// No description provided for @cartCount.
  ///
  /// In ar, this message translates to:
  /// **'({count} منتجات)'**
  String cartCount(int count);

  /// No description provided for @cartEmptyTitle.
  ///
  /// In ar, this message translates to:
  /// **'السلة فاضية'**
  String get cartEmptyTitle;

  /// No description provided for @cartEmptyBody.
  ///
  /// In ar, this message translates to:
  /// **'ضيف منتجات من الأقسام وارجع هنا.'**
  String get cartEmptyBody;

  /// No description provided for @browseProducts.
  ///
  /// In ar, this message translates to:
  /// **'تصفح المنتجات'**
  String get browseProducts;

  /// No description provided for @subtotal.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي الفرعي'**
  String get subtotal;

  /// No description provided for @shippingFee.
  ///
  /// In ar, this message translates to:
  /// **'رسوم التوصيل'**
  String get shippingFee;

  /// No description provided for @buyerFee.
  ///
  /// In ar, this message translates to:
  /// **'رسوم الخدمة'**
  String get buyerFee;

  /// No description provided for @discount.
  ///
  /// In ar, this message translates to:
  /// **'الخصم'**
  String get discount;

  /// No description provided for @total.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي'**
  String get total;

  /// No description provided for @checkoutCta.
  ///
  /// In ar, this message translates to:
  /// **'إتمام الشراء'**
  String get checkoutCta;

  /// No description provided for @shippingNotPriced.
  ///
  /// In ar, this message translates to:
  /// **'هيتحدد بعد اختيار العنوان'**
  String get shippingNotPriced;

  /// No description provided for @noShippingToArea.
  ///
  /// In ar, this message translates to:
  /// **'البائع مش بيوصّل للمحافظة دي'**
  String get noShippingToArea;

  /// No description provided for @issueUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'غير متوفر حالياً'**
  String get issueUnavailable;

  /// No description provided for @issueInsufficientStock.
  ///
  /// In ar, this message translates to:
  /// **'الكمية المطلوبة مش متوفرة'**
  String get issueInsufficientStock;

  /// No description provided for @issuePriceChanged.
  ///
  /// In ar, this message translates to:
  /// **'السعر اتغير من {old}'**
  String issuePriceChanged(Object old);

  /// No description provided for @issueSellerUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'البائع مش متاح حالياً'**
  String get issueSellerUnavailable;

  /// No description provided for @acknowledgePrices.
  ///
  /// In ar, this message translates to:
  /// **'موافق على الأسعار الجديدة'**
  String get acknowledgePrices;

  /// No description provided for @remove.
  ///
  /// In ar, this message translates to:
  /// **'حذف'**
  String get remove;

  /// No description provided for @removeFromCartConfirm.
  ///
  /// In ar, this message translates to:
  /// **'تحذف المنتج من السلة؟'**
  String get removeFromCartConfirm;

  /// No description provided for @signInToCheckout.
  ///
  /// In ar, this message translates to:
  /// **'سجّل دخولك علشان تكمل الشراء'**
  String get signInToCheckout;

  /// No description provided for @checkoutTitle.
  ///
  /// In ar, this message translates to:
  /// **'إتمام الطلب'**
  String get checkoutTitle;

  /// No description provided for @stepAddress.
  ///
  /// In ar, this message translates to:
  /// **'العنوان'**
  String get stepAddress;

  /// No description provided for @stepDelivery.
  ///
  /// In ar, this message translates to:
  /// **'التوصيل'**
  String get stepDelivery;

  /// No description provided for @stepPayment.
  ///
  /// In ar, this message translates to:
  /// **'الدفع'**
  String get stepPayment;

  /// No description provided for @stepConfirm.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد'**
  String get stepConfirm;

  /// No description provided for @deliveryAddress.
  ///
  /// In ar, this message translates to:
  /// **'عنوان التوصيل'**
  String get deliveryAddress;

  /// No description provided for @addAddress.
  ///
  /// In ar, this message translates to:
  /// **'إضافة عنوان'**
  String get addAddress;

  /// No description provided for @paymentMethod.
  ///
  /// In ar, this message translates to:
  /// **'طريقة الدفع'**
  String get paymentMethod;

  /// No description provided for @orderSummary.
  ///
  /// In ar, this message translates to:
  /// **'ملخص الطلب'**
  String get orderSummary;

  /// No description provided for @itemsTotal.
  ///
  /// In ar, this message translates to:
  /// **'إجمالي المنتجات'**
  String get itemsTotal;

  /// No description provided for @placeOrder.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الطلب'**
  String get placeOrder;

  /// No description provided for @continueLabel.
  ///
  /// In ar, this message translates to:
  /// **'متابعة'**
  String get continueLabel;

  /// No description provided for @paymentWindow.
  ///
  /// In ar, this message translates to:
  /// **'لازم تحوّل المبلغ خلال {hours} ساعة، وبعدها الطلب بيتلغي تلقائياً.'**
  String paymentWindow(int hours);

  /// No description provided for @priceChangedReview.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي اتغير. راجع السعر الجديد قبل التأكيد.'**
  String get priceChangedReview;

  /// No description provided for @orderPlacedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء طلبك'**
  String get orderPlacedTitle;

  /// No description provided for @orderPlacedBody.
  ///
  /// In ar, this message translates to:
  /// **'حوّل المبلغ وارفع الإيصال علشان نراجع الدفع.'**
  String get orderPlacedBody;

  /// No description provided for @deliveryEta.
  ///
  /// In ar, this message translates to:
  /// **'التوصيل خلال {min}–{max} يوم'**
  String deliveryEta(int min, int max);

  /// No description provided for @noAddressesTitle.
  ///
  /// In ar, this message translates to:
  /// **'مفيش عناوين محفوظة'**
  String get noAddressesTitle;

  /// No description provided for @addressesTitle.
  ///
  /// In ar, this message translates to:
  /// **'عناوين التوصيل'**
  String get addressesTitle;

  /// No description provided for @addressLabelHint.
  ///
  /// In ar, this message translates to:
  /// **'اسم العنوان (البيت، الشغل…)'**
  String get addressLabelHint;

  /// No description provided for @recipientHint.
  ///
  /// In ar, this message translates to:
  /// **'اسم المستلم'**
  String get recipientHint;

  /// No description provided for @governorate.
  ///
  /// In ar, this message translates to:
  /// **'المحافظة'**
  String get governorate;

  /// No description provided for @cityHint.
  ///
  /// In ar, this message translates to:
  /// **'المدينة / المنطقة'**
  String get cityHint;

  /// No description provided for @districtHint.
  ///
  /// In ar, this message translates to:
  /// **'الحي (اختياري)'**
  String get districtHint;

  /// No description provided for @streetHint.
  ///
  /// In ar, this message translates to:
  /// **'الشارع'**
  String get streetHint;

  /// No description provided for @buildingHint.
  ///
  /// In ar, this message translates to:
  /// **'رقم العمارة'**
  String get buildingHint;

  /// No description provided for @floorHint.
  ///
  /// In ar, this message translates to:
  /// **'الدور'**
  String get floorHint;

  /// No description provided for @apartmentHint.
  ///
  /// In ar, this message translates to:
  /// **'الشقة'**
  String get apartmentHint;

  /// No description provided for @landmarkHint.
  ///
  /// In ar, this message translates to:
  /// **'علامة مميزة (اختياري)'**
  String get landmarkHint;

  /// No description provided for @defaultAddress.
  ///
  /// In ar, this message translates to:
  /// **'العنوان الأساسي'**
  String get defaultAddress;

  /// No description provided for @save.
  ///
  /// In ar, this message translates to:
  /// **'حفظ'**
  String get save;

  /// No description provided for @saved.
  ///
  /// In ar, this message translates to:
  /// **'تم الحفظ'**
  String get saved;

  /// No description provided for @edit.
  ///
  /// In ar, this message translates to:
  /// **'تعديل'**
  String get edit;

  /// No description provided for @delete.
  ///
  /// In ar, this message translates to:
  /// **'حذف'**
  String get delete;

  /// No description provided for @deleteAddressConfirm.
  ///
  /// In ar, this message translates to:
  /// **'تحذف العنوان ده؟ الطلبات القديمة مش هتتأثر.'**
  String get deleteAddressConfirm;

  /// No description provided for @ordersEmptyTitle.
  ///
  /// In ar, this message translates to:
  /// **'لسه مفيش طلبات'**
  String get ordersEmptyTitle;

  /// No description provided for @searchOrdersHint.
  ///
  /// In ar, this message translates to:
  /// **'ابحث في طلباتك'**
  String get searchOrdersHint;

  /// No description provided for @filterInProgress.
  ///
  /// In ar, this message translates to:
  /// **'قيد التنفيذ'**
  String get filterInProgress;

  /// No description provided for @filterDelivered.
  ///
  /// In ar, this message translates to:
  /// **'تم التوصيل'**
  String get filterDelivered;

  /// No description provided for @filterCancelled.
  ///
  /// In ar, this message translates to:
  /// **'ملغي'**
  String get filterCancelled;

  /// No description provided for @orderDetails.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل الطلب'**
  String get orderDetails;

  /// No description provided for @trackOrder.
  ///
  /// In ar, this message translates to:
  /// **'تتبع الطلب'**
  String get trackOrder;

  /// No description provided for @orderStatus.
  ///
  /// In ar, this message translates to:
  /// **'حالة الطلب'**
  String get orderStatus;

  /// No description provided for @cancelOrder.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطلب'**
  String get cancelOrder;

  /// No description provided for @cancelOrderConfirm.
  ///
  /// In ar, this message translates to:
  /// **'تلغي الطلب؟ المنتجات هترجع للبائع ومفيش فلوس اتدفعت.'**
  String get cancelOrderConfirm;

  /// No description provided for @orderCancelled.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء الطلب'**
  String get orderCancelled;

  /// No description provided for @payNow.
  ///
  /// In ar, this message translates to:
  /// **'ادفع وارفع الإيصال'**
  String get payNow;

  /// No description provided for @paymentTitle.
  ///
  /// In ar, this message translates to:
  /// **'الدفع'**
  String get paymentTitle;

  /// No description provided for @transferTo.
  ///
  /// In ar, this message translates to:
  /// **'حوّل المبلغ على'**
  String get transferTo;

  /// No description provided for @amountDue.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ المطلوب'**
  String get amountDue;

  /// No description provided for @payBefore.
  ///
  /// In ar, this message translates to:
  /// **'ادفع قبل {date}'**
  String payBefore(Object date);

  /// No description provided for @testPaymentNotice.
  ///
  /// In ar, this message translates to:
  /// **'دفعة تجريبية: الأموال الحقيقية مقفولة. متحوّلش أي فلوس حقيقية.'**
  String get testPaymentNotice;

  /// No description provided for @uploadReceipt.
  ///
  /// In ar, this message translates to:
  /// **'إيصال التحويل'**
  String get uploadReceipt;

  /// No description provided for @uploadReceiptHint.
  ///
  /// In ar, this message translates to:
  /// **'اختار صورة أو PDF للإيصال'**
  String get uploadReceiptHint;

  /// No description provided for @claimedAmountHint.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ اللي حوّلته (ج.م)'**
  String get claimedAmountHint;

  /// No description provided for @referenceHint.
  ///
  /// In ar, this message translates to:
  /// **'رقم العملية (اختياري)'**
  String get referenceHint;

  /// No description provided for @payerNameHint.
  ///
  /// In ar, this message translates to:
  /// **'اسم المحوِّل (اختياري)'**
  String get payerNameHint;

  /// No description provided for @submitReceipt.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الإيصال للمراجعة'**
  String get submitReceipt;

  /// No description provided for @receiptSubmitted.
  ///
  /// In ar, this message translates to:
  /// **'الإيصال وصل وتحت المراجعة. الدفع مش هيتأكد غير بعد مراجعة فريق أضمن.'**
  String get receiptSubmitted;

  /// No description provided for @receiptUnderReview.
  ///
  /// In ar, this message translates to:
  /// **'الإيصال تحت المراجعة'**
  String get receiptUnderReview;

  /// No description provided for @receiptRejected.
  ///
  /// In ar, this message translates to:
  /// **'الإيصال اترفض: {reason}'**
  String receiptRejected(Object reason);

  /// No description provided for @paymentConfirmed.
  ///
  /// In ar, this message translates to:
  /// **'تم تأكيد الدفع'**
  String get paymentConfirmed;

  /// No description provided for @paymentExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت مهلة الدفع'**
  String get paymentExpired;

  /// No description provided for @submissions.
  ///
  /// In ar, this message translates to:
  /// **'الإيصالات المرسلة'**
  String get submissions;

  /// No description provided for @confirmReceipt.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الاستلام'**
  String get confirmReceipt;

  /// No description provided for @confirmReceiptConfirm.
  ///
  /// In ar, this message translates to:
  /// **'أكّد إنك استلمت الشحنة دي وكل حاجة سليمة؟ ده بيبدأ مستحقات البائع.'**
  String get confirmReceiptConfirm;

  /// No description provided for @receiptConfirmed.
  ///
  /// In ar, this message translates to:
  /// **'تم تأكيد الاستلام'**
  String get receiptConfirmed;

  /// No description provided for @requestCancellation.
  ///
  /// In ar, this message translates to:
  /// **'طلب إلغاء'**
  String get requestCancellation;

  /// No description provided for @cancellationReasonHint.
  ///
  /// In ar, this message translates to:
  /// **'سبب الإلغاء'**
  String get cancellationReasonHint;

  /// No description provided for @cancellationRequested.
  ///
  /// In ar, this message translates to:
  /// **'اتبعت طلب الإلغاء للبائع'**
  String get cancellationRequested;

  /// No description provided for @reportProblem.
  ///
  /// In ar, this message translates to:
  /// **'الإبلاغ عن مشكلة'**
  String get reportProblem;

  /// No description provided for @problemNotReceived.
  ///
  /// In ar, this message translates to:
  /// **'الشحنة موصلتش'**
  String get problemNotReceived;

  /// No description provided for @problemProductIssue.
  ///
  /// In ar, this message translates to:
  /// **'مشكلة في المنتج'**
  String get problemProductIssue;

  /// No description provided for @problemDescriptionHint.
  ///
  /// In ar, this message translates to:
  /// **'اوصف المشكلة بالتفصيل (10 حروف على الأقل)'**
  String get problemDescriptionHint;

  /// No description provided for @problemReported.
  ///
  /// In ar, this message translates to:
  /// **'اتسجلت المشكلة وفريق أضمن هيتابع معاك'**
  String get problemReported;

  /// No description provided for @sellerOrderLabel.
  ///
  /// In ar, this message translates to:
  /// **'شحنة من {store}'**
  String sellerOrderLabel(Object store);

  /// No description provided for @trackingNumber.
  ///
  /// In ar, this message translates to:
  /// **'رقم الشحنة: {number}'**
  String trackingNumber(Object number);

  /// No description provided for @refundStatus.
  ///
  /// In ar, this message translates to:
  /// **'حالة الاسترداد'**
  String get refundStatus;

  /// No description provided for @refundUncertain.
  ///
  /// In ar, this message translates to:
  /// **'جاري التحقق من التحويل'**
  String get refundUncertain;

  /// No description provided for @disputeOpen.
  ///
  /// In ar, this message translates to:
  /// **'في نزاع مفتوح'**
  String get disputeOpen;

  /// No description provided for @shippingAddress.
  ///
  /// In ar, this message translates to:
  /// **'عنوان الشحن'**
  String get shippingAddress;

  /// No description provided for @statusPendingPayment.
  ///
  /// In ar, this message translates to:
  /// **'في انتظار الدفع'**
  String get statusPendingPayment;

  /// No description provided for @statusPaymentUnderReview.
  ///
  /// In ar, this message translates to:
  /// **'الدفع تحت المراجعة'**
  String get statusPaymentUnderReview;

  /// No description provided for @statusPaid.
  ///
  /// In ar, this message translates to:
  /// **'تم الدفع'**
  String get statusPaid;

  /// No description provided for @statusProcessing.
  ///
  /// In ar, this message translates to:
  /// **'قيد التنفيذ'**
  String get statusProcessing;

  /// No description provided for @statusCompleted.
  ///
  /// In ar, this message translates to:
  /// **'مكتمل'**
  String get statusCompleted;

  /// No description provided for @statusPartiallyCompleted.
  ///
  /// In ar, this message translates to:
  /// **'مكتمل جزئياً'**
  String get statusPartiallyCompleted;

  /// No description provided for @statusClosedUnfulfilled.
  ///
  /// In ar, this message translates to:
  /// **'مغلق دون تنفيذ'**
  String get statusClosedUnfulfilled;

  /// No description provided for @statusCancelled.
  ///
  /// In ar, this message translates to:
  /// **'ملغي'**
  String get statusCancelled;

  /// No description provided for @stepOrderPlaced.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء الطلب'**
  String get stepOrderPlaced;

  /// No description provided for @stepPaymentConfirmed.
  ///
  /// In ar, this message translates to:
  /// **'تم تأكيد الدفع'**
  String get stepPaymentConfirmed;

  /// No description provided for @stepOrderConfirmed.
  ///
  /// In ar, this message translates to:
  /// **'تم تأكيد الطلب'**
  String get stepOrderConfirmed;

  /// No description provided for @stepPreparing.
  ///
  /// In ar, this message translates to:
  /// **'جاري تجهيز الطلب'**
  String get stepPreparing;

  /// No description provided for @stepShipped.
  ///
  /// In ar, this message translates to:
  /// **'تم الشحن'**
  String get stepShipped;

  /// No description provided for @stepOnTheWay.
  ///
  /// In ar, this message translates to:
  /// **'في طريقه إليك'**
  String get stepOnTheWay;

  /// No description provided for @stepDelivered.
  ///
  /// In ar, this message translates to:
  /// **'تم التوصيل'**
  String get stepDelivered;

  /// No description provided for @stepReceiptConfirmed.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الاستلام'**
  String get stepReceiptConfirmed;

  /// No description provided for @stepCompleted.
  ///
  /// In ar, this message translates to:
  /// **'اكتمال الطلب'**
  String get stepCompleted;

  /// No description provided for @accountTitle.
  ///
  /// In ar, this message translates to:
  /// **'حسابي'**
  String get accountTitle;

  /// No description provided for @personalInfo.
  ///
  /// In ar, this message translates to:
  /// **'البيانات الشخصية'**
  String get personalInfo;

  /// No description provided for @paymentMethods.
  ///
  /// In ar, this message translates to:
  /// **'طرق الدفع'**
  String get paymentMethods;

  /// No description provided for @wallet.
  ///
  /// In ar, this message translates to:
  /// **'المحفظة'**
  String get wallet;

  /// No description provided for @notifications.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات'**
  String get notifications;

  /// No description provided for @helpSupport.
  ///
  /// In ar, this message translates to:
  /// **'المساعدة والدعم'**
  String get helpSupport;

  /// No description provided for @aboutEdmn.
  ///
  /// In ar, this message translates to:
  /// **'عن أضمن ماركت'**
  String get aboutEdmn;

  /// No description provided for @security.
  ///
  /// In ar, this message translates to:
  /// **'الأمان'**
  String get security;

  /// No description provided for @changePassword.
  ///
  /// In ar, this message translates to:
  /// **'تغيير كلمة المرور'**
  String get changePassword;

  /// No description provided for @currentPasswordHint.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور الحالية'**
  String get currentPasswordHint;

  /// No description provided for @passwordChanged.
  ///
  /// In ar, this message translates to:
  /// **'تم تغيير كلمة المرور وتم تسجيل الخروج من الأجهزة التانية'**
  String get passwordChanged;

  /// No description provided for @sellerCenter.
  ///
  /// In ar, this message translates to:
  /// **'مركز البائع'**
  String get sellerCenter;

  /// No description provided for @protectedDeal.
  ///
  /// In ar, this message translates to:
  /// **'أضمن صفقة'**
  String get protectedDeal;

  /// No description provided for @legal.
  ///
  /// In ar, this message translates to:
  /// **'الشروط والسياسات'**
  String get legal;

  /// No description provided for @signInPromptTitle.
  ///
  /// In ar, this message translates to:
  /// **'سجّل دخولك'**
  String get signInPromptTitle;

  /// No description provided for @signInPromptBody.
  ///
  /// In ar, this message translates to:
  /// **'سجّل دخولك علشان تتابع طلباتك وعناويـنك.'**
  String get signInPromptBody;

  /// No description provided for @comingFromServer.
  ///
  /// In ar, this message translates to:
  /// **'الخدمة دي لسه مش متاحة في التطبيق'**
  String get comingFromServer;

  /// No description provided for @notAvailableYetBody.
  ///
  /// In ar, this message translates to:
  /// **'الخدمة دي شغالة على موقع أضمن، ولسه بنجهز لها واجهة في التطبيق.'**
  String get notAvailableYetBody;

  /// No description provided for @openOnWebsite.
  ///
  /// In ar, this message translates to:
  /// **'افتح على الموقع'**
  String get openOnWebsite;

  /// No description provided for @emailHint.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني'**
  String get emailHint;

  /// No description provided for @deliveryFailed.
  ///
  /// In ar, this message translates to:
  /// **'فشل التوصيل'**
  String get deliveryFailed;

  /// No description provided for @paymentRejected.
  ///
  /// In ar, this message translates to:
  /// **'الإيصال اترفض'**
  String get paymentRejected;

  /// No description provided for @refundCompleted.
  ///
  /// In ar, this message translates to:
  /// **'تم الاسترداد'**
  String get refundCompleted;

  /// No description provided for @refundNotPaid.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم الاسترداد'**
  String get refundNotPaid;

  /// No description provided for @refundInProgress.
  ///
  /// In ar, this message translates to:
  /// **'الاسترداد جاري'**
  String get refundInProgress;

  /// No description provided for @sendCode.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الكود'**
  String get sendCode;

  /// No description provided for @productsCount.
  ///
  /// In ar, this message translates to:
  /// **'منتج'**
  String get productsCount;

  /// No description provided for @storeReturns.
  ///
  /// In ar, this message translates to:
  /// **'المتجر بيقبل الاسترجاع خلال {days} يوم'**
  String storeReturns(int days);

  /// No description provided for @storeNoVoluntaryReturns.
  ///
  /// In ar, this message translates to:
  /// **'المتجر مش بيقبل استرجاع اختياري، وحقوقك القانونية محفوظة'**
  String get storeNoVoluntaryReturns;

  /// No description provided for @superseded.
  ///
  /// In ar, this message translates to:
  /// **'مستبدل'**
  String get superseded;

  /// No description provided for @reorderEmptyTitle.
  ///
  /// In ar, this message translates to:
  /// **'مفيش طلبات مكتملة لسه'**
  String get reorderEmptyTitle;

  /// No description provided for @reorderEmptyBody.
  ///
  /// In ar, this message translates to:
  /// **'لما طلب يكتمل هتقدر تطلبه تاني من هنا بضغطة.'**
  String get reorderEmptyBody;

  /// No description provided for @reorderNotice.
  ///
  /// In ar, this message translates to:
  /// **'إعادة الطلب بتضيف نفس المنتجات للسلة بسعر النهارده، وتقدر تراجعها قبل الدفع.'**
  String get reorderNotice;

  /// No description provided for @orderAgain.
  ///
  /// In ar, this message translates to:
  /// **'اطلب تاني'**
  String get orderAgain;

  /// No description provided for @reorderAdded.
  ///
  /// In ar, this message translates to:
  /// **'اتضاف {count} منتج للسلة'**
  String reorderAdded(int count);

  /// No description provided for @reorderPartial.
  ///
  /// In ar, this message translates to:
  /// **'اتضاف {added} منتج، و{failed} مش متاح حالياً'**
  String reorderPartial(int added, int failed);

  /// No description provided for @paymentMethodsNote.
  ///
  /// In ar, this message translates to:
  /// **'بتختار طريقة الدفع مع كل طلب. أضمن مش بيحفظ بيانات أي كارت.'**
  String get paymentMethodsNote;

  /// No description provided for @destBankName.
  ///
  /// In ar, this message translates to:
  /// **'البنك'**
  String get destBankName;

  /// No description provided for @destAccountName.
  ///
  /// In ar, this message translates to:
  /// **'اسم الحساب'**
  String get destAccountName;

  /// No description provided for @destAccountNumber.
  ///
  /// In ar, this message translates to:
  /// **'رقم الحساب'**
  String get destAccountNumber;

  /// No description provided for @destInstapayAddress.
  ///
  /// In ar, this message translates to:
  /// **'عنوان إنستاباي'**
  String get destInstapayAddress;

  /// No description provided for @destWalletNumber.
  ///
  /// In ar, this message translates to:
  /// **'رقم المحفظة'**
  String get destWalletNumber;
}

class _EdmnLocalizationsDelegate
    extends LocalizationsDelegate<EdmnLocalizations> {
  const _EdmnLocalizationsDelegate();

  @override
  Future<EdmnLocalizations> load(Locale locale) {
    return SynchronousFuture<EdmnLocalizations>(
      lookupEdmnLocalizations(locale),
    );
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_EdmnLocalizationsDelegate old) => false;
}

EdmnLocalizations lookupEdmnLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return EdmnLocalizationsAr();
    case 'en':
      return EdmnLocalizationsEn();
  }

  throw FlutterError(
    'EdmnLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
