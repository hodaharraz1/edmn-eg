import 'package:flutter/material.dart';

/// Brand tokens mirrored from the web (src/app/globals.css). Egyptian identity: EDMN blue + Egyptian red accent,
/// no Gulf palette or imagery.
abstract final class EdmnColors {
  static const brand950 = Color(0xFF061A3D);
  static const brand900 = Color(0xFF0A2A5E);
  static const brand700 = Color(0xFF0F3F8C);
  static const brand600 = Color(0xFF1452B3);
  static const brand500 = Color(0xFF1E66D0);
  static const brand100 = Color(0xFFE6EEFB);
  static const brand50 = Color(0xFFF3F7FD);
  static const accent600 = Color(0xFFD7263D);
  static const accent100 = Color(0xFFFDE6E9);
  static const ink = Color(0xFF0F172A);
}

/// Font stack of the web: IBM Plex Sans Arabic, falling back to the platform's Arabic font until the font files are
/// bundled (Phase 2 — fonts are an asset decision recorded in the brand document).
const _fontFallback = ['IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Roboto'];

ThemeData edmnTheme({Brightness brightness = Brightness.light}) {
  final scheme = ColorScheme.fromSeed(
    seedColor: EdmnColors.brand600,
    brightness: brightness,
    primary: brightness == Brightness.light ? EdmnColors.brand600 : EdmnColors.brand100,
    secondary: EdmnColors.accent600,
    error: EdmnColors.accent600,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamilyFallback: _fontFallback,
    scaffoldBackgroundColor: brightness == Brightness.light ? EdmnColors.brand50 : EdmnColors.brand950,
    appBarTheme: AppBarTheme(backgroundColor: scheme.surface, foregroundColor: scheme.onSurface, centerTitle: false),
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48))),
  );
}
