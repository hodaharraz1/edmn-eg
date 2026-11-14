/// Money is ALWAYS an integer number of piastres (1 EGP = 100 piastres), exactly as the API sends it. No `double`
/// ever touches an amount: formatting is done with integer arithmetic so 0.1 + 0.2 problems cannot exist.
class Money {
  const Money(this.piastres);
  final int piastres;

  Money operator +(Money other) => Money(piastres + other.piastres);
  Money operator -(Money other) => Money(piastres - other.piastres);
  bool get isZero => piastres == 0;

  @override
  bool operator ==(Object other) => other is Money && other.piastres == piastres;

  @override
  int get hashCode => piastres.hashCode;
}

/// Formats EGP the same way as the web (`formatEGP`): Western digits, `,` grouping, up to two decimals (trailing
/// zeros dropped unless [fixed]), followed by `ج.م` in Arabic or preceded by `EGP` in English. Null → `—`.
String formatEgp(int? piastres, {String languageCode = 'ar', bool fixed = false}) {
  if (piastres == null) return '—';
  final negative = piastres < 0;
  final abs = piastres.abs();
  final whole = abs ~/ 100;
  final cents = abs % 100;
  final grouped = _group(whole.toString());
  String frac;
  if (fixed) {
    frac = '.${cents.toString().padLeft(2, '0')}';
  } else if (cents == 0) {
    frac = '';
  } else if (cents % 10 == 0) {
    frac = '.${cents ~/ 10}';
  } else {
    frac = '.${cents.toString().padLeft(2, '0')}';
  }
  final number = '${negative ? '-' : ''}$grouped$frac';
  return languageCode == 'en' ? 'EGP $number' : '$number ج.م';
}

String _group(String digits) {
  final b = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) b.write(',');
    b.write(digits[i]);
  }
  return b.toString();
}
