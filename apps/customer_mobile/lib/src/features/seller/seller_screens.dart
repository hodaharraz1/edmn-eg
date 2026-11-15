import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/file_pick.dart';
import '../../common/ui.dart';
import '../../providers.dart';

/// Seller Center inside the same app. The store and its permissions come from the server (membership of the
/// signed-in user); menus and actions show only what the member's role allows and what the server allows now.
final sellerMembershipProvider = FutureProvider<GetMySellerMembershipResponseMembership?>((ref) async {
  if (!ref.watch(signedInProvider)) return null;
  return (await ref.watch(mobileApiProvider).sellerMembership()).membership;
});
final sellerHomeProvider = FutureProvider<GetSellerHomeResponse>((ref) => ref.watch(mobileApiProvider).sellerHome());
final sellerOrdersProvider = FutureProvider.family<ListSellerOrdersResponse, String?>((ref, status) => ref.watch(mobileApiProvider).sellerOrders(status: status));
final sellerOrderProvider = FutureProvider.family<SellerOrder, String>((ref, id) => ref.watch(mobileApiProvider).sellerOrder(id));
final sellerProductsProvider = FutureProvider<ListSellerProductsResponse>((ref) => ref.watch(mobileApiProvider).sellerProducts());
final sellerFundsProvider = FutureProvider<GetSellerFundsResponse>((ref) => ref.watch(mobileApiProvider).sellerFunds());

String sellerStatusLabel(EdmnLocalizations t, String s) => switch (s) {
      'APPROVED' => t.sellerActive,
      'RESTRICTED' => t.sellerRestricted,
      'DRAFT' => t.sellerDraft,
      'PENDING_REVIEW' => t.sellerPendingReview,
      'MORE_INFO_REQUIRED' => t.sellerMoreInfo,
      'SUSPENDED' => t.sellerSuspended,
      'REJECTED' => t.sellerRejected,
      _ => s,
    };

(String, EdmnTone) sellerOrderStatusChip(EdmnLocalizations t, String s) => switch (s) {
      'PAID' => (t.soNew, EdmnTone.warning),
      'SELLER_CONFIRMED' => (t.soAccepted, EdmnTone.info),
      'PROCESSING' || 'READY_TO_SHIP' => (t.stepPreparing, EdmnTone.info),
      'SHIPPED' => (t.stepShipped, EdmnTone.info),
      'AWAITING_BUYER_RESPONSE' || 'DELIVERED' => (t.stepDelivered, EdmnTone.success),
      'COMPLETED' => (t.statusCompleted, EdmnTone.success),
      'DELIVERY_FAILED' => (t.deliveryFailed, EdmnTone.danger),
      'CANCELLED' => (t.statusCancelled, EdmnTone.danger),
      _ => (s, EdmnTone.neutral),
    };

/// Board "مركز البائع": store header + active chip, stat tiles, menu. Non-sellers and pending applications get an
/// honest status screen (seller registration runs on the website until its mobile API exists).
class SellerCenterScreen extends ConsumerWidget {
  const SellerCenterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final m = ref.watch(sellerMembershipProvider);
    return EdmnAppScaffold(
      title: t.sellerCenter,
      body: AsyncView(
        value: m,
        onRetry: () => ref.invalidate(sellerMembershipProvider),
        data: (membership) {
          if (membership == null) {
            return EdmnEmptyState(
              key: const Key('not-a-seller'),
              icon: Icons.storefront_outlined,
              title: t.notSellerTitle,
              message: t.becomeSellerBody,
              actionLabel: t.becomeSeller,
              onAction: () => context.push('/seller/apply'),
            );
          }
          if (!membership.canOperate) {
            return EdmnEmptyState(
              key: const Key('seller-status'),
              icon: Icons.hourglass_top_rounded,
              title: sellerStatusLabel(t, membership.status),
              message: t.sellerNotOperatingBody,
              actionLabel: t.continueApplication,
              onAction: () => context.push('/seller/apply'),
            );
          }
          return _SellerHome(membership: membership);
        },
      ),
    );
  }
}

