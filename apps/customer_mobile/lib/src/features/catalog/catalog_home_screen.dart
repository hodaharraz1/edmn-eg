import 'dart:async';

import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/ui.dart';
import '../../providers.dart';
import '../account/account_screens.dart' show addressesProvider;
import '../cart/cart_providers.dart';
import 'catalog_providers.dart';
import '../wishlist/wishlist_screens.dart' show toggleWishlist, wishlistIdsProvider;

/// PKG-UI-01 home (reference video, 2026-11-26): a yellow-sunburst screen — pinned header (location pill, wishlist /
/// account / cart shortcuts, search bar), category chips, a large hero carousel of the featured products, the Protected
/// Deal banner, the featured rail and the latest grid. Every element is wired to the real providers/API; reference
/// elements with no real data source (flash-sale countdown, coupons row, sponsored card, installments banner,
/// recently-viewed rail) were removed per the owner's decision and are listed in the package report.
class CatalogHomeScreen extends ConsumerWidget {
  const CatalogHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final featured = ref.watch(featuredProductsProvider);
    final latest = ref.watch(latestProductsProvider);
    final clearance = EdmnFloatingNavigation.clearanceOf(context);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: ColoredBox(
        color: EdmnColors.warmBackground,
        child: Column(children: [
          const _SunburstHeader(),
          Expanded(
            child: RefreshIndicator(
              color: EdmnColors.primary,
              backgroundColor: EdmnColors.surface,
              onRefresh: () async {
                ref.invalidate(featuredProductsProvider);
                ref.invalidate(latestProductsProvider);
                ref.invalidate(categoriesProvider);
                await ref.read(featuredProductsProvider.future).catchError((_) => const SearchProductsResponse(items: [], page: 1, pageSize: 0, total: 0, pages: 0));
              },
              child: CustomScrollView(
                key: const PageStorageKey('home'),
                slivers: [
                  SliverToBoxAdapter(child: _CategoryChips(categories: ref.watch(categoriesProvider))),
                  SliverToBoxAdapter(
                    child: AsyncView(
                      value: featured,
                      onRetry: () => ref.invalidate(featuredProductsProvider),
                      data: (r) => r.items.isEmpty ? const SizedBox.shrink() : _HeroCarousel(items: r.items),
                    ),
                  ),
                  const SliverToBoxAdapter(child: Padding(padding: EdgeInsetsDirectional.only(top: EdmnSpacing.md), child: _DealBanner())),
                  SliverToBoxAdapter(
                    child: EdmnSectionHeader(
                      title: t.featuredProducts,
                      icon: Icons.diamond_outlined,
                      actionLabel: t.seeAll,
                      onAction: () => context.push('/search'),
                    ),
                  ),
                  SliverToBoxAdapter(
                    child: SizedBox(
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
                  ),
                  SliverToBoxAdapter(
                    child: EdmnSectionHeader(
                      title: t.latestProducts,
                      icon: Icons.new_releases_outlined,
                      actionLabel: t.seeAll,
                      onAction: () => context.push('/search?sort=newest'),
                    ),
                  ),
                  SliverToBoxAdapter(
                    child: AsyncView(
                      value: latest,
                      onRetry: () => ref.invalidate(latestProductsProvider),
                      data: (r) => ProductGrid(items: r.items, shrinkWrap: true),
                    ),
                  ),
                  SliverToBoxAdapter(child: SizedBox(height: clearance)),
                ],
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Pinned sunburst header (the reference keeps it fixed while the content scrolls): location pill, wishlist /
/// account / cart circle buttons and the white search bar with the cycling hint.
class _SunburstHeader extends ConsumerWidget {
  const _SunburstHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final cartCount = ref.watch(cartCountProvider);
    return EdmnSunburstBackground(
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.screen, EdmnSpacing.xs, EdmnSpacing.screen, EdmnSpacing.md),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              const Expanded(child: _LocationPill()),
              _CircleButton(
                key: const Key('home-cart'),
                icon: Icons.shopping_cart_outlined,
                badge: cartCount,
                tooltip: t.cartTitle,
                onTap: () => context.go('/cart'),
              ),
              const SizedBox(width: EdmnSpacing.xs),
              _CircleButton(
                key: const Key('home-account'),
                icon: Icons.person_outline_rounded,
                tooltip: t.accountTitle,
                onTap: () => context.push('/account'),
              ),
              const SizedBox(width: EdmnSpacing.xs),
              _CircleButton(
                key: const Key('home-wishlist'),
                icon: Icons.favorite_rounded,
                tooltip: t.wishlistTitle,
                filled: true,
                onTap: () => context.push('/account/wishlist'),
              ),
            ]),
            const SizedBox(height: EdmnSpacing.sm),
            const _SearchPill(),
          ]),
        ),
      ),
    );
  }
}

