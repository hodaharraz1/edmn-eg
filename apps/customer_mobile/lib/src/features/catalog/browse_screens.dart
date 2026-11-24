import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/ui.dart';
import '../cart/cart_providers.dart';
import 'catalog_home_screen.dart';
import 'catalog_providers.dart';
import '../wishlist/wishlist_screens.dart' show toggleWishlist, wishlistIdsProvider;

/// Board "الأقسام": search field and the category grid (from the database — no invented categories).
class CategoriesScreen extends ConsumerStatefulWidget {
  const CategoriesScreen({super.key});
  @override
  ConsumerState<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends ConsumerState<CategoriesScreen> {
  String _filter = '';

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final cats = ref.watch(categoriesProvider);
    final en = languageOf(context) == 'en';
    return EdmnAppScaffold(
      title: t.categories,
      showBack: false,
      body: Column(children: [
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.screen, EdmnSpacing.md, EdmnSpacing.screen, EdmnSpacing.xs),
          child: EdmnSearchBar(
            hint: t.searchCategoryHint,
            onChanged: (v) => setState(() => _filter = v.trim()),
            onSubmitted: (v) => v.trim().isEmpty ? null : context.push('/search?q=${Uri.encodeComponent(v.trim())}'),
          ),
        ),
        Expanded(
          child: AsyncView(
            value: cats,
            skeleton: true,
            onRetry: () => ref.invalidate(categoriesProvider),
            data: (list) {
              final shown = _filter.isEmpty ? list : list.where((c) => (en ? c.nameEn : c.nameAr).toLowerCase().contains(_filter.toLowerCase())).toList();
              if (shown.isEmpty) return EdmnEmptyState(icon: Icons.category_outlined, title: t.noResults);
              return GridView.builder(
                key: const PageStorageKey('categories'),
                padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, mainAxisSpacing: EdmnSpacing.sm, crossAxisSpacing: EdmnSpacing.sm, childAspectRatio: 0.82),
                itemCount: shown.length,
                itemBuilder: (_, i) => EdmnCategoryItem(
                  key: Key('category-${shown[i].slug}'),
                  label: en ? shown[i].nameEn : shown[i].nameAr,
                  icon: categoryIcon(shown[i].icon),
                  onTap: () => context.push('/categories/${shown[i].id}', extra: shown[i]),
                ),
              );
            },
          ),
        ),
      ]),
    );
  }
}

/// Products of a category, with subcategory pills, sorting, condition filter and pagination.
class CategoryProductsScreen extends ConsumerStatefulWidget {
  const CategoryProductsScreen({super.key, required this.categoryId, this.category});
  final String categoryId;
  final Category? category;
  @override
  ConsumerState<CategoryProductsScreen> createState() => _CategoryProductsScreenState();
}

class _CategoryProductsScreenState extends ConsumerState<CategoryProductsScreen> {
  late ProductQuery _q = ProductQuery(categoryId: widget.categoryId);

  Category? _find(List<Category> list, String id) {
    for (final c in list) {
      if (c.id == id) return c;
      final f = _find(c.children, id);
      if (f != null) return f;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final cats = ref.watch(categoriesProvider).value ?? const [];
    final cat = widget.category ?? _find(cats, widget.categoryId);
    final en = languageOf(context) == 'en';
    return EdmnAppScaffold(
      title: cat == null ? EdmnLocalizations.of(context).categories : (en ? cat.nameEn : cat.nameAr),
      actions: [IconButton(tooltip: EdmnLocalizations.of(context).searchTitle, color: EdmnColors.onPrimary, icon: Icon(Icons.search_rounded, semanticLabel: EdmnLocalizations.of(context).searchTitle), onPressed: () => context.push('/search'))],
      body: ProductListView(
        query: _q,
        onQuery: (q) => setState(() => _q = q),
        header: cat == null || cat.children.isEmpty
            ? null
            : SizedBox(
                height: 48,
                child: ListView.separated(
                  padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.screen),
                  scrollDirection: Axis.horizontal,
                  itemCount: cat.children.length,
                  separatorBuilder: (_, _) => const SizedBox(width: EdmnSpacing.xs),
                  itemBuilder: (_, i) => ActionChip(
                    label: Text(en ? cat.children[i].nameEn : cat.children[i].nameAr),
                    onPressed: () => context.push('/categories/${cat.children[i].id}', extra: cat.children[i]),
                  ),
                ),
              ),
      ),
    );
  }
}