class _SellerHome extends ConsumerWidget {
  const _SellerHome({required this.membership});
  final GetMySellerMembershipResponseMembership membership;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final home = ref.watch(sellerHomeProvider);
    final p = membership.permissions.toSet();
    return RefreshIndicator(
      onRefresh: () => ref.refresh(sellerHomeProvider.future),
      child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
        EdmnCard(
          child: EdmnSellerSummary(
            name: membership.store?.name ?? t.sellerCenter,
            subtitle: t.sellerRole(sellerRoleLabel(t, membership.role)),
            status: EdmnStatusChip(label: sellerStatusLabel(t, membership.status), tone: membership.status == 'APPROVED' ? EdmnTone.success : EdmnTone.warning),
          ),
        ),
        const SizedBox(height: EdmnSpacing.md),
        home.when(
          loading: () => const SizedBox(height: 180, child: EdmnLoadingState()),
          error: (e, _) => EdmnNotice(message: apiErrorMessage(context, e), tone: EdmnTone.danger),
          data: (h) => GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: EdmnSpacing.sm,
            crossAxisSpacing: EdmnSpacing.sm,
            childAspectRatio: 1.7,
            children: [
              if (h.sales != null)
                EdmnStatTile(label: t.salesToday, icon: Icons.shopping_cart_outlined, value: EgpText(h.sales!.todayPiastres))
              else
                EdmnStatTile(label: t.ordersLast30, icon: Icons.shopping_cart_outlined, value: Text('${h.orders.last30Days}')),
              EdmnStatTile(label: t.ordersToHandle, icon: Icons.pending_actions_outlined, value: Text('${h.orders.pendingConfirmation + h.orders.processing + h.orders.readyToShip}'), tint: EdmnColors.warning),
              EdmnStatTile(label: t.productsLive, icon: Icons.inventory_2_outlined, value: Text('${h.products.live}'), tint: EdmnColors.success),
              EdmnStatTile(label: t.ratingLabel, icon: Icons.star_rounded, value: Text(h.rating.count == 0 ? '—' : h.rating.average.toStringAsFixed(1)), tint: EdmnColors.warning),
            ],
          ),
        ),
        const SizedBox(height: EdmnSpacing.md),
        EdmnMenuGroup(children: [
          if (p.contains('products.manage') || p.contains('inventory.manage'))
            EdmnMenuItem(key: const Key('seller-products'), icon: Icons.inventory_2_outlined, title: t.manageProducts, onTap: () => context.push('/seller/products')),
          if (p.contains('orders.manage')) EdmnMenuItem(key: const Key('seller-orders'), icon: Icons.shopping_cart_outlined, title: t.sellerOrders, onTap: () => context.push('/seller/orders')),
          if (p.contains('finance.view')) EdmnMenuItem(key: const Key('seller-funds'), icon: Icons.account_balance_wallet_outlined, title: t.earningsBalance, onTap: () => context.push('/seller/funds')),
          if (p.contains('finance.view')) EdmnMenuItem(key: const Key('seller-payouts'), icon: Icons.outbound_outlined, title: t.payoutRequests, onTap: () => context.push('/seller/payouts')),
          if (p.contains('store.manage')) EdmnMenuItem(key: const Key('seller-shipping'), icon: Icons.local_shipping_outlined, title: t.shippingRates, onTap: () => context.push('/seller/shipping')),
          if (p.contains('store.manage')) EdmnMenuItem(key: const Key('seller-store'), icon: Icons.settings_outlined, title: t.storeSettings, onTap: () => context.push('/seller/store')),
          if (membership.store != null)
            EdmnMenuItem(icon: Icons.storefront_outlined, title: t.viewMyStore, onTap: () => context.push('/stores/${Uri.encodeComponent(membership.store!.slug)}')),
        ]),
      ]),
    );
  }
}

class SellerOrdersScreen extends ConsumerStatefulWidget {
  const SellerOrdersScreen({super.key});
  @override
  ConsumerState<SellerOrdersScreen> createState() => _SellerOrdersScreenState();
}

