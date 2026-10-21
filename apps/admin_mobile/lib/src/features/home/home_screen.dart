import 'package:edmn_api/admin.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers.dart';

final adminProfileProvider = FutureProvider<Profile>((ref) => ref.watch(adminApiProvider).me());

/// Phase 1 home: who am I, what may I do (server permissions), my sessions and account security. Operational
/// modules (KPIs, reports, exports, fees, settings, content, system health — Phase 0 decision 10) arrive in Phase 2 on
/// top of this shell; the app never shows a module the server would refuse.
class AdminHomeScreen extends ConsumerWidget {
  const AdminHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final me = ref.watch(adminProfileProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.appNameAdmin), actions: [
        IconButton(
          tooltip: t.language,
          icon: const Icon(Icons.translate),
          onPressed: () => ref.read(localeProvider.notifier).set(ref.read(localeProvider).languageCode == 'ar' ? EdmnLocales.english : EdmnLocales.arabic),
        ),
        IconButton(
          tooltip: t.signOut,
          icon: const Icon(Icons.logout),
          onPressed: () async {
            await ref.read(adminApiProvider).logout().catchError((_) {});
            ref.read(adminSessionProvider.notifier).set(AdminSessionState.signedOut);
          },
        ),
      ]),
      body: me.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(adminProfileProvider)),
        data: (p) {
          final canRevoke = p.permissions.contains('customers.manage') || p.permissions.contains('roles.manage');
          return ListView(children: [
            ListTile(title: Text(p.fullName, style: Theme.of(context).textTheme.titleLarge), subtitle: Text(p.email ?? '')),
            ListTile(leading: const Icon(Icons.verified_user), title: Text(t.permissions), trailing: Text('${p.permissions.length}', key: const Key('permission-count'))),
            if (canRevoke)
              ListTile(
                key: const Key('revoke-user-sessions'),
                leading: const Icon(Icons.phonelink_erase),
                title: Text(t.signOutOtherDevices),
                onTap: () => context.push('/security/revoke-sessions'),
              ),
          ]);
        },
      ),
    );
  }
}
