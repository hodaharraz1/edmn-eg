import 'package:edmn_design/edmn_design.dart';
import 'package:edmn_customer/src/features/postpurchase/postpurchase_screens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // Regression guard for the final-review a11y finding: rating stars must announce a localized,
  // meaningful label ("3 من 5 نجوم" / "3 of 5 stars"), never a bare number.
  test('starRatingLabel localizes value and scale in ar and en', () async {
    final ar = await EdmnLocalizations.delegate.load(const Locale('ar'));
    final en = await EdmnLocalizations.delegate.load(const Locale('en'));
    expect(ar.starRatingLabel(3), contains('3'));
    expect(ar.starRatingLabel(3), contains('5'));
    expect(ar.starRatingLabel(3), isNot('3'));
    expect(en.starRatingLabel(2), '2 of 5 stars');
  });

  testWidgets('rating stars announce the localized label and select on tap', (tester) async {
    await tester.pumpWidget(ProviderScope(
      child: MaterialApp(
        localizationsDelegates: EdmnLocalizations.localizationsDelegates,
        supportedLocales: EdmnLocalizations.supportedLocales,
        locale: const Locale('ar'),
        home: Scaffold(body: ReviewFormProbe(key: const Key('rev-form-probe'))),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.byTooltip('3 من 5 نجوم'), findsOneWidget);
    await tester.tap(find.byKey(const Key('rev-form-probe-star-4')));
    await tester.pump();
    expect(find.byIcon(Icons.star_rounded), findsNWidgets(4));
  });
}

class ReviewFormProbe extends ConsumerWidget {
  const ReviewFormProbe({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => buildReviewFormForTest(context, ref, key: key);
}