class _SellerOrdersScreenState extends ConsumerState<SellerOrdersScreen> {
  String? _status = 'PAID';

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final orders = ref.watch(sellerOrdersProvider(_status));
    return EdmnAppScaffold(
      title: t.sellerOrders,
      body: Column(children: [
        const SizedBox(height: EdmnSpacing.md),
        EdmnFilterPills<String?>(
          options: [('PAID', t.soNew), ('SELLER_CONFIRMED', t.soAccepted), ('PROCESSING', t.stepPreparing), ('READY_TO_SHIP', t.soReady), ('SHIPPED', t.stepShipped), ('COMPLETED', t.statusCompleted), ('CANCELLED', t.statusCancelled), (null, t.all)],
          selected: _status,
          onSelected: (s) => setState(() => _status = s),
        ),
        const SizedBox(height: EdmnSpacing.sm),
        Expanded(
          child: AsyncView(
            value: orders,
            skeleton: true,
            onRetry: () => ref.invalidate(sellerOrdersProvider(_status)),
            data: (r) => r.items.isEmpty
                ? EdmnEmptyState(icon: Icons.inbox_outlined, title: t.noSellerOrders)
                : RefreshIndicator(
                    onRefresh: () => ref.refresh(sellerOrdersProvider(_status).future),
                    child: ListView(padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.screen), children: [
                      for (final o in r.items)
                        () {
                          final (l, tone) = sellerOrderStatusChip(t, o.status);
                          return EdmnOrderCard(
                            key: Key('so-${o.id}'),
                            number: o.number,
                            date: formatDateTime(context, o.paidAt),
                            status: EdmnStatusChip(label: l, tone: tone),
                            totalPiastres: o.merchandiseSubtotalPiastres,
                            thumbnails: o.thumbnails,
                            onTap: () => context.push('/seller/orders/${o.id}'),
                          );
                        }(),
                    ]),
                  ),
          ),
        ),
      ]),
    );
  }
}

/// A paid order of the store: ship-to, items, shipment, and ONLY the steps the server allows now.
class SellerOrderScreen extends ConsumerStatefulWidget {
  const SellerOrderScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<SellerOrderScreen> createState() => _SellerOrderScreenState();
}

class _SellerOrderScreenState extends ConsumerState<SellerOrderScreen> {
  final _intent = IntentKey();
  String? _busy;

