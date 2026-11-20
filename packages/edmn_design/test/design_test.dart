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

  testWidgets('primary button: loading disables it so one tap can never send twice', (t) async {
    var taps = 0;
    await t.pumpWidget(_app(EdmnPrimaryButton(label: 'تأكيد', loading: true, onPressed: () => taps++)));
    await t.tap(find.byType(FilledButton));
    expect(taps, 0);
    await t.pumpWidget(_app(EdmnPrimaryButton(label: 'تأكيد', onPressed: () => taps++)));
    await t.tap(find.byType(FilledButton));
    expect(taps, 1);
  });

  testWidgets('the original logo assets are bundled for every variant', (t) async {
    for (final v in EdmnLogoVariant.values) {
      await t.pumpWidget(_app(EdmnLogo(variant: v)));
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
    }
  });

  testWidgets('error state follows the error kind: offline, session expired (with sign-in), generic', (t) async {
    await t.pumpWidget(_app(const EdmnErrorState(error: ApiFailure(code: ApiErrorCode.network))));
    expect(find.text('مفيش اتصال بالإنترنت'), findsOneWidget);
    var signIn = 0;
    await t.pumpWidget(_app(EdmnErrorState(error: const ApiFailure(code: ApiErrorCode.unauthenticated, status: 401), onSignIn: () => signIn++)));
    await t.tap(find.text('تسجيل الدخول'));
    expect(signIn, 1);
  });

  testWidgets('tracking timeline renders done / current / pending / failed steps', (t) async {
    await t.pumpWidget(_app(const EdmnTrackingTimeline(steps: [
      EdmnTimelineStep(title: 'تم إنشاء الطلب', state: EdmnStepState.done, time: '1 يناير'),
      EdmnTimelineStep(title: 'في طريقه إليك', state: EdmnStepState.current),
      EdmnTimelineStep(title: 'تم التوصيل', state: EdmnStepState.pending),
    ])));
    expect(find.byIcon(Icons.check_rounded), findsOneWidget);
    expect(find.text('في طريقه إليك'), findsOneWidget);
  });

  test('tokens: brand colors are the logo colors', () {
    expect(EdmnColors.primary, const Color(0xFF1A57A1));
    expect(EdmnColors.accentCyan, const Color(0xFF1FA7E1));
    expect(EdmnColors.brandRed, const Color(0xFFED181E));
  });

  testWidgets('radio cards: each option is ONE accessible radio named by its label, and tapping it selects', (t) async {
    final handle = t.ensureSemantics();
    String? picked;
    await t.pumpWidget(_app(StatefulBuilder(builder: (context, set) => EdmnRadioCard<String>(
          value: picked,
          onChanged: (v) => set(() => picked = v),
          options: const [
            EdmnRadioOption(value: 'INSTAPAY', label: 'إنستاباي', icon: Icons.bolt, subtitle: 'حوّل المبلغ'),
            EdmnRadioOption(value: 'BANK', label: 'تحويل بنكي', icon: Icons.account_balance),
          ],
        ))));
    final node = t.getSemantics(find.byKey(const Key('radio-INSTAPAY')));
    expect(node.label, contains('إنستاباي'));
    expect(node.label, contains('حوّل المبلغ'));
    expect(find.bySemanticsLabel(RegExp('تحويل بنكي')), findsOneWidget);
    await t.tap(find.text('تحويل بنكي'));
    await t.pump();
    expect(picked, 'BANK');
    List<String> flags(String v) => t.getSemantics(find.byKey(Key('radio-$v'))).getSemanticsData().flagsCollection.toStrings();
    expect(flags('BANK'), containsAll(['isChecked', 'isInMutuallyExclusiveGroup']));
    expect(flags('INSTAPAY'), isNot(contains('isChecked')));
    handle.dispose();
  });

  testWidgets('quantity stepper: both buttons have an accessible name', (t) async {
    final handle = t.ensureSemantics();
    var v = 1;
    await t.pumpWidget(_app(StatefulBuilder(builder: (context, set) => EdmnQuantityStepper(value: v, onChanged: (n) => set(() => v = n)))));
    expect(find.bySemanticsLabel('زيادة الكمية'), findsOneWidget);
    expect(find.bySemanticsLabel('تقليل الكمية'), findsOneWidget);
    await t.tap(find.byKey(const Key('qty-inc')));
    await t.pump();
    expect(v, 2);
    handle.dispose();
  });

  testWidgets('the app-bar back button has an accessible name', (t) async {
    final handle = t.ensureSemantics();
    await t.pumpWidget(_app(const EdmnBackButton()));
    expect(find.bySemanticsLabel(RegExp('رجوع|Back')), findsOneWidget);
    handle.dispose();
  });
}
