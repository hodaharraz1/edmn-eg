import 'package:flutter/material.dart';

/// EDMN Market design tokens — the ONLY place colors, spacing, radii, elevation and type sizes are defined.
///
/// Source of truth: the approved "EDMN Market — Approved Final UI Board" (design locked) and the original EDMN logo.
/// Brand colors are sampled from the logo; the UI tones follow the approved board. Screens never declare their own
/// colors or magic numbers — they use these tokens (enforced by `test/token_audit_test.dart` in the Customer App).
abstract final class EdmnColors {
  // Brand (from the original logo).
  static const primary = Color(0xFF1A57A1);
  static const primaryDark = Color(0xFF103F7D);
  static const primaryDeep = Color(
    0xFF0B2F63,
  ); // top of the header gradient on the board
  static const primaryLight = Color(0xFFE8F2FC);
  static const accentCyan = Color(0xFF1FA7E1);
  static const brandRed = Color(0xFFED181E);

  // Surfaces and text.
  static const background = Color(0xFFFFFFFF);
  static const surface = Color(0xFFFFFFFF);
  static const subtle = Color(0xFFF6F8FC);
  static const border = Color(0xFFE3EAF2);
  static const textPrimary = Color(0xFF17243B);
  static const textSecondary = Color(0xFF66758A);
  static const disabled = Color(0xFFA9B4C3);

  // Semantic (states only — never a screen's main color).
  static const success = Color(0xFF198754);
  static const successLight = Color(0xFFE6F4EC);
  static const warning = Color(0xFFB7791F);
  static const warningLight = Color(0xFFFDF3E1);
  static const error = Color(0xFFD92D20);
  static const errorLight = Color(0xFFFDECEA);
  static const infoLight = Color(0xFFE4F3FB);

  static const onPrimary = Color(0xFFFFFFFF);
  static const scrim = Color(0x6617243B);

  /// Header and hero gradient exactly as on the board (deep brand blue → brand blue). Used ONLY by [EdmnHeader],
  /// the splash/onboarding background and the wallet balance card — the places the board shows it.
  static const headerGradient = LinearGradient(
    begin: AlignmentDirectional.topStart,
    end: AlignmentDirectional.bottomEnd,
    colors: [primaryDeep, primaryDark, primary],
  );

  /* ── PKG-UI-01 sunburst home (reference video, 2026-11-26) ──
     The reference home is a bright yellow sunburst. These tokens are the ONLY place that palette is defined; the
     dark navy keeps text contrast on the yellow (navy on sunburst ≈ 13:1, well above the 4.5:1 minimum). */
  static const sunburst = Color(0xFFFFF38A); // ray yellow
  static const sunburstCore = Color(0xFFFFFBE0); // lighter center
  static const sunburstDeep = Color(0xFFFFDE33); // outer rays
  static const sunburstText = Color(0xFF1B2436); // text on yellow

  /// The green accent circle of the floating nav (reference center slot).
  static const accentGreen = Color(0xFF3AE24A);
  static const accentGreenDark = Color(0xFF12961F); // small green text/percent on white

  /// Promo red of the reference banners (هتبط فلال / الجمعة الصفراء).
  static const promoRed = Color(0xFFD40E14);
  static const promoYellow = Color(0xFFFFE135);

  /// Warm off-white screen background under the sunburst header.
  static const warmBackground = Color(0xFFFFFDF4);
}

/// 4px spacing scale. Allowed values: 4 / 8 / 12 / 16 / 20 / 24 / 32.
abstract final class EdmnSpacing {
  static const xxs = 4.0;
  static const xs = 8.0;
  static const sm = 12.0;
  static const md = 16.0;
  static const lg = 20.0;
  static const xl = 24.0;
  static const xxl = 32.0;

  /// Horizontal screen gutter.
  static const screen = md;
}

abstract final class EdmnRadii {
  static const chip = 999.0;
  static const button = 999.0; // the board's buttons are pill-shaped
  static const field = 24.0;
  static const card = 16.0;
  static const tile = 16.0;
  static const small = 10.0;
  static const sheet = 24.0;
}

abstract final class EdmnSizes {
  static const buttonHeight = 52.0;
  static const secondaryButtonHeight = 44.0;
  static const fieldHeight = 52.0;
  static const minTouch = 48.0;
  static const headerHeight = 64.0;
  static const bottomNavHeight = 68.0;
  static const iconSm = 18.0;
  static const icon = 22.0;
  static const iconLg = 28.0;
  static const avatar = 64.0;
  static const thumb = 56.0;
}

abstract final class EdmnShadows {
  /// Very soft card shadow (the board uses light borders plus a faint lift).
  static const card = [
    BoxShadow(color: Color(0x0F17243B), blurRadius: 12, offset: Offset(0, 4)),
  ];
  static const floating = [
    BoxShadow(color: Color(0x1F17243B), blurRadius: 20, offset: Offset(0, 6)),
  ];
}

/// Type scale (Cairo). Sizes from the directive; weights from the board.
abstract final class EdmnType {
  static const fontFamily = 'Cairo';
  static const package = 'edmn_design';

  static const pageTitle = TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.w700,
    height: 1.35,
  );
  static const headerTitle = TextStyle(
    fontSize: 20,
    fontWeight: FontWeight.w700,
    height: 1.35,
  );
  static const section = TextStyle(
    fontSize: 20,
    fontWeight: FontWeight.w700,
    height: 1.35,
  );
  static const cardTitle = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w600,
    height: 1.4,
  );
  static const body = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.5,
  );
  static const bodyStrong = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    height: 1.5,
  );
  static const secondary = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    height: 1.45,
  );
  static const caption = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w500,
    height: 1.4,
  );
  static const button = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    height: 1.2,
  );
  static const price = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w700,
    height: 1.2,
  );
  static const priceLarge = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.w700,
    height: 1.2,
  );
  static const balance = TextStyle(
    fontSize: 30,
    fontWeight: FontWeight.w800,
    height: 1.15,
  );
}

abstract final class EdmnMotion {
  static const fast = Duration(milliseconds: 150);
  static const normal = Duration(milliseconds: 250);
}
