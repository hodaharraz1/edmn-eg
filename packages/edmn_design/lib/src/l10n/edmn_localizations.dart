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
  /// **'التصنيفات'**
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
