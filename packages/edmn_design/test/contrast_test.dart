import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// WCAG 2.x contrast ratio between two opaque colours.
double _ratio(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  // PKG-THEME-01: every main text/surface combination must keep the accessible contrast.
  group('colour contrast (text >= 4.5:1)', () {
    final text = <String, (Color, Color)>{
      'white on Cobalt (primary buttons, header)': (EdmnColors.onPrimary, EdmnColors.primary),
      'white on primaryDark (app bar)': (EdmnColors.onPrimary, EdmnColors.primaryDark),
      'white on primaryDeep (header gradient start)': (EdmnColors.onPrimary, EdmnColors.primaryDeep),
      'white on sunburstCore (header glow centre)': (EdmnColors.onPrimary, EdmnColors.sunburstCore),
      'navy on Acid Lime (badges, tab, offers)': (EdmnColors.onAccent, EdmnColors.accent),
      'Acid Lime on Cobalt (links on the header)': (EdmnColors.accent, EdmnColors.primary),
      'Acid Lime on primaryDeep (splash, offers banner)': (EdmnColors.accent, EdmnColors.primaryDeep),
      'body text on Snow White': (EdmnColors.textPrimary, EdmnColors.background),
      'body text on cards (surface)': (EdmnColors.textPrimary, EdmnColors.surface),
      'body text on subtle fills': (EdmnColors.textPrimary, EdmnColors.subtle),
      'secondary text on Snow White': (EdmnColors.textSecondary, EdmnColors.background),
      'secondary text on subtle fills': (EdmnColors.textSecondary, EdmnColors.subtle),
      'Cobalt links on Snow White': (EdmnColors.primary, EdmnColors.background),
      'Cobalt on primaryLight (info chips, pressed)': (EdmnColors.primary, EdmnColors.primaryLight),
      'primaryDark on primaryLight (chip labels)': (EdmnColors.primaryDark, EdmnColors.primaryLight),
    };
    text.forEach((name, pair) {
      test(name, () => expect(_ratio(pair.$1, pair.$2), greaterThanOrEqualTo(4.5)));
    });
  });

  test('icons: Cobalt and navy on Snow White are >= 3:1', () {
    expect(_ratio(EdmnColors.primary, EdmnColors.background), greaterThanOrEqualTo(3.0));
    expect(_ratio(EdmnColors.onAccent, EdmnColors.accent), greaterThanOrEqualTo(3.0));
  });

  test('white text on Acid Lime is NOT allowed (it fails 4.5:1)', () {
    expect(_ratio(EdmnColors.onPrimary, EdmnColors.accent), lessThan(4.5));
  });
}
