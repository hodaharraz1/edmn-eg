import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';
import '../../version.dart';

/// Wraps every screen: blocks unsupported app versions (server-driven) and shows the TEST-money banner while Real Money
/// is OFF. If the config cannot be loaded the app still works (catalog is read-only); the banner stays visible.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(appConfigProvider);
    final version = ref.watch(buildConfigProvider).appVersion;
    final t = EdmnLocalizations.of(context);
    final cfg = config.value;
    if (cfg != null && !isVersionSupported(version, cfg.minSupportedVersion.customer)) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsetsDirectional.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(t.updateRequiredTitle, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(t.updateRequiredBody, textAlign: TextAlign.center),
            ]),
          ),
        ),
      );
    }
    return Column(children: [
      if (cfg == null || !cfg.realMoneyEnabled) const SafeArea(bottom: false, child: TestMoneyBanner()),
      Expanded(child: child),
    ]);
  }
}
