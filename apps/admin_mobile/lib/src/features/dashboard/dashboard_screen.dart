import 'package:edmn_api/admin.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';

const dashboardRanges = ['today', '7d', '30d', '90d', '365d'];

class DashboardRange extends Notifier<String> {
  @override
  String build() => '30d';
  void set(String r) => state = r;
}

final dashboardRangeProvider = NotifierProvider<DashboardRange, String>(DashboardRange.new);

final dashboardProvider = FutureProvider.autoDispose<AdminGetDashboardResponse>(
    (ref) => ref.watch(adminApiProvider).dashboard(range: ref.watch(dashboardRangeProvider)));

/// Operational dashboard: the same figures as the web console's /admin page, read-only. Every amount is integer
/// piastres from the server, formatted with formatEgp; nothing is computed on the device. Queues are visibility only:
/// approving a payout, refund or settlement stays in the web console (no financial mutation in the Admin App).
class AdminDashboardScreen extends ConsumerWidget {
  const AdminDashboardScreen({super.key});

  String _rangeLabel(EdmnLocalizations t, String r) => switch (r) {
        'today' => t.adminRangeToday,
        '7d' => t.adminRange7d,
        '90d' => t.adminRange90d,
        '365d' => t.adminRange365d,
        _ => t.adminRange30d,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final range = ref.watch(dashboardRangeProvider);
    final d = ref.watch(dashboardProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.adminDashboard)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(dashboardProvider.future),
        child: ListView(
          padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final r in dashboardRanges)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: EdmnSpacing.xs),
                    child: ChoiceChip(
                      key: Key('range-$r'),
                      label: Text(_rangeLabel(t, r)),
                      selected: r == range,
                      onSelected: (_) => ref.read(dashboardRangeProvider.notifier).set(r),
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: EdmnSpacing.sm),
            ...d.when(
              loading: () => [const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))],
              error: (e, _) => [ErrorView(error: e, onRetry: () => ref.invalidate(dashboardProvider))],
              data: (x) => _content(context, t, x),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _content(BuildContext context, EdmnLocalizations t, AdminGetDashboardResponse x) {
    String pct(double v) => '${(v * 100).toStringAsFixed(1)}%';
    final k = x.kpis;
    final q = x.queues;
    Widget grid(List<Widget> tiles) => LayoutBuilder(builder: (context, c) {
          final cols = c.maxWidth >= 600 ? 4 : 2;
          final w = (c.maxWidth - EdmnSpacing.xs * (cols - 1)) / cols;
          return Wrap(spacing: EdmnSpacing.xs, runSpacing: EdmnSpacing.xs, children: [for (final tile in tiles) SizedBox(width: w, child: tile)]);
        });
    Widget queue(String key, String label, int n, IconData icon, {bool danger = false}) => KeyedSubtree(
          key: Key('queue-$key'),
          child: EdmnStatTile(
            label: label,
            value: Text('$n'),
            icon: icon,
            tint: n == 0 ? EdmnColors.textSecondary : (danger ? EdmnColors.error : EdmnColors.warning),
          ),
        );
    Widget ranking(String title, List<({String name, int gmv})> rows) => EdmnCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: EdmnType.section),
            const SizedBox(height: EdmnSpacing.xs),
            if (rows.isEmpty) Text(t.adminNoData, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
            for (final r in rows)
              Padding(
                padding: const EdgeInsetsDirectional.symmetric(vertical: 4),
                child: Row(children: [
                  Expanded(child: Text(r.name, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  EgpText(r.gmv),
                ]),
              ),
          ]),
        );
    return [
      if (!x.realMoney) ...[
        EdmnNotice(key: const Key('test-money-notice'), tone: EdmnTone.warning, message: t.adminTestMoneyNotice),
        const SizedBox(height: EdmnSpacing.sm),
      ],
      grid([
        EdmnStatTile(key: const Key('kpi-gmv'), label: t.adminKpiGmv, value: EgpText(k.gmv), icon: Icons.payments_outlined),
        EdmnStatTile(label: t.adminKpiRevenue, value: EgpText(k.revenue), icon: Icons.verified_user_outlined, tint: EdmnColors.success),
        EdmnStatTile(label: t.adminKpiOrders, value: Text('${k.ordersPaid} / ${k.ordersTotal}'), icon: Icons.shopping_bag_outlined),
        EdmnStatTile(label: t.adminKpiDeals, value: Text('${k.deals}'), icon: Icons.handshake_outlined),
        EdmnStatTile(label: t.adminKpiBuyers, value: Text('${k.activeBuyers}'), icon: Icons.people_outline),
        EdmnStatTile(label: t.adminKpiSellers, value: Text('${k.activeSellers}'), icon: Icons.storefront_outlined),
        EdmnStatTile(label: t.adminKpiReturnRate, value: Text(pct(k.returnRate)), icon: Icons.assignment_return_outlined),
        EdmnStatTile(label: t.adminKpiDisputeRate, value: Text(pct(k.disputeRate)), icon: Icons.gavel_outlined),
      ]),
      const SizedBox(height: EdmnSpacing.md),
      Text(t.adminQueues, style: EdmnType.section),
      const SizedBox(height: EdmnSpacing.xs),
      grid([
        queue('sellers', t.adminQueueSellers, q.pendingSellers, Icons.how_to_reg_outlined),
        queue('products', t.adminQueueProducts, q.pendingProducts, Icons.inventory_2_outlined),
        queue('payments', t.adminQueuePayments, q.pendingPayments, Icons.credit_card, danger: true),
        queue('withdrawals', t.adminQueueWithdrawals, q.pendingWithdrawals, Icons.account_balance_wallet_outlined),
        queue('refunds', t.adminQueueRefunds, q.pendingRefunds, Icons.schedule),
        queue('disputes', t.adminQueueDisputes, q.openDisputes, Icons.gavel_outlined, danger: true),
        queue('tickets', t.adminQueueTickets, q.openTickets, Icons.support_agent),
        queue('deliveries', t.adminQueueDeliveries, q.unconfirmedDeliveries, Icons.local_shipping_outlined),
      ]),
      if (q.pendingWithdrawals > 0)
        Padding(
          padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.xs),
          child: Row(children: [Text('${t.adminQueueWithdrawals}: '), EgpText(q.pendingWithdrawalsAmount, key: const Key('withdrawals-amount'))]),
        ),
      const SizedBox(height: EdmnSpacing.sm),
      EdmnNotice(message: t.adminReadOnlyNotice),
      const SizedBox(height: EdmnSpacing.md),
      ranking(t.adminTopCategories, [for (final c in x.topCategories) (name: c.name, gmv: c.gmv)]),
      const SizedBox(height: EdmnSpacing.sm),
      ranking(t.adminTopSellers, [for (final c in x.topSellers) (name: c.name, gmv: c.gmv)]),
    ];
  }
}
