import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers.dart';
import 'security/device_integrity.dart';
import 'router.dart';

class AdminApp extends ConsumerWidget {
  const AdminApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp.router(
        onGenerateTitle: (c) => EdmnLocalizations.of(c).appNameAdmin,
        locale: ref.watch(localeProvider),
        supportedLocales: EdmnLocales.supported,
        localizationsDelegates: const [EdmnLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        theme: edmnTheme(),
        routerConfig: ref.watch(routerProvider),
        // Staff screens show TOTP secrets, personal data and money queues: hidden whenever the app is not in front.
        // UX-02: support the OS font-size setting without letting huge text break layouts.
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: MediaQuery.textScalerOf(context).clamp(minScaleFactor: 0.85, maxScaleFactor: 1.35),
          ),
          child: EdmnPrivacyShield(child: _DeviceIntegrityGate(child: child ?? const SizedBox.shrink())),
        ),
      );
}

/// MOBILE-REL-01: one-time rooted/jailbroken warning on launch (warning only, never a gate).
class _DeviceIntegrityGate extends StatefulWidget {
  const _DeviceIntegrityGate({required this.child});

  final Widget child;

  @override
  State<_DeviceIntegrityGate> createState() => _DeviceIntegrityGateState();
}

class _DeviceIntegrityGateState extends State<_DeviceIntegrityGate> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      DeviceIntegrity.warnIfCompromised(context, onDetected: () => Telemetry().event('admin_device_compromised_warning', const {}));
    });
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
