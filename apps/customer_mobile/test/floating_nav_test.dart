import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// PKG-UI-01: the floating frosted-glass nav pill. It hides while scrolling down and returns on scrolling up (owner
/// decision 2026-11-27); the active tab is highlighted in brand blue (no centre button). Behaviour, not pixels.
Widget _host({required int currentIndex, required ValueChanged<int> onTap, bool disableAnimations = false, int? badge}) {
  final items = [
    const EdmnFloatingNavItem(key: Key('nav-home'), icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'الرئيسية'),
    const EdmnFloatingNavItem(key: Key('nav-categories'), icon: Icons.grid_view_outlined, activeIcon: Icons.grid_view_rounded, label: 'الأقسام'),
    const EdmnFloatingNavItem(key: Key('nav-wallet'), icon: Icons.account_balance_wallet_outlined, activeIcon: Icons.account_balance_wallet_rounded, label: 'المحفظة'),
    EdmnFloatingNavItem(key: const Key('nav-orders'), icon: Icons.shopping_bag_outlined, activeIcon: Icons.shopping_bag_rounded, label: 'طلباتي', badge: badge),
  ];
  return MediaQuery(
    data: MediaQueryData(disableAnimations: disableAnimations),
    child: MaterialApp(
      locale: const Locale('ar'),
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          body: EdmnFloatingNavShell(
            index: currentIndex,
            body: Column(children: [
              SizedBox(
                height: 80,
                child: ListView(key: const Key('carousel'), scrollDirection: Axis.horizontal, children: [for (var i = 0; i < 20; i++) SizedBox(width: 120, child: Text('بطاقة $i'))]),
              ),
              Expanded(child: ListView(key: const Key('content'), children: [for (var i = 0; i < 40; i++) ListTile(title: Text('صف $i'))])),
            ]),
            navigation: EdmnFloatingNavigation(items: items, currentIndex: currentIndex, onTap: onTap),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('four tabs in the app order: الرئيسية، الأقسام، المحفظة، طلباتي, each one announced', (t) async {
    await t.pumpWidget(_host(currentIndex: 0, onTap: (_) {}));
    expect(find.byKey(const Key('nav-home')), findsOneWidget);
    expect(find.byKey(const Key('nav-categories')), findsOneWidget);
    expect(find.byKey(const Key('nav-wallet')), findsOneWidget);
    expect(find.byKey(const Key('nav-orders')), findsOneWidget);
    for (final label in ['الرئيسية', 'الأقسام', 'المحفظة', 'طلباتي']) {
      expect(find.text(label), findsOneWidget);
    }
    // Each tab is a named, selectable button for screen readers.
    final buttons = t.widgetList<Semantics>(
      find.descendant(
        of: find.byType(EdmnFloatingNavigation),
        matching: find.byWidgetPredicate((w) => w is Semantics && (w.properties.button ?? false)),
      ),
    );
    expect(buttons.map((s) => s.properties.label), containsAll(['الرئيسية', 'الأقسام', 'المحفظة', 'طلباتي']));
    expect(buttons.where((s) => s.properties.selected ?? false).map((s) => s.properties.label), ['الرئيسية']);
  });

  testWidgets('a tap reports the tapped tab index', (t) async {
    final tapped = <int>[];
    await t.pumpWidget(_host(currentIndex: 0, onTap: tapped.add));
    await t.tap(find.byKey(const Key('nav-wallet')));
    await t.tap(find.byKey(const Key('nav-orders')));
    expect(tapped, [2, 3]);
  });

  testWidgets('the active tab carries the blue accent circle; the others stay transparent', (t) async {
    await t.pumpWidget(_host(currentIndex: 2, onTap: (_) {}));
    final circles = t
        .widgetList<AnimatedContainer>(
          find.descendant(of: find.byType(EdmnFloatingNavigation), matching: find.byType(AnimatedContainer)),
        )
        .map((c) => (c.decoration as BoxDecoration).color)
        .toList();
    expect(circles, [Colors.transparent, Colors.transparent, EdmnColors.primary, Colors.transparent]);
  });

  testWidgets('every tab meets the 48px touch-target minimum', (t) async {
    await t.pumpWidget(_host(currentIndex: 0, onTap: (_) {}));
    for (final key in ['nav-home', 'nav-categories', 'nav-wallet', 'nav-orders']) {
      final size = t.getSize(find.byKey(Key(key)));
      expect(size.width, greaterThanOrEqualTo(48), reason: '$key width');
      expect(size.height, greaterThanOrEqualTo(48), reason: '$key height');
    }
  });

  testWidgets('تقليل الحركة stops the highlight animation', (t) async {
    await t.pumpWidget(_host(currentIndex: 0, onTap: (_) {}, disableAnimations: true));
    final circle = t.widget<AnimatedContainer>(
      find.descendant(of: find.byType(EdmnFloatingNavigation), matching: find.byType(AnimatedContainer)).first,
    );
    expect(circle.duration, Duration.zero);

    await t.pumpWidget(_host(currentIndex: 0, onTap: (_) {}));
    final animated = t.widget<AnimatedContainer>(
      find.descendant(of: find.byType(EdmnFloatingNavigation), matching: find.byType(AnimatedContainer)).first,
    );
    expect(animated.duration, EdmnMotion.normal);
  });

  testWidgets('the badge appears only when a count is set', (t) async {
    await t.pumpWidget(_host(currentIndex: 0, onTap: (_) {}, badge: 5));
    expect(find.text('5'), findsOneWidget);
    await t.pumpWidget(_host(currentIndex: 0, onTap: (_) {}));
    expect(find.text('5'), findsNothing);
  });

  Offset slide(WidgetTester t) => t.widget<AnimatedSlide>(find.byKey(const Key('floating-nav-slide'))).offset;

  testWidgets('scrolling down hides the bar, scrolling back up shows it again', (t) async {
    await t.pumpWidget(_host(currentIndex: 0, onTap: (_) {}));
    expect(slide(t), Offset.zero);
    expect(t.widget<AnimatedSlide>(find.byKey(const Key('floating-nav-slide'))).duration, const Duration(milliseconds: 550));
    // a tiny jitter does not move it
    await t.drag(find.byKey(const Key('content')), const Offset(0, -20));
    await t.pumpAndSettle();
    expect(slide(t), Offset.zero);
    await t.drag(find.byKey(const Key('content')), const Offset(0, -600));
    await t.pumpAndSettle();
    expect(slide(t), isNot(Offset.zero));
    expect(t.widget<IgnorePointer>(find.ancestor(of: find.byKey(const Key('floating-nav-slide')), matching: find.byType(IgnorePointer)).first).ignoring, isTrue);
    await t.drag(find.byKey(const Key('content')), const Offset(0, 200));
    await t.pumpAndSettle();
    expect(slide(t), Offset.zero);
  });

  testWidgets('horizontal carousels never hide the bar', (t) async {
    await t.pumpWidget(_host(currentIndex: 0, onTap: (_) {}));
    await t.drag(find.byKey(const Key('carousel')), const Offset(-400, 0));
    await t.pumpAndSettle();
    expect(slide(t), Offset.zero);
  });

  testWidgets('switching tab brings a hidden bar back; تقليل الحركة makes the slide instant', (t) async {
    await t.pumpWidget(_host(currentIndex: 0, onTap: (_) {}, disableAnimations: true));
    expect(t.widget<AnimatedSlide>(find.byKey(const Key('floating-nav-slide'))).duration, Duration.zero);
    await t.drag(find.byKey(const Key('content')), const Offset(0, -600));
    await t.pumpAndSettle();
    expect(slide(t), isNot(Offset.zero));
    await t.pumpWidget(_host(currentIndex: 1, onTap: (_) {}, disableAnimations: true));
    await t.pumpAndSettle();
    expect(slide(t), Offset.zero);
  });
}
