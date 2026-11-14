import 'package:edmn_core/edmn_core.dart';
import 'package:flutter/material.dart';

import 'errors.dart';
import 'l10n/edmn_localizations.dart';
import 'theme.dart';

/// Price in EGP from integer piastres, formatted for the current language.
class EgpText extends StatelessWidget {
  const EgpText(this.piastres, {super.key, this.style});
  final int? piastres;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) => Text(formatEgp(piastres, languageCode: Localizations.localeOf(context).languageCode), style: style);
}

/// Error state with a localized message and a retry action.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsetsDirectional.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.error_outline, size: 40),
            const SizedBox(height: 12),
            Text(apiErrorMessage(context, error), textAlign: TextAlign.center),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              OutlinedButton(onPressed: onRetry, child: Text(EdmnLocalizations.of(context).retry)),
            ],
          ]),
        ),
      );
}

/// Shown on every screen while Real Money is OFF (value comes from the server's app config, never hardcoded).
class TestMoneyBanner extends StatelessWidget {
  const TestMoneyBanner({super.key});

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        color: EdmnColors.accent100,
        padding: const EdgeInsetsDirectional.symmetric(horizontal: 16, vertical: 8),
        child: Text(EdmnLocalizations.of(context).testMoneyBanner, style: const TextStyle(color: EdmnColors.accent600, fontWeight: FontWeight.w600)),
      );
}
