import 'package:flutter/material.dart';

import 'l10n/edmn_localizations.dart';
import 'tokens.dart';

export 'money_text.dart';

/// In-flow notice for money steps while Real Money is OFF (payment, deal payment, wallet, payout requests). The app
/// passes the server's flag; it is never shown app-wide. Says plainly that no real money moves.
class EdmnTestMoneyNotice extends StatelessWidget {
  const EdmnTestMoneyNotice({super.key, this.message});

  /// Step-specific wording; defaults to the generic TEST-money sentence.
  final String? message;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    child: Container(
      key: const Key('test-money-notice'),
      width: double.infinity,
      padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
      decoration: BoxDecoration(
        color: EdmnColors.warningLight,
        borderRadius: BorderRadius.circular(EdmnRadii.small),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.science_outlined, color: EdmnColors.warning, size: 20),
          const SizedBox(width: EdmnSpacing.xs),
          Expanded(
            child: Text(
              message ?? EdmnLocalizations.of(context).testMoneyBanner,
              style: EdmnType.secondary.copyWith(color: EdmnColors.warning, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    ),
  );
}