  Future<void> _step(String step, String label) async {
    final t = EdmnLocalizations.of(context);
    String? note;
    if (step == 'ACCEPT_CANCELLATION') {
      if (!await showEdmnConfirmation(context, title: label, message: t.acceptCancellationConfirm, confirmLabel: label, destructive: true)) return;
      note = t.acceptCancellationNote;
    } else if (!await showEdmnConfirmation(context, title: label, message: t.sellerStepConfirm, confirmLabel: label)) {
      return;
    }
    if (!mounted) return;
    setState(() => _busy = step);
    final ok = await runAction(context, () => ref.read(mobileApiProvider).sellerOrderStep(widget.id, step, note: note, idempotencyKey: _intent.value), success: t.saved);
    if (ok) _intent.reset();
    ref.invalidate(sellerOrderProvider(widget.id));
    ref.invalidate(sellerOrdersProvider);
    ref.invalidate(sellerHomeProvider);
    if (mounted) setState(() => _busy = null);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final order = ref.watch(sellerOrderProvider(widget.id));
    final labels = {
      'CONFIRM_ORDER': t.stepConfirmOrder,
      'START_PROCESSING': t.stepStartProcessing,
      'MARK_READY_TO_SHIP': t.stepMarkReady,
      'MARK_SHIPPED': t.stepMarkShipped,
      'ACCEPT_CANCELLATION': t.stepAcceptCancellation,
    };
    return EdmnAppScaffold(
      title: t.orderDetails,
      body: AsyncView(
        value: order,
        onRetry: () => ref.invalidate(sellerOrderProvider(widget.id)),
        data: (o) {
          final (l, tone) = sellerOrderStatusChip(t, o.status);
          final a = o.shipTo;
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            Row(children: [
              Expanded(child: Text('#${o.number}', textDirection: TextDirection.ltr, textAlign: TextAlign.start, style: EdmnType.section.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800))),
              EdmnStatusChip(label: l, tone: tone),
            ]),
            Text(formatDateTime(context, o.paidAt), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
            if (o.cancellationRequest != null) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(title: t.cancellationRequested, message: o.cancellationRequest!.note ?? '', tone: EdmnTone.warning)],
            if (o.openDispute) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(message: t.disputeOpen, tone: EdmnTone.warning)],
            const SizedBox(height: EdmnSpacing.md),
            EdmnCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(t.shippingAddress, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                const SizedBox(height: EdmnSpacing.xxs),
                Text(a.recipientName ?? '', style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                if (a.phone != null)
                  Row(children: [
                    Text(a.phone!, textDirection: TextDirection.ltr, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                    IconButton(icon: const Icon(Icons.copy_rounded, size: EdmnSizes.iconSm, color: EdmnColors.primary), onPressed: () => Clipboard.setData(ClipboardData(text: a.phone!))),
                  ]),
                Text([a.street, a.building, a.floor, a.apartment, a.district, a.city, a.governorate].whereType<String>().where((x) => x.isNotEmpty).join('، '), style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                if (a.landmark != null) Text(a.landmark!, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
              ]),
            ),
            const SizedBox(height: EdmnSpacing.sm),
            EdmnCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                for (final i in o.items)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                    child: Row(children: [
                      EdmnThumb(url: i.imageUrl),
                      const SizedBox(width: EdmnSpacing.sm),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(i.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                          Text('${i.quantity} × ${i.variantLabel}', style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                        ]),
                      ),
                      EgpText(i.lineTotalPiastres, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                    ]),
                  ),
                if (o.economics != null) ...[
                  const Divider(),
                  EdmnAmountSummary(
                    rows: [(t.itemsTotal, o.merchandiseSubtotalPiastres), (t.shippingFee, o.shippingFeePiastres), (t.commission, -o.economics!.commissionPiastres)],
                    totalLabel: t.sellerNet,
                    totalPiastres: o.economics!.sellerNetPiastres,
                    note: t.sellerNetNote,
                  ),
                ],
              ]),
            ),
            if (o.shipment != null) ...[
              const SizedBox(height: EdmnSpacing.sm),
              EdmnCard(
                child: Row(children: [
                  const Icon(Icons.local_shipping_outlined, color: EdmnColors.primary),
                  const SizedBox(width: EdmnSpacing.sm),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(o.shipment!.carrierName, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                      if (o.shipment!.trackingNumber != null) Text(t.trackingNumber(o.shipment!.trackingNumber!), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                      if (o.shipment!.hasWaybill) Text(t.waybillAttached, style: EdmnType.secondary.copyWith(color: EdmnColors.success)),
                    ]),
                  ),
                ]),
              ),
            ],
            const SizedBox(height: EdmnSpacing.md),
            for (final step in labels.keys)
              if (o.allowedActions.contains(step))
                Padding(
                  padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                  child: step == 'ACCEPT_CANCELLATION'
                      ? EdmnSecondaryButton(key: Key('step-$step'), label: labels[step]!, destructive: true, loading: _busy == step, onPressed: _busy == null ? () => _step(step, labels[step]!) : null)
                      : EdmnPrimaryButton(key: Key('step-$step'), label: labels[step]!, loading: _busy == step, onPressed: _busy == null ? () => _step(step, labels[step]!) : null),
                ),
            if (o.allowedActions.contains('SAVE_SHIPMENT'))
              EdmnSecondaryButton(
                key: const Key('save-shipment'),
                label: o.shipment == null ? t.addShipment : t.editShipment,
                icon: Icons.local_shipping_outlined,
                onPressed: () async {
                  final saved = await showEdmnBottomSheet<bool>(context, title: t.shipmentDetails, child: _ShipmentForm(orderId: o.id));
                  if (saved == true) ref.invalidate(sellerOrderProvider(widget.id));
                },
              ),
          ]);
        },
      ),
    );
  }
}

class _ShipmentForm extends ConsumerStatefulWidget {
  const _ShipmentForm({required this.orderId});
  final String orderId;
  @override
  ConsumerState<_ShipmentForm> createState() => _ShipmentFormState();
}

class _ShipmentFormState extends ConsumerState<_ShipmentForm> {
  final _form = GlobalKey<FormState>();
  final _carrier = TextEditingController();
  final _tracking = TextEditingController();
  final _intent = IntentKey();
  PickedFile? _waybill;
  bool _busy = false;

