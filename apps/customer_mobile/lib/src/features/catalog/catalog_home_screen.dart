import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/ui.dart';
import '../../providers.dart';
import '../cart/cart_providers.dart';
import 'catalog_providers.dart';
import '../wishlist/wishlist_screens.dart' show toggleWishlist, wishlistIdsProvider;

/// Board "الرئيسية": blue header (logo, account and cart shortcuts, tagline, governorate, guarantee badge, search,
/// category icon row) and the white sheet with the Protected Deal banner and product carousels from the API.
class CatalogHomeScreen extends ConsumerWidget {
  const CatalogHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final featured = ref.watch(featuredProductsProvider);
    final latest = ref.watch(latestProductsProvider);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: ColoredBox(
        color: EdmnColors.primaryDark,
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(featuredProductsProvider);
            ref.invalidate(latestProductsProvider);
            ref.invalidate(categoriesProvider);
            await ref.read(featuredProductsProvider.future).catchError((_) => const SearchProductsResponse(items: [], page: 1, pageSize: 0, total: 0, pages: 0));
          },
          child: CustomScrollView(
            key: const PageStorageKey('home'),
            slivers: [
              const SliverToBoxAdapter(child: _HomeHeader()),
              SliverToBoxAdapter(
                child: Container(
                  decoration: const BoxDecoration(color: EdmnColors.surface, borderRadius: BorderRadius.vertical(top: Radius.circular(EdmnRadii.sheet))),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    const SizedBox(height: EdmnSpacing.md),
                    const _DealBanner(),
                    EdmnSectionHeader(title: t.featuredProducts, icon: Icons.diamond_outlined, actionLabel: t.seeAll, onAction: () => context.push('/search')),
                    SizedBox(
                      height: 300,
                      child: AsyncView(
                        value: featured,
                        onRetry: () => ref.invalidate(featuredProductsProvider),
                        data: (r) => r.items.isEmpty
                            ? EdmnEmptyState(icon: Icons.inventory_2_outlined, title: t.noProductsTitle)
                            : ListView.separated(
                                padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.screen),
                                scrollDirection: Axis.horizontal,
                                itemCount: r.items.length,
                                separatorBuilder: (_, _) => const SizedBox(width: EdmnSpacing.sm),
                                itemBuilder: (_, i) => ProductCardTile(product: r.items[i]),
                              ),
                      ),
                    ),
                    EdmnSectionHeader(title: t.latestProducts, icon: Icons.new_releases_outlined, actionLabel: t.seeAll, onAction: () => context.push('/search?sort=newest')),
                  ]),
                ),
              ),
              SliverToBoxAdapter(
                child: ColoredBox(
                  color: EdmnColors.surface,
                  child: AsyncView(
                    value: latest,
                    onRetry: () => ref.invalidate(latestProductsProvider),
                    data: (r) => ProductGrid(items: r.items, shrinkWrap: true),
                  ),
                ),
              ),
              const SliverFillRemaining(hasScrollBody: false, child: ColoredBox(color: EdmnColors.surface)),
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeHeader extends ConsumerWidget {
  const _HomeHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final cartCount = ref.watch(cartCountProvider);
    final categories = ref.watch(categoriesProvider);
    return DecoratedBox(
      decoration: const BoxDecoration(gradient: EdmnColors.headerGradient),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.screen, EdmnSpacing.xs, EdmnSpacing.screen, EdmnSpacing.lg),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              // Start (right in Arabic): original logo + "ماركت", then the tagline and the governorate selector.
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const EdmnLogo(variant: EdmnLogoVariant.onDark, height: 48),
                    const SizedBox(width: EdmnSpacing.xs),
                    Flexible(child: Text(t.marketLabel, maxLines: 1, overflow: TextOverflow.ellipsis, style: EdmnType.cardTitle.copyWith(color: EdmnColors.accentCyan, fontWeight: FontWeight.w700))),
                  ]),
                  const SizedBox(height: EdmnSpacing.xs),
                  Text(t.homeTagline, style: EdmnType.section.copyWith(color: EdmnColors.onPrimary, fontWeight: FontWeight.w800)),
                  const _GovernorateSelector(),
                ]),
              ),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Row(mainAxisSize: MainAxisSize.min, children: [
                  _CircleIcon(
                    key: const Key('home-cart'),
                    icon: Icons.shopping_cart_outlined,
                    badge: cartCount,
                    tooltip: t.cartTitle,
                    onTap: () => context.push('/cart'),
                  ),
                  const SizedBox(width: EdmnSpacing.xs),
                  _CircleIcon(key: const Key('home-account'), icon: Icons.person_rounded, tooltip: t.accountTitle, onTap: () => context.push('/account')),
                ]),
                const SizedBox(height: EdmnSpacing.md),
                Container(
                  padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.sm, vertical: EdmnSpacing.xxs),
                  decoration: BoxDecoration(color: EdmnColors.primary.withValues(alpha: 0.65), borderRadius: BorderRadius.circular(EdmnRadii.chip), border: Border.all(color: EdmnColors.accentCyan.withValues(alpha: 0.4))),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(t.shopSafeBadge, textAlign: TextAlign.end, style: EdmnType.caption.copyWith(color: EdmnColors.onPrimary, fontWeight: FontWeight.w700)),
                    const SizedBox(width: EdmnSpacing.xxs),
                    const Icon(Icons.verified_user_rounded, color: EdmnColors.accentCyan, size: EdmnSizes.icon),
                  ]),
                ),
              ]),
            ]),
            const SizedBox(height: EdmnSpacing.md),
            EdmnSearchBar(hint: t.searchProductsHint, onDark: true, readOnly: true, onTap: () => context.push('/search')),
            const SizedBox(height: EdmnSpacing.md),
            SizedBox(
              height: 72,
              child: categories.when(
                loading: () => const SizedBox(),
                error: (_, _) => const SizedBox(),
                data: (cats) => ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: cats.length,
                  separatorBuilder: (_, _) => const SizedBox(width: EdmnSpacing.xs),
                  itemBuilder: (_, i) => EdmnCategoryItem(
                    compact: true,
                    onDark: true,
                    selected: i == 0,
                    label: languageOf(context) == 'en' ? cats[i].nameEn : cats[i].nameAr,
                    icon: categoryIcon(cats[i].icon),
                    onTap: () => context.push('/categories/${cats[i].id}', extra: cats[i]),
                  ),
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class _CircleIcon extends StatelessWidget {
  const _CircleIcon({super.key, required this.icon, required this.onTap, required this.tooltip, this.badge = 0});
  final IconData icon;
  final VoidCallback onTap;
  final String tooltip;
  final int badge;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: tooltip,
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: EdmnColors.primaryDeep.withValues(alpha: 0.7), shape: BoxShape.circle),
            child: Badge(
              isLabelVisible: badge > 0,
              backgroundColor: EdmnColors.brandRed,
              label: Text('$badge'),
              child: Icon(icon, color: EdmnColors.onPrimary, size: EdmnSizes.icon),
            ),
          ),
        ),
      );
}

