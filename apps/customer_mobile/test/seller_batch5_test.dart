import 'dart:async';

import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_customer/src/common/governorate_field.dart';
import 'package:edmn_customer/src/common/status.dart';
import 'package:edmn_customer/src/providers.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Batch 5: the governorate picker used by the seller application, and the seller-facing order status labels.

const _govs = [
  ListGovernoratesResponseItemsItem(id: 1, code: 'C', nameAr: 'القاهرة', nameEn: 'Cairo'),
  ListGovernoratesResponseItemsItem(id: 2, code: 'ALX', nameAr: 'الإسكندرية', nameEn: 'Alexandria'),
  ListGovernoratesResponseItemsItem(id: 3, code: 'GZ', nameAr: 'الجيزة', nameEn: 'Giza'),
];

/// Every server state of a seller sub-order (`SELLER_ORDER_STATUSES` in src/domain/machines.ts).
const _sellerOrderStatuses = [
  'PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', //
  'SHIPPED', 'AWAITING_BUYER_RESPONSE', 'DELIVERED', 'COMPLETED', 'DELIVERY_FAILED', 'CANCELLED',
];

Widget _host(Future<List<ListGovernoratesResponseItemsItem>> Function() load, {int? initial, Locale locale = const Locale('ar'), void Function(int)? onChanged, GlobalKey<FormState>? form}) =>
    ProviderScope(
      overrides: [governoratesProvider.overrideWith((ref) => load())],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: EdmnLocalizations.localizationsDelegates,
        supportedLocales: EdmnLocalizations.supportedLocales,
        home: Scaffold(body: Form(key: form, child: _Holder(initial: initial, onChanged: onChanged))),
      ),
    );

class _Holder extends StatefulWidget {
  const _Holder({this.initial, this.onChanged});
  final int? initial;
  final void Function(int)? onChanged;
  @override
  State<_Holder> createState() => _HolderState();
}

class _HolderState extends State<_Holder> {
  late int? v = widget.initial;
  @override
  Widget build(BuildContext context) => GovernorateField(
        value: v,
        onChanged: (x) {
          setState(() => v = x);
          widget.onChanged?.call(x);
        },
      );
}

