import 'package:flutter/material.dart';

import '../tokens.dart';

/// The ORIGINAL EDMN logo (assets derived from the supplied logo file by cropping and, for dark backgrounds, recoloring
/// the dark-blue wordmark pixels to white — never redrawn). See docs/mobile/DESIGN_SYSTEM.md §Brand.
enum EdmnLogoVariant {
  /// Emblem + wordmark, for light backgrounds.
  full('edmn_logo'),

  /// Emblem + white wordmark, for the blue header / splash.
  onDark('edmn_logo_on_dark'),

  /// Wings + shield only.
  emblem('edmn_emblem'),
  wordmark('edmn_wordmark'),
  wordmarkOnDark('edmn_wordmark_on_dark');

  const EdmnLogoVariant(this.asset);
  final String asset;
}

class EdmnLogo extends StatelessWidget {
  const EdmnLogo({
    super.key,
    this.variant = EdmnLogoVariant.full,
    this.height = 96,
    this.semanticLabel = 'EDMN أضمن',
  });
  final EdmnLogoVariant variant;
  final double height;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) => Image.asset(
    'assets/brand/${variant.asset}.png',
    package: EdmnType.package,
    height: height,
    fit: BoxFit.contain,
    semanticLabel: semanticLabel,
    filterQuality: FilterQuality.medium,
  );
}

/// "أضمن ماركت" lockup as shown on the board: original logo + the product label "ماركت" in brand cyan.
/// The label is text, not part of the logo artwork (the supplied logo has no "ماركت" — recorded in VISUAL_AUDIT.md).
class EdmnMarketLockup extends StatelessWidget {
  const EdmnMarketLockup({
    super.key,
    required this.marketLabel,
    this.onDark = true,
    this.height = 120,
  });
  final String marketLabel;
  final bool onDark;
  final double height;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      EdmnLogo(
        variant: onDark ? EdmnLogoVariant.onDark : EdmnLogoVariant.full,
        height: height,
      ),
      Text(
        marketLabel,
        style: EdmnType.headerTitle.copyWith(color: EdmnColors.accentCyan),
      ),
    ],
  );
}
