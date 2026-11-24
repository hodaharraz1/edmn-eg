import 'package:edmn_api/mobile.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';

/// All the buyer's orders, loaded page by page (20 per page from the server).
class OrdersState {
  const OrdersState({this.items = const [], this.page = 0, this.hasMore = true, this.loadingMore = false, this.error});
  final List<ListOrdersResponseItemsItem> items;
  final int page;
  final bool hasMore;
  final bool loadingMore;
  final Object? error;
}

class Orders extends AsyncNotifier<OrdersState> {
  @override
  Future<OrdersState> build() async {
    if (!ref.watch(signedInProvider)) return const OrdersState(hasMore: false);
    final r = await ref.read(mobileApiProvider).orders(page: 1);
    return OrdersState(items: r.items, page: 1, hasMore: r.items.length >= r.pageSize);
  }

  Future<void> loadMore() async {
    final s = state.value;
    if (s == null || s.loadingMore || !s.hasMore) return;
    state = AsyncData(OrdersState(items: s.items, page: s.page, hasMore: s.hasMore, loadingMore: true));
    try {
      final r = await ref.read(mobileApiProvider).orders(page: s.page + 1);
      state = AsyncData(OrdersState(items: [...s.items, ...r.items], page: s.page + 1, hasMore: r.items.length >= r.pageSize));
    } catch (e) {
      state = AsyncData(OrdersState(items: s.items, page: s.page, hasMore: s.hasMore, error: e));
    }
  }
}

final ordersProvider = AsyncNotifierProvider<Orders, OrdersState>(Orders.new);
final orderProvider = FutureProvider.family<Order, String>((ref, id) => ref.watch(mobileApiProvider).order(id));
// Staff can review a receipt while the user is elsewhere. Reload when the
// payment screen is reopened instead of retaining a stale review status.
final paymentProvider = FutureProvider.autoDispose.family<GetPaymentResponse, String>((ref, id) => ref.watch(mobileApiProvider).payment(id));
