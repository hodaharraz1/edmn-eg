import 'package:edmn_customer/src/features/postpurchase/postpurchase_screens.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Batch 6 (found by the approved-return UI journey): the return timeline and status labels.
const _statuses = ['REQUESTED', 'APPROVED', 'RETURN_IN_TRANSIT', 'RECEIVED', 'INSPECTION', 'REFUND_PENDING', 'REFUNDED', 'REJECTED', 'DISPUTED'];

void main() {
  test('a refunded return shows every step done (the last one was left "current")', () {
    expect([for (var i = 0; i < 6; i++) returnStepState('REFUNDED', i)], everyElement(EdmnStepState.done));
    expect(returnStepState('REFUND_PENDING', 4), EdmnStepState.current);
    expect(returnStepState('REFUND_PENDING', 5), EdmnStepState.pending);
    expect(returnStepState('INSPECTION', 3), EdmnStepState.current);
    expect(returnStepState('REJECTED', 1), EdmnStepState.pending);
  });

  for (final locale in const [Locale('ar'), Locale('en')]) {
    test('received and inspection are told apart; every return state has its own label (${locale.languageCode})', () async {
      final t = await EdmnLocalizations.delegate.load(locale);
      final labels = {for (final s in _statuses) s: returnStatus(t, s).$1};
      expect(labels.values.toSet(), hasLength(_statuses.length), reason: '$labels');
      expect(labels['RECEIVED'], isNot(labels['INSPECTION']));
    });
  }
}
