import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/ui.dart';
import '../../providers.dart';
import '../catalog/catalog_home_screen.dart' show pickGovernorate;
import 'cart_providers.dart';

/// Board "السلة": lines grouped by seller (multi-seller), quantity stepper, delete, server totals, "إتمام الشراء".
/// Every number on this screen is the server's; the app never adds prices up itself.
class CartScreen extends ConsumerStatefulWidget {
  const CartScreen({super.key});
  @override
  ConsumerState<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends ConsumerState<CartScreen> {
  final Set<String> _busy = {};
  bool _acking = false;

  Future<void> _setQty(String variantId, int qty) async {
    setState(() => _busy.add(variantId));
    await runAction(context, () => ref.read(mobileApiProvider).setCartQuantity(variantId, qty));
    ref.invalidate(cartProvider);
    await ref.read(cartProvider.future).catchError((_) => null);
    if (mounted) setState(() => _busy.remove(variantId));
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final signedIn = ref.watch(signedInProvider);
    final cart = ref.watch(cartProvider);
    final c = cart.value;
    return EdmnAppScaffold(
      title: c == null || c.itemCount == 0 ? t.cartTitle : '${t.cartTitle} ${t.cartCount(c.itemCount)}',
      bottomBar: c == null || c.groups.isEmpty
          ? null
          : Padding(
              // The cart is a main tab: keep «إتمام الشراء» above the floating bar.
              padding: const EdgeInsetsDirectional.only(bottom: EdmnFloatingNavigation.barHeight + EdmnSpacing.sm),
              child: EdmnPrimaryButton(
                key: const Key('checkout'),
                label: t.checkoutCta,
                onPressed: c.hasIssues ? null : () => context.push('/checkout'),
              ),
            ),
      body: !signedIn
          ? EdmnEmptyState(
              icon: Icons.shopping_cart_outlined,
              title: t.cartTitle,
              message: t.signInToCheckout,
              actionLabel: t.signIn,
              onAction: () => context.push('/sign-in?next=/cart'),
            )
          : AsyncView(
              value: cart,
              skeleton: true,
              onRetry: () => ref.invalidate(cartProvider),
              data: (c) => c == null || c.groups.isEmpty
                  ? EdmnEmptyState(icon: Icons.shopping_cart_outlined, title: t.cartEmptyTitle, message: t.cartEmptyBody, actionLabel: t.browseProducts, onAction: () => context.go('/'))
                  : RefreshIndicator(
                      onRefresh: () => ref.refresh(cartProvider.future),
                      child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
                        if (c.groups.any((g) => g.lines.any((l) => l.issues.contains('PRICE_CHANGED')))) ...[
                          EdmnNotice(message: t.priceChangedReview, tone: EdmnTone.warning),
                          const SizedBox(height: EdmnSpacing.xs),
                          EdmnSecondaryButton(
                            key: const Key('ack-prices'),
                            label: t.acknowledgePrices,
                            loading: _acking,
                            onPressed: () async {
                              setState(() => _acking = true);
                              await runAction(context, () => ref.read(mobileApiProvider).acknowledgeCartPrices());
                              ref.invalidate(cartProvider);
                              if (mounted) setState(() => _acking = false);
                            },
                          ),
                          const SizedBox(height: EdmnSpacing.sm),
                        ],
                        for (final g in c.groups) _SellerGroup(group: g, busy: _busy, onQty: _setQty),
                        if (!c.shippingResolved)
                          Padding(
                            padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
                            child: EdmnCard(
                              key: const Key('cart-governorate'),
                              onTap: () => pickGovernorate(context, ref),
                              padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
                              child: Row(children: [
                                const Icon(Icons.location_on_outlined, color: EdmnColors.primary),
                                const SizedBox(width: EdmnSpacing.xs),
                                Expanded(child: Text(t.selectGovernorate, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary))),
                                const Icon(Icons.chevron_right_rounded, color: EdmnColors.textSecondary),
                              ]),
                            ),
                          ),
                        if (c.pricingUnavailableAr != null) ...[EdmnNotice(message: c.pricingUnavailableAr!, tone: EdmnTone.danger), const SizedBox(height: EdmnSpacing.sm)],
                        EdmnAmountSummary(
                          rows: [
                            (t.subtotal, c.merchandiseTotalPiastres),
                            (t.shippingFee, c.shippingResolved ? c.shippingTotalPiastres : null),
                            if (c.buyerFeeTotalPiastres > 0) (t.buyerFee, c.buyerFeeTotalPiastres),
                            if (c.discountTotalPiastres > 0) (t.discount, -c.discountTotalPiastres),
                          ],
                          totalLabel: t.total,
                          totalPiastres: c.grandTotalPiastres,
                          note: c.shippingResolved ? null : t.shippingNotPriced,
                        ),
                      ]),
                    ),
            ),
    );
  }
}

