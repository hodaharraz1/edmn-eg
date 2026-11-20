import 'package:edmn_api/admin.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';

/// One row of any monitoring list, already mapped from the server payload. Nothing here is computed from money or
/// status on the device: amounts are server piastres, statuses are server codes mapped to a label and a tone.
class MonitorRow {
  const MonitorRow({required this.id, required this.title, this.subtitle, required this.status, this.amount, this.badge, this.at});
  final String id;
  final String title;
  final String? subtitle;
  final String status;
  final int? amount;
  final String? badge;
  final String? at;
}

/// A page of rows; [next] loads the following page (null = no more).
class MonitorPage {
  const MonitorPage(this.rows, {this.next});
  final List<MonitorRow> rows;
  final Future<MonitorPage> Function()? next;
}

typedef MonitorLoader = Future<MonitorPage> Function(AdminApi api, String tab);

/// Server status → label and tone, shared by the six lists. Unknown codes show as they are, neutrally.
(String, EdmnTone) adminStatus(EdmnLocalizations t, String s) => switch (s) {
      'PENDING_REVIEW' => (t.adminStatusPendingReview, EdmnTone.warning),
      'MORE_INFO_REQUIRED' => (t.adminStatusMoreInfo, EdmnTone.warning),
      'REVERIFICATION_REQUIRED' => (t.adminStatusReverify, EdmnTone.warning),
      'APPROVED' => (t.adminStatusApproved, EdmnTone.success),
      'REJECTED' => (t.adminStatusRejected, EdmnTone.danger),
      'OPEN' => (t.adminStatusOpen, EdmnTone.danger),
      'UNDER_REVIEW' => (t.adminStatusUnderReview, EdmnTone.warning),
      'AWAITING_INFORMATION' => (t.adminStatusAwaitingInfo, EdmnTone.warning),
      'RESOLVED' => (t.adminStatusResolved, EdmnTone.success),
      'CLOSED' => (t.adminStatusClosed, EdmnTone.neutral),
      'ACTIVE' => (t.adminStatusActive, EdmnTone.info),
      'DISPUTED' => (t.adminStatusDisputed, EdmnTone.danger),
      'REFUNDED' => (t.adminStatusRefunded, EdmnTone.neutral),
      'SHIPPED' => (t.adminStatusShipped, EdmnTone.info),
      'PENDING_PAYMENT' => (t.statusPendingPayment, EdmnTone.warning),
      'PAYMENT_UNDER_REVIEW' => (t.statusPaymentUnderReview, EdmnTone.warning),
      'PAID' => (t.statusPaid, EdmnTone.info),
      'COMPLETED' => (t.statusCompleted, EdmnTone.success),
      'PARTIALLY_COMPLETED' => (t.statusPartiallyCompleted, EdmnTone.success),
      'CLOSED_UNFULFILLED' => (t.statusClosedUnfulfilled, EdmnTone.danger),
      'CANCELLED' => (t.statusCancelled, EdmnTone.danger),
      _ => (s, EdmnTone.neutral),
    };

/// The six screens: title, server permission (the home menu shows an entry only when the profile carries it; the server
/// enforces it on every call regardless), tabs and the loader mapping the typed response to rows.
class MonitorSpec {
  const MonitorSpec({required this.path, required this.permission, required this.icon, required this.title, required this.tabs, required this.load});
  final String path;
  final String permission;
  final IconData icon;
  final String Function(EdmnLocalizations) title;
  final List<(String, String Function(EdmnLocalizations))> tabs;
  final MonitorLoader load;
}

String _date(String? iso) => iso == null ? '' : iso.substring(0, 10);

Future<MonitorPage> _orders(AdminApi api, String tab, {int page = 1}) async {
  final r = await api.orders(tab: tab, page: page);
  return MonitorPage(
    [for (final o in r.items) MonitorRow(id: o.id, title: '#${o.number}', subtitle: [o.customer, o.store].whereType<String>().join(' · '), status: o.status, amount: o.total, at: o.at)],
    next: r.hasMore ? () => _orders(api, tab, page: page + 1) : null,
  );
}