/// Governorate for delivery pricing (Egyptian governorates from the database, never hardcoded).
class _GovernorateSelector extends ConsumerWidget {
  const _GovernorateSelector();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final gov = ref.watch(governorateProvider);
    final list = ref.watch(governoratesProvider).value ?? const [];
    final current = list.where((g) => g.id == gov).firstOrNull;
    final name = current == null ? t.selectGovernorate : (languageOf(context) == 'en' ? current.nameEn : current.nameAr);
    return InkWell(
      key: const Key('governorate'),
      onTap: () => pickGovernorate(context, ref),
      child: Padding(
        padding: const EdgeInsetsDirectional.symmetric(vertical: EdmnSpacing.xxs),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.location_on_outlined, color: EdmnColors.onPrimary, size: EdmnSizes.iconSm),
          const SizedBox(width: EdmnSpacing.xxs),
          Flexible(child: Text(name, overflow: TextOverflow.ellipsis, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.onPrimary))),
          const Icon(Icons.arrow_drop_down_rounded, color: EdmnColors.onPrimary),
        ]),
      ),
    );
  }
}

Future<void> pickGovernorate(BuildContext context, WidgetRef ref) async {
  final t = EdmnLocalizations.of(context);
  final list = await ref.read(governoratesProvider.future);
  if (!context.mounted) return;
  final picked = await showEdmnBottomSheet<int>(
    context,
    title: t.selectGovernorate,
    child: Column(children: [
      for (final g in list)
        ListTile(
          title: Text(languageOf(context) == 'en' ? g.nameEn : g.nameAr, style: EdmnType.body),
          trailing: g.id == ref.read(governorateProvider) ? const Icon(Icons.check_rounded, color: EdmnColors.primary) : null,
          onTap: () => Navigator.pop(context, g.id),
        ),
    ]),
  );
  if (picked != null) ref.read(governorateProvider.notifier).set(picked);
}

