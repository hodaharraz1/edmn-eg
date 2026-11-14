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

final productSearchProvider = FutureProvider<SearchProductsResponse>((ref) => ref.watch(mobileApiProvider).searchProducts(q: ref.watch(searchQueryProvider)));

final productProvider = FutureProvider.family<ProductDetail, String>((ref, slug) => ref.watch(mobileApiProvider).product(slug));
