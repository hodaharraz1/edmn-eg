import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'tokens.dart';

export 'tokens.dart';

/// Bundled font family (packaged fonts are addressed as `packages/<package>/<family>`).
const edmnFontFamily = 'packages/${EdmnType.package}/${EdmnType.fontFamily}';

/// The EDMN Market theme. Every Material default the board overrides is set here, so screens stay token-free.
ThemeData edmnTheme({Brightness brightness = Brightness.light}) {
  final scheme =
      ColorScheme.fromSeed(
        seedColor: EdmnColors.primary,
        brightness: brightness,
      ).copyWith(
        primary: EdmnColors.primary,
        onPrimary: EdmnColors.onPrimary,
        primaryContainer: EdmnColors.primaryLight,
        onPrimaryContainer: EdmnColors.primaryDark,
        secondary: EdmnColors.accentCyan,
        onSecondary: EdmnColors.onPrimary,
        tertiary: EdmnColors.brandRed,
        error: EdmnColors.error,
        onError: EdmnColors.onPrimary,
        surface: EdmnColors.surface,
        onSurface: EdmnColors.textPrimary,
        onSurfaceVariant: EdmnColors.textSecondary,
        outline: EdmnColors.border,
        outlineVariant: EdmnColors.border,
        surfaceContainerLowest: EdmnColors.surface,
        surfaceContainerLow: EdmnColors.subtle,
        surfaceContainer: EdmnColors.subtle,
        surfaceContainerHigh: EdmnColors.subtle,
      );

  TextStyle t(TextStyle s, [Color c = EdmnColors.textPrimary]) =>
      s.copyWith(color: c);
  final textTheme = TextTheme(
    headlineSmall: t(EdmnType.pageTitle),
    titleLarge: t(EdmnType.section),
    titleMedium: t(EdmnType.cardTitle),
    titleSmall: t(EdmnType.bodyStrong),
    bodyLarge: t(EdmnType.body),
    bodyMedium: t(EdmnType.body),
    bodySmall: t(EdmnType.secondary, EdmnColors.textSecondary),
    labelLarge: t(EdmnType.button),
    labelMedium: t(EdmnType.caption),
    labelSmall: t(EdmnType.caption, EdmnColors.textSecondary),
  );

  const stadium = StadiumBorder();
  final fieldBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(EdmnRadii.field),
    borderSide: const BorderSide(color: EdmnColors.border),
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: edmnFontFamily,
    textTheme: textTheme,
    scaffoldBackgroundColor: EdmnColors.background,
    dividerTheme: const DividerThemeData(
      color: EdmnColors.border,
      thickness: 1,
      space: 1,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: EdmnColors.primaryDark,
      foregroundColor: EdmnColors.onPrimary,
      centerTitle: true,
      elevation: 0,
      titleTextStyle: t(
        EdmnType.headerTitle,
        EdmnColors.onPrimary,
      ).copyWith(fontFamily: edmnFontFamily),
      systemOverlayStyle: SystemUiOverlayStyle.light,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: EdmnColors.surface,
      contentPadding: const EdgeInsetsDirectional.symmetric(
        horizontal: EdmnSpacing.md,
        vertical: 14,
      ),
      hintStyle: t(EdmnType.body, EdmnColors.textSecondary),
      prefixIconColor: EdmnColors.textPrimary,
      suffixIconColor: EdmnColors.textSecondary,
      border: fieldBorder,
      enabledBorder: fieldBorder,
      focusedBorder: fieldBorder.copyWith(
        borderSide: const BorderSide(color: EdmnColors.primary, width: 1.5),
      ),
      errorBorder: fieldBorder.copyWith(
        borderSide: const BorderSide(color: EdmnColors.error),
      ),
      focusedErrorBorder: fieldBorder.copyWith(
        borderSide: const BorderSide(color: EdmnColors.error, width: 1.5),
      ),
      disabledBorder: fieldBorder,
      errorStyle: t(EdmnType.secondary, EdmnColors.error),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(EdmnSizes.buttonHeight),
        shape: stadium,
        backgroundColor: EdmnColors.primary,
        foregroundColor: EdmnColors.onPrimary,
        disabledBackgroundColor: EdmnColors.border,
        disabledForegroundColor: EdmnColors.disabled,
        textStyle: EdmnType.button.copyWith(fontFamily: edmnFontFamily),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(EdmnSizes.secondaryButtonHeight),
        shape: stadium,
        foregroundColor: EdmnColors.primary,
        side: const BorderSide(color: EdmnColors.primary, width: 1.2),
        textStyle: EdmnType.button.copyWith(fontFamily: edmnFontFamily),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: EdmnColors.primary,
        textStyle: EdmnType.bodyStrong.copyWith(fontFamily: edmnFontFamily),
      ),
    ),
    radioTheme: RadioThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected)
            ? EdmnColors.primary
            : EdmnColors.disabled,
      ),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? EdmnColors.primary : null,
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: EdmnColors.primary,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: EdmnColors.textPrimary,
      contentTextStyle: t(EdmnType.body, EdmnColors.onPrimary),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(EdmnRadii.small),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: EdmnColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(EdmnRadii.sheet),
        ),
      ),
      showDragHandle: true,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: EdmnColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(EdmnRadii.card),
      ),
    ),
    chipTheme: ChipThemeData(
      shape: stadium,
      side: const BorderSide(color: EdmnColors.border),
      selectedColor: EdmnColors.primary,
      backgroundColor: EdmnColors.surface,
      labelStyle: t(
        EdmnType.bodyStrong,
        EdmnColors.primaryDark,
      ).copyWith(fontFamily: edmnFontFamily),
      secondaryLabelStyle: t(
        EdmnType.bodyStrong,
        EdmnColors.onPrimary,
      ).copyWith(fontFamily: edmnFontFamily),
      showCheckmark: false,
    ),
  );
}
