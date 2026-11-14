import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/account/devices_screen.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/bootstrap/app_shell.dart';
import 'features/catalog/catalog_home_screen.dart';
import 'features/catalog/product_screen.dart';
import 'providers.dart';

/// Feature routes. Account routes require a session; the redirect sends signed-out users to sign-in and back.
final routerProvider = Provider<GoRouter>((ref) {
  final signedIn = ValueNotifierBridge(ref);
  return GoRouter(
    refreshListenable: signedIn,
    redirect: (context, state) {
      final needsAuth = state.matchedLocation.startsWith('/account');
      if (needsAuth && !ref.read(signedInProvider)) return '/sign-in?next=${Uri.encodeComponent(state.matchedLocation)}';
      return null;
    },
    routes: [
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(path: '/', builder: (c, s) => const CatalogHomeScreen()),
          GoRoute(path: '/products/:slug', builder: (c, s) => ProductScreen(slug: s.pathParameters['slug']!)),
          GoRoute(path: '/sign-in', builder: (c, s) => SignInScreen(next: s.uri.queryParameters['next'])),
          GoRoute(path: '/account/devices', builder: (c, s) => const DevicesScreen()),
        ],
      ),
    ],
  );
});

/// Re-runs router redirects when the signed-in state changes.
class ValueNotifierBridge extends ChangeNotifier {
  ValueNotifierBridge(Ref ref) {
    ref.listen<bool>(signedInProvider, (_, _) => notifyListeners());
  }
}
