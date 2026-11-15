import 'package:edmn_core/edmn_core.dart';
import 'package:flutter/widgets.dart';

/// Price in EGP from integer piastres (server values only), formatted for the current language. Always LTR digits.
class EgpText extends StatelessWidget {
  const EgpText(
    this.piastres, {
    super.key,
    this.style,
    this.signed = false,
    this.textAlign,
  });
  final int? piastres;
  final TextStyle? style;
  final TextAlign? textAlign;

  /// Prefix credits with "+" (wallet history). Debits already carry "-".
  final bool signed;

  @override
  Widget build(BuildContext context) {
    final text = formatEgp(
      piastres,
      languageCode: Localizations.localeOf(context).languageCode,
    );
    return Text(
      signed && (piastres ?? 0) > 0 ? '+$text' : text,
      style: style,
      textAlign: textAlign,
      maxLines: 1,
    );
  }
}