  @override
  void dispose() {
    _carrier.dispose();
    _tracking.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Form(
      key: _form,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        EdmnTextField(key: const Key('carrier'), controller: _carrier, hint: t.carrierHint, icon: Icons.local_shipping_outlined, validator: (v) => (v ?? '').trim().length < 2 ? t.fieldRequired : null),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnTextField(key: const Key('tracking'), controller: _tracking, hint: t.trackingHint, icon: Icons.tag_rounded, textDirection: TextDirection.ltr),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnUploadField(
          label: t.waybill,
          hint: t.waybillHint,
          fileName: _waybill?.name,
          onClear: () => setState(() => _waybill = null),
          onPick: () async {
            final f = await ref.read(filePickerProvider).pick();
            if (f != null) setState(() => _waybill = f);
          },
        ),
        const SizedBox(height: EdmnSpacing.md),
        EdmnPrimaryButton(
          key: const Key('shipment-submit'),
          label: t.save,
          loading: _busy,
          onPressed: () async {
            if (!_form.currentState!.validate()) return;
            setState(() => _busy = true);
            final ok = await runAction(
              context,
              () => ref.read(mobileApiProvider).saveSellerShipment(widget.orderId,
                  carrierName: _carrier.text.trim(), trackingNumber: _tracking.text.trim(), shippedAt: DateTime.now(), waybill: _waybill?.bytes, waybillName: _waybill?.name, idempotencyKey: _intent.value),
              success: t.saved,
            );
            if (mounted) setState(() => _busy = false);
            if (ok && context.mounted) Navigator.pop(context, true);
          },
        ),
      ]),
    );
  }
}

/// Products with stock per variant; stock edits go through the inventory service (never below reserved units).
class SellerProductsScreen extends ConsumerWidget {
  const SellerProductsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final list = ref.watch(sellerProductsProvider);
    return EdmnAppScaffold(
      title: t.manageProducts,
      bottomBar: EdmnPrimaryButton(key: const Key('new-product'), label: t.addProduct, icon: Icons.add_rounded, onPressed: () => context.push('/seller/products/new')),
      body: AsyncView(
        value: list,
        skeleton: true,
        onRetry: () => ref.invalidate(sellerProductsProvider),
        data: (r) => r.items.isEmpty
            ? EdmnEmptyState(icon: Icons.inventory_2_outlined, title: t.noProductsTitle)
            : ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
                for (final p in r.items)
                  EdmnCard(
                    key: Key('sp-${p.id}'),
                    onTap: () => context.push('/seller/products/${p.id}/edit'),
                    margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Row(children: [
                        EdmnThumb(url: p.imageUrl),
                        const SizedBox(width: EdmnSpacing.sm),
                        Expanded(child: Text(p.titleAr, maxLines: 2, overflow: TextOverflow.ellipsis, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700))),
                        EdmnStatusChip(label: productStatusLabel(t, p.status), tone: p.status == 'LIVE' ? EdmnTone.success : EdmnTone.neutral),
                      ]),
                      const Divider(height: EdmnSpacing.lg),
                      for (final v in p.variants)
                        Row(children: [
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(v.label.isEmpty ? '—' : v.label, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                              Text(t.stockLine(v.stockOnHand, v.reserved, v.available),
                                  style: EdmnType.secondary.copyWith(color: v.available == 0 ? EdmnColors.error : (v.available <= v.lowStockThreshold ? EdmnColors.warning : EdmnColors.textSecondary))),
                            ]),
                          ),
                          EgpText(v.pricePiastres, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                          IconButton(
                            key: Key('edit-stock-${v.id}'),
                            tooltip: t.editStock,
                            icon: const Icon(Icons.edit_outlined, color: EdmnColors.primary),
                            onPressed: () => _editStock(context, ref, v),
                          ),
                        ]),
                    ]),
                  ),
              ]),
      ),
    );
  }

  Future<void> _editStock(BuildContext context, WidgetRef ref, ListSellerProductsResponseItemsItemVariantsItem v) async {
    final t = EdmnLocalizations.of(context);
    final c = TextEditingController(text: '${v.stockOnHand}');
    final form = GlobalKey<FormState>();
    final value = await showEdmnBottomSheet<int>(
      context,
      title: t.editStock,
      child: Form(
        key: form,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(t.reservedFloor(v.reserved), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
          const SizedBox(height: EdmnSpacing.xs),
          EdmnTextField(
            key: const Key('stock-input'),
            controller: c,
            hint: t.stockOnHand,
            keyboardType: TextInputType.number,
            textDirection: TextDirection.ltr,
            validator: (s) {
              final n = int.tryParse((s ?? '').trim());
              return n == null || n < v.reserved ? t.reservedFloor(v.reserved) : null;
            },
          ),
        ]),
      ),
      action: Builder(builder: (sheet) => EdmnPrimaryButton(key: const Key('stock-save'), label: t.save, onPressed: () => form.currentState!.validate() ? Navigator.pop(sheet, int.parse(c.text.trim())) : null)),
    );
    if (value == null || !context.mounted) return;
    await runAction(context, () => ref.read(mobileApiProvider).setVariantStock(v.id, value), success: t.saved);
    ref.invalidate(sellerProductsProvider);
    ref.invalidate(sellerHomeProvider);
  }
}