Future<MonitorPage> _audit(AdminApi api, {int? before}) async {
  final r = await api.auditLog(before: before);
  return MonitorPage(
    [
      for (final a in r.items)
        MonitorRow(id: '${a.id}', title: a.action, subtitle: '${a.actor ?? a.actorType} · ${a.entityType}${a.channel == null ? '' : ' · ${a.channel}'}', status: a.actorType, at: a.at),
    ],
    next: r.nextBefore == null ? null : () => _audit(api, before: r.nextBefore),
  );
}

final monitorSpecs = <MonitorSpec>[
  MonitorSpec(
    path: '/monitor/sellers',
    permission: 'sellers.review',
    icon: Icons.storefront_outlined,
    title: (t) => t.adminSellerApplications,
    tabs: [('pending', (t) => t.adminTabPending), ('info', (t) => t.adminTabNeedsInfo)],
    load: (api, tab) async => MonitorPage([
      for (final s in (await api.sellerApplications(tab: tab)).items)
        MonitorRow(id: s.id, title: s.storeName ?? s.applicant ?? '—', subtitle: [s.applicant, s.type, if (s.riskLevel != null) s.riskLevel].whereType<String>().join(' · '), status: s.status, at: s.submittedAt),
    ]),
  ),
  MonitorSpec(
    path: '/monitor/identity',
    permission: 'identity.view',
    icon: Icons.badge_outlined,
    title: (t) => t.adminIdentityReviews,
    tabs: [('pending', (t) => t.adminTabPending), ('action', (t) => t.adminTabWaitingCustomer), ('approved', (t) => t.adminTabApproved), ('rejected', (t) => t.adminTabRejected)],
    load: (api, tab) async => MonitorPage([
      for (final v in (await api.identityReviews(tab: tab)).items) MonitorRow(id: v.id, title: v.name ?? '—', status: v.status, badge: v.documentsComplete ? 'docs-ok' : 'docs-missing', at: v.submittedAt),
    ]),
  ),
  MonitorSpec(
    path: '/monitor/orders',
    permission: 'orders.view',
    icon: Icons.local_shipping_outlined,
    title: (t) => t.adminOrders,
    tabs: [('all', (t) => t.adminTabAllOrders), ('followup', (t) => t.adminTabFollowUp)],
    load: (api, tab) => _orders(api, tab),
  ),
  MonitorSpec(
    path: '/monitor/deals',
    permission: 'deals.view',
    icon: Icons.handshake_outlined,
    title: (t) => t.adminDeals,
    tabs: [('active', (t) => t.adminTabActive), ('disputed', (t) => t.adminTabDisputed), ('done', (t) => t.adminTabDone)],
    load: (api, tab) async => MonitorPage([
      for (final d in (await api.deals(tab: tab)).items)
        MonitorRow(id: d.id, title: '#${d.number} · ${d.title}', subtitle: [d.buyer, d.seller].whereType<String>().join(' ⇄ '), status: d.status, amount: d.buyerPays, badge: d.sellerConfirmed ? null : 'seller-unconfirmed', at: d.updatedAt),
    ]),
  ),
  MonitorSpec(
    path: '/monitor/disputes',
    permission: 'disputes.manage',
    icon: Icons.gavel_outlined,
    title: (t) => t.adminDisputes,
    tabs: [('open', (t) => t.adminTabOpen), ('mine', (t) => t.adminTabMine), ('closed', (t) => t.adminTabClosed)],
    load: (api, tab) async => MonitorPage([
      for (final d in (await api.disputes(tab: tab)).items)
        MonitorRow(id: d.id, title: '#${d.number}', subtitle: [d.kind, d.claimant, d.reasonCode].whereType<String>().join(' · '), status: d.status, amount: d.claimedAmount, badge: d.assignedToMe ? 'mine' : null, at: d.createdAt),
    ]),
  ),
  MonitorSpec(
    path: '/monitor/audit',
    permission: 'audit.view',
    icon: Icons.history_rounded,
    title: (t) => t.adminAuditLog,
    tabs: [('all', (t) => t.adminAuditLog)],
    load: (api, tab) => _audit(api),
  ),
];