/// Board banner promoting أضمن صفقة (brand message, not data). The board's 3D cart illustration is not part of the
/// supplied assets, so the original emblem is used instead (recorded in VISUAL_AUDIT.md).
class _DealBanner extends StatelessWidget {
  const _DealBanner();

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.screen),
      child: InkWell(
        key: const Key('deal-banner'),
        onTap: () => context.push('/deals'),
        borderRadius: BorderRadius.circular(EdmnRadii.card),
        child: Container(
          constraints: const BoxConstraints(minHeight: 150),
          padding: const EdgeInsetsDirectional.all(EdmnSpacing.md),
          decoration: BoxDecoration(gradient: EdmnColors.headerGradient, borderRadius: BorderRadius.circular(EdmnRadii.card), boxShadow: EdmnShadows.card),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                Container(
                  padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.sm, vertical: EdmnSpacing.xxs),
                  decoration: BoxDecoration(color: EdmnColors.accentCyan, borderRadius: BorderRadius.circular(EdmnRadii.small)),
                  child: Text(t.protectedDealBannerTitle, style: EdmnType.section.copyWith(color: EdmnColors.primaryDeep, fontWeight: FontWeight.w800)),
                ),
                const SizedBox(height: EdmnSpacing.xs),
                Text(t.protectedDealBannerBody, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.onPrimary)),
                const SizedBox(height: EdmnSpacing.xs),
                Container(
                  padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.sm, vertical: EdmnSpacing.xxs),
                  decoration: BoxDecoration(color: EdmnColors.surface, borderRadius: BorderRadius.circular(EdmnRadii.chip)),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(t.shopNow, style: EdmnType.secondary.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                    const Icon(Icons.chevron_right_rounded, color: EdmnColors.primaryDark, size: EdmnSizes.iconSm),
                  ]),
                ),
              ]),
            ),
            const EdmnLogo(variant: EdmnLogoVariant.emblem, height: 70),
          ]),
        ),
      ),
    );
  }
}

/// Product card wired to the cart (server decides availability and price).
class ProductCardTile extends ConsumerStatefulWidget {
  const ProductCardTile({super.key, required this.product, this.width = 156});
  final ProductCard product;
  final double? width;
  @override
  ConsumerState<ProductCardTile> createState() => _ProductCardTileState();
}

class _ProductCardTileState extends ConsumerState<ProductCardTile> {
  bool _adding = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final p = widget.product;
    // Products with several variants open the detail page so the buyer chooses one.
    final direct = p.inStock && p.defaultVariantId != null && p.variantCount <= 1;
    return EdmnProductCard(
      key: Key('product-${p.slug}'),
      width: widget.width,
      title: p.titleAr,
      imageUrl: p.imageUrl,
      pricePiastres: p.minPricePiastres,
      compareAtPiastres: p.compareAtPricePiastres,
      badge: p.condition == 'USED' ? t.conditionUsed : null,
      unavailableLabel: p.inStock ? null : t.unavailable,
      addLabel: t.add,
      adding: _adding,
      saved: ref.watch(wishlistIdsProvider).contains(p.id),
      saveLabel: ref.watch(wishlistIdsProvider).contains(p.id) ? t.wishlistRemove : t.wishlistAdd,
      onToggleSaved: () => toggleWishlist(context, ref, p.id),
      onTap: () => context.push('/products/${Uri.encodeComponent(p.slug)}'),
      onAdd: () async {
        if (!direct) {
          context.push('/products/${Uri.encodeComponent(p.slug)}');
          return;
        }
        setState(() => _adding = true);
        await addToCart(context, ref, p.defaultVariantId!);
        if (mounted) setState(() => _adding = false);
      },
    );
  }
}

class ProductGrid extends StatelessWidget {
  const ProductGrid({super.key, required this.items, this.shrinkWrap = false, this.footer, this.controller});
  final List<ProductCard> items;
  final bool shrinkWrap;
  final Widget? footer;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    if (items.isEmpty) return EdmnEmptyState(icon: Icons.search_off_rounded, title: t.noProductsTitle, message: t.noProductsBody);
    return LayoutBuilder(builder: (context, c) {
      final columns = c.maxWidth >= 600 ? 3 : 2;
      return CustomScrollView(
        controller: controller,
        shrinkWrap: shrinkWrap,
        physics: shrinkWrap ? const NeverScrollableScrollPhysics() : null,
        slivers: [
          SliverPadding(
            padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.screen, vertical: EdmnSpacing.xs),
            sliver: SliverGrid(
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: columns, mainAxisSpacing: EdmnSpacing.sm, crossAxisSpacing: EdmnSpacing.sm, mainAxisExtent: 300),
              delegate: SliverChildBuilderDelegate((_, i) => ProductCardTile(product: items[i], width: null), childCount: items.length),
            ),
          ),
          if (footer != null) SliverToBoxAdapter(child: footer),
        ],
      );
    });
  }
}
