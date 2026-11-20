import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:edmn_design/edmn_design.dart' show EdmnNotFoundScreen;
import 'package:go_router/go_router.dart';

import 'features/auth/mfa_screen.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/home/home_screen.dart';
import 'features/monitoring/detail_screens.dart';
import 'features/monitoring/monitoring_screens.dart';
import 'features/security/revoke_user_sessions_screen.dart';
import 'providers.dart';

/// The session state machine drives navigation: nothing past sign-in is reachable before TOTP verification.
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _SessionListenable(ref);
  return GoRouter(
    errorBuilder: (context, state) => EdmnNotFoundScreen(onHome: () => context.go('/')),
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final s = ref.read(adminSessionProvider);
      final loc = state.matchedLocation;
      return switch (s) {
        AdminSessionState.signedOut => loc == '/sign-in' ? null : '/sign-in',
        AdminSessionState.needsMfa => loc == '/mfa' ? null : '/mfa',
        AdminSessionState.ready => (loc == '/sign-in' || loc == '/mfa') ? '/' : null,
      };
    },
    routes: [
      GoRoute(path: '/sign-in', builder: (c, s) => const AdminSignInScreen()),
      GoRoute(path: '/mfa', builder: (c, s) => const MfaScreen()),
      GoRoute(path: '/', builder: (c, s) => const AdminHomeScreen()),
      GoRoute(path: '/dashboard', builder: (c, s) => const AdminDashboardScreen()),
      for (final spec in monitorSpecs) GoRoute(path: spec.path, builder: (c, s) => MonitorListScreen(spec: spec)),
      GoRoute(path: '/monitor/sellers/:id', builder: (c, s) => SellerDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/monitor/identity/:id', builder: (c, s) => IdentityDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/monitor/orders/:id', builder: (c, s) => OrderDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/monitor/deals/:id', builder: (c, s) => DealDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/monitor/disputes/:id', builder: (c, s) => DisputeDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/security/revoke-sessions', builder: (c, s) => const RevokeUserSessionsScreen()),
    ],
  );
});

class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen<AdminSessionState>(adminSessionProvider, (_, _) => notifyListeners());
  }
}
