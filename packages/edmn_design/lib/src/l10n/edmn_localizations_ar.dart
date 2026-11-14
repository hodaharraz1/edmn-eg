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
  String get categories => 'التصنيفات';

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
}
