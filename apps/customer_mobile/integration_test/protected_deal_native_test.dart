import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:integration_test/integration_test.dart';
import 'package:edmn_customer/src/app.dart';
import 'package:edmn_customer/src/router.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native buyer creates a real test draft', (tester) async {
    const api = String.fromEnvironment('EDMN_API_BASE_URL');
    expect(
      api,
      'http://127.0.0.1:3000',
      reason: 'This test requires an isolated local test backend.',
    );
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const CustomerApp(),
      ),
    );
    await tester.pump(const Duration(seconds: 4));
    container.read(routerProvider).go('/sign-in');
    await tester.pumpAndSettle();
    Finder input(String key) => find.descendant(
      of: find.byKey(Key(key)),
      matching: find.byType(TextField),
    );
    await tester.enterText(input('identifier'), 'ahmed@demo.edmn.local');
    await tester.enterText(input('password'), 'Demo@12345');
    await tester.tap(find.byKey(const Key('sign-in')));
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(seconds: 1));
      if (find.byKey(const Key('sign-in')).evaluate().isEmpty) break;
    }
    expect(find.byKey(const Key('sign-in')), findsNothing);
    container.read(routerProvider).go('/deals/new');
    await tester.pumpAndSettle();
    await tester.enterText(input('deal-title'), 'Native batch four camera');
    await tester.enterText(
      input('deal-description'),
      'A camera for the isolated simulator test',
    );
    await tester.tap(find.byKey(const Key('deal-next')));
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(seconds: 1));
      if (find.byKey(const Key('deal-unitPrice')).evaluate().isNotEmpty) break;
    }
    expect(find.byKey(const Key('deal-unitPrice')), findsOneWidget);
  });
}
