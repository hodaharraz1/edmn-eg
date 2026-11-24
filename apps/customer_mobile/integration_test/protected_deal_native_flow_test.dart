import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:integration_test/integration_test.dart';
import 'package:edmn_customer/src/app.dart';
import 'package:edmn_customer/src/router.dart';
import 'package:edmn_customer/src/providers.dart';
import 'package:edmn_customer/src/common/file_pick.dart';

// The native document picker is outside Flutter's integration-test control. Only
// the picker result is substituted; the app, API and test PostgreSQL are real.
class SyntheticPhotoPicker implements FilePickerService {
  @override
  Future<PickedFile?> pick({bool allowPdf = true}) async => PickedFile(
    name: 'native-test.png',
    bytes: base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAIAAAABc2X6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA10lEQVR4nO3XUQ1EQQhDUVyNpbF03a6HTSZ8vJMgAFpoy5zbp2rWOzBwGM5K54YjWlFptnS2TVLwSNJKtEyWzvOQb+nuGwZb6gUEsw45hnsKwaxDjuEwnJXODUe0otJs6XygZr0DA4fhrHRuOKIVlWZLZ9skBY8krUTLZOk8D/mW7r5hsKVeQDDrkGO4pxDMOuQYDsNZ6dxwRCsqzZbOB2rWOzBwGM5K54YjWlFptnS2TVLwSNJKtEyWzvOQb+nuGwZb6gUEsw45hnsKwaxDjuEwnJXubwh+tsB5w3RFdQEAAAAASUVORK5CYII=',
    ),
  );
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native buyer creates, photographs and invites; seller joins', (
    tester,
  ) async {
    expect(
      const String.fromEnvironment('EDMN_API_BASE_URL'),
      'http://127.0.0.1:3000',
    );
    final container = ProviderContainer(
      overrides: [filePickerProvider.overrideWithValue(SyntheticPhotoPicker())],
    );
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const CustomerApp(),
      ),
    );
    await tester.pump(const Duration(seconds: 4));
    Future<void> waitKey(String key) async {
      for (var i = 0; i < 40 && find.byKey(Key(key)).evaluate().isEmpty; i++) {
        await tester.pump(const Duration(seconds: 1));
      }
      expect(find.byKey(Key(key)), findsOneWidget, reason: key);
    }

    Finder input(String key) => find.descendant(
      of: find.byKey(Key(key)),
      matching: find.byType(TextField),
    );
    Future<void> enter(String key, String value) async {
      await tester.ensureVisible(find.byKey(Key(key)));
      await tester.enterText(input(key), value);
    }

    Future<void> login(String email) async {
      container.read(routerProvider).go('/sign-in');
      await tester.pumpAndSettle();
      await enter('identifier', email);
      await enter('password', 'Demo@12345');
      await tester.tap(find.byKey(const Key('sign-in')));
      for (
        var i = 0;
        i < 40 && find.byKey(const Key('sign-in')).evaluate().isNotEmpty;
        i++
      ) {
        await tester.pump(const Duration(seconds: 1));
      }
      expect(find.byKey(const Key('sign-in')), findsNothing);
    }

    await login('ahmed@demo.edmn.local');
    container.read(routerProvider).go('/deals/new');
    await tester.pumpAndSettle();
    await enter('deal-title', 'Native batch five camera');
    await enter(
      'deal-description',
      'A camera for the isolated simulator journey',
    );
    await tester.scrollUntilVisible(
      find.byKey(const Key('deal-pick-photo')),
      250,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.byKey(const Key('deal-pick-photo')));
    await tester.pumpAndSettle();
    expect(find.text('native-test.png'), findsOneWidget);
    await tester.tap(find.byKey(const Key('deal-next')));
    await waitKey('deal-unitPrice');
    await enter('deal-unitPrice', '3000');
    await tester.tap(find.byKey(const Key('deal-next')));
    await waitKey('deal-deliveryMethod');
    await enter('deal-deliveryMethod', 'Delivery service');
    await tester.tap(find.byKey(const Key('deal-next')));
    await waitKey('deal-city');
    await enter('deal-city', 'Cairo');
    await enter('deal-street', 'Test street');
    await tester.tap(find.byKey(const Key('deal-next')));
    await tester.pump(const Duration(seconds: 3));
    await tester.tap(find.byKey(const Key('deal-next')));
    await tester.pump(const Duration(seconds: 4));
    await tester.scrollUntilVisible(
      find.byKey(const Key('deal-invite')),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.byKey(const Key('deal-invite')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('dialog-confirm')));
    for (var i = 0; i < 40 && find.byType(Scrollable).evaluate().isEmpty; i++) {
      await tester.pump(const Duration(seconds: 1));
    }
    await tester.scrollUntilVisible(
      find.byKey(const Key('invite-link-card')),
      -300,
      scrollable: find.byType(Scrollable).last,
    );
    final card = find.byKey(const Key('invite-link-card'));
    final link = tester
        .widget<SelectableText>(
          find
              .descendant(of: card, matching: find.byType(SelectableText))
              .first,
        )
        .data!;
    expect(link.contains('/deal/invite/'), isTrue);
    await container.read(mobileApiProvider).logout();
    container.read(signedInProvider.notifier).set(false);
    await login('techzone@demo.edmn.local');
    container.read(routerProvider).go('/deals/join');
    await tester.pumpAndSettle();
    await enter('invite-link', link);
    await tester.tap(find.byKey(const Key('join-deal')));
    for (var i = 0; i < 40; i++) {
      await tester.pump(const Duration(seconds: 1));
      if (find.byKey(const Key('join-deal')).evaluate().isEmpty &&
          find.byType(Scrollable).evaluate().isNotEmpty)
        break;
    }
    await tester.scrollUntilVisible(
      find.byKey(const Key('deal-offer')),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.byKey(const Key('deal-offer')), findsOneWidget);
    await tester.tap(find.byKey(const Key('deal-offer')));
    await tester.pumpAndSettle();
    await enter('offer-fullName', 'Test Seller');
    await enter('offer-city', 'Giza');
    await enter('offer-street', 'Test seller street');
    await enter('offer-holderName', 'Test Seller');
    await enter('offer-instapay', 'test-seller@instapay');
    await enter('offer-deliveryMethod', 'Delivery service');
    await tester.ensureVisible(find.byKey(const Key('offer-submit')));
    await tester.tap(find.byKey(const Key('offer-submit')));
    for (
      var i = 0;
      i < 40 && find.byKey(const Key('offer-submit')).evaluate().isNotEmpty;
      i++
    ) {
      await tester.pump(const Duration(seconds: 1));
    }
    expect(find.byKey(const Key('offer-submit')), findsNothing);
  });
}