/// Shared list body: sort + condition pills, grid, load-more footer, empty and error states.
class ProductListView extends ConsumerWidget {
  const ProductListView({super.key, required this.query, required this.onQuery, this.header});
  final ProductQuery query;
  final ValueChanged<ProductQuery> onQuery;
  final Widget? header;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final state = ref.watch(productListProvider(query));
    final sorts = [('recommended', t.all), ('newest', t.sortNewest), ('price_asc', t.sortPriceAsc), ('price_desc', t.sortPriceDesc), ('top_rated', t.sortRating)];
    return Column(children: [
      const SizedBox(height: EdmnSpacing.sm),
      ?header,
      EdmnFilterPills<String>(options: sorts, selected: query.sort, onSelected: (s) => onQuery(query.copyWith(sort: s))),
      const SizedBox(height: EdmnSpacing.xs),
      EdmnFilterPills<String>(
        options: [('', t.filterCondition), ('NEW', t.conditionNew), ('USED', t.conditionUsed)],
        selected: query.condition ?? '',
        onSelected: (c) => onQuery(c.isEmpty ? query.copyWith(clearCondition: true) : query.copyWith(condition: c)),
      ),
      Expanded(
        child: AsyncView(
          value: state,
          skeleton: true,
          onRetry: () => ref.invalidate(productListProvider(query)),
          data: (s) => NotificationListener<ScrollNotification>(
            onNotification: (n) {
              if (n.metrics.pixels > n.metrics.maxScrollExtent - 400) ref.read(productListProvider(query).notifier).loadMore();
              return false;
            },
            child: ProductGrid(
              items: s.items,
              footer: EdmnPagination(hasMore: s.hasMore, loading: s.loadingMore, error: s.error, onLoadMore: () => ref.read(productListProvider(query).notifier).loadMore()),
            ),
          ),
        ),
      ),
    ]);
  }
}

/// Search: input, recent searches (device only), results with sort/filter and pagination, no-results state.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key, this.initialQuery = '', this.initialSort});
  final String initialQuery;
  final String? initialSort;
  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  late final _controller = TextEditingController(text: widget.initialQuery);
  late ProductQuery? _q = widget.initialQuery.isEmpty && widget.initialSort == null ? null : ProductQuery(q: widget.initialQuery, sort: widget.initialSort ?? 'recommended');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit(String v) {
    final q = v.trim();
    ref.read(recentSearchesProvider.notifier).add(q);
    setState(() => _q = ProductQuery(q: q, sort: _q?.sort ?? 'recommended', condition: _q?.condition));
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final recent = ref.watch(recentSearchesProvider).value ?? const [];
    return EdmnAppScaffold(
      title: t.searchTitle,
      body: Column(children: [
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.screen, EdmnSpacing.md, EdmnSpacing.screen, 0),
          child: EdmnSearchBar(
            hint: t.searchProductsHint,
            controller: _controller,
            autofocus: _q == null,
            onSubmitted: _submit,
            onClear: () {
              _controller.clear();
              setState(() => _q = null);
            },
          ),
        ),
        Expanded(
          child: _q == null
              ? ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
                  if (recent.isNotEmpty) ...[
                    Row(children: [
                      Expanded(child: Text(t.recentSearches, style: EdmnType.cardTitle.copyWith(color: EdmnColors.textPrimary))),
                      TextButton(onPressed: () => ref.read(recentSearchesProvider.notifier).clear(), child: Text(t.clear)),
                    ]),
                    Wrap(spacing: EdmnSpacing.xs, runSpacing: EdmnSpacing.xs, children: [
                      for (final r in recent)
                        ActionChip(
                          avatar: const Icon(Icons.history_rounded, size: EdmnSizes.iconSm),
                          label: Text(r),
                          onPressed: () {
                            _controller.text = r;
                            _submit(r);
                          },
                        ),
                    ]),
                  ],
                ])
              : ProductListView(query: _q!, onQuery: (q) => setState(() => _q = q)),
        ),
      ]),
    );
  }
}

