// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'edmn_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class EdmnLocalizationsEn extends EdmnLocalizations {
  EdmnLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appNameCustomer => 'EDMN';

  @override
  String get appNameAdmin => 'EDMN Admin';

  @override
  String get retry => 'Try again';

  @override
  String get cancel => 'Cancel';

  @override
  String get confirm => 'Confirm';

  @override
  String get signIn => 'Sign in';

  @override
  String get signOut => 'Sign out';

  @override
  String get identifierLabel => 'Email or mobile number';

  @override
  String get passwordLabel => 'Password';

  @override
  String get fieldRequired => 'This field is required';

  @override
  String get home => 'Home';

  @override
  String get categories => 'Categories';

  @override
  String get searchHint => 'Search for a product';

  @override
  String get noResults => 'No results';

  @override
  String get inStock => 'In stock';

  @override
  String get outOfStock => 'Out of stock';

  @override
  String get account => 'My account';

  @override
  String get devices => 'Signed-in devices';

  @override
  String get thisDevice => 'This device';

  @override
  String get signOutDevice => 'Sign out this device';

  @override
  String get signOutOtherDevices => 'Sign out all other devices';

  @override
  String signedOutOthers(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Signed out of $count devices',
      one: 'Signed out of 1 device',
      zero: 'No other devices',
    );
    return '$_temp0';
  }

  @override
  String get testMoneyBanner =>
      'Test mode: payments are test-only and no real money moves';

  @override
  String get updateRequiredTitle => 'Update required';

  @override
  String get updateRequiredBody =>
      'This version of the app is no longer supported. Please update to continue.';

  @override
  String get mfaTitle => 'Two-step verification';

  @override
  String get mfaEnterCode =>
      'Enter the 6-digit code from your authenticator app';

  @override
  String get mfaEnrollHint =>
      'Add this account to your authenticator app with the key below, then enter the code';

  @override
  String get verify => 'Verify';

  @override
  String get permissions => 'Permissions';

  @override
  String get language => 'Language';

  @override
  String get errorValidation => 'Please check the information you entered';

  @override
  String get errorUnauthenticated =>
      'Your session ended or the sign-in details are incorrect. Please sign in again';

  @override
  String get errorForbidden => 'You are not allowed to do this';

  @override
  String get errorNotFound => 'We couldn\'t find what you\'re looking for';

  @override
  String get errorConflict =>
      'Something changed meanwhile. Refresh and try again';

  @override
  String get errorInvalidState => 'This action isn\'t available right now';

  @override
  String get errorInsufficientStock =>
      'The requested quantity isn\'t available';

  @override
  String get errorInsufficientBalance => 'Insufficient balance';

  @override
  String get errorRateLimited => 'Too many attempts. Please wait and try again';

  @override
  String get errorMfaRequired => 'Please complete two-step verification';

  @override
  String get errorStepUpRequired =>
      'Confirm it\'s you with a verification code first';

  @override
  String get errorIdentityRequired => 'Please verify your identity first';

  @override
  String get errorSellerRequired => 'This action is for sellers only';

  @override
  String get errorIdempotency =>
      'This request is already being processed or was completed';

  @override
  String get errorInternal => 'Something unexpected happened. Please try again';

  @override
  String errorReference(String reference) {
    return 'Reference: $reference';
  }

  @override
  String get errorNetwork =>
      'No internet connection. Check your network and try again';

  @override
  String get errorUnknown => 'Something went wrong. Please try again';
}
