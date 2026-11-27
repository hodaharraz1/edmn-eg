import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers.dart';

/// The server-priced cart (null when signed out — the mobile cart belongs to the account).
final cartProvider = FutureProvider<Cart?>((ref) async {
  if (!ref.watch(signedInProvider)) return null;
  return ref.watch(mobileApiProvider).cart(governorateId: ref.watch(governorateProvider));
});

final cartCountProvider = Provider<int>((ref) => ref.watch(cartProvider).value?.itemCount ?? 0);

/// Adds a variant to the cart. Signed-out users go to sign-in first and come back. One idempotency key per tap.
/// The confirmation offers «شوف السلة»; [quiet] skips it (used by «اشتري دلوقتي», which goes straight to checkout).
Future<bool> addToCart(BuildContext context, WidgetRef ref, String variantId, {int quantity = 1, bool quiet = false}) async {
  final t = EdmnLocalizations.of(context);
  if (!ref.read(signedInProvider)) {
    final here = GoRouterState.of(context).uri.toString();
    context.push('/sign-in?next=${Uri.encodeComponent(here)}');
    return false;
  }
  try {
    await ref.read(mobileApiProvider).addToCart(variantId, quantity, idempotencyKey: newIdempotencyKey());
    ref.invalidate(cartProvider);
    if (context.mounted && !quiet) {
      final router = GoRouter.of(context);
      showEdmnMessage(context, t.addedToCart, actionLabel: t.viewCart, onAction: () => router.push('/cart'));
    }
    return true;
  } catch (e) {
    if (context.mounted) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
    return false;
  }
}
