import 'package:edmn_api/mobile.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';

final categoriesProvider = FutureProvider<List<Category>>((ref) async => (await ref.watch(mobileApiProvider).categories()).items);

class SearchQueryController extends Notifier<String> {
  @override
  String build() => '';
  void set(String q) => state = q.trim();
}

final searchQueryProvider = NotifierProvider<SearchQueryController, String>(SearchQueryController.new);

/// Home carousels (server ordering; no client-side "featured" invention).
final featuredProductsProvider = FutureProvider<SearchProductsResponse>((ref) => ref.watch(mobileApiProvider).searchProducts(sort: 'recommended', pageSize: 10));
final latestProductsProvider = FutureProvider<SearchProductsResponse>((ref) => ref.watch(mobileApiProvider).searchProducts(sort: 'newest', pageSize: 12));

/// Search / category listing parameters (kept while navigating back, as the directive requires).
class ProductQuery {
  const ProductQuery({this.q = '', this.categoryId, this.sort = 'recommended', this.condition, this.storeSlug});
  final String? storeSlug;
  final String q;
  final String? categoryId;
  final String sort;
  final String? condition;

  ProductQuery copyWith({String? q, String? categoryId, String? sort, String? condition, bool clearCondition = false}) =>
      ProductQuery(q: q ?? this.q, categoryId: categoryId ?? this.categoryId, sort: sort ?? this.sort, condition: clearCondition ? null : (condition ?? this.condition), storeSlug: storeSlug);

  @override
  bool operator ==(Object other) => other is ProductQuery && other.q == q && other.categoryId == categoryId && other.sort == sort && other.condition == condition && other.storeSlug == storeSlug;
  @override
  int get hashCode => Object.hash(q, categoryId, sort, condition, storeSlug);
}

/// Paginated product list for a query. Pages are appended; a failed page keeps the loaded ones.
class ProductListState {
  const ProductListState({this.items = const [], this.page = 0, this.pages = 1, this.total = 0, this.loadingMore = false, this.error});
  final List<ProductCard> items;
  final int page;
  final int pages;
  final int total;
  final bool loadingMore;
  final Object? error;
  bool get hasMore => page < pages;
}

class ProductList extends AsyncNotifier<ProductListState> {
  ProductList(this.arg);
  final ProductQuery arg;

  @override
  Future<ProductListState> build() async {
    final r = await _fetch(arg, 1);
    return ProductListState(items: r.items, page: r.page, pages: r.pages, total: r.total);
  }

  Future<SearchProductsResponse> _fetch(ProductQuery q, int page) =>
      ref.read(mobileApiProvider).searchProducts(q: q.q, categoryId: q.categoryId, sort: q.sort, condition: q.condition, storeSlug: q.storeSlug, page: page, pageSize: 20);

  Future<void> loadMore() async {
    final s = state.value;
    if (s == null || s.loadingMore || !s.hasMore) return;
    state = AsyncData(ProductListState(items: s.items, page: s.page, pages: s.pages, total: s.total, loadingMore: true));
    try {
      final r = await _fetch(arg, s.page + 1);
      state = AsyncData(ProductListState(items: [...s.items, ...r.items], page: r.page, pages: r.pages, total: r.total));
    } catch (e) {
      state = AsyncData(ProductListState(items: s.items, page: s.page, pages: s.pages, total: s.total, error: e));
    }
  }
}

final productListProvider = AsyncNotifierProvider.family<ProductList, ProductListState, ProductQuery>(ProductList.new);

final productProvider = FutureProvider.family<ProductDetail, String>((ref, slug) => ref.watch(mobileApiProvider).product(slug));
final productReviewsProvider = FutureProvider.family<ListProductReviewsResponse, String>((ref, slug) => ref.watch(mobileApiProvider).productReviews(slug));
final storeProvider = FutureProvider.family<Store, String>((ref, slug) => ref.watch(mobileApiProvider).store(slug));

/// Recent searches (device only, never sent anywhere).
class RecentSearches extends AsyncNotifier<List<String>> {
  @override
  Future<List<String>> build() async {
    final raw = await ref.read(appPrefsProvider).read('recent_searches');
    return raw == null || raw.isEmpty ? [] : raw.split('\u001f');
  }

  Future<void> add(String q) async {
    if (q.trim().isEmpty) return;
    final list = [q.trim(), ...(state.value ?? const <String>[]).where((x) => x != q.trim())].take(8).toList();
    state = AsyncData(list);
    await ref.read(appPrefsProvider).write('recent_searches', list.join('\u001f'));
  }

  Future<void> clear() async {
    state = const AsyncData([]);
    await ref.read(appPrefsProvider).write('recent_searches', null);
  }
}

final recentSearchesProvider = AsyncNotifierProvider<RecentSearches, List<String>>(RecentSearches.new);