class MonitorListScreen extends ConsumerStatefulWidget {
  const MonitorListScreen({super.key, required this.spec});
  final MonitorSpec spec;
  @override
  ConsumerState<MonitorListScreen> createState() => _MonitorListScreenState();
}

class _MonitorListScreenState extends ConsumerState<MonitorListScreen> {
  late String _tab = widget.spec.tabs.first.$1;
  List<MonitorRow> _rows = const [];
  Future<MonitorPage> Function()? _next;
  Object? _error;
  bool _loading = true;
  bool _loadingMore = false;
  int _generation = 0; // a late answer for a tab the user already left is dropped

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final gen = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      _rows = const []; // never show the previous tab's rows under the new tab
    });
    try {
      final p = await widget.spec.load(ref.read(adminApiProvider), _tab);
      if (!mounted || gen != _generation) return;
      setState(() {
        _rows = p.rows;
        _next = p.next;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || gen != _generation) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<void> _more() async {
    final next = _next;
    if (next == null || _loadingMore) return;
    final gen = _generation;
    setState(() => _loadingMore = true);
    try {
      final p = await next();
      if (!mounted || gen != _generation) return;
      setState(() {
        _rows = [..._rows, ...p.rows];
        _next = p.next;
      });
    } catch (e) {
      if (mounted && gen == _generation) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final spec = widget.spec;
    return Scaffold(
      appBar: AppBar(title: Text(spec.title(t))),
      body: Column(children: [
        if (spec.tabs.length > 1)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.sm, EdmnSpacing.xs, EdmnSpacing.sm, 0),
            child: Row(children: [
              for (final (key, label) in spec.tabs)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: EdmnSpacing.xs),
                  child: ChoiceChip(
                    key: Key('tab-$key'),
                    label: Text(label(t)),
                    selected: key == _tab,
                    onSelected: (_) {
                      if (key == _tab) return;
                      _tab = key;
                      _reload();
                    },
                  ),
                ),
            ]),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _reload,
            child: ListView(
              padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
              children: [
                EdmnNotice(key: const Key('read-only-notice'), message: t.adminDecisionsOnWeb),
                const SizedBox(height: EdmnSpacing.sm),
                if (_loading)
                  const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
                else if (_error != null && _rows.isEmpty)
                  ErrorView(error: _error!, onRetry: _reload)
                else if (_rows.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(32),
                    child: Center(child: Text(t.adminEmptyList, key: const Key('empty'), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary))),
                  )
                else ...[
                  for (final r in _rows) _RowTile(row: r),
                  if (_next != null)
                    Padding(
                      padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.sm),
                      child: _loadingMore
                          ? const Center(child: CircularProgressIndicator())
                          : TextButton(key: const Key('load-more'), onPressed: _more, child: Text(t.adminLoadMore)),
                    ),
                ],
              ],
            ),
          ),
        ),
      ]),
    );
  }
}

class _RowTile extends StatelessWidget {
  const _RowTile({required this.row});
  final MonitorRow row;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final (label, tone) = adminStatus(t, row.status);
    final badge = switch (row.badge) {
      'docs-ok' => t.adminDocsComplete,
      'docs-missing' => t.adminDocsMissing,
      'seller-unconfirmed' => t.adminSellerUnconfirmed,
      'mine' => t.adminAssignedToMe,
      _ => null,
    };
    return Padding(
      key: Key('row-${row.id}'),
      padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
      child: EdmnCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(row.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: EdmnType.bodyStrong)),
            const SizedBox(width: EdmnSpacing.xs),
            EdmnStatusChip(label: label, tone: tone),
          ]),
          if (row.subtitle != null && row.subtitle!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(row.subtitle!, maxLines: 2, overflow: TextOverflow.ellipsis, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
          ],
          const SizedBox(height: 4),
          Row(children: [
            if (row.at != null) Text(_date(row.at), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
            if (badge != null) ...[const SizedBox(width: EdmnSpacing.xs), Text(badge, style: EdmnType.secondary.copyWith(color: EdmnColors.primaryDark))],
            const Spacer(),
            if (row.amount != null) EgpText(row.amount, style: EdmnType.bodyStrong),
          ]),
        ]),
      ),
    );
  }
}