/// "المنزل - دمياط كورنيش النيل …": the signed-in user's default address, else the chosen governorate (which prices
/// shipping). Signed-out users pick a governorate; signed-in users manage addresses. Real data only.
class _LocationPill extends ConsumerWidget {
  const _LocationPill();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final signedIn = ref.watch(signedInProvider);
    final gov = ref.watch(governorateProvider);
    final governorates = ref.watch(governoratesProvider).value ?? const [];
    final addresses = signedIn ? (ref.watch(addressesProvider).value ?? const <Address>[]) : const <Address>[];
    final current = addresses.where((a) => a.isDefault).firstOrNull ?? addresses.firstOrNull;
    final govName = governorates.where((g) => g.id == gov).firstOrNull;
    final text = current != null
        ? '${current.label ?? t.homeLabel} - ${current.street}'
        : (govName == null ? t.selectGovernorate : (languageOf(context) == 'en' ? govName.nameEn : govName.nameAr));
    return Semantics(
      button: true,
      label: t.deliveryAddress,
      child: InkWell(
        key: const Key('governorate'),
        onTap: () => signedIn ? context.push('/account/addresses') : pickGovernorate(context, ref),
        borderRadius: BorderRadius.circular(EdmnRadii.chip),
        child: Container(
          height: 44,
          padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.sm),
          decoration: BoxDecoration(
            color: EdmnColors.surface,
            borderRadius: BorderRadius.circular(EdmnRadii.chip),
            boxShadow: EdmnShadows.card,
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.home_rounded, color: EdmnColors.sunburstText, size: EdmnSizes.icon),
            const SizedBox(width: EdmnSpacing.xxs),
            Flexible(
              child: Text(
                text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: EdmnType.secondary.copyWith(color: EdmnColors.sunburstText, fontWeight: FontWeight.w700),
              ),
            ),
            const Icon(Icons.keyboard_arrow_down_rounded, color: EdmnColors.sunburstText, size: EdmnSizes.iconSm),
          ]),
        ),
      ),
    );
  }
}

class _CircleButton extends StatelessWidget {
  const _CircleButton({super.key, required this.icon, required this.tooltip, required this.onTap, this.badge = 0, this.filled = false});
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final int badge;
  final bool filled;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: badge > 0 ? '$tooltip ($badge)' : tooltip,
        excludeSemantics: true,
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: filled ? EdmnColors.surface : EdmnColors.surface.withValues(alpha: 0.75),
              shape: BoxShape.circle,
              boxShadow: EdmnShadows.card,
            ),
            child: Badge(
              isLabelVisible: badge > 0,
              backgroundColor: EdmnColors.brandRed,
              label: Text('$badge'),
              child: Icon(icon, color: filled ? EdmnColors.brandRed : EdmnColors.sunburstText, size: EdmnSizes.icon),
            ),
          ),
        ),
      );
}

/// The reference search bar: a white pill with a search icon and a hint that cycles through example searches. The
/// cycling is a text-only animation; under "تقليل الحركة" the first hint is shown statically.
class _SearchPill extends ConsumerStatefulWidget {
  const _SearchPill();
  @override
  ConsumerState<_SearchPill> createState() => _SearchPillState();
}