class _SellerGroup extends StatelessWidget {
  const _SellerGroup({required this.group, required this.busy, required this.onQty});
  final CartGroupsItem group;
  final Set<String> busy;
  final Future<void> Function(String variantId, int qty) onQty;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final g = group;
    return EdmnCard(
      margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
      padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Icon(Icons.storefront_outlined, color: EdmnColors.primary, size: EdmnSizes.iconSm),
          const SizedBox(width: EdmnSpacing.xxs),
          Expanded(child: Text(g.store.name, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w700))),
          if (g.store.verified) const Icon(Icons.verified_rounded, color: EdmnColors.primary, size: EdmnSizes.iconSm),
        ]),
        const Divider(height: EdmnSpacing.md),
        for (final l in g.lines) _CartLine(line: l, busy: busy.contains(l.variantId), onQty: onQty),
        Row(children: [
          Expanded(
            child: Text(
              g.shippingFeePiastres == null
                  ? t.shippingNotPriced
                  : (g.etaMinDays != null && g.etaMaxDays != null ? t.deliveryEta(g.etaMinDays!, g.etaMaxDays!) : t.shippingFee),
              style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary),
            ),
          ),
          if (g.shippingFeePiastres != null) EgpText(g.shippingFeePiastres, style: EdmnType.secondary.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700)),
        ]),
      ]),
    );
  }
}

class _CartLine extends StatelessWidget {
  const _CartLine({required this.line, required this.busy, required this.onQty});
  final CartGroupsItemLinesItem line;
  final bool busy;
  final Future<void> Function(String variantId, int qty) onQty;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final l = line;
    String issue(String code) => switch (code) {
          'UNAVAILABLE' => t.issueUnavailable,
          'INSUFFICIENT_STOCK' => t.issueInsufficientStock,
          'PRICE_CHANGED' => t.issuePriceChanged(formatEgpFor(context, l.priceSeenPiastres)),
          'SELLER_UNAVAILABLE' => t.issueSellerUnavailable,
          'NO_SHIPPING' => t.noShippingToArea,
          _ => code,
        };
    return Padding(
      key: Key('cart-line-${l.variantId}'),
      padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        InkWell(onTap: () => context.push('/products/${Uri.encodeComponent(l.productSlug)}'), child: EdmnThumb(url: l.imageUrl, size: 72)),
        const SizedBox(width: EdmnSpacing.sm),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(l.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700)),
            if (l.variantLabel.isNotEmpty) Text(l.variantLabel, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
            for (final i in l.issues) Text(issue(i), style: EdmnType.secondary.copyWith(color: i == 'PRICE_CHANGED' ? EdmnColors.warning : EdmnColors.error, fontWeight: FontWeight.w700)),
            const SizedBox(height: EdmnSpacing.xs),
            Row(children: [
              EdmnQuantityStepper(value: l.quantity, busy: busy, min: 1, onChanged: (v) => onQty(l.variantId, v)),
              const SizedBox(width: EdmnSpacing.xs),
              Expanded(
                child: Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: FittedBox(fit: BoxFit.scaleDown, child: EgpText(l.lineTotalPiastres, style: EdmnType.price.copyWith(color: EdmnColors.textPrimary))),
                ),
              ),
            ]),
          ]),
        ),
        IconButton(
          key: Key('remove-${l.variantId}'),
          tooltip: t.remove,
          icon: Icon(Icons.delete_outline_rounded, color: EdmnColors.textPrimary, semanticLabel: t.remove),
          onPressed: busy
              ? null
              : () async {
                  if (await showEdmnConfirmation(context, title: t.remove, message: t.removeFromCartConfirm, confirmLabel: t.remove, destructive: true)) {
                    await onQty(l.variantId, 0);
                  }
                },
        ),
      ]),
    );
  }
}

String formatEgpFor(BuildContext context, int? piastres) => formatEgp(piastres, languageCode: languageOf(context));