String productStatusLabel(EdmnLocalizations t, String s) => switch (s) {
      'LIVE' => t.productLive,
      'DRAFT' => t.productDraft,
      'SUBMITTED' || 'UNDER_REVIEW' => t.productInReview,
      'REJECTED' => t.productRejected,
      'SUSPENDED' => t.productSuspended,
      'ARCHIVED' => t.productArchived,
      _ => s,
    };

/// Earnings — read only. Withdrawable is the server's number; holds, debts and uncovered claims are shown apart.
class SellerFundsScreen extends ConsumerWidget {
  const SellerFundsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final funds = ref.watch(sellerFundsProvider);
    return EdmnAppScaffold(
      title: t.earningsBalance,
      body: AsyncView(
        value: funds,
        onRetry: () => ref.invalidate(sellerFundsProvider),
        data: (f) => RefreshIndicator(
          onRefresh: () => ref.refresh(sellerFundsProvider.future),
          child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            EdmnWalletCard(key: const Key('withdrawable'), label: t.withdrawable, amountPiastres: f.withdrawablePiastres),
            const SizedBox(height: EdmnSpacing.md),
            if (f.blockReasonAr != null) ...[EdmnNotice(message: f.blockReasonAr!, tone: EdmnTone.danger), const SizedBox(height: EdmnSpacing.sm)],
            EdmnCard(
              child: EdmnAmountSummary(
                rows: [
                  (t.fundsPending, f.pendingPiastres),
                  (t.fundsAvailable, f.availablePiastres),
                  (t.fundsHeld, f.heldPiastres),
                  (t.fundsReserved, f.reservedForPayoutPiastres),
                  if (f.bookedDebtPiastres > 0) (t.fundsDebt, f.bookedDebtPiastres),
                  if (f.unsecuredClaimsPiastres > 0) (t.fundsUnsecured, f.unsecuredClaimsPiastres),
                ],
                totalLabel: t.withdrawable,
                totalPiastres: f.withdrawablePiastres,
                note: t.fundsNote,
              ),
            ),
            if (f.openPayoutRequests > 0) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(message: t.openPayouts(f.openPayoutRequests), tone: EdmnTone.warning)],
            const SizedBox(height: EdmnSpacing.sm),
            EdmnSecondaryButton(key: const Key('to-payouts'), label: t.payoutRequests, icon: Icons.outbound_outlined, onPressed: () => context.push('/seller/payouts')),
          ]),
        ),
      ),
    );
  }
}

String sellerRoleLabel(EdmnLocalizations t, String role) => switch (role) {
      'STORE_OWNER' => t.roleOwner,
      'STORE_MANAGER' => t.roleManager,
      'CATALOG_MANAGER' => t.roleCatalog,
      'ORDER_MANAGER' => t.roleOrders,
      'FINANCE' => t.roleFinance,
      'SUPPORT' => t.roleSupport,
      _ => role,
    };