class _SearchPillState extends ConsumerState<_SearchPill> {
  Timer? _timer;
  int _index = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduce = MediaQuery.disableAnimationsOf(context);
    if (reduce && _timer != null) {
      _timer!.cancel();
      _timer = null;
    } else if (!reduce && _timer == null) {
      _timer = Timer.periodic(const Duration(milliseconds: 2800), (_) {
        if (mounted) setState(() => _index++);
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final hints = [t.searchHintPhones, t.searchHintWatches, t.searchHintConsoles, t.searchHintAppliances];
    final hint = hints[_index % hints.length];
    return Semantics(
      button: true,
      label: t.searchProductsHint,
      child: InkWell(
        key: const Key('home-search'),
        onTap: () => context.push('/search'),
        borderRadius: BorderRadius.circular(EdmnRadii.chip),
        child: Container(
          height: 48,
          padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.md),
          decoration: BoxDecoration(
            color: EdmnColors.surface,
            borderRadius: BorderRadius.circular(EdmnRadii.chip),
            boxShadow: EdmnShadows.card,
          ),
          child: Row(children: [
            const Icon(Icons.search_rounded, color: EdmnColors.textSecondary, size: EdmnSizes.icon),
            const SizedBox(width: EdmnSpacing.xs),
            Expanded(
              child: AnimatedSwitcher(
                duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : EdmnMotion.normal,
                child: Text(
                  hint,
                  key: ValueKey(hint),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EdmnType.body.copyWith(color: EdmnColors.textSecondary),
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

/// "اشترى حسب الفئة": a real «عروض» chip (the Protected Deals hub) then the API categories as yellow icon chips.
class _CategoryChips extends StatelessWidget {
  const _CategoryChips({required this.categories});
  final AsyncValue<List<Category>> categories;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final cats = categories.value ?? const <Category>[];
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.screen, EdmnSpacing.sm, EdmnSpacing.screen, EdmnSpacing.xs),
        child: Text(
          t.shopByCategory,
          style: EdmnType.cardTitle.copyWith(color: EdmnColors.sunburstText, fontWeight: FontWeight.w800),
        ),
      ),
      SizedBox(
        height: 88,
        child: ListView.separated(
          padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.screen),
          scrollDirection: Axis.horizontal,
          itemCount: cats.length + 1,
          separatorBuilder: (_, _) => const SizedBox(width: EdmnSpacing.sm),
          itemBuilder: (_, i) {
            if (i == 0) {
              return _Chip(label: t.offersLabel, icon: Icons.local_offer_rounded, onTap: () => context.push('/deals'));
            }
            final c = cats[i - 1];
            return _Chip(
              label: languageOf(context) == 'en' ? c.nameEn : c.nameAr,
              icon: categoryIcon(c.icon),
              onTap: () => context.push('/categories/${c.id}', extra: c),
            );
          },
        ),
      ),
    ]);
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.icon, required this.onTap});
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: label,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(EdmnRadii.card),
          child: SizedBox(
            width: 64,
            child: Column(children: [
              Container(
                width: 56,
                height: 56,
                decoration: const BoxDecoration(color: EdmnColors.primaryLight, shape: BoxShape.circle, boxShadow: EdmnShadows.card),
                child: Icon(icon, color: EdmnColors.primary, size: EdmnSizes.icon),
              ),
              const SizedBox(height: EdmnSpacing.xxs),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: EdmnType.caption.copyWith(color: EdmnColors.sunburstText, fontWeight: FontWeight.w700),
              ),
            ]),
          ),
        ),
      );
}

/// The reference hero: large full-bleed product cards (real featured products) with a dark gradient overlay carrying
/// the name, the EGP price and the real discount percentage. Swipe between cards.
class _HeroCarousel extends ConsumerStatefulWidget {
  const _HeroCarousel({required this.items});
  final List<ProductCard> items;
  @override
  ConsumerState<_HeroCarousel> createState() => _HeroCarouselState();
}

class _HeroCarouselState extends ConsumerState<_HeroCarousel> {
  final _controller = PageController(viewportFraction: 0.82);
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.items.take(8).toList();
    return Column(children: [
      SizedBox(
        height: 380,
        child: PageView.builder(
          controller: _controller,
          padEnds: false,
          onPageChanged: (i) => setState(() => _page = i),
          itemCount: items.length,
          itemBuilder: (_, i) => Padding(
            padding: const EdgeInsetsDirectional.only(start: EdmnSpacing.screen, end: EdmnSpacing.xs, top: EdmnSpacing.xs, bottom: EdmnSpacing.xs),
            child: _HeroCard(product: items[i]),
          ),
        ),
      ),
      const SizedBox(height: EdmnSpacing.xs),
      _Dots(count: items.length, index: _page, reduceMotion: MediaQuery.disableAnimationsOf(context)),
    ]);
  }
}

