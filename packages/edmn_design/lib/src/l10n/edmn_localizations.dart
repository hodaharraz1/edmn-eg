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

  /// No description provided for @sellerActive.
  ///
  /// In ar, this message translates to:
  /// **'نشط'**
  String get sellerActive;

  /// No description provided for @sellerRestricted.
  ///
  /// In ar, this message translates to:
  /// **'مقيّد'**
  String get sellerRestricted;

  /// No description provided for @sellerDraft.
  ///
  /// In ar, this message translates to:
  /// **'طلب لم يُرسل'**
  String get sellerDraft;

  /// No description provided for @sellerPendingReview.
  ///
  /// In ar, this message translates to:
  /// **'طلبك تحت المراجعة'**
  String get sellerPendingReview;

  /// No description provided for @sellerMoreInfo.
  ///
  /// In ar, this message translates to:
  /// **'مطلوب بيانات إضافية'**
  String get sellerMoreInfo;

  /// No description provided for @sellerSuspended.
  ///
  /// In ar, this message translates to:
  /// **'موقوف'**
  String get sellerSuspended;

  /// No description provided for @sellerRejected.
  ///
  /// In ar, this message translates to:
  /// **'مرفوض'**
  String get sellerRejected;

  /// No description provided for @notSellerTitle.
  ///
  /// In ar, this message translates to:
  /// **'انت مش بائع على أضمن لسه'**
  String get notSellerTitle;

  /// No description provided for @notSellerBody.
  ///
  /// In ar, this message translates to:
  /// **'التسجيل كبائع ومراجعة المستندات بيتم حالياً من موقع أضمن (مركز البائع). بعد الموافقة هتدير متجرك من هنا.'**
  String get notSellerBody;

  /// No description provided for @sellerNotOperatingBody.
  ///
  /// In ar, this message translates to:
  /// **'هتقدر تستقبل الطلبات بعد موافقة فريق أضمن. تابع حالة طلبك من موقع أضمن.'**
  String get sellerNotOperatingBody;

  /// No description provided for @sellerRole.
  ///
  /// In ar, this message translates to:
  /// **'دورك: {role}'**
  String sellerRole(Object role);

  /// No description provided for @salesToday.
  ///
  /// In ar, this message translates to:
  /// **'المبيعات اليوم'**
  String get salesToday;

  /// No description provided for @ordersLast30.
  ///
  /// In ar, this message translates to:
  /// **'الطلبات (30 يوم)'**
  String get ordersLast30;

  /// No description provided for @ordersToHandle.
  ///
  /// In ar, this message translates to:
  /// **'طلبات محتاجة تنفيذ'**
  String get ordersToHandle;

  /// No description provided for @productsLive.
  ///
  /// In ar, this message translates to:
  /// **'المنتجات المعروضة'**
  String get productsLive;

  /// No description provided for @ratingLabel.
  ///
  /// In ar, this message translates to:
  /// **'التقييم'**
  String get ratingLabel;

  /// No description provided for @manageProducts.
  ///
  /// In ar, this message translates to:
  /// **'إدارة المنتجات'**
  String get manageProducts;

  /// No description provided for @sellerOrders.
  ///
  /// In ar, this message translates to:
  /// **'الطلبات'**
  String get sellerOrders;

  /// No description provided for @earningsBalance.
  ///
  /// In ar, this message translates to:
  /// **'الأرباح والرصيد'**
  String get earningsBalance;

  /// No description provided for @viewMyStore.
  ///
  /// In ar, this message translates to:
  /// **'صفحة متجري للمشترين'**
  String get viewMyStore;

  /// No description provided for @sellerWebOnlyNote.
  ///
  /// In ar, this message translates to:
  /// **'إضافة منتج جديد وتعديل الصور والأسعار وأسعار الشحن وطلبات السحب متاحة حالياً من مركز البائع على الموقع.'**
  String get sellerWebOnlyNote;

  /// No description provided for @soNew.
  ///
  /// In ar, this message translates to:
  /// **'جديد'**
  String get soNew;

  /// No description provided for @soAccepted.
  ///
  /// In ar, this message translates to:
  /// **'مقبول'**
  String get soAccepted;

  /// No description provided for @soReady.
  ///
  /// In ar, this message translates to:
  /// **'جاهز للشحن'**
  String get soReady;

  /// No description provided for @noSellerOrders.
  ///
  /// In ar, this message translates to:
  /// **'مفيش طلبات هنا'**
  String get noSellerOrders;

  /// No description provided for @stepConfirmOrder.
  ///
  /// In ar, this message translates to:
  /// **'قبول الطلب'**
  String get stepConfirmOrder;

  /// No description provided for @stepStartProcessing.
  ///
  /// In ar, this message translates to:
  /// **'بدء التجهيز'**
  String get stepStartProcessing;

  /// No description provided for @stepMarkReady.
  ///
  /// In ar, this message translates to:
  /// **'جاهز للشحن'**
  String get stepMarkReady;

  /// No description provided for @stepMarkShipped.
  ///
  /// In ar, this message translates to:
  /// **'تم الشحن'**
  String get stepMarkShipped;

  /// No description provided for @stepAcceptCancellation.
  ///
  /// In ar, this message translates to:
  /// **'الموافقة على الإلغاء'**
  String get stepAcceptCancellation;

  /// No description provided for @sellerStepConfirm.
  ///
  /// In ar, this message translates to:
  /// **'هتغيّر حالة الطلب. المشتري هيشوف التحديث.'**
  String get sellerStepConfirm;

  /// No description provided for @acceptCancellationConfirm.
  ///
  /// In ar, this message translates to:
  /// **'هيتلغي الطلب والمبلغ هيرجع للمشتري حسب سياسة أضمن.'**
  String get acceptCancellationConfirm;

  /// No description provided for @acceptCancellationNote.
  ///
  /// In ar, this message translates to:
  /// **'البائع وافق على طلب الإلغاء من التطبيق'**
  String get acceptCancellationNote;

  /// No description provided for @commission.
  ///
  /// In ar, this message translates to:
  /// **'عمولة أضمن'**
  String get commission;

  /// No description provided for @sellerNet.
  ///
  /// In ar, this message translates to:
  /// **'صافي البائع'**
  String get sellerNet;

  /// No description provided for @sellerNetNote.
  ///
  /// In ar, this message translates to:
  /// **'الصافي بيتحول لرصيدك بعد الاستلام وانتهاء الضمانات، مش فوراً.'**
  String get sellerNetNote;

  /// No description provided for @waybillAttached.
  ///
  /// In ar, this message translates to:
  /// **'بوليصة الشحن مرفوعة'**
  String get waybillAttached;

  /// No description provided for @addShipment.
  ///
  /// In ar, this message translates to:
  /// **'بيانات الشحن'**
  String get addShipment;

  /// No description provided for @editShipment.
  ///
  /// In ar, this message translates to:
  /// **'تعديل بيانات الشحن'**
  String get editShipment;

  /// No description provided for @shipmentDetails.
  ///
  /// In ar, this message translates to:
  /// **'بيانات الشحن'**
  String get shipmentDetails;

  /// No description provided for @carrierHint.
  ///
  /// In ar, this message translates to:
  /// **'شركة الشحن'**
  String get carrierHint;

  /// No description provided for @trackingHint.
  ///
  /// In ar, this message translates to:
  /// **'رقم البوليصة (اختياري)'**
  String get trackingHint;

  /// No description provided for @waybill.
  ///
  /// In ar, this message translates to:
  /// **'إثبات الشحن (بوليصة)'**
  String get waybill;

  /// No description provided for @waybillHint.
  ///
  /// In ar, this message translates to:
  /// **'اختار صورة أو PDF للبوليصة'**
  String get waybillHint;

  /// No description provided for @stockLine.
  ///
  /// In ar, this message translates to:
  /// **'المخزون {onHand} · محجوز {reserved} · متاح {available}'**
  String stockLine(int onHand, int reserved, int available);

  /// No description provided for @editStock.
  ///
  /// In ar, this message translates to:
  /// **'تعديل المخزون'**
  String get editStock;

  /// No description provided for @stockOnHand.
  ///
  /// In ar, this message translates to:
  /// **'الكمية الموجودة'**
  String get stockOnHand;

  /// No description provided for @reservedFloor.
  ///
  /// In ar, this message translates to:
  /// **'لا تقل عن {reserved} (محجوزة لطلبات قائمة)'**
  String reservedFloor(int reserved);

  /// No description provided for @productLive.
  ///
  /// In ar, this message translates to:
  /// **'معروض'**
  String get productLive;

  /// No description provided for @productDraft.
  ///
  /// In ar, this message translates to:
  /// **'مسودة'**
  String get productDraft;

  /// No description provided for @productInReview.
  ///
  /// In ar, this message translates to:
  /// **'تحت المراجعة'**
  String get productInReview;

  /// No description provided for @productRejected.
  ///
  /// In ar, this message translates to:
  /// **'مرفوض'**
  String get productRejected;

  /// No description provided for @productSuspended.
  ///
  /// In ar, this message translates to:
  /// **'موقوف'**
  String get productSuspended;

  /// No description provided for @productArchived.
  ///
  /// In ar, this message translates to:
  /// **'مؤرشف'**
  String get productArchived;

  /// No description provided for @withdrawable.
  ///
  /// In ar, this message translates to:
  /// **'قابل للسحب'**
  String get withdrawable;

  /// No description provided for @fundsPending.
  ///
  /// In ar, this message translates to:
  /// **'معلّق (لسه ما اتحررش)'**
  String get fundsPending;

  /// No description provided for @fundsAvailable.
  ///
  /// In ar, this message translates to:
  /// **'رصيد متاح بالدفاتر'**
  String get fundsAvailable;

  /// No description provided for @fundsHeld.
  ///
  /// In ar, this message translates to:
  /// **'محجوز لنزاعات/مرتجعات'**
  String get fundsHeld;

  /// No description provided for @fundsReserved.
  ///
  /// In ar, this message translates to:
  /// **'محجوز لسحب معتمد'**
  String get fundsReserved;

  /// No description provided for @fundsDebt.
  ///
  /// In ar, this message translates to:
  /// **'مديونية مسجلة'**
  String get fundsDebt;

  /// No description provided for @fundsUnsecured.
  ///
  /// In ar, this message translates to:
  /// **'مطالبات غير مغطاة'**
  String get fundsUnsecured;

  /// No description provided for @fundsNote.
  ///
  /// In ar, this message translates to:
  /// **'الأرقام من دفاتر أضمن. المحجوز والمديونية والمطالبات مش قابلة للسحب.'**
  String get fundsNote;

  /// No description provided for @openPayouts.
  ///
  /// In ar, this message translates to:
  /// **'عندك {count} طلب سحب قيد التنفيذ'**
  String openPayouts(int count);

  /// No description provided for @payoutOnWebNote.
  ///
  /// In ar, this message translates to:
  /// **'طلب السحب ومتابعته متاحين حالياً من مركز البائع على الموقع، ويتم اعتماده بمراجعة مزدوجة من فريق أضمن.'**
  String get payoutOnWebNote;

  /// No description provided for @switchToSeller.
  ///
  /// In ar, this message translates to:
  /// **'مركز البائع'**
  String get switchToSeller;

  /// No description provided for @roleOwner.
  ///
  /// In ar, this message translates to:
  /// **'صاحب المتجر'**
  String get roleOwner;

  /// No description provided for @roleManager.
  ///
  /// In ar, this message translates to:
  /// **'مدير المتجر'**
  String get roleManager;

  /// No description provided for @roleCatalog.
  ///
  /// In ar, this message translates to:
  /// **'مسؤول المنتجات'**
  String get roleCatalog;

  /// No description provided for @roleOrders.
  ///
  /// In ar, this message translates to:
  /// **'مسؤول الطلبات'**
  String get roleOrders;

  /// No description provided for @roleFinance.
  ///
  /// In ar, this message translates to:
  /// **'المالية'**
  String get roleFinance;

  /// No description provided for @roleSupport.
  ///
  /// In ar, this message translates to:
  /// **'الدعم'**
  String get roleSupport;

  /// No description provided for @idApproved.
  ///
  /// In ar, this message translates to:
  /// **'الهوية موثّقة'**
  String get idApproved;

  /// No description provided for @idPending.
  ///
  /// In ar, this message translates to:
  /// **'الهوية تحت المراجعة'**
  String get idPending;

  /// No description provided for @idMoreInfo.
  ///
  /// In ar, this message translates to:
  /// **'مطلوب استكمال بيانات الهوية'**
  String get idMoreInfo;

  /// No description provided for @idRejected.
  ///
  /// In ar, this message translates to:
  /// **'اترفض توثيق الهوية'**
  String get idRejected;

  /// No description provided for @idIncomplete.
  ///
  /// In ar, this message translates to:
  /// **'الهوية لسه مش موثّقة'**
  String get idIncomplete;

  /// No description provided for @identityTitle.
  ///
  /// In ar, this message translates to:
  /// **'توثيق الهوية'**
  String get identityTitle;

  /// No description provided for @identityWhy.
  ///
  /// In ar, this message translates to:
  /// **'توثيق البطاقة مطلوب قبل البيع وبعض العمليات المالية. فريق أضمن بيراجع الصور، والرقم القومي بيتخزن مشفّر ومش بيظهر تاني.'**
  String get identityWhy;

  /// No description provided for @identityLast4.
  ///
  /// In ar, this message translates to:
  /// **'آخر 4 أرقام: {last4}'**
  String identityLast4(Object last4);

  /// No description provided for @legalNameHint.
  ///
  /// In ar, this message translates to:
  /// **'الاسم الكامل كما في البطاقة (ثلاثي)'**
  String get legalNameHint;

  /// No description provided for @nationalIdHint.
  ///
  /// In ar, this message translates to:
  /// **'الرقم القومي (14 رقم)'**
  String get nationalIdHint;

  /// No description provided for @idFront.
  ///
  /// In ar, this message translates to:
  /// **'صورة البطاقة (الوجه)'**
  String get idFront;

  /// No description provided for @idBack.
  ///
  /// In ar, this message translates to:
  /// **'صورة البطاقة (الظهر)'**
  String get idBack;

  /// No description provided for @pickImage.
  ///
  /// In ar, this message translates to:
  /// **'اختار صورة'**
  String get pickImage;

  /// No description provided for @pickDocument.
  ///
  /// In ar, this message translates to:
  /// **'اختار صورة أو PDF'**
  String get pickDocument;

  /// No description provided for @submitForReview.
  ///
  /// In ar, this message translates to:
  /// **'إرسال للمراجعة'**
  String get submitForReview;

  /// No description provided for @sentForReview.
  ///
  /// In ar, this message translates to:
  /// **'اتبعت للمراجعة'**
  String get sentForReview;

  /// No description provided for @becomeSeller.
  ///
  /// In ar, this message translates to:
  /// **'ابدأ البيع على أضمن'**
  String get becomeSeller;

  /// No description provided for @becomeSellerBody.
  ///
  /// In ar, this message translates to:
  /// **'افتح متجرك: اختار نوع البائع، وثّق هويتك، ضيف بيانات المتجر والمستندات وحساب استلام الأموال، وبعدها فريق أضمن بيراجع الطلب.'**
  String get becomeSellerBody;

  /// No description provided for @checklist.
  ///
  /// In ar, this message translates to:
  /// **'خطوات الطلب'**
  String get checklist;

  /// No description provided for @sellerTermsNote.
  ///
  /// In ar, this message translates to:
  /// **'بإرسال الطلب أنت موافق على اتفاقية البائع والعمولات وسياسات أضمن السارية.'**
  String get sellerTermsNote;

  /// No description provided for @ownerDetails.
  ///
  /// In ar, this message translates to:
  /// **'بيانات صاحب المتجر'**
  String get ownerDetails;

  /// No description provided for @businessDetails.
  ///
  /// In ar, this message translates to:
  /// **'بيانات النشاط'**
  String get businessDetails;

  /// No description provided for @storeDetails.
  ///
  /// In ar, this message translates to:
  /// **'بيانات المتجر'**
  String get storeDetails;

  /// No description provided for @payoutAccount.
  ///
  /// In ar, this message translates to:
  /// **'حساب استلام الأموال'**
  String get payoutAccount;

  /// No description provided for @documents.
  ///
  /// In ar, this message translates to:
  /// **'المستندات'**
  String get documents;

  /// No description provided for @sellerIndividual.
  ///
  /// In ar, this message translates to:
  /// **'فرد'**
  String get sellerIndividual;

  /// No description provided for @sellerBusiness.
  ///
  /// In ar, this message translates to:
  /// **'شركة / نشاط تجاري'**
  String get sellerBusiness;

  /// No description provided for @startApplication.
  ///
  /// In ar, this message translates to:
  /// **'ابدأ الطلب'**
  String get startApplication;

  /// No description provided for @acceptSellerAgreement.
  ///
  /// In ar, this message translates to:
  /// **'أوافق على اتفاقية البائع'**
  String get acceptSellerAgreement;

  /// No description provided for @readAgreement.
  ///
  /// In ar, this message translates to:
  /// **'اقرأ الاتفاقية'**
  String get readAgreement;

  /// No description provided for @applicationIncomplete.
  ///
  /// In ar, this message translates to:
  /// **'كمّل كل الخطوات ووثّق هويتك الأول'**
  String get applicationIncomplete;

  /// No description provided for @businessName.
  ///
  /// In ar, this message translates to:
  /// **'الاسم القانوني للنشاط'**
  String get businessName;

  /// No description provided for @commercialRegistration.
  ///
  /// In ar, this message translates to:
  /// **'رقم السجل التجاري'**
  String get commercialRegistration;

  /// No description provided for @taxRegistration.
  ///
  /// In ar, this message translates to:
  /// **'رقم البطاقة الضريبية'**
  String get taxRegistration;

  /// No description provided for @businessAddress.
  ///
  /// In ar, this message translates to:
  /// **'عنوان النشاط'**
  String get businessAddress;

  /// No description provided for @authorizedRepresentative.
  ///
  /// In ar, this message translates to:
  /// **'الممثل القانوني'**
  String get authorizedRepresentative;

  /// No description provided for @storeName.
  ///
  /// In ar, this message translates to:
  /// **'اسم المتجر'**
  String get storeName;

  /// No description provided for @storeDescription.
  ///
  /// In ar, this message translates to:
  /// **'وصف المتجر'**
  String get storeDescription;

  /// No description provided for @returnAddress.
  ///
  /// In ar, this message translates to:
  /// **'عنوان الإرجاع'**
  String get returnAddress;

  /// No description provided for @supportPhone.
  ///
  /// In ar, this message translates to:
  /// **'رقم خدمة العملاء (اختياري)'**
  String get supportPhone;

  /// No description provided for @storeLogo.
  ///
  /// In ar, this message translates to:
  /// **'شعار المتجر (اختياري)'**
  String get storeLogo;

  /// No description provided for @upload.
  ///
  /// In ar, this message translates to:
  /// **'رفع'**
  String get upload;

  /// No description provided for @holderName.
  ///
  /// In ar, this message translates to:
  /// **'اسم صاحب الحساب'**
  String get holderName;

  /// No description provided for @walletProvider.
  ///
  /// In ar, this message translates to:
  /// **'مزود المحفظة'**
  String get walletProvider;

  /// No description provided for @mobileWallet.
  ///
  /// In ar, this message translates to:
  /// **'محفظة موبايل'**
  String get mobileWallet;

  /// No description provided for @payoutAccountNote.
  ///
  /// In ar, this message translates to:
  /// **'فريق أضمن بيتحقق من الحساب قبل أي تحويل.'**
  String get payoutAccountNote;

  /// No description provided for @addProduct.
  ///
  /// In ar, this message translates to:
  /// **'إضافة منتج'**
  String get addProduct;

  /// No description provided for @productNameHint.
  ///
  /// In ar, this message translates to:
  /// **'اسم المنتج'**
  String get productNameHint;

  /// No description provided for @category.
  ///
  /// In ar, this message translates to:
  /// **'القسم'**
  String get category;

  /// No description provided for @editProduct.
  ///
  /// In ar, this message translates to:
  /// **'تعديل المنتج'**
  String get editProduct;

  /// No description provided for @moderationNote.
  ///
  /// In ar, this message translates to:
  /// **'ملاحظة المراجعة'**
  String get moderationNote;

  /// No description provided for @revisionPending.
  ///
  /// In ar, this message translates to:
  /// **'في تعديل تحت المراجعة'**
  String get revisionPending;

  /// No description provided for @beforeSubmit.
  ///
  /// In ar, this message translates to:
  /// **'قبل الإرسال للمراجعة'**
  String get beforeSubmit;

  /// No description provided for @photos.
  ///
  /// In ar, this message translates to:
  /// **'الصور'**
  String get photos;

  /// No description provided for @tapToAdd.
  ///
  /// In ar, this message translates to:
  /// **'اضغط للإضافة'**
  String get tapToAdd;

  /// No description provided for @priceAndStock.
  ///
  /// In ar, this message translates to:
  /// **'السعر والمخزون'**
  String get priceAndStock;

  /// No description provided for @setPrice.
  ///
  /// In ar, this message translates to:
  /// **'حدد السعر والكمية'**
  String get setPrice;

  /// No description provided for @addVariant.
  ///
  /// In ar, this message translates to:
  /// **'إضافة نوع (مقاس / لون)'**
  String get addVariant;

  /// No description provided for @productReturnCustom.
  ///
  /// In ar, this message translates to:
  /// **'سياسة خاصة: إرجاع خلال {days} يوم'**
  String productReturnCustom(int days);

  /// No description provided for @productReturnStoreDefault.
  ///
  /// In ar, this message translates to:
  /// **'سياسة المتجر الافتراضية'**
  String get productReturnStoreDefault;

  /// No description provided for @returnPolicyNotSet.
  ///
  /// In ar, this message translates to:
  /// **'لسه ما اتحددتش سياسة الإرجاع'**
  String get returnPolicyNotSet;

  /// No description provided for @hideProduct.
  ///
  /// In ar, this message translates to:
  /// **'إخفاء المنتج من المتجر'**
  String get hideProduct;

  /// No description provided for @showProduct.
  ///
  /// In ar, this message translates to:
  /// **'إظهار المنتج في المتجر'**
  String get showProduct;

  /// No description provided for @viewAsBuyer.
  ///
  /// In ar, this message translates to:
  /// **'عرض كمشتري'**
  String get viewAsBuyer;

  /// No description provided for @keyFeaturesHint.
  ///
  /// In ar, this message translates to:
  /// **'مميزات المنتج (سطر لكل ميزة)'**
  String get keyFeaturesHint;

  /// No description provided for @variantLabelHint.
  ///
  /// In ar, this message translates to:
  /// **'النوع (مثلاً: أسود / 128GB)'**
  String get variantLabelHint;

  /// No description provided for @priceEgp.
  ///
  /// In ar, this message translates to:
  /// **'السعر (ج.م)'**
  String get priceEgp;

  /// No description provided for @compareAtEgp.
  ///
  /// In ar, this message translates to:
  /// **'السعر قبل الخصم (اختياري)'**
  String get compareAtEgp;

  /// No description provided for @customReturnPolicy.
  ///
  /// In ar, this message translates to:
  /// **'سياسة إرجاع خاصة بالمنتج'**
  String get customReturnPolicy;

  /// No description provided for @acceptsReturns.
  ///
  /// In ar, this message translates to:
  /// **'بيقبل الإرجاع الاختياري'**
  String get acceptsReturns;

  /// No description provided for @processingDaysHint.
  ///
  /// In ar, this message translates to:
  /// **'أيام التجهيز'**
  String get processingDaysHint;

  /// No description provided for @returnDaysHint.
  ///
  /// In ar, this message translates to:
  /// **'مدة الإرجاع (أيام)'**
  String get returnDaysHint;

  /// No description provided for @shippingRates.
  ///
  /// In ar, this message translates to:
  /// **'الشحن حسب المحافظة'**
  String get shippingRates;

  /// No description provided for @checkRates.
  ///
  /// In ar, this message translates to:
  /// **'راجع الأرقام قبل الحفظ'**
  String get checkRates;

  /// No description provided for @shippingRatesNote.
  ///
  /// In ar, this message translates to:
  /// **'فعّل المحافظات اللي بتشحن لها وحدد رسوم ومدة التوصيل. المشتري بيشوف الرسوم دي في السلة.'**
  String get shippingRatesNote;

  /// No description provided for @feeEgp.
  ///
  /// In ar, this message translates to:
  /// **'الرسوم'**
  String get feeEgp;

  /// No description provided for @etaMin.
  ///
  /// In ar, this message translates to:
  /// **'من'**
  String get etaMin;

  /// No description provided for @etaMax.
  ///
  /// In ar, this message translates to:
  /// **'إلى'**
  String get etaMax;

  /// No description provided for @storeSettings.
  ///
  /// In ar, this message translates to:
  /// **'إعدادات المتجر'**
  String get storeSettings;

  /// No description provided for @payoutRequests.
  ///
  /// In ar, this message translates to:
  /// **'طلبات السحب'**
  String get payoutRequests;

  /// No description provided for @requestPayout.
  ///
  /// In ar, this message translates to:
  /// **'طلب سحب'**
  String get requestPayout;

  /// No description provided for @payoutHistory.
  ///
  /// In ar, this message translates to:
  /// **'سجل الطلبات'**
  String get payoutHistory;

  /// No description provided for @noPayouts.
  ///
  /// In ar, this message translates to:
  /// **'مفيش طلبات سحب'**
  String get noPayouts;

  /// No description provided for @payoutRequestNote.
  ///
  /// In ar, this message translates to:
  /// **'طلب السحب بيتراجع من شخصين في فريق أضمن قبل التحويل. التطبيق مش بيحوّل فلوس.'**
  String get payoutRequestNote;

  /// No description provided for @payoutUnderReview.
  ///
  /// In ar, this message translates to:
  /// **'تحت المراجعة'**
  String get payoutUnderReview;

  /// No description provided for @payoutProcessing.
  ///
  /// In ar, this message translates to:
  /// **'جاري التنفيذ'**
  String get payoutProcessing;

  /// No description provided for @payoutPaid.
  ///
  /// In ar, this message translates to:
  /// **'تم التحويل'**
  String get payoutPaid;

  /// No description provided for @payoutUncertain.
  ///
  /// In ar, this message translates to:
  /// **'جاري التحقق من التحويل'**
  String get payoutUncertain;

  /// No description provided for @payoutRejected.
  ///
  /// In ar, this message translates to:
  /// **'مرفوض'**
  String get payoutRejected;

  /// No description provided for @payoutNotTransferred.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم التحويل'**
  String get payoutNotTransferred;

  /// No description provided for @payoutUncertainNote.
  ///
  /// In ar, this message translates to:
  /// **'مش واضح لسه إذا التحويل وصل. فريق أضمن بيتحقق، ومحدش هيعيد التحويل قبل التأكد.'**
  String get payoutUncertainNote;

  /// No description provided for @paidReference.
  ///
  /// In ar, this message translates to:
  /// **'مرجع التحويل: {ref}'**
  String paidReference(Object ref);

  /// No description provided for @cancelRequest.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطلب'**
  String get cancelRequest;

  /// No description provided for @cancelPayoutConfirm.
  ///
  /// In ar, this message translates to:
  /// **'تلغي طلب السحب ده؟'**
  String get cancelPayoutConfirm;

  /// No description provided for @maxWithdrawable.
  ///
  /// In ar, this message translates to:
  /// **'أقصى مبلغ متاح: {amount}'**
  String maxWithdrawable(Object amount);

  /// No description provided for @amountEgp.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ (ج.م)'**
  String get amountEgp;

  /// No description provided for @transferCost.
  ///
  /// In ar, this message translates to:
  /// **'تكلفة التحويل'**
  String get transferCost;

  /// No description provided for @youReceive.
  ///
  /// In ar, this message translates to:
  /// **'هتستلم'**
  String get youReceive;

  /// No description provided for @reviewAmount.
  ///
  /// In ar, this message translates to:
  /// **'مراجعة المبلغ'**
  String get reviewAmount;

  /// No description provided for @sendRequest.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الطلب'**
  String get sendRequest;

  /// No description provided for @payoutRequested.
  ///
  /// In ar, this message translates to:
  /// **'اتبعت طلب السحب للمراجعة'**
  String get payoutRequested;

  /// No description provided for @payoutAlreadyRequested.
  ///
  /// In ar, this message translates to:
  /// **'الطلب ده متسجل بالفعل'**
  String get payoutAlreadyRequested;

  /// No description provided for @continueApplication.
  ///
  /// In ar, this message translates to:
  /// **'كمّل طلب البائع'**
  String get continueApplication;

  /// No description provided for @acceptChange.
  ///
  /// In ar, this message translates to:
  /// **'قبول التعديل'**
  String get acceptChange;

  /// No description provided for @acceptOffer.
  ///
  /// In ar, this message translates to:
  /// **'قبول العرض'**
  String get acceptOffer;

  /// No description provided for @acceptOfferConfirm.
  ///
  /// In ar, this message translates to:
  /// **'بقبول العرض تصبح الشروط ملزمة للطرفين وتنتقل للدفع.'**
  String get acceptOfferConfirm;

  /// No description provided for @cancelDeal.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الصفقة'**
  String get cancelDeal;

  /// No description provided for @changeMessageHint.
  ///
  /// In ar, this message translates to:
  /// **'اكتب التعديل المطلوب بوضوح'**
  String get changeMessageHint;

  /// No description provided for @codeWarning.
  ///
  /// In ar, this message translates to:
  /// **'لا تعطِ الكود إلا عند استلام المنتج فعليًا وفحصه.'**
  String get codeWarning;

  /// No description provided for @copyLink.
  ///
  /// In ar, this message translates to:
  /// **'نسخ الرابط'**
  String get copyLink;

  /// No description provided for @dealAwaitingRelease.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار تحويل المبلغ للبائع'**
  String get dealAwaitingRelease;

  /// No description provided for @dealBuyerOnly.
  ///
  /// In ar, this message translates to:
  /// **'المشتري هو من يبدأ الصفقة ثم يدعو البائع برابط.'**
  String get dealBuyerOnly;

  /// No description provided for @dealBuyerPays.
  ///
  /// In ar, this message translates to:
  /// **'إجمالي ما تدفعه'**
  String get dealBuyerPays;

  /// No description provided for @dealChangeRequested.
  ///
  /// In ar, this message translates to:
  /// **'مطلوب تعديل'**
  String get dealChangeRequested;

  /// No description provided for @dealConfirmReceiptConfirm.
  ///
  /// In ar, this message translates to:
  /// **'بتأكيد الاستلام تقرّ بأن المنتج مطابق، ويُستحق المبلغ للبائع بعد مراجعة أضمن.'**
  String get dealConfirmReceiptConfirm;

  /// No description provided for @dealDeadlineHint.
  ///
  /// In ar, this message translates to:
  /// **'مدة التسليم بالأيام'**
  String get dealDeadlineHint;

  /// No description provided for @dealDelivered.
  ///
  /// In ar, this message translates to:
  /// **'تم الشحن'**
  String get dealDelivered;

  /// No description provided for @dealDeliveryHint.
  ///
  /// In ar, this message translates to:
  /// **'طريقة التسليم (مندوب، شركة شحن، استلام يدوي)'**
  String get dealDeliveryHint;

  /// No description provided for @dealDescriptionHint.
  ///
  /// In ar, this message translates to:
  /// **'وصف المنتج وحالته بالتفصيل'**
  String get dealDescriptionHint;

  /// No description provided for @dealDraft.
  ///
  /// In ar, this message translates to:
  /// **'مسودة'**
  String get dealDraft;

  /// No description provided for @dealFeesNote.
  ///
  /// In ar, this message translates to:
  /// **'رسوم الخدمة ومبلغ الشحن يحسبهما أضمن ويظهران قبل الدفع.'**
  String get dealFeesNote;

  /// No description provided for @dealFundsHeld.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ محجوز لدى أضمن'**
  String get dealFundsHeld;

  /// No description provided for @dealHubBody.
  ///
  /// In ar, this message translates to:
  /// **'ادفع بأمان لأي شخص خارج المتجر. أضمن يحجز المبلغ لحد ما تستلم.'**
  String get dealHubBody;

  /// No description provided for @dealInspection.
  ///
  /// In ar, this message translates to:
  /// **'فترة الفحص'**
  String get dealInspection;

  /// No description provided for @dealInspectionHint.
  ///
  /// In ar, this message translates to:
  /// **'أيام الفحص بعد الاستلام'**
  String get dealInspectionHint;

  /// No description provided for @dealInvited.
  ///
  /// In ar, this message translates to:
  /// **'تمت دعوة البائع'**
  String get dealInvited;

  /// No description provided for @dealLinkHint.
  ///
  /// In ar, this message translates to:
  /// **'رابط الإعلان (اختياري)'**
  String get dealLinkHint;

  /// No description provided for @dealLocationPrivacy.
  ///
  /// In ar, this message translates to:
  /// **'عنوانك لا يظهر للبائع إلا بعد الدفع.'**
  String get dealLocationPrivacy;

  /// No description provided for @dealMoneyNote.
  ///
  /// In ar, this message translates to:
  /// **'المبالغ محسوبة من أضمن ولا تتغير إلا بموافقة الطرفين.'**
  String get dealMoneyNote;

  /// No description provided for @dealNoReleaseNote.
  ///
  /// In ar, this message translates to:
  /// **'تحويل المبلغ أو استرداده يتم من فريق أضمن بعد المراجعة، وليس من التطبيق.'**
  String get dealNoReleaseNote;

  /// No description provided for @dealOfferPending.
  ///
  /// In ar, this message translates to:
  /// **'عرض بانتظار ردك'**
  String get dealOfferPending;

  /// No description provided for @dealOnHold.
  ///
  /// In ar, this message translates to:
  /// **'الصفقة موقوفة مؤقتًا للمراجعة.'**
  String get dealOnHold;

  /// No description provided for @dealRoleBuyer.
  ///
  /// In ar, this message translates to:
  /// **'أنت المشتري'**
  String get dealRoleBuyer;

  /// No description provided for @dealRoleSeller.
  ///
  /// In ar, this message translates to:
  /// **'أنت البائع'**
  String get dealRoleSeller;

  /// No description provided for @dealSaved.
  ///
  /// In ar, this message translates to:
  /// **'تم حفظ الصفقة'**
  String get dealSaved;

  /// No description provided for @dealSavedBody.
  ///
  /// In ar, this message translates to:
  /// **'راجع التفاصيل ثم أرسل رابط الدعوة للبائع.'**
  String get dealSavedBody;

  /// No description provided for @dealSellerJoined.
  ///
  /// In ar, this message translates to:
  /// **'انضم البائع'**
  String get dealSellerJoined;

  /// No description provided for @dealSellerNameHint.
  ///
  /// In ar, this message translates to:
  /// **'اسم البائع'**
  String get dealSellerNameHint;

  /// No description provided for @dealSellerPhoneHint.
  ///
  /// In ar, this message translates to:
  /// **'رقم موبايل البائع'**
  String get dealSellerPhoneHint;

  /// No description provided for @dealSellerReceives.
  ///
  /// In ar, this message translates to:
  /// **'صافي ما تستلمه'**
  String get dealSellerReceives;

  /// No description provided for @dealStepDeliver.
  ///
  /// In ar, this message translates to:
  /// **'التسليم'**
  String get dealStepDeliver;

  /// No description provided for @dealStepDelivery.
  ///
  /// In ar, this message translates to:
  /// **'التسليم'**
  String get dealStepDelivery;

  /// No description provided for @dealStepHold.
  ///
  /// In ar, this message translates to:
  /// **'حجز المبلغ'**
  String get dealStepHold;

  /// No description provided for @dealStepItem.
  ///
  /// In ar, this message translates to:
  /// **'المنتج'**
  String get dealStepItem;

  /// No description provided for @dealStepLocation.
  ///
  /// In ar, this message translates to:
  /// **'العنوان'**
  String get dealStepLocation;

  /// No description provided for @dealStepPrice.
  ///
  /// In ar, this message translates to:
  /// **'السعر'**
  String get dealStepPrice;

  /// No description provided for @dealStepRelease.
  ///
  /// In ar, this message translates to:
  /// **'تحويل للبائع'**
  String get dealStepRelease;

  /// No description provided for @dealTermsAccept.
  ///
  /// In ar, this message translates to:
  /// **'أوافق على شروط أضمن صفقة.'**
  String get dealTermsAccept;

  /// No description provided for @dealTermsHint.
  ///
  /// In ar, this message translates to:
  /// **'شروط إضافية (اختياري)'**
  String get dealTermsHint;

  /// No description provided for @dealTermsHistory.
  ///
  /// In ar, this message translates to:
  /// **'سجل الشروط'**
  String get dealTermsHistory;

  /// No description provided for @dealTimeline.
  ///
  /// In ar, this message translates to:
  /// **'مراحل الصفقة'**
  String get dealTimeline;

  /// No description provided for @dealTitleHint.
  ///
  /// In ar, this message translates to:
  /// **'اسم المنتج'**
  String get dealTitleHint;

  /// No description provided for @dealTlAgreed.
  ///
  /// In ar, this message translates to:
  /// **'اتفاق الطرفين'**
  String get dealTlAgreed;

  /// No description provided for @dealTlConfirmed.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد الاستلام'**
  String get dealTlConfirmed;

  /// No description provided for @dealTlCreated.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء الصفقة'**
  String get dealTlCreated;

  /// No description provided for @dealTlHandover.
  ///
  /// In ar, this message translates to:
  /// **'التحقق من التسليم'**
  String get dealTlHandover;

  /// No description provided for @dealTlHeld.
  ///
  /// In ar, this message translates to:
  /// **'حجز المبلغ'**
  String get dealTlHeld;

  /// No description provided for @dealTlInvited.
  ///
  /// In ar, this message translates to:
  /// **'دعوة البائع'**
  String get dealTlInvited;

  /// No description provided for @dealTlPaid.
  ///
  /// In ar, this message translates to:
  /// **'مراجعة الدفع'**
  String get dealTlPaid;

  /// No description provided for @dealTlReleased.
  ///
  /// In ar, this message translates to:
  /// **'تحويل المبلغ'**
  String get dealTlReleased;

  /// No description provided for @dealTlShipped.
  ///
  /// In ar, this message translates to:
  /// **'الشحن'**
  String get dealTlShipped;

  /// No description provided for @dealUnitPriceHint.
  ///
  /// In ar, this message translates to:
  /// **'سعر الوحدة بالجنيه'**
  String get dealUnitPriceHint;

  /// No description provided for @dealsActive.
  ///
  /// In ar, this message translates to:
  /// **'جارية'**
  String get dealsActive;

  /// No description provided for @dealsClosed.
  ///
  /// In ar, this message translates to:
  /// **'منتهية'**
  String get dealsClosed;

  /// No description provided for @declineDeal.
  ///
  /// In ar, this message translates to:
  /// **'رفض الصفقة'**
  String get declineDeal;

  /// No description provided for @deliveryCode.
  ///
  /// In ar, this message translates to:
  /// **'كود التسليم'**
  String get deliveryCode;

  /// No description provided for @enterDeliveryCode.
  ///
  /// In ar, this message translates to:
  /// **'إدخال كود التسليم'**
  String get enterDeliveryCode;

  /// No description provided for @haveInvitation.
  ///
  /// In ar, this message translates to:
  /// **'معايا رابط دعوة'**
  String get haveInvitation;

  /// No description provided for @howDealWorks.
  ///
  /// In ar, this message translates to:
  /// **'إزاي أضمن صفقة بتشتغل؟'**
  String get howDealWorks;

  /// No description provided for @howDealWorksBody.
  ///
  /// In ar, this message translates to:
  /// **'1. المشتري ينشئ الصفقة ويدعو البائع.\n2. البائع يرسل عرضه والمشتري يوافق.\n3. المشتري يدفع وأضمن يراجع الإيصال ويحجز المبلغ.\n4. البائع يشحن، والمشتري يعطيه كود التسليم.\n5. بعد الفحص والتأكيد يحوّل أضمن المبلغ للبائع.'**
  String get howDealWorksBody;

  /// No description provided for @inviteLinkHint.
  ///
  /// In ar, this message translates to:
  /// **'الصق رابط الدعوة'**
  String get inviteLinkHint;

  /// No description provided for @inviteLinkReady.
  ///
  /// In ar, this message translates to:
  /// **'رابط الدعوة جاهز — أرسله للبائع فقط'**
  String get inviteLinkReady;

  /// No description provided for @inviteSeller.
  ///
  /// In ar, this message translates to:
  /// **'دعوة البائع'**
  String get inviteSeller;

  /// No description provided for @joinDeal.
  ///
  /// In ar, this message translates to:
  /// **'الانضمام للصفقة'**
  String get joinDeal;

  /// No description provided for @joinDealBody.
  ///
  /// In ar, this message translates to:
  /// **'لو البائع أنت، الصق الرابط اللي وصلك من المشتري.'**
  String get joinDealBody;

  /// No description provided for @makeOffer.
  ///
  /// In ar, this message translates to:
  /// **'إرسال عرض'**
  String get makeOffer;

  /// No description provided for @markShippedDeal.
  ///
  /// In ar, this message translates to:
  /// **'تم الشحن'**
  String get markShippedDeal;

  /// No description provided for @newDeal.
  ///
  /// In ar, this message translates to:
  /// **'صفقة جديدة'**
  String get newDeal;

  /// No description provided for @newDeliveryCode.
  ///
  /// In ar, this message translates to:
  /// **'إرسال كود جديد'**
  String get newDeliveryCode;

  /// No description provided for @newInviteLink.
  ///
  /// In ar, this message translates to:
  /// **'رابط دعوة جديد'**
  String get newInviteLink;

  /// No description provided for @noActiveCode.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد كود تسليم نشط حاليًا.'**
  String get noActiveCode;

  /// No description provided for @noDeals.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد صفقات'**
  String get noDeals;

  /// No description provided for @offerSent.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال العرض'**
  String get offerSent;

  /// No description provided for @quantityHint.
  ///
  /// In ar, this message translates to:
  /// **'الكمية'**
  String get quantityHint;

  /// No description provided for @rejectChange.
  ///
  /// In ar, this message translates to:
  /// **'رفض التعديل'**
  String get rejectChange;

  /// No description provided for @rejectOffer.
  ///
  /// In ar, this message translates to:
  /// **'رفض العرض'**
  String get rejectOffer;

  /// No description provided for @rejectOfferConfirm.
  ///
  /// In ar, this message translates to:
  /// **'رفض العرض ينهي التفاوض على هذه الصفقة.'**
  String get rejectOfferConfirm;

  /// No description provided for @requestChange.
  ///
  /// In ar, this message translates to:
  /// **'طلب تعديل'**
  String get requestChange;

  /// No description provided for @reviewDeal.
  ///
  /// In ar, this message translates to:
  /// **'مراجعة الصفقة'**
  String get reviewDeal;

  /// No description provided for @revokeInvite.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء رابط الدعوة'**
  String get revokeInvite;

  /// No description provided for @sendOffer.
  ///
  /// In ar, this message translates to:
  /// **'إرسال العرض'**
  String get sendOffer;

  /// No description provided for @shipNoteHint.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل الشحن (الشركة، رقم البوليصة)'**
  String get shipNoteHint;

  /// No description provided for @showDeliveryCode.
  ///
  /// In ar, this message translates to:
  /// **'عرض كود التسليم'**
  String get showDeliveryCode;

  /// No description provided for @codeExpires.
  ///
  /// In ar, this message translates to:
  /// **'صالح حتى {time} · المحاولات المتبقية {attempts}'**
  String codeExpires(String time, int attempts);

  /// No description provided for @dealMoneyOffer.
  ///
  /// In ar, this message translates to:
  /// **'مبالغ العرض الحالي محسوبة من أضمن، وتصبح نهائية بعد موافقة الطرفين.'**
  String get dealMoneyOffer;

  /// No description provided for @dealMoneyIndicative.
  ///
  /// In ar, this message translates to:
  /// **'مبالغ تقديرية لحين وصول عرض البائع؛ الرسوم النهائية تُحسب عند الاتفاق.'**
  String get dealMoneyIndicative;

  /// No description provided for @dealAwaitingBuyer.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار رد المشتري'**
  String get dealAwaitingBuyer;

  /// No description provided for @dealAwaitingSeller.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار رد البائع'**
  String get dealAwaitingSeller;

  /// No description provided for @dealPartySeller.
  ///
  /// In ar, this message translates to:
  /// **'البائع'**
  String get dealPartySeller;

  /// No description provided for @dealPartyBuyer.
  ///
  /// In ar, this message translates to:
  /// **'المشتري'**
  String get dealPartyBuyer;

  /// No description provided for @termsProposed.
  ///
  /// In ar, this message translates to:
  /// **'مقترح'**
  String get termsProposed;

  /// No description provided for @termsAccepted.
  ///
  /// In ar, this message translates to:
  /// **'مقبول'**
  String get termsAccepted;

  /// No description provided for @termsRejected.
  ///
  /// In ar, this message translates to:
  /// **'مرفوض'**
  String get termsRejected;

  /// No description provided for @termsSuperseded.
  ///
  /// In ar, this message translates to:
  /// **'استُبدل بنسخة أحدث'**
  String get termsSuperseded;

  /// No description provided for @attachFile.
  ///
  /// In ar, this message translates to:
  /// **'إرفاق ملف'**
  String get attachFile;

  /// No description provided for @attachmentHint.
  ///
  /// In ar, this message translates to:
  /// **'صورة أو PDF (اختياري)'**
  String get attachmentHint;

  /// No description provided for @conversationReadOnly.
  ///
  /// In ar, this message translates to:
  /// **'المحادثة دي للقراءة بس دلوقتي.'**
  String get conversationReadOnly;

  /// No description provided for @dealConversation.
  ///
  /// In ar, this message translates to:
  /// **'محادثة الصفقة'**
  String get dealConversation;

  /// No description provided for @edmnTeam.
  ///
  /// In ar, this message translates to:
  /// **'فريق أضمن'**
  String get edmnTeam;

  /// No description provided for @filterAll.
  ///
  /// In ar, this message translates to:
  /// **'الكل'**
  String get filterAll;

  /// No description provided for @filterDeals.
  ///
  /// In ar, this message translates to:
  /// **'الصفقات'**
  String get filterDeals;

  /// No description provided for @filterOrders.
  ///
  /// In ar, this message translates to:
  /// **'الطلبات'**
  String get filterOrders;

  /// No description provided for @filterUnread.
  ///
  /// In ar, this message translates to:
  /// **'غير مقروءة'**
  String get filterUnread;

  /// No description provided for @helpWithDeal.
  ///
  /// In ar, this message translates to:
  /// **'مساعدة بخصوص الصفقة'**
  String get helpWithDeal;

  /// No description provided for @helpWithOrder.
  ///
  /// In ar, this message translates to:
  /// **'مساعدة بخصوص الطلب'**
  String get helpWithOrder;

  /// No description provided for @imageAttachment.
  ///
  /// In ar, this message translates to:
  /// **'صورة مرفقة'**
  String get imageAttachment;

  /// No description provided for @messageBuyer.
  ///
  /// In ar, this message translates to:
  /// **'مراسلة المشتري'**
  String get messageBuyer;

  /// No description provided for @messageHidden.
  ///
  /// In ar, this message translates to:
  /// **'الرسالة دي اتخفت بواسطة فريق أضمن'**
  String get messageHidden;

  /// No description provided for @messageNotSentRetry.
  ///
  /// In ar, this message translates to:
  /// **'الرسالة ما اتبعتتش. اضغط إرسال تاني، ومش هتتكرر.'**
  String get messageNotSentRetry;

  /// No description provided for @messageSeller.
  ///
  /// In ar, this message translates to:
  /// **'مراسلة البائع'**
  String get messageSeller;

  /// No description provided for @messages.
  ///
  /// In ar, this message translates to:
  /// **'الرسائل'**
  String get messages;

  /// No description provided for @messagesEvidenceNote.
  ///
  /// In ar, this message translates to:
  /// **'الرسائل للتواصل بس: أي تأكيد استلام أو تغيير في السعر لازم يتم من أزرار الطلب أو الصفقة. ما تبعتش بيانات دفع أو كلمات سر.'**
  String get messagesEvidenceNote;

  /// No description provided for @myTickets.
  ///
  /// In ar, this message translates to:
  /// **'تذاكري'**
  String get myTickets;

  /// No description provided for @newTicket.
  ///
  /// In ar, this message translates to:
  /// **'تذكرة جديدة'**
  String get newTicket;

  /// No description provided for @noConversations.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد محادثات'**
  String get noConversations;

  /// No description provided for @noConversationsBody.
  ///
  /// In ar, this message translates to:
  /// **'المحادثة بتتفتح من الطلب بعد تأكيد الدفع، أو من الصفقة بعد انضمام البائع.'**
  String get noConversationsBody;

  /// No description provided for @noTickets.
  ///
  /// In ar, this message translates to:
  /// **'مافيش تذاكر لحد دلوقتي'**
  String get noTickets;

  /// No description provided for @pdfAttachment.
  ///
  /// In ar, this message translates to:
  /// **'ملف PDF مرفق'**
  String get pdfAttachment;

  /// No description provided for @rateService.
  ///
  /// In ar, this message translates to:
  /// **'قيّم الخدمة'**
  String get rateService;

  /// No description provided for @ratingCommentHint.
  ///
  /// In ar, this message translates to:
  /// **'تعليق (اختياري)'**
  String get ratingCommentHint;

  /// No description provided for @reopenReasonHint.
  ///
  /// In ar, this message translates to:
  /// **'ليه عايز تعيد فتح التذكرة؟'**
  String get reopenReasonHint;

  /// No description provided for @reopenTicket.
  ///
  /// In ar, this message translates to:
  /// **'إعادة فتح التذكرة'**
  String get reopenTicket;

  /// No description provided for @replyReopensTicket.
  ///
  /// In ar, this message translates to:
  /// **'ردك هيعيد فتح التذكرة.'**
  String get replyReopensTicket;

  /// No description provided for @reportDataRequest.
  ///
  /// In ar, this message translates to:
  /// **'طلب بيانات مش محتاجها'**
  String get reportDataRequest;

  /// No description provided for @reportFraud.
  ///
  /// In ar, this message translates to:
  /// **'محاولة نصب'**
  String get reportFraud;

  /// No description provided for @reportInappropriate.
  ///
  /// In ar, this message translates to:
  /// **'محتوى غير لائق'**
  String get reportInappropriate;

  /// No description provided for @reportMessage.
  ///
  /// In ar, this message translates to:
  /// **'الإبلاغ عن الرسالة'**
  String get reportMessage;

  /// No description provided for @reportMessageBody.
  ///
  /// In ar, this message translates to:
  /// **'البلاغ بيوصل لفريق أضمن للمراجعة. محدش بيتعاقب تلقائيًا.'**
  String get reportMessageBody;

  /// No description provided for @reportNoteHint.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل إضافية (اختياري)'**
  String get reportNoteHint;

  /// No description provided for @reportOther.
  ///
  /// In ar, this message translates to:
  /// **'سبب آخر'**
  String get reportOther;

  /// No description provided for @reportSent.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال البلاغ'**
  String get reportSent;

  /// No description provided for @seenByOther.
  ///
  /// In ar, this message translates to:
  /// **'اتقرت'**
  String get seenByOther;

  /// No description provided for @send.
  ///
  /// In ar, this message translates to:
  /// **'إرسال'**
  String get send;

  /// No description provided for @sendReport.
  ///
  /// In ar, this message translates to:
  /// **'إرسال البلاغ'**
  String get sendReport;

  /// No description provided for @sendTicket.
  ///
  /// In ar, this message translates to:
  /// **'إرسال التذكرة'**
  String get sendTicket;

  /// No description provided for @sent.
  ///
  /// In ar, this message translates to:
  /// **'اتبعتت'**
  String get sent;

  /// No description provided for @startConversation.
  ///
  /// In ar, this message translates to:
  /// **'ابدأ المحادثة'**
  String get startConversation;

  /// No description provided for @storeMessages.
  ///
  /// In ar, this message translates to:
  /// **'رسائل المتجر'**
  String get storeMessages;

  /// No description provided for @supportIntro.
  ///
  /// In ar, this message translates to:
  /// **'فريق أضمن موجود يساعدك في الطلبات والدفع والصفقات والحساب.'**
  String get supportIntro;

  /// No description provided for @thanksForRating.
  ///
  /// In ar, this message translates to:
  /// **'شكرًا على تقييمك'**
  String get thanksForRating;

  /// No description provided for @ticketAboutThis.
  ///
  /// In ar, this message translates to:
  /// **'التذكرة هتترتبط بالطلب أو الصفقة اللي فتحتها منها.'**
  String get ticketAboutThis;

  /// No description provided for @ticketBody.
  ///
  /// In ar, this message translates to:
  /// **'اشرح المشكلة بالتفصيل'**
  String get ticketBody;

  /// No description provided for @ticketBodyShort.
  ///
  /// In ar, this message translates to:
  /// **'اشرح طلبك في 10 حروف على الأقل'**
  String get ticketBodyShort;

  /// No description provided for @ticketClosed.
  ///
  /// In ar, this message translates to:
  /// **'مغلقة'**
  String get ticketClosed;

  /// No description provided for @ticketEscalated.
  ///
  /// In ar, this message translates to:
  /// **'محوّلة لفريق متخصص'**
  String get ticketEscalated;

  /// No description provided for @ticketInProgress.
  ///
  /// In ar, this message translates to:
  /// **'جاري العمل عليها'**
  String get ticketInProgress;

  /// No description provided for @ticketOpen.
  ///
  /// In ar, this message translates to:
  /// **'مفتوحة'**
  String get ticketOpen;

  /// No description provided for @ticketPrivacyNote.
  ///
  /// In ar, this message translates to:
  /// **'ما تكتبش كلمة السر أو رقم البطاقة. فريق أضمن عمره ما هيطلبهم.'**
  String get ticketPrivacyNote;

  /// No description provided for @ticketResolved.
  ///
  /// In ar, this message translates to:
  /// **'تم الحل'**
  String get ticketResolved;

  /// No description provided for @ticketSent.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال التذكرة'**
  String get ticketSent;

  /// No description provided for @ticketSubject.
  ///
  /// In ar, this message translates to:
  /// **'الموضوع'**
  String get ticketSubject;

  /// No description provided for @ticketSubjectShort.
  ///
  /// In ar, this message translates to:
  /// **'اكتب موضوع واضح (5 حروف على الأقل)'**
  String get ticketSubjectShort;

  /// No description provided for @ticketTitle.
  ///
  /// In ar, this message translates to:
  /// **'تذكرة دعم'**
  String get ticketTitle;

  /// No description provided for @ticketType.
  ///
  /// In ar, this message translates to:
  /// **'نوع المشكلة'**
  String get ticketType;

  /// No description provided for @ticketTypeAccount.
  ///
  /// In ar, this message translates to:
  /// **'الحساب'**
  String get ticketTypeAccount;

  /// No description provided for @ticketTypeOrder.
  ///
  /// In ar, this message translates to:
  /// **'طلب'**
  String get ticketTypeOrder;

  /// No description provided for @ticketTypePayment.
  ///
  /// In ar, this message translates to:
  /// **'الدفع'**
  String get ticketTypePayment;

  /// No description provided for @ticketTypeProduct.
  ///
  /// In ar, this message translates to:
  /// **'منتج'**
  String get ticketTypeProduct;

  /// No description provided for @ticketTypeRefund.
  ///
  /// In ar, this message translates to:
  /// **'استرداد'**
  String get ticketTypeRefund;

  /// No description provided for @ticketTypeReturn.
  ///
  /// In ar, this message translates to:
  /// **'إرجاع'**
  String get ticketTypeReturn;

  /// No description provided for @ticketTypeSellerFinance.
  ///
  /// In ar, this message translates to:
  /// **'أرباح المتجر'**
  String get ticketTypeSellerFinance;

  /// No description provided for @ticketTypeShipping.
  ///
  /// In ar, this message translates to:
  /// **'الشحن'**
  String get ticketTypeShipping;

  /// No description provided for @ticketTypeTechnical.
  ///
  /// In ar, this message translates to:
  /// **'مشكلة تقنية'**
  String get ticketTypeTechnical;

  /// No description provided for @ticketWaitingSeller.
  ///
  /// In ar, this message translates to:
  /// **'في انتظار البائع'**
  String get ticketWaitingSeller;

  /// No description provided for @ticketWaitingYou.
  ///
  /// In ar, this message translates to:
  /// **'في انتظار ردك'**
  String get ticketWaitingYou;

  /// No description provided for @typeMessage.
  ///
  /// In ar, this message translates to:
  /// **'اكتب رسالتك'**
  String get typeMessage;

  /// No description provided for @writeReply.
  ///
  /// In ar, this message translates to:
  /// **'اكتب ردك'**
  String get writeReply;

  /// No description provided for @you.
  ///
  /// In ar, this message translates to:
  /// **'أنت'**
  String get you;

  /// No description provided for @maxAttachments.
  ///
  /// In ar, this message translates to:
  /// **'تقدر ترفق {count} ملفات بالكتير'**
  String maxAttachments(int count);

  /// No description provided for @faq.
  ///
  /// In ar, this message translates to:
  /// **'الأسئلة الشائعة'**
  String get faq;

  /// No description provided for @returnsPolicy.
  ///
  /// In ar, this message translates to:
  /// **'سياسة الإرجاع'**
  String get returnsPolicy;

  /// No description provided for @protectedDealTerms.
  ///
  /// In ar, this message translates to:
  /// **'شروط أضمن صفقة'**
  String get protectedDealTerms;

  /// No description provided for @accountHolderMustMatch.
  ///
  /// In ar, this message translates to:
  /// **'اسم صاحب الحساب لازم يطابق اسمك في التحقق من الهوية.'**
  String get accountHolderMustMatch;

  /// No description provided for @accountNeedsInfo.
  ///
  /// In ar, this message translates to:
  /// **'مطلوب معلومات'**
  String get accountNeedsInfo;

  /// No description provided for @accountNumberHint.
  ///
  /// In ar, this message translates to:
  /// **'رقم الحساب (اختياري لو كتبت الـ IBAN)'**
  String get accountNumberHint;

  /// No description provided for @accountRejected.
  ///
  /// In ar, this message translates to:
  /// **'مرفوض'**
  String get accountRejected;

  /// No description provided for @accountSubmitted.
  ///
  /// In ar, this message translates to:
  /// **'اتبعت للمراجعة. هيتفعّل بعد تحقق فريق أضمن.'**
  String get accountSubmitted;

  /// No description provided for @accountUnderReview.
  ///
  /// In ar, this message translates to:
  /// **'قيد المراجعة'**
  String get accountUnderReview;

  /// No description provided for @accountVerified.
  ///
  /// In ar, this message translates to:
  /// **'متحقق منه'**
  String get accountVerified;

  /// No description provided for @activityTestNotice.
  ///
  /// In ar, this message translates to:
  /// **'عملية تجريبية: الأموال الحقيقية مقفولة ومفيش فلوس اتحولت.'**
  String get activityTestNotice;

  /// No description provided for @addReceivingAccount.
  ///
  /// In ar, this message translates to:
  /// **'إضافة حساب استلام'**
  String get addReceivingAccount;

  /// No description provided for @amountEgpHint.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ بالجنيه'**
  String get amountEgpHint;

  /// No description provided for @amountInvalid.
  ///
  /// In ar, this message translates to:
  /// **'اكتب مبلغ صحيح (جنيه وقروش لحد رقمين)'**
  String get amountInvalid;

  /// No description provided for @availableToWithdraw.
  ///
  /// In ar, this message translates to:
  /// **'متاح للسحب'**
  String get availableToWithdraw;

  /// No description provided for @balanceAvailable.
  ///
  /// In ar, this message translates to:
  /// **'متاح'**
  String get balanceAvailable;

  /// No description provided for @balanceAvailableHint.
  ///
  /// In ar, this message translates to:
  /// **'تقدر تطلب سحبه دلوقتي'**
  String get balanceAvailableHint;

  /// No description provided for @balanceAwaitingRelease.
  ///
  /// In ar, this message translates to:
  /// **'مستحق وبانتظار الاعتماد'**
  String get balanceAwaitingRelease;

  /// No description provided for @balanceAwaitingReleaseHint.
  ///
  /// In ar, this message translates to:
  /// **'المشتري أكد، وفريق أضمن بيعتمد التحويل لرصيدك'**
  String get balanceAwaitingReleaseHint;

  /// No description provided for @balanceBreakdown.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل الرصيد'**
  String get balanceBreakdown;

  /// No description provided for @balanceBySource.
  ///
  /// In ar, this message translates to:
  /// **'حسب المصدر'**
  String get balanceBySource;

  /// No description provided for @balanceClaims.
  ///
  /// In ar, this message translates to:
  /// **'مطالبات مفتوحة'**
  String get balanceClaims;

  /// No description provided for @balanceClaimsHint.
  ///
  /// In ar, this message translates to:
  /// **'مطالبات نزاع/إرجاع مش مغطاة برصيد — مش فلوس'**
  String get balanceClaimsHint;

  /// No description provided for @balanceDebt.
  ///
  /// In ar, this message translates to:
  /// **'مديونية'**
  String get balanceDebt;

  /// No description provided for @balanceDebtHint.
  ///
  /// In ar, this message translates to:
  /// **'لازم تتسوّى قبل أي سحب'**
  String get balanceDebtHint;

  /// No description provided for @balanceHeld.
  ///
  /// In ar, this message translates to:
  /// **'محجوز'**
  String get balanceHeld;

  /// No description provided for @balanceHeldHint.
  ///
  /// In ar, this message translates to:
  /// **'بسبب نزاع أو مراجعة — مش قابل للسحب'**
  String get balanceHeldHint;

  /// No description provided for @balancePaidOut.
  ///
  /// In ar, this message translates to:
  /// **'اتحوّل لك'**
  String get balancePaidOut;

  /// No description provided for @balancePending.
  ///
  /// In ar, this message translates to:
  /// **'معلّق'**
  String get balancePending;

  /// No description provided for @balancePendingHint.
  ///
  /// In ar, this message translates to:
  /// **'اتدفع ولسه في فترة التوصيل أو رد المشتري'**
  String get balancePendingHint;

  /// No description provided for @balanceReserved.
  ///
  /// In ar, this message translates to:
  /// **'محجوز لطلب سحب'**
  String get balanceReserved;

  /// No description provided for @balanceReservedHint.
  ///
  /// In ar, this message translates to:
  /// **'طلب سحب اتعتمد ولسه بيتحوّل'**
  String get balanceReservedHint;

  /// No description provided for @bankNameHint.
  ///
  /// In ar, this message translates to:
  /// **'اسم البنك'**
  String get bankNameHint;

  /// No description provided for @checkAmount.
  ///
  /// In ar, this message translates to:
  /// **'مراجعة المبلغ'**
  String get checkAmount;

  /// No description provided for @dateLabel.
  ///
  /// In ar, this message translates to:
  /// **'التاريخ'**
  String get dateLabel;

  /// No description provided for @destDealsOnly.
  ///
  /// In ar, this message translates to:
  /// **'مستحقات الصفقات المحمية فقط'**
  String get destDealsOnly;

  /// No description provided for @destStoreAndDeals.
  ///
  /// In ar, this message translates to:
  /// **'حساب المتجر: المتجر + الصفقات'**
  String get destStoreAndDeals;

  /// No description provided for @destinationLabel.
  ///
  /// In ar, this message translates to:
  /// **'الوجهة'**
  String get destinationLabel;

  /// No description provided for @edmnFees.
  ///
  /// In ar, this message translates to:
  /// **'رسوم أضمن'**
  String get edmnFees;

  /// No description provided for @filterPayments.
  ///
  /// In ar, this message translates to:
  /// **'مدفوعات'**
  String get filterPayments;

  /// No description provided for @filterPayouts.
  ///
  /// In ar, this message translates to:
  /// **'سحب'**
  String get filterPayouts;

  /// No description provided for @filterRefunds.
  ///
  /// In ar, this message translates to:
  /// **'مستردات'**
  String get filterRefunds;

  /// No description provided for @financialStatement.
  ///
  /// In ar, this message translates to:
  /// **'كشف الحساب'**
  String get financialStatement;

  /// No description provided for @fundsByOrder.
  ///
  /// In ar, this message translates to:
  /// **'المبالغ حسب الطلب أو الصفقة'**
  String get fundsByOrder;

  /// No description provided for @holderNameFull.
  ///
  /// In ar, this message translates to:
  /// **'اسم صاحب الحساب كامل'**
  String get holderNameFull;

  /// No description provided for @ibanHint.
  ///
  /// In ar, this message translates to:
  /// **'IBAN (EG + 27 رقم)'**
  String get ibanHint;

  /// No description provided for @ledgerEntries.
  ///
  /// In ar, this message translates to:
  /// **'الحركات'**
  String get ledgerEntries;

  /// No description provided for @methodBank.
  ///
  /// In ar, this message translates to:
  /// **'تحويل بنكي'**
  String get methodBank;

  /// No description provided for @methodInstapay.
  ///
  /// In ar, this message translates to:
  /// **'إنستاباي'**
  String get methodInstapay;

  /// No description provided for @methodLabel.
  ///
  /// In ar, this message translates to:
  /// **'الطريقة'**
  String get methodLabel;

  /// No description provided for @methodWallet.
  ///
  /// In ar, this message translates to:
  /// **'محفظة موبايل'**
  String get methodWallet;

  /// No description provided for @noActivity.
  ///
  /// In ar, this message translates to:
  /// **'مفيش حركات لحد دلوقتي'**
  String get noActivity;

  /// No description provided for @noPayoutRequests.
  ///
  /// In ar, this message translates to:
  /// **'مفيش طلبات سحب'**
  String get noPayoutRequests;

  /// No description provided for @noPrepaidBalance.
  ///
  /// In ar, this message translates to:
  /// **'أضمن ما بيحتفظش برصيد مدفوع مقدمًا: الدفع بيكون لكل طلب أو صفقة، والمستردات بترجع لوسيلة الدفع الأصلية.'**
  String get noPrepaidBalance;

  /// No description provided for @noReceivingAccounts.
  ///
  /// In ar, this message translates to:
  /// **'مفيش حسابات استلام'**
  String get noReceivingAccounts;

  /// No description provided for @noteLabel.
  ///
  /// In ar, this message translates to:
  /// **'ملاحظة'**
  String get noteLabel;

  /// No description provided for @openFromHistory.
  ///
  /// In ar, this message translates to:
  /// **'افتح العملية من سجل المعاملات'**
  String get openFromHistory;

  /// No description provided for @payoutBlockDebt.
  ///
  /// In ar, this message translates to:
  /// **'عليك مديونية لازم تتسوّى قبل أي سحب.'**
  String get payoutBlockDebt;

  /// No description provided for @payoutBlockIdentity.
  ///
  /// In ar, this message translates to:
  /// **'لازم تتحقق من هويتك قبل طلب أي سحب.'**
  String get payoutBlockIdentity;

  /// No description provided for @payoutBlockNoAccount.
  ///
  /// In ar, this message translates to:
  /// **'أضف حساب استلام واستنى التحقق منه قبل السحب.'**
  String get payoutBlockNoAccount;

  /// No description provided for @payoutBlockNothing.
  ///
  /// In ar, this message translates to:
  /// **'مفيش رصيد متاح للسحب دلوقتي.'**
  String get payoutBlockNothing;

  /// No description provided for @payoutDestination.
  ///
  /// In ar, this message translates to:
  /// **'هيتحوّل على'**
  String get payoutDestination;

  /// No description provided for @payoutDoesNotFit.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ أكبر من المتاح للسحب على الوجهة دي.'**
  String get payoutDoesNotFit;

  /// No description provided for @payoutPreviewNote.
  ///
  /// In ar, this message translates to:
  /// **'ده تقدير من الخادم. التوزيع النهائي بيتحدد وقت الاعتماد.'**
  String get payoutPreviewNote;

  /// No description provided for @payoutRequestAlreadySent.
  ///
  /// In ar, this message translates to:
  /// **'الطلب ده اتسجل قبل كده'**
  String get payoutRequestAlreadySent;

  /// No description provided for @payoutRequestSent.
  ///
  /// In ar, this message translates to:
  /// **'تم استلام طلب السحب'**
  String get payoutRequestSent;

  /// No description provided for @payoutTestNotice.
  ///
  /// In ar, this message translates to:
  /// **'طلب تجريبي: الأموال الحقيقية مقفولة، ومفيش أي تحويل هيتم.'**
  String get payoutTestNotice;

  /// No description provided for @receivingAccounts.
  ///
  /// In ar, this message translates to:
  /// **'حسابات الاستلام'**
  String get receivingAccounts;

  /// No description provided for @receivingAccountsNote.
  ///
  /// In ar, this message translates to:
  /// **'أي حساب جديد بيتراجع من فريق أضمن قبل ما يستقبل فلوس.'**
  String get receivingAccountsNote;

  /// No description provided for @recentActivity.
  ///
  /// In ar, this message translates to:
  /// **'آخر الحركات'**
  String get recentActivity;

  /// No description provided for @referenceNumber.
  ///
  /// In ar, this message translates to:
  /// **'الرقم المرجعي'**
  String get referenceNumber;

  /// No description provided for @refundsTotal.
  ///
  /// In ar, this message translates to:
  /// **'مستردات'**
  String get refundsTotal;

  /// No description provided for @removeAccount.
  ///
  /// In ar, this message translates to:
  /// **'إيقاف الحساب'**
  String get removeAccount;

  /// No description provided for @removeAccountConfirm.
  ///
  /// In ar, this message translates to:
  /// **'مش هتقدر تستخدم الحساب ده تاني في طلبات جديدة.'**
  String get removeAccountConfirm;

  /// No description provided for @searchByReference.
  ///
  /// In ar, this message translates to:
  /// **'ابحث برقم الطلب أو المرجع'**
  String get searchByReference;

  /// No description provided for @sendPayoutRequest.
  ///
  /// In ar, this message translates to:
  /// **'إرسال طلب السحب'**
  String get sendPayoutRequest;

  /// No description provided for @sourceStore.
  ///
  /// In ar, this message translates to:
  /// **'مبيعات المتجر'**
  String get sourceStore;

  /// No description provided for @testTag.
  ///
  /// In ar, this message translates to:
  /// **'تجريبي'**
  String get testTag;

  /// No description provided for @totalSales.
  ///
  /// In ar, this message translates to:
  /// **'إجمالي المبيعات'**
  String get totalSales;

  /// No description provided for @transactionDetails.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل العملية'**
  String get transactionDetails;

  /// No description provided for @transactionHistory.
  ///
  /// In ar, this message translates to:
  /// **'سجل المعاملات'**
  String get transactionHistory;

  /// No description provided for @transferReference.
  ///
  /// In ar, this message translates to:
  /// **'مرجع التحويل'**
  String get transferReference;

  /// No description provided for @viewAll.
  ///
  /// In ar, this message translates to:
  /// **'عرض الكل'**
  String get viewAll;

  /// No description provided for @walletNumberHint.
  ///
  /// In ar, this message translates to:
  /// **'رقم المحفظة'**
  String get walletNumberHint;

  /// No description provided for @walletProviderHint.
  ///
  /// In ar, this message translates to:
  /// **'مزود المحفظة (فودافون كاش، اتصالات كاش…)'**
  String get walletProviderHint;

  /// No description provided for @walletTestNotice.
  ///
  /// In ar, this message translates to:
  /// **'أرصدة تجريبية: الأموال الحقيقية مقفولة، والمبالغ دي مش فلوس حقيقية قابلة للتحويل.'**
  String get walletTestNotice;

  /// No description provided for @activityPayment.
  ///
  /// In ar, this message translates to:
  /// **'دفع {ref}'**
  String activityPayment(String ref);

  /// No description provided for @activityRefund.
  ///
  /// In ar, this message translates to:
  /// **'استرداد {ref}'**
  String activityRefund(String ref);

  /// No description provided for @activityPayout.
  ///
  /// In ar, this message translates to:
  /// **'طلب سحب {ref}'**
  String activityPayout(String ref);

  /// No description provided for @orderRef.
  ///
  /// In ar, this message translates to:
  /// **'طلب {ref}'**
  String orderRef(String ref);

  /// No description provided for @payoutMinimum.
  ///
  /// In ar, this message translates to:
  /// **'الحد الأدنى {amount}'**
  String payoutMinimum(String amount);

  /// No description provided for @payoutRequestResult.
  ///
  /// In ar, this message translates to:
  /// **'رقم الطلب #{number}. فريق أضمن هيراجعه ويعتمده، ومفيش فلوس بتتحرك قبل الاعتماد.'**
  String payoutRequestResult(String number);

  /// No description provided for @payoutConfirmBody.
  ///
  /// In ar, this message translates to:
  /// **'هتطلب سحب {amount} على {destination}. الطلب بيتراجع ويتعتمد من فريق أضمن.'**
  String payoutConfirmBody(String amount, String destination);

  /// No description provided for @noEarningsYet.
  ///
  /// In ar, this message translates to:
  /// **'لسه مفيش مستحقات ليك. لما تبيع في متجرك أو كبائع في صفقة محمية، مستحقاتك هتظهر هنا.'**
  String get noEarningsYet;

  /// No description provided for @acceptRefundNote.
  ///
  /// In ar, this message translates to:
  /// **'القبول بيطلب استرداد للوحدات المرتجعة بسعر الشراء المسجل. فريق أضمن هو اللي بيعتمد ويحوّل.'**
  String get acceptRefundNote;

  /// No description provided for @acceptReturnRefund.
  ///
  /// In ar, this message translates to:
  /// **'قبول الإرجاع وطلب الاسترداد'**
  String get acceptReturnRefund;

  /// No description provided for @addEvidenceFile.
  ///
  /// In ar, this message translates to:
  /// **'إرفاق دليل'**
  String get addEvidenceFile;

  /// No description provided for @againstYou.
  ///
  /// In ar, this message translates to:
  /// **'مفتوح عليك'**
  String get againstYou;

  /// No description provided for @approveReturn.
  ///
  /// In ar, this message translates to:
  /// **'الموافقة على الإرجاع'**
  String get approveReturn;

  /// No description provided for @buyerParty.
  ///
  /// In ar, this message translates to:
  /// **'المشتري'**
  String get buyerParty;

  /// No description provided for @chooseItemToReturn.
  ///
  /// In ar, this message translates to:
  /// **'اختار منتج واحد على الأقل وكميته'**
  String get chooseItemToReturn;

  /// No description provided for @chooseReason.
  ///
  /// In ar, this message translates to:
  /// **'اختار السبب'**
  String get chooseReason;

  /// No description provided for @claimedAmount.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ المطلوب'**
  String get claimedAmount;

  /// No description provided for @contactSupportAboutDispute.
  ///
  /// In ar, this message translates to:
  /// **'تواصل مع الدعم بخصوص النزاع'**
  String get contactSupportAboutDispute;

  /// No description provided for @decFullRefund.
  ///
  /// In ar, this message translates to:
  /// **'استرداد كامل'**
  String get decFullRefund;

  /// No description provided for @decPartialRefund.
  ///
  /// In ar, this message translates to:
  /// **'استرداد جزئي'**
  String get decPartialRefund;

  /// No description provided for @decRejectClaim.
  ///
  /// In ar, this message translates to:
  /// **'رفض المطالبة'**
  String get decRejectClaim;

  /// No description provided for @decReleaseToSeller.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ للبائع'**
  String get decReleaseToSeller;

  /// No description provided for @decReplacement.
  ///
  /// In ar, this message translates to:
  /// **'استبدال المنتج'**
  String get decReplacement;

  /// No description provided for @decReturnRequired.
  ///
  /// In ar, this message translates to:
  /// **'مطلوب إرجاع المنتج'**
  String get decReturnRequired;

  /// No description provided for @describeMore.
  ///
  /// In ar, this message translates to:
  /// **'اشرح السبب في 10 حروف على الأقل'**
  String get describeMore;

  /// No description provided for @describeMore20.
  ///
  /// In ar, this message translates to:
  /// **'احكي اللي حصل في 20 حرف على الأقل'**
  String get describeMore20;

  /// No description provided for @disputeConversation.
  ///
  /// In ar, this message translates to:
  /// **'الردود'**
  String get disputeConversation;

  /// No description provided for @disputeDescriptionHint.
  ///
  /// In ar, this message translates to:
  /// **'احكي اللي حصل بالتفصيل'**
  String get disputeDescriptionHint;

  /// No description provided for @disputeFreezeNote.
  ///
  /// In ar, this message translates to:
  /// **'طول ما النزاع مفتوح، مستحقات البائع عن الطلب ده بتفضل متجمّدة لحد ما فريق أضمن ياخد قراره.'**
  String get disputeFreezeNote;

  /// No description provided for @disputeFundsFrozen.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ المتعلق بالنزاع متجمّد لحد قرار فريق أضمن.'**
  String get disputeFundsFrozen;

  /// No description provided for @disputeLabel.
  ///
  /// In ar, this message translates to:
  /// **'نزاع'**
  String get disputeLabel;

  /// No description provided for @disputeOpened.
  ///
  /// In ar, this message translates to:
  /// **'تم فتح النزاع'**
  String get disputeOpened;

  /// No description provided for @disputeReasonTitle.
  ///
  /// In ar, this message translates to:
  /// **'نوع المشكلة'**
  String get disputeReasonTitle;

  /// No description provided for @disputeTryFirst.
  ///
  /// In ar, this message translates to:
  /// **'جرّب الأول تتواصل مع البائع أو تطلب إرجاع. لو المشكلة ما اتحلتش، افتح نزاع.'**
  String get disputeTryFirst;

  /// No description provided for @drNotReceived.
  ///
  /// In ar, this message translates to:
  /// **'ما استلمتش الطلب'**
  String get drNotReceived;

  /// No description provided for @drSellerUnresponsive.
  ///
  /// In ar, this message translates to:
  /// **'البائع مش بيرد'**
  String get drSellerUnresponsive;

  /// No description provided for @dspAwaitingInfo.
  ///
  /// In ar, this message translates to:
  /// **'مطلوب معلومات'**
  String get dspAwaitingInfo;

  /// No description provided for @dspClosed.
  ///
  /// In ar, this message translates to:
  /// **'مغلق'**
  String get dspClosed;

  /// No description provided for @dspOpen.
  ///
  /// In ar, this message translates to:
  /// **'مفتوح'**
  String get dspOpen;

  /// No description provided for @dspResolved.
  ///
  /// In ar, this message translates to:
  /// **'صدر القرار'**
  String get dspResolved;

  /// No description provided for @dspUnderReview.
  ///
  /// In ar, this message translates to:
  /// **'قيد المراجعة'**
  String get dspUnderReview;

  /// No description provided for @edmnDecision.
  ///
  /// In ar, this message translates to:
  /// **'قرار فريق أضمن'**
  String get edmnDecision;

  /// No description provided for @escalateHint.
  ///
  /// In ar, this message translates to:
  /// **'اشرح ليه محتاج فريق أضمن يتدخل'**
  String get escalateHint;

  /// No description provided for @escalateToEdmn.
  ///
  /// In ar, this message translates to:
  /// **'تحويل لفريق أضمن (نزاع)'**
  String get escalateToEdmn;

  /// No description provided for @evidenceTitle.
  ///
  /// In ar, this message translates to:
  /// **'الأدلة'**
  String get evidenceTitle;

  /// No description provided for @iShippedItBack.
  ///
  /// In ar, this message translates to:
  /// **'بعت المنتج للبائع'**
  String get iShippedItBack;

  /// No description provided for @includeShippingRefund.
  ///
  /// In ar, this message translates to:
  /// **'استرداد مصاريف الشحن كمان'**
  String get includeShippingRefund;

  /// No description provided for @markReturnReceived.
  ///
  /// In ar, this message translates to:
  /// **'استلمت المنتج المرتجع'**
  String get markReturnReceived;

  /// No description provided for @myDisputes.
  ///
  /// In ar, this message translates to:
  /// **'النزاعات'**
  String get myDisputes;

  /// No description provided for @myReturns.
  ///
  /// In ar, this message translates to:
  /// **'طلبات الإرجاع'**
  String get myReturns;

  /// No description provided for @noDisputes.
  ///
  /// In ar, this message translates to:
  /// **'مفيش نزاعات'**
  String get noDisputes;

  /// No description provided for @noMessagesYet.
  ///
  /// In ar, this message translates to:
  /// **'لسه مفيش ردود'**
  String get noMessagesYet;

  /// No description provided for @noReturns.
  ///
  /// In ar, this message translates to:
  /// **'مفيش طلبات إرجاع'**
  String get noReturns;

  /// No description provided for @openDispute.
  ///
  /// In ar, this message translates to:
  /// **'فتح نزاع'**
  String get openDispute;

  /// No description provided for @orderRefLabel.
  ///
  /// In ar, this message translates to:
  /// **'طلب'**
  String get orderRefLabel;

  /// No description provided for @photosRequired.
  ///
  /// In ar, this message translates to:
  /// **'ارفع صور توضّح المشكلة'**
  String get photosRequired;

  /// No description provided for @publishReview.
  ///
  /// In ar, this message translates to:
  /// **'نشر التقييم'**
  String get publishReview;

  /// No description provided for @rateProducts.
  ///
  /// In ar, this message translates to:
  /// **'قيّم المنتجات'**
  String get rateProducts;

  /// No description provided for @reasonWindowClosed.
  ///
  /// In ar, this message translates to:
  /// **'انتهت مدة الإرجاع لهذا السبب'**
  String get reasonWindowClosed;

  /// No description provided for @refundByEdmnNote.
  ///
  /// In ar, this message translates to:
  /// **'الاسترداد بيتعتمد ويتحوّل من فريق أضمن لوسيلة الدفع الأصلية — مش من التطبيق.'**
  String get refundByEdmnNote;

  /// No description provided for @refundRequested.
  ///
  /// In ar, this message translates to:
  /// **'تم طلب الاسترداد'**
  String get refundRequested;

  /// No description provided for @rejectReasonHint.
  ///
  /// In ar, this message translates to:
  /// **'سبب الرفض (بيظهر للمشتري)'**
  String get rejectReasonHint;

  /// No description provided for @rejectReturn.
  ///
  /// In ar, this message translates to:
  /// **'رفض الإرجاع'**
  String get rejectReturn;

  /// No description provided for @requestReturn.
  ///
  /// In ar, this message translates to:
  /// **'طلب إرجاع'**
  String get requestReturn;

  /// No description provided for @restockItems.
  ///
  /// In ar, this message translates to:
  /// **'رجّع الكمية للمخزون'**
  String get restockItems;

  /// No description provided for @retApproved.
  ///
  /// In ar, this message translates to:
  /// **'اتقبل'**
  String get retApproved;

  /// No description provided for @retDisputed.
  ///
  /// In ar, this message translates to:
  /// **'محوّل لفريق أضمن'**
  String get retDisputed;

  /// No description provided for @retInTransit.
  ///
  /// In ar, this message translates to:
  /// **'في الطريق للبائع'**
  String get retInTransit;

  /// No description provided for @retReceived.
  ///
  /// In ar, this message translates to:
  /// **'البائع استلم'**
  String get retReceived;

  /// No description provided for @retRefundPending.
  ///
  /// In ar, this message translates to:
  /// **'الاسترداد قيد الاعتماد'**
  String get retRefundPending;

  /// No description provided for @retRefunded.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ اترد'**
  String get retRefunded;

  /// No description provided for @retRejected.
  ///
  /// In ar, this message translates to:
  /// **'مرفوض'**
  String get retRejected;

  /// No description provided for @retRequested.
  ///
  /// In ar, this message translates to:
  /// **'تم الطلب'**
  String get retRequested;

  /// No description provided for @returnDescriptionHint.
  ///
  /// In ar, this message translates to:
  /// **'اشرح سبب الإرجاع بالتفصيل'**
  String get returnDescriptionHint;

  /// No description provided for @returnLabel.
  ///
  /// In ar, this message translates to:
  /// **'إرجاع'**
  String get returnLabel;

  /// No description provided for @returnNotDelivered.
  ///
  /// In ar, this message translates to:
  /// **'تقدر تطلب الإرجاع بعد ما تأكّد استلام الطلب.'**
  String get returnNotDelivered;

  /// No description provided for @returnNothingLeft.
  ///
  /// In ar, this message translates to:
  /// **'كل الوحدات في الطلب ده اترجعت أو عليها طلب إرجاع.'**
  String get returnNothingLeft;

  /// No description provided for @returnReason.
  ///
  /// In ar, this message translates to:
  /// **'سبب الإرجاع'**
  String get returnReason;

  /// No description provided for @returnRefundNote.
  ///
  /// In ar, this message translates to:
  /// **'لو الإرجاع اتقبل، الاسترداد بيتعتمد من فريق أضمن ويرجع لوسيلة الدفع الأصلية.'**
  String get returnRefundNote;

  /// No description provided for @returnRequestSent.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال طلب الإرجاع'**
  String get returnRequestSent;

  /// No description provided for @returnShipBuyerPays.
  ///
  /// In ar, this message translates to:
  /// **'مصاريف شحن المرتجع على المشتري'**
  String get returnShipBuyerPays;

  /// No description provided for @returnShipByReason.
  ///
  /// In ar, this message translates to:
  /// **'مصاريف الشحن حسب السبب: على البائع لو المنتج معيب أو مختلف'**
  String get returnShipByReason;

  /// No description provided for @returnShipSellerPays.
  ///
  /// In ar, this message translates to:
  /// **'مصاريف شحن المرتجع على البائع'**
  String get returnShipSellerPays;

  /// No description provided for @returnWindowClosed.
  ///
  /// In ar, this message translates to:
  /// **'انتهت مدة الإرجاع. لو المنتج معيب، تقدر تفتح نزاع.'**
  String get returnWindowClosed;

  /// No description provided for @returnWindowTitle.
  ///
  /// In ar, this message translates to:
  /// **'مدة الإرجاع'**
  String get returnWindowTitle;

  /// No description provided for @returnedItems.
  ///
  /// In ar, this message translates to:
  /// **'المنتجات المرتجعة'**
  String get returnedItems;

  /// No description provided for @reviewAfterDelivery.
  ///
  /// In ar, this message translates to:
  /// **'التقييم متاح بعد استلام الطلب.'**
  String get reviewAfterDelivery;

  /// No description provided for @reviewBodyHint.
  ///
  /// In ar, this message translates to:
  /// **'اكتب رأيك (اختياري)'**
  String get reviewBodyHint;

  /// No description provided for @reviewPublished.
  ///
  /// In ar, this message translates to:
  /// **'تم نشر التقييم'**
  String get reviewPublished;

  /// No description provided for @reviewTitleHint.
  ///
  /// In ar, this message translates to:
  /// **'عنوان التقييم (اختياري)'**
  String get reviewTitleHint;

  /// No description provided for @reviewVerifiedNote.
  ///
  /// In ar, this message translates to:
  /// **'التقييم متاح بس للمشتري الفعلي، ومرة واحدة لكل منتج ولكل طلب.'**
  String get reviewVerifiedNote;

  /// No description provided for @reviewed.
  ///
  /// In ar, this message translates to:
  /// **'اتقيّم'**
  String get reviewed;

  /// No description provided for @rrChangedMind.
  ///
  /// In ar, this message translates to:
  /// **'غيرت رأيي'**
  String get rrChangedMind;

  /// No description provided for @rrCounterfeit.
  ///
  /// In ar, this message translates to:
  /// **'شاكك إنه مش أصلي'**
  String get rrCounterfeit;

  /// No description provided for @rrDamaged.
  ///
  /// In ar, this message translates to:
  /// **'وصل تالف'**
  String get rrDamaged;

  /// No description provided for @rrDefective.
  ///
  /// In ar, this message translates to:
  /// **'معيب / مش شغال'**
  String get rrDefective;

  /// No description provided for @rrMissingParts.
  ///
  /// In ar, this message translates to:
  /// **'ناقص أجزاء'**
  String get rrMissingParts;

  /// No description provided for @rrNotAsDescribed.
  ///
  /// In ar, this message translates to:
  /// **'مش مطابق للوصف'**
  String get rrNotAsDescribed;

  /// No description provided for @rrOther.
  ///
  /// In ar, this message translates to:
  /// **'سبب تاني'**
  String get rrOther;

  /// No description provided for @rrWrongItem.
  ///
  /// In ar, this message translates to:
  /// **'منتج مختلف'**
  String get rrWrongItem;

  /// No description provided for @sellerParty.
  ///
  /// In ar, this message translates to:
  /// **'البائع'**
  String get sellerParty;

  /// No description provided for @sendReturnRequest.
  ///
  /// In ar, this message translates to:
  /// **'إرسال طلب الإرجاع'**
  String get sendReturnRequest;

  /// No description provided for @shipBackTitle.
  ///
  /// In ar, this message translates to:
  /// **'ابعت المنتج على'**
  String get shipBackTitle;

  /// No description provided for @startInspection.
  ///
  /// In ar, this message translates to:
  /// **'بدء الفحص'**
  String get startInspection;

  /// No description provided for @storeDecision.
  ///
  /// In ar, this message translates to:
  /// **'قرار البائع'**
  String get storeDecision;

  /// No description provided for @storeDisputes.
  ///
  /// In ar, this message translates to:
  /// **'نزاعات المتجر'**
  String get storeDisputes;

  /// No description provided for @storeReturnRequests.
  ///
  /// In ar, this message translates to:
  /// **'مرتجعات المتجر'**
  String get storeReturnRequests;

  /// No description provided for @theClaim.
  ///
  /// In ar, this message translates to:
  /// **'المطالبة'**
  String get theClaim;

  /// No description provided for @viewDispute.
  ///
  /// In ar, this message translates to:
  /// **'عرض النزاع'**
  String get viewDispute;

  /// No description provided for @whichItems.
  ///
  /// In ar, this message translates to:
  /// **'هترجع إيه؟'**
  String get whichItems;

  /// No description provided for @writeReview.
  ///
  /// In ar, this message translates to:
  /// **'اكتب تقييم'**
  String get writeReview;

  /// No description provided for @youOpenedIt.
  ///
  /// In ar, this message translates to:
  /// **'أنت فتحته'**
  String get youOpenedIt;

  /// No description provided for @changeOfMindUntil.
  ///
  /// In ar, this message translates to:
  /// **'الإرجاع لأي سبب لحد {date}'**
  String changeOfMindUntil(String date);

  /// No description provided for @protectedUntil.
  ///
  /// In ar, this message translates to:
  /// **'المنتج المعيب أو المختلف لحد {date}'**
  String protectedUntil(String date);

  /// No description provided for @shippedBackWith.
  ///
  /// In ar, this message translates to:
  /// **'اتشحن مع {carrier} — رقم التتبع {tracking}'**
  String shippedBackWith(String carrier, String tracking);

  /// No description provided for @rateStore.
  ///
  /// In ar, this message translates to:
  /// **'قيّم المتجر {store}'**
  String rateStore(String store);

  /// No description provided for @evidenceLabel.
  ///
  /// In ar, this message translates to:
  /// **'صور أو مستندات (حتى {max})'**
  String evidenceLabel(int max);

  /// No description provided for @returnWindowBody.
  ///
  /// In ar, this message translates to:
  /// **'مدة الإرجاع {days} يوم من الاستلام (الحد القانوني {statutory} يوم).'**
  String returnWindowBody(int days, int statutory);

  /// No description provided for @returnableOf.
  ///
  /// In ar, this message translates to:
  /// **'متاح للإرجاع {n} من {total}'**
  String returnableOf(int n, int total);

  /// No description provided for @disputeClaimHint.
  ///
  /// In ar, this message translates to:
  /// **'المبلغ اللي بتطالب بيه بالجنيه (اختياري)'**
  String get disputeClaimHint;

  /// No description provided for @previousPage.
  ///
  /// In ar, this message translates to:
  /// **'الصفحة السابقة'**
  String get previousPage;

  /// No description provided for @downloadPdf.
  ///
  /// In ar, this message translates to:
  /// **'تنزيل ملف PDF'**
  String get downloadPdf;

  /// No description provided for @activityMoneyModeUnknown.
  ///
  /// In ar, this message translates to:
  /// **'نوع الأموال لهذه العملية القديمة غير متاح. راجع الدعم للتأكد.'**
  String get activityMoneyModeUnknown;

  /// No description provided for @payoutNetAmount.
  ///
  /// In ar, this message translates to:
  /// **'صافي المبلغ المتوقع استلامه'**
  String get payoutNetAmount;

  /// No description provided for @confirmPasswordHint.
  ///
  /// In ar, this message translates to:
  /// **'أكّد كلمة المرور الجديدة'**
  String get confirmPasswordHint;

  /// No description provided for @devicePushNote.
  ///
  /// In ar, this message translates to:
  /// **'إشعارات الموبايل الفورية (Push) لسه مش مفعّلة في التطبيق؛ الإعدادات دي بتتطبق على الإشعارات داخل التطبيق والإيميل، وعلى Push لما يتفعّل.'**
  String get devicePushNote;

  /// No description provided for @haveResetLink.
  ///
  /// In ar, this message translates to:
  /// **'معايا رابط إعادة التعيين'**
  String get haveResetLink;

  /// No description provided for @markAllRead.
  ///
  /// In ar, this message translates to:
  /// **'تعليم الكل كمقروء'**
  String get markAllRead;

  /// No description provided for @messageNotifications.
  ///
  /// In ar, this message translates to:
  /// **'تنبيهات الرسائل'**
  String get messageNotifications;

  /// No description provided for @noNotifications.
  ///
  /// In ar, this message translates to:
  /// **'مفيش إشعارات لحد دلوقتي'**
  String get noNotifications;

  /// No description provided for @noUnreadNotifications.
  ///
  /// In ar, this message translates to:
  /// **'مفيش إشعارات جديدة'**
  String get noUnreadNotifications;

  /// No description provided for @notificationSettings.
  ///
  /// In ar, this message translates to:
  /// **'إعدادات الإشعارات'**
  String get notificationSettings;

  /// No description provided for @passwordChangedBody.
  ///
  /// In ar, this message translates to:
  /// **'اتسجّل خروجك من كل الأجهزة. ادخل بكلمة المرور الجديدة.'**
  String get passwordChangedBody;

  /// No description provided for @passwordRules.
  ///
  /// In ar, this message translates to:
  /// **'8 حروف على الأقل، وفيها حروف وأرقام.'**
  String get passwordRules;

  /// No description provided for @passwordsDoNotMatch.
  ///
  /// In ar, this message translates to:
  /// **'كلمتين المرور مش متطابقين'**
  String get passwordsDoNotMatch;

  /// No description provided for @pasteResetLink.
  ///
  /// In ar, this message translates to:
  /// **'الصق رابط إعادة التعيين اللي وصلك'**
  String get pasteResetLink;

  /// No description provided for @prefEmail.
  ///
  /// In ar, this message translates to:
  /// **'إيميل لما ما أكونش متصل'**
  String get prefEmail;

  /// No description provided for @prefEmailHint.
  ///
  /// In ar, this message translates to:
  /// **'بعد فترة لو الرسالة ما اتقرتش'**
  String get prefEmailHint;

  /// No description provided for @prefInApp.
  ///
  /// In ar, this message translates to:
  /// **'داخل التطبيق'**
  String get prefInApp;

  /// No description provided for @prefPush.
  ///
  /// In ar, this message translates to:
  /// **'إشعارات Push'**
  String get prefPush;

  /// No description provided for @prefPushHint.
  ///
  /// In ar, this message translates to:
  /// **'على الأجهزة اللي فعّلتها'**
  String get prefPushHint;

  /// No description provided for @prefPushPreview.
  ///
  /// In ar, this message translates to:
  /// **'عرض نص الرسالة في الإشعار'**
  String get prefPushPreview;

  /// No description provided for @prefPushPreviewHint.
  ///
  /// In ar, this message translates to:
  /// **'مقفول افتراضيًا لحماية خصوصيتك'**
  String get prefPushPreviewHint;

  /// No description provided for @prefSound.
  ///
  /// In ar, this message translates to:
  /// **'صوت التنبيه'**
  String get prefSound;

  /// No description provided for @requestNewResetLink.
  ///
  /// In ar, this message translates to:
  /// **'اطلب رابط جديد'**
  String get requestNewResetLink;

  /// No description provided for @resetLinkInvalid.
  ///
  /// In ar, this message translates to:
  /// **'الرابط ده مش صحيح. الصق الرابط كامل زي ما وصلك.'**
  String get resetLinkInvalid;

  /// No description provided for @resetPasswordBody.
  ///
  /// In ar, this message translates to:
  /// **'اختار كلمة مرور جديدة. الرابط بيستخدم مرة واحدة وليه مدة صلاحية.'**
  String get resetPasswordBody;

  /// No description provided for @resetPasswordTitle.
  ///
  /// In ar, this message translates to:
  /// **'إعادة تعيين كلمة المرور'**
  String get resetPasswordTitle;

  /// No description provided for @saveNewPassword.
  ///
  /// In ar, this message translates to:
  /// **'حفظ كلمة المرور الجديدة'**
  String get saveNewPassword;

  /// No description provided for @securityNotificationsNote.
  ///
  /// In ar, this message translates to:
  /// **'إشعارات الأمان والطلبات والمدفوعات بتوصلك دايمًا ومش بتتقفل من هنا.'**
  String get securityNotificationsNote;

  /// No description provided for @unreadCount.
  ///
  /// In ar, this message translates to:
  /// **'غير مقروءة ({n})'**
  String unreadCount(int n);

  /// No description provided for @resetLinkExpired.
  ///
  /// In ar, this message translates to:
  /// **'الرابط ده انتهت صلاحيته أو اتستخدم قبل كده، أو اتطلب رابط أحدث منه. اطلب رابط جديد.'**
  String get resetLinkExpired;
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
