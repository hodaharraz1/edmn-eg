import 'package:flutter/material.dart';

import 'l10n/edmn_localizations.dart';
import 'tokens.dart';

export 'money_text.dart';

/// Shown on every screen while Real Money is OFF (value comes from the server's app config, never hardcoded).
class TestMoneyBanner extends StatelessWidget {
  const TestMoneyBanner({super.key});

  @override
  Widget build(BuildContext context) => Material(
    type: MaterialType.transparency,
    child: Container(
      width: double.infinity,
      color: EdmnColors.warningLight,
      padding: const EdgeInsetsDirectional.symmetric(
        horizontal: EdmnSpacing.md,
        vertical: EdmnSpacing.xxs,
      ),
      child: Text(
        EdmnLocalizations.of(context).testMoneyBanner,
        textAlign: TextAlign.center,
        style: EdmnType.caption.copyWith(
          color: EdmnColors.warning,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}
