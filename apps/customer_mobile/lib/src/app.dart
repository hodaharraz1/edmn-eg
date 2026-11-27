import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/bootstrap/app_shell.dart';
import 'providers.dart';
import 'router.dart';

class CustomerApp extends ConsumerWidget {
  const CustomerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(bootstrapProvider);
    return MaterialApp.router(
      debugShowCheckedModeBanner: false,
      onGenerateTitle: (c) => EdmnLocalizations.of(c).appNameCustomer,
      locale: ref.watch(localeProvider),
      supportedLocales: EdmnLocales.supported,
      localizationsDelegates: const [EdmnLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      theme: edmnTheme(),
      routerConfig: ref.watch(routerProvider),
      // Version gate + TEST-money banner wrap every screen.
      // UX-02: support the OS font-size setting without letting huge text break layouts.
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: MediaQuery.textScalerOf(context).clamp(minScaleFactor: 0.85, maxScaleFactor: 1.35),
        ),
        child: AppShell(child: child ?? const SizedBox()),
      ),
    );
  }
}
