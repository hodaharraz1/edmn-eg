import 'package:flutter/widgets.dart';

/// Arabic is the default (RTL); English is secondary (LTR). Text direction always follows the locale — screens never
/// hardcode left/right (use EdgeInsetsDirectional / AlignmentDirectional).
abstract final class EdmnLocales {
  static const arabic = Locale('ar', 'EG');
  static const english = Locale('en');
  static const supported = [arabic, english];
  static const fallback = arabic;

  /// Picks the user's saved choice, else the device language if supported, else Arabic.
  static Locale resolve(Locale? saved, List<Locale>? device) {
    if (saved != null) return saved.languageCode == 'en' ? english : arabic;
    for (final l in device ?? const <Locale>[]) {
      if (l.languageCode == 'ar') return arabic;
      if (l.languageCode == 'en') return english;
    }
    return fallback;
  }
}
