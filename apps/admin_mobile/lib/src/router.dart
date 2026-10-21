import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/auth/mfa_screen.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/home/home_screen.dart';
import 'features/security/revoke_user_sessions_screen.dart';
import 'providers.dart';

/// The session state machine drives navigation: nothing past sign-in is reachable before TOTP verification.
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _SessionListenable(ref);
  return GoRouter(
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
      GoRoute(path: '/security/revoke-sessions', builder: (c, s) => const RevokeUserSessionsScreen()),
    ],
  );
});

class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen<AdminSessionState>(adminSessionProvider, (_, _) => notifyListeners());
  }
}
