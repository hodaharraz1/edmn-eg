import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/account/account_screens.dart';
import 'features/account/devices_screen.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/auth/splash_onboarding.dart';
import 'features/cart/cart_providers.dart';
import 'features/cart/cart_screen.dart';
import 'features/catalog/browse_screens.dart';
import 'features/catalog/catalog_home_screen.dart';
import 'features/checkout/checkout_screen.dart';
import 'features/deals/deals_screens.dart';
import 'features/messages/messages_screens.dart';
import 'features/orders/orders_screens.dart';
import 'features/orders/payment_screen.dart';
import 'features/seller/seller_screens.dart';
import 'features/seller/seller_setup_screens.dart';
import 'features/support/support_screens.dart';
import 'providers.dart';

/// Routes that need a session; signed-out users go to sign-in and come back.
const _protected = ['/account/', '/checkout', '/payments', '/orders/', '/wallet', '/deals', '/seller', '/notifications', '/support', '/messages'];

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _SignedInListenable(ref);
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final loc = state.matchedLocation;
      final needsAuth = _protected.any((p) => loc.startsWith(p));
      if (needsAuth && !ref.read(signedInProvider)) return '/sign-in?next=${Uri.encodeComponent(state.uri.toString())}';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (c, s) => const SplashScreen()),
      GoRoute(path: '/onboarding', builder: (c, s) => const OnboardingScreen()),
      GoRoute(path: '/sign-in', builder: (c, s) => SignInScreen(next: s.uri.queryParameters['next'])),
      GoRoute(path: '/register', builder: (c, s) => const RegisterScreen()),
      GoRoute(path: '/forgot-password', builder: (c, s) => const ForgotPasswordScreen()),
      GoRoute(path: '/verify', builder: (c, s) => VerifyScreen(channel: s.uri.queryParameters['channel'] == 'EMAIL' ? 'EMAIL' : 'PHONE')),
      // Board bottom navigation: الرئيسية · الأقسام · إعادة الطلب · طلباتي (each tab keeps its own stack and scroll).
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => MainShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (c, s) => const CatalogHomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/categories', builder: (c, s) => const CategoriesScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/reorder', builder: (c, s) => const ReorderScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/orders', builder: (c, s) => const OrdersScreen())]),
        ],
      ),
      GoRoute(path: '/search', builder: (c, s) => SearchScreen(initialQuery: s.uri.queryParameters['q'] ?? '', initialSort: s.uri.queryParameters['sort'])),
      GoRoute(path: '/categories/:id', builder: (c, s) => CategoryProductsScreen(categoryId: s.pathParameters['id']!, category: s.extra as Category?)),
      GoRoute(path: '/products/:slug', builder: (c, s) => ProductScreen(slug: s.pathParameters['slug']!)),
      GoRoute(path: '/stores/:slug', builder: (c, s) => StoreScreen(slug: s.pathParameters['slug']!)),
      GoRoute(path: '/cart', builder: (c, s) => const CartScreen()),
      GoRoute(path: '/checkout', builder: (c, s) => const CheckoutScreen()),
      GoRoute(path: '/orders/:id', builder: (c, s) => OrderScreen(orderId: s.pathParameters['id']!, justPlaced: s.uri.queryParameters['placed'] == '1')),
      GoRoute(path: '/payments/:id', builder: (c, s) => PaymentScreen(paymentId: s.pathParameters['id']!)),
      GoRoute(path: '/account', builder: (c, s) => const AccountScreen()),
      GoRoute(path: '/account/profile', builder: (c, s) => const ProfileScreen()),
      GoRoute(path: '/account/security', builder: (c, s) => const SecurityScreen()),
      GoRoute(path: '/account/devices', builder: (c, s) => const DevicesScreen()),
      GoRoute(path: '/account/payment-methods', builder: (c, s) => const PaymentMethodsScreen()),
      GoRoute(path: '/account/addresses', builder: (c, s) => const AddressesScreen()),
      GoRoute(path: '/account/addresses/new', builder: (c, s) => const AddressFormScreen()),
      GoRoute(path: '/account/addresses/:id', builder: (c, s) => AddressFormScreen(address: s.extra as Address?)),
      GoRoute(path: '/legal/:slug', builder: (c, s) => LegalScreen(slug: s.pathParameters['slug']!)),
      // Services whose mobile API is not built yet: an honest screen, never a fake balance or list.
      GoRoute(path: '/deals', builder: (c, s) => const DealsHubScreen()),
      GoRoute(path: '/deals/new', builder: (c, s) => const NewDealScreen()),
      GoRoute(path: '/deals/join', builder: (c, s) => JoinDealScreen(token: s.uri.queryParameters['token'])),
      GoRoute(path: '/deals/:id', builder: (c, s) => DealScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/wallet', builder: (c, s) => NotYetAvailableScreen(title: EdmnLocalizations.of(c).wallet, icon: Icons.account_balance_wallet_outlined)),
      GoRoute(path: '/seller', builder: (c, s) => const SellerCenterScreen()),
      GoRoute(path: '/seller/orders', builder: (c, s) => const SellerOrdersScreen()),
      GoRoute(path: '/seller/orders/:id', builder: (c, s) => SellerOrderScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/seller/products', builder: (c, s) => const SellerProductsScreen()),
      GoRoute(path: '/seller/products/new', builder: (c, s) => const NewProductScreen()),
      GoRoute(path: '/seller/products/:id/edit', builder: (c, s) => ProductEditorScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/seller/apply', builder: (c, s) => const SellerApplicationScreen()),
      GoRoute(path: '/seller/shipping', builder: (c, s) => const ShippingRatesScreen()),
      GoRoute(path: '/seller/store', builder: (c, s) => const StoreSettingsScreen()),
      GoRoute(path: '/seller/payouts', builder: (c, s) => const PayoutRequestsScreen()),
      GoRoute(path: '/account/identity', builder: (c, s) => const IdentityScreen()),
      GoRoute(path: '/seller/funds', builder: (c, s) => const SellerFundsScreen()),
      GoRoute(path: '/notifications', builder: (c, s) => NotYetAvailableScreen(title: EdmnLocalizations.of(c).notifications, icon: Icons.notifications_none_rounded)),
      GoRoute(path: '/messages', builder: (c, s) => const InboxScreen()),
      GoRoute(path: '/messages/:id', builder: (c, s) => ConversationScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/seller/messages', builder: (c, s) => const InboxScreen(store: true)),
      GoRoute(path: '/seller/messages/:id', builder: (c, s) => ConversationScreen(id: s.pathParameters['id']!, store: true)),
      GoRoute(path: '/support', builder: (c, s) => const SupportScreen()),
      GoRoute(
        path: '/support/new',
        builder: (c, s) => NewTicketScreen(type: s.uri.queryParameters['type'], relatedType: s.uri.queryParameters['relatedType'], relatedId: s.uri.queryParameters['relatedId']),
      ),
      GoRoute(path: '/pages/:slug', builder: (c, s) => ContentPageScreen(slug: s.pathParameters['slug']!)),
      GoRoute(path: '/support/:id', builder: (c, s) => TicketScreen(id: s.pathParameters['id']!)),
    ],
  );
});

class MainShell extends ConsumerWidget {
  const MainShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    ref.watch(cartCountProvider);
    return Scaffold(
      body: shell,
      bottomNavigationBar: EdmnBottomNavigation(
        currentIndex: shell.currentIndex,
        onTap: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        items: [
          EdmnNavItem(icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: t.home),
          EdmnNavItem(icon: Icons.grid_view_outlined, activeIcon: Icons.grid_view_rounded, label: t.categories),
          EdmnNavItem(icon: Icons.replay_rounded, activeIcon: Icons.replay_rounded, label: t.reorder),
          EdmnNavItem(icon: Icons.shopping_bag_outlined, activeIcon: Icons.shopping_bag_rounded, label: t.myOrders),
        ],
      ),
    );
  }
}

class _SignedInListenable extends ChangeNotifier {
  _SignedInListenable(Ref ref) {
    ref.listen<bool>(signedInProvider, (_, _) => notifyListeners());
  }
}
