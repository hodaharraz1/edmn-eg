import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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
        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(context, e))));
      }
      ref.invalidate(mySessionsProvider);
    }

    return Scaffold(
      appBar: AppBar(title: Text(t.devices), actions: [
        IconButton(
          tooltip: t.signOut,
          icon: const Icon(Icons.logout),
          onPressed: () async {
            await api.logout().catchError((_) {});
            ref.read(signedInProvider.notifier).set(false);
            if (context.mounted) context.go('/');
          },
        ),
      ]),
      body: sessions.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(mySessionsProvider)),
        data: (items) => ListView(children: [
          for (final s in items)
            ListTile(
              key: Key('session-${s.id}'),
              leading: Icon(s.device == null ? Icons.language : Icons.smartphone),
              title: Text(s.device?.name ?? s.device?.platform ?? s.userAgent ?? s.scope),
              subtitle: Text(s.current ? t.thisDevice : s.lastSeenAt),
              trailing: s.current
                  ? null
                  : IconButton(
                      tooltip: t.signOutDevice,
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        final key = newIdempotencyKey();
                        run(() => api.revokeSession(s.id, idempotencyKey: key));
                      },
                    ),
            ),
          Padding(
            padding: const EdgeInsetsDirectional.all(16),
            child: OutlinedButton(
              key: const Key('revoke-others'),
              onPressed: () {
                final key = newIdempotencyKey();
                run(() async {
                  final n = await api.revokeOtherSessions(idempotencyKey: key);
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t.signedOutOthers(n))));
                });
              },
              child: Text(t.signOutOtherDevices),
            ),
          ),
        ]),
      ),
    );
  }
}
