import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _app(Widget child, {Locale locale = EdmnLocales.arabic}) => MaterialApp(
      locale: locale,
      supportedLocales: EdmnLocales.supported,
      localizationsDelegates: const [EdmnLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      theme: edmnTheme(),
      home: Scaffold(body: child),
    );

void main() {
  testWidgets('Arabic is the default and lays out right-to-left', (t) async {
    await t.pumpWidget(_app(const EgpText(125050)));
    expect(Directionality.of(t.element(find.byType(EgpText))), TextDirection.rtl);
    expect(find.text('1,250.5 ج.م'), findsOneWidget);
  });

  testWidgets('English lays out left-to-right with the English money format', (t) async {
    await t.pumpWidget(_app(const EgpText(125050), locale: EdmnLocales.english));
    expect(Directionality.of(t.element(find.byType(EgpText))), TextDirection.ltr);
    expect(find.text('EGP 1,250.5'), findsOneWidget);
  });

  testWidgets('every API error code has a localized message; internal errors show the support reference', (t) async {
    late BuildContext ctx;
    await t.pumpWidget(_app(Builder(builder: (c) {
      ctx = c;
      return const SizedBox();
    })));
    for (final code in ApiErrorCode.values) {
      expect(apiErrorMessage(ctx, ApiFailure(code: code)), isNotEmpty);
    }
    expect(apiErrorMessage(ctx, const ApiFailure(code: ApiErrorCode.rateLimited)), 'محاولات كتير. استنى شوية وجرّب تاني');
    expect(apiErrorMessage(ctx, const ApiFailure(code: ApiErrorCode.internalError, reference: 'REF-1')), contains('REF-1'));
  });

  test('locale resolution: saved choice, then device, then Arabic', () {
    expect(EdmnLocales.resolve(null, const [Locale('fr'), Locale('en', 'US')]), EdmnLocales.english);
    expect(EdmnLocales.resolve(null, const [Locale('fr')]), EdmnLocales.arabic);
    expect(EdmnLocales.resolve(const Locale('ar'), const [Locale('en')]), EdmnLocales.arabic);
  });
}