void main() {
  group('governorate picker', () {
    testWidgets('search (Arabic spelling variants and English) and select → the database id, not a name', (t) async {
      int? picked;
      final form = GlobalKey<FormState>();
      await t.pumpWidget(_host(() async => _govs, onChanged: (v) => picked = v, form: form));
      await t.pumpAndSettle();
      expect(find.text('اختار المحافظة'), findsOneWidget);
      expect(form.currentState!.validate(), isFalse, reason: 'nothing chosen yet');
      await t.pump();
      expect(find.text('الحقل ده مطلوب'), findsOneWidget);

      await t.tap(find.byKey(const Key('governorate-field')));
      await t.pumpAndSettle();
      // "اسكندرية" without the hamza still finds «الإسكندرية».
      await t.enterText(find.byKey(const Key('governorate-search')), 'اسكندري');
      await t.pumpAndSettle();
      expect(find.byKey(const Key('gov-2')), findsOneWidget);
      expect(find.byKey(const Key('gov-1')), findsNothing);
      await t.enterText(find.byKey(const Key('governorate-search')), 'giz');
      await t.pumpAndSettle();
      expect(find.byKey(const Key('gov-3')), findsOneWidget);
      await t.enterText(find.byKey(const Key('governorate-search')), 'zzz');
      await t.pumpAndSettle();
      expect(find.byKey(const Key('governorate-no-match')), findsOneWidget);
      await t.enterText(find.byKey(const Key('governorate-search')), '');
      await t.pumpAndSettle();
      await t.tap(find.byKey(const Key('gov-3')));
      await t.pumpAndSettle();
      expect(picked, 3);
      expect(find.text('الجيزة'), findsOneWidget);
      expect(form.currentState!.validate(), isTrue);
    });

    testWidgets('an id that is not in the active list (deactivated or unknown) fails validation until a listed one is chosen', (t) async {
      final form = GlobalKey<FormState>();
      await t.pumpWidget(_host(() async => _govs, initial: 99, form: form));
      await t.pumpAndSettle();
      expect(form.currentState!.validate(), isFalse);
      await t.pump();
      expect(find.textContaining('غير متاحة'), findsWidgets);
    });

    testWidgets('loading and empty states', (t) async {
      final c = Completer<List<ListGovernoratesResponseItemsItem>>();
      await t.pumpWidget(_host(() => c.future));
      await t.pump();
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      c.complete(const []);
      await t.pumpAndSettle();
      expect(find.byKey(const Key('governorate-empty')), findsOneWidget);
    });

    testWidgets('a failed load shows the error with a retry that reloads the list', (t) async {
      var fail = true;
      await t.pumpWidget(_host(() async {
        if (fail) throw const ApiFailure(code: ApiErrorCode.network);
        return _govs;
      }));
      // Riverpod retries a failed provider on its own with back-off; once it gives up the error and a retry show.
      for (var i = 0; i < 40; i++) {
        await t.pump(const Duration(seconds: 5));
      }
      expect(find.byKey(const Key('governorate-retry')), findsOneWidget);
      expect(find.byKey(const Key('governorate-field')), findsNothing);
      fail = false;
      await t.tap(find.byKey(const Key('governorate-retry')));
      await t.pumpAndSettle();
      expect(find.byKey(const Key('governorate-field')), findsOneWidget);
    });

    testWidgets('English shows English names left-to-right; the field is one named button for screen readers', (t) async {
      final h = t.ensureSemantics();
      await t.pumpWidget(_host(() async => _govs, initial: 2, locale: const Locale('en')));
      await t.pumpAndSettle();
      expect(find.text('Alexandria'), findsOneWidget);
      expect(Directionality.of(t.element(find.text('Alexandria'))), TextDirection.ltr);
      expect(find.bySemanticsLabel('Governorate: Alexandria'), findsOneWidget);
      h.dispose();
    });
  });

  group('seller order status labels', () {
    for (final locale in const [Locale('ar'), Locale('en')]) {
      test('every seller state has its own label and a next-step hint (${locale.languageCode})', () async {
        final t = await EdmnLocalizations.delegate.load(locale);
        final labels = {for (final s in _sellerOrderStatuses) s: sellerOrderStatusChip(t, s).$1};
        expect(labels.values.toSet().length, _sellerOrderStatuses.length, reason: 'two states share a label: $labels');
        for (final s in _sellerOrderStatuses) {
          expect(labels[s], isNot(s), reason: '$s has no translation');
          expect(sellerOrderStatusHint(t, s), isNotNull, reason: '$s has no hint');
        }
        expect(labels['PROCESSING'], isNot(labels['READY_TO_SHIP']));
        // DELIVERED means "entitled, awaiting EDMN approval": it must never read as completed / paid out.
        expect(labels['DELIVERED'], isNot(labels['COMPLETED']));
        expect(labels['AWAITING_BUYER_RESPONSE'], isNot(labels['DELIVERED']));
      });
    }

    test('Arabic labels for the preparation states read as an ordinary seller expects', () async {
      final t = await EdmnLocalizations.delegate.load(const Locale('ar'));
      expect(sellerOrderStatusChip(t, 'PROCESSING').$1, 'قيد التجهيز');
      expect(sellerOrderStatusChip(t, 'READY_TO_SHIP').$1, 'جاهز للشحن');
      expect(sellerOrderStatusChip(t, 'DELIVERED').$1, contains('المستحقات قيد المراجعة'));
      expect(sellerOrderStatusChip(t, 'SOMETHING_NEW').$2, EdmnTone.neutral, reason: 'an unknown server state is shown neutrally, never guessed');
    });
  });
}
