import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/ui.dart';
import '../../providers.dart';
import '../catalog/catalog_home_screen.dart' show ProductGrid;

/// The signed-in user's wishlist (null when signed out). The server's answer to every add / remove replaces the state,
/// so hearts on every screen always show what is really saved.
class WishlistNotifier extends AsyncNotifier<Wishlist?> {
  final _busy = <String>{};

  @override
  Future<Wishlist?> build() async {
    if (!ref.watch(signedInProvider)) return null;
    return ref.watch(mobileApiProvider).wishlist();
  }

  bool isBusy(String productId) => _busy.contains(productId);

  /// Saves or removes [productId]. One idempotency key per tap; a second tap while the first is in flight is ignored.
  Future<bool?> toggle(String productId) async {
    if (_busy.contains(productId)) return null;
    final saved = state.value?.productIds.contains(productId) ?? false;
    _busy.add(productId);
    try {
      final api = ref.read(mobileApiProvider);
      final key = newIdempotencyKey();
      final next = saved ? await api.removeFromWishlist(productId, idempotencyKey: key) : await api.addToWishlist(productId, idempotencyKey: key);
      state = AsyncData(next);
      return !saved;
    } finally {
      _busy.remove(productId);
    }
  }
}

final wishlistProvider = AsyncNotifierProvider<WishlistNotifier, Wishlist?>(WishlistNotifier.new);

/// Ids currently saved (empty while signed out or loading).
final wishlistIdsProvider = Provider<Set<String>>((ref) => {...?ref.watch(wishlistProvider).value?.productIds});

/// Heart tap from any screen: signed-out users go to sign-in first and come back; the result is announced.
Future<void> toggleWishlist(BuildContext context, WidgetRef ref, String productId) async {
  final t = EdmnLocalizations.of(context);
  if (!ref.read(signedInProvider)) {
    final here = GoRouterState.of(context).uri.toString();
    context.push('/sign-in?next=${Uri.encodeComponent(here)}');
    return;
  }
  try {
    final nowSaved = await ref.read(wishlistProvider.notifier).toggle(productId);
    if (nowSaved != null && context.mounted) showEdmnMessage(context, nowSaved ? t.wishlistAdded : t.wishlistRemoved);
  } catch (e) {
    if (context.mounted) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
  }
}

class WishlistScreen extends ConsumerStatefulWidget {
  const WishlistScreen({super.key});
  @override
  ConsumerState<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends ConsumerState<WishlistScreen> {
  @override
  void initState() {
    super.initState();
    // Items may have been saved elsewhere (the website, another device): reload from the server on every visit.
    // The previous list stays on screen while it refreshes.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.invalidate(wishlistProvider);
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final list = ref.watch(wishlistProvider);
    return EdmnAppScaffold(
      title: t.wishlistTitle,
      body: AsyncView<Wishlist?>(
        value: list,
        skeleton: true,
        onRetry: () => ref.invalidate(wishlistProvider),
        data: (w) {
          final items = w?.items ?? const <ProductCard>[];
          if (items.isEmpty) {
            return EdmnEmptyState(
              key: const Key('wishlist-empty'),
              icon: Icons.favorite_border_rounded,
              title: t.wishlistEmpty,
              message: t.wishlistEmptyHint,
              actionLabel: t.browseProducts,
              onAction: () => context.go('/'),
            );
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(wishlistProvider.future),
            child: ProductGrid(key: const Key('wishlist-grid'), items: items),
          );
        },
      ),
    );
  }
}
