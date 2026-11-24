import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../common/ui.dart';
import '../../providers.dart';

final mySessionsProvider = FutureProvider<List<DeviceSession>>((ref) async => (await ref.watch(mobileApiProvider).mySessions()).items);

/// Remote sign-out (lost phone). Each tap gets ONE idempotency key, reused if the user retries the same action.
class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final sessions = ref.watch(mySessionsProvider);
    final api = ref.read(mobileApiProvider);

    Future<void> run(Future<void> Function() action) async {
      try {
        await action();
      } catch (e) {
        if (context.mounted) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
      }
      ref.invalidate(mySessionsProvider);
    }

    return EdmnAppScaffold(
      title: t.devices,
      body: AsyncView(
        value: sessions,
        skeleton: true,
        onRetry: () => ref.invalidate(mySessionsProvider),
        data: (items) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          EdmnMenuGroup(children: [
            for (final s in items)
              EdmnMenuItem(
                key: Key('session-${s.id}'),
                icon: s.device == null ? Icons.language_rounded : Icons.smartphone_rounded,
                title: s.device?.name ?? s.device?.platform ?? s.userAgent ?? s.scope,
                subtitle: s.current ? t.thisDevice : formatDateTime(context, s.lastSeenAt),
                trailing: s.current
                    ? EdmnStatusChip(label: t.thisDevice, tone: EdmnTone.success)
                    : IconButton(
                        tooltip: t.signOutDevice,
                        icon: Icon(Icons.logout_rounded, color: EdmnColors.error, semanticLabel: t.signOutDevice),
                        onPressed: () {
                          final key = newIdempotencyKey();
                          run(() => api.revokeSession(s.id, idempotencyKey: key));
                        },
                      ),
              ),
          ]),
          const SizedBox(height: EdmnSpacing.md),
          EdmnSecondaryButton(
            key: const Key('revoke-others'),
            label: t.signOutOtherDevices,
            destructive: true,
            onPressed: () {
              final key = newIdempotencyKey();
              run(() async {
                final n = await api.revokeOtherSessions(idempotencyKey: key);
                if (context.mounted) showEdmnMessage(context, t.signedOutOthers(n));
              });
            },
          ),
        ]),
      ),
    );
  }
}