class _Dots extends StatelessWidget {
  const _Dots({required this.count, required this.index, required this.reduceMotion});
  final int count;
  final int index;
  final bool reduceMotion;

  @override
  Widget build(BuildContext context) => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 0; i < count; i++)
          AnimatedContainer(
            duration: reduceMotion ? Duration.zero : EdmnMotion.fast,
            margin: const EdgeInsetsDirectional.symmetric(horizontal: 2),
            width: i == index ? 18 : 6,
            height: 6,
            decoration: BoxDecoration(
              color: i == index ? EdmnColors.sunburstText : EdmnColors.disabled,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
      ]);
}

class _HeroCard extends ConsumerWidget {
  const _HeroCard({required this.product});
  final ProductCard product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final p = product;
    final price = p.minPricePiastres;
    final compareAt = p.compareAtPricePiastres;
    final percent = (price != null && compareAt != null && compareAt > price) ? (((compareAt - price) / compareAt) * 100).round() : null;
    return EdmnCard(
      key: Key('hero-${p.slug}'),
      onTap: () => context.push('/products/${Uri.encodeComponent(p.slug)}'),
      padding: EdgeInsetsDirectional.zero,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(EdmnRadii.card),
        child: Stack(fit: StackFit.expand, children: [
          ColoredBox(
            color: EdmnColors.subtle,
            child: EdmnNetworkImage(url: p.imageUrl, fit: BoxFit.cover),
          ),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: AlignmentDirectional.topCenter,
                end: AlignmentDirectional.bottomCenter,
                colors: [Color(0x00000000), Color(0xCC101826)],
                stops: [0.45, 1.0],
              ),
            ),
          ),
          if (percent != null)
            PositionedDirectional(
              top: EdmnSpacing.sm,
              start: EdmnSpacing.sm,
              child: Container(
                padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.sm, vertical: EdmnSpacing.xxs),
                decoration: BoxDecoration(color: EdmnColors.promoRed, borderRadius: BorderRadius.circular(EdmnRadii.small)),
                child: Text(
                  t.discountPercentLabel(percent),
                  style: EdmnType.bodyStrong.copyWith(color: EdmnColors.onPrimary, fontWeight: FontWeight.w800),
                ),
              ),
            ),
          PositionedDirectional(
            top: EdmnSpacing.sm,
            end: EdmnSpacing.sm,
            child: EdmnSaveButton(
              saved: ref.watch(wishlistIdsProvider).contains(p.id),
              onPressed: () => toggleWishlist(context, ref, p.id),
              label: ref.watch(wishlistIdsProvider).contains(p.id) ? t.wishlistRemove : t.wishlistAdd,
            ),
          ),
          PositionedDirectional(
            start: EdmnSpacing.md,
            end: EdmnSpacing.md,
            bottom: EdmnSpacing.md,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(
                p.titleAr,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: EdmnType.cardTitle.copyWith(color: EdmnColors.onPrimary, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: EdmnSpacing.xxs),
              Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: EdmnSpacing.xs, children: [
                EgpText(price, style: EdmnType.price.copyWith(color: EdmnColors.onPrimary, fontWeight: FontWeight.w800)),
                if (percent != null)
                  EgpText(
                    compareAt,
                    style: EdmnType.secondary.copyWith(color: EdmnColors.onPrimary.withValues(alpha: 0.75), decoration: TextDecoration.lineThrough),
                  ),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// Governorate for delivery pricing (Egyptian governorates from the database, never hardcoded).
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