/// Board "المنتج": large gallery, title, brand, rating, price, availability chip, quantity, description, and the
/// pinned "أضف إلى السلة". Variants, condition details, return policy, seller, specs and reviews follow below.
class ProductScreen extends ConsumerStatefulWidget {
  const ProductScreen({super.key, required this.slug});
  final String slug;
  @override
  ConsumerState<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends ConsumerState<ProductScreen> {
  String? _variantId;
  int _qty = 1;
  bool _adding = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final product = ref.watch(productProvider(widget.slug));
    final p = product.value;
    final variant = p == null || p.variants.isEmpty
        ? null
        : p.variants.firstWhere((v) => v.id == _variantId, orElse: () => p.variants.firstWhere((v) => v.available, orElse: () => p.variants.first));
    final saved = p != null && ref.watch(wishlistIdsProvider).contains(p.id);
    return EdmnAppScaffold(
      title: t.productTitle,
      actions: [
        if (p != null)
          Padding(
            padding: const EdgeInsetsDirectional.only(end: EdmnSpacing.xs),
            child: Center(child: EdmnSaveButton(key: const Key('product-save'), saved: saved, label: saved ? t.wishlistRemove : t.wishlistAdd, onPressed: () => toggleWishlist(context, ref, p.id))),
          ),
      ],
      bottomBar: variant == null
          ? null
          : EdmnPrimaryButton(
              key: const Key('add-to-cart'),
              label: variant.available ? t.addToCart : t.unavailable,
              icon: Icons.add_shopping_cart_rounded,
              loading: _adding,
              onPressed: !variant.available
                  ? null
                  : () async {
                      setState(() => _adding = true);
                      await addToCart(context, ref, variant.id, quantity: _qty);
                      if (mounted) setState(() => _adding = false);
                    },
            ),
      body: AsyncView(
        value: product,
        onRetry: () => ref.invalidate(productProvider(widget.slug)),
        data: (p) => ListView(padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.lg), children: [
          const SizedBox(height: EdmnSpacing.md),
          EdmnImageGallery(urls: [for (final i in p.images) i.url]),
          Padding(
            padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(languageOf(context) == 'en' && p.titleEn != null ? p.titleEn! : p.titleAr, style: EdmnType.section.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800)),
              if (p.brand != null) Text(t.brandLabel(languageOf(context) == 'en' ? p.brand!.name : (p.brand!.nameAr ?? p.brand!.name)), style: EdmnType.body.copyWith(color: EdmnColors.textSecondary)),
              if (p.ratingCount > 0) ...[
                const SizedBox(height: EdmnSpacing.xxs),
                Row(children: [
                  for (var i = 1; i <= 5; i++) Icon(i <= p.ratingAvg.round() ? Icons.star_rounded : Icons.star_border_rounded, color: EdmnColors.warning, size: EdmnSizes.icon),
                  const SizedBox(width: EdmnSpacing.xxs),
                  Text('(${p.ratingCount})', style: EdmnType.body.copyWith(color: EdmnColors.textSecondary)),
                ]),
              ],
              const SizedBox(height: EdmnSpacing.sm),
              Row(children: [
                Expanded(
                  child: Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: EdmnSpacing.xs, children: [
                    EgpText(variant?.pricePiastres, style: EdmnType.priceLarge.copyWith(color: EdmnColors.textPrimary)),
                    if (variant?.compareAtPricePiastres != null && variant!.compareAtPricePiastres! > variant.pricePiastres)
                      EgpText(variant.compareAtPricePiastres, style: EdmnType.body.copyWith(color: EdmnColors.textSecondary, decoration: TextDecoration.lineThrough)),
                  ]),
                ),
                EdmnStatusChip(label: variant?.available == true ? t.available : t.unavailable, tone: variant?.available == true ? EdmnTone.success : EdmnTone.danger),
              ]),
              const SizedBox(height: EdmnSpacing.sm),
              Row(children: [
                EdmnStatusChip(label: p.condition == 'USED' ? t.conditionUsed : t.conditionNew, tone: EdmnTone.info),
                const Spacer(),
                EdmnQuantityStepper(value: _qty, onChanged: variant?.available == true ? (v) => setState(() => _qty = v) : null),
              ]),
              if (p.variants.length > 1) ...[
                const SizedBox(height: EdmnSpacing.md),
                Text(t.chooseVariant, style: EdmnType.cardTitle.copyWith(color: EdmnColors.textPrimary)),
                const SizedBox(height: EdmnSpacing.xs),
                Wrap(spacing: EdmnSpacing.xs, runSpacing: EdmnSpacing.xs, children: [
                  for (final v in p.variants)
                    ChoiceChip(
                      key: Key('variant-${v.id}'),
                      label: Text(v.label),
                      selected: v.id == variant?.id,
                      onSelected: v.available ? (_) => setState(() => _variantId = v.id) : null,
                    ),
                ]),
              ],
              const Divider(height: EdmnSpacing.xxl),
              _StoreRow(store: p.store),
              if (p.description != null && p.description!.isNotEmpty) ...[
                const SizedBox(height: EdmnSpacing.md),
                Text(t.productDescription, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                const SizedBox(height: EdmnSpacing.xxs),
                Text(p.description!, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
              ],
              for (final (label, value) in [
                (t.conditionNotes, p.conditionNotes),
                (t.defects, p.defects),
                (t.includedAccessories, p.includedAccessories),
                (t.warranty, p.warrantyInfo),
              ])
                if (value != null && value.isNotEmpty) ...[
                  const SizedBox(height: EdmnSpacing.sm),
                  Text(label, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                  Text(value, style: EdmnType.body.copyWith(color: EdmnColors.textSecondary)),
                ],
              if (p.processingDays != null) ...[
                const SizedBox(height: EdmnSpacing.sm),
                EdmnNotice(message: t.processingDays(p.processingDays!), icon: Icons.local_shipping_outlined),
              ],
              if (p.specs.isNotEmpty) ...[
                const SizedBox(height: EdmnSpacing.md),
                Text(t.specifications, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                for (final s in p.specs)
                  Padding(
                    padding: const EdgeInsetsDirectional.symmetric(vertical: EdmnSpacing.xxs),
                    child: Row(children: [
                      Expanded(child: Text(s.name, style: EdmnType.body.copyWith(color: EdmnColors.textSecondary))),
                      Expanded(child: Text(s.value, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary))),
                    ]),
                  ),
              ],
              const SizedBox(height: EdmnSpacing.md),
              _Reviews(slug: p.slug),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _StoreRow extends StatelessWidget {
  const _StoreRow({required this.store});
  final ProductDetailStore store;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnCard(
      key: const Key('product-store'),
      onTap: () => context.push('/stores/${Uri.encodeComponent(store.slug)}'),
      padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
      child: Row(children: [
        const Icon(Icons.storefront_outlined, color: EdmnColors.primary),
        const SizedBox(width: EdmnSpacing.sm),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t.soldBy(store.name), style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
            if (store.verified) Text(t.verifiedSeller, style: EdmnType.caption.copyWith(color: EdmnColors.success)),
          ]),
        ),
        const Icon(Icons.chevron_right_rounded, color: EdmnColors.textSecondary),
      ]),
    );
  }
}

class _Reviews extends ConsumerWidget {
  const _Reviews({required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final reviews = ref.watch(productReviewsProvider(slug));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(t.reviews, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
      reviews.when(
        loading: () => const Padding(padding: EdgeInsetsDirectional.all(EdmnSpacing.md), child: Center(child: CircularProgressIndicator())),
        error: (e, _) => Text(apiErrorMessage(context, e), style: EdmnType.secondary.copyWith(color: EdmnColors.error)),
        data: (r) => r.items.isEmpty
            ? Text(t.noReviews, style: EdmnType.body.copyWith(color: EdmnColors.textSecondary))
            : Column(children: [for (final rv in r.items) ReviewTile(review: rv)]),
      ),
    ]);
  }
}

class ReviewTile extends StatelessWidget {
  const ReviewTile({super.key, required this.review});
  final Review review;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsetsDirectional.symmetric(vertical: EdmnSpacing.xs),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            for (var i = 1; i <= 5; i++) Icon(i <= review.rating ? Icons.star_rounded : Icons.star_border_rounded, color: EdmnColors.warning, size: EdmnSizes.iconSm),
            const SizedBox(width: EdmnSpacing.xs),
            Text(review.author, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
          ]),
          if (review.title != null) Text(review.title!, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
          if (review.body != null) Text(review.body!, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
          if (review.sellerResponse != null) Text('↳ ${review.sellerResponse!}', style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
        ]),
      );
}

/// PUBLIC store page for buyers (not the seller's private dashboard): profile, policy and the store's live products.
class StoreScreen extends ConsumerWidget {
  const StoreScreen({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final store = ref.watch(storeProvider(slug));
    return EdmnAppScaffold(
      title: store.value?.name ?? '',
      body: AsyncView(
        value: store,
        onRetry: () => ref.invalidate(storeProvider(slug)),
        data: (s) => Column(children: [
          Padding(
            padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              EdmnSellerSummary(
                name: s.name,
                subtitle: [if (s.ratingCount > 0) '★ ${s.ratingAvg.toStringAsFixed(1)} (${s.ratingCount})', '${s.productCount} ${t.productsCount}'].join(' · '),
                status: s.verified ? EdmnStatusChip(label: t.verifiedSeller, tone: EdmnTone.success) : null,
              ),
              if (s.description != null && s.description!.isNotEmpty) ...[
                const SizedBox(height: EdmnSpacing.sm),
                Text(s.description!, maxLines: 3, overflow: TextOverflow.ellipsis, style: EdmnType.body.copyWith(color: EdmnColors.textSecondary)),
              ],
              if (s.reviews.isNotEmpty) ...[
                const SizedBox(height: EdmnSpacing.xs),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton.icon(
                    key: const Key('store-reviews'),
                    icon: const Icon(Icons.star_rounded, color: EdmnColors.warning),
                    label: Text('${t.reviews} (${s.ratingCount})'),
                    onPressed: () => showEdmnBottomSheet(context, title: t.reviews, child: Column(children: [for (final rv in s.reviews) ReviewTile(review: rv)])),
                  ),
                ),
              ],
              const SizedBox(height: EdmnSpacing.sm),
              EdmnNotice(
                icon: Icons.assignment_return_outlined,
                message: s.acceptsVoluntaryReturns && s.voluntaryReturnDays != null ? t.storeReturns(s.voluntaryReturnDays!) : t.storeNoVoluntaryReturns,
              ),
            ]),
          ),
          Expanded(child: _StoreProducts(slug: slug)),
        ]),
      ),
    );
  }
}

class _StoreProducts extends StatefulWidget {
  const _StoreProducts({required this.slug});
  final String slug;
  @override
  State<_StoreProducts> createState() => _StoreProductsState();
}

class _StoreProductsState extends State<_StoreProducts> {
  late ProductQuery _q = ProductQuery(storeSlug: widget.slug);
  @override
  Widget build(BuildContext context) => ProductListView(query: _q, onQuery: (q) => setState(() => _q = q));
}
