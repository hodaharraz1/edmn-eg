import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/status.dart';
import '../../common/ui.dart';
import '../../providers.dart';
import '../messages/messages_screens.dart' show openConversation;
import '../cart/cart_providers.dart';
import 'order_providers.dart';

/// Board "طلباتي": search, status pills (الكل / قيد التنفيذ / تم التوصيل / ملغي), order cards with thumbnails.
class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});
  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  OrderFilter _filter = OrderFilter.all;
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final signedIn = ref.watch(signedInProvider);
    final orders = ref.watch(ordersProvider);
    return EdmnAppScaffold(
      title: t.myOrders,
      showBack: false,
      body: !signedIn
          ? EdmnEmptyState(icon: Icons.receipt_long_outlined, title: t.signInPromptTitle, message: t.signInPromptBody, actionLabel: t.signIn, onAction: () => context.push('/sign-in?next=/orders'))
          : Column(children: [
              Padding(
                padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.screen, EdmnSpacing.md, EdmnSpacing.screen, EdmnSpacing.sm),
                child: EdmnSearchBar(hint: t.searchOrdersHint, onChanged: (v) => setState(() => _q = v.trim().toUpperCase())),
              ),
              Padding(
                padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.screen, 0, EdmnSpacing.screen, EdmnSpacing.sm),
                child: EdmnSecondaryButton(key: const Key('open-reorder'), label: t.reorder, icon: Icons.replay_rounded, onPressed: () => context.push('/reorder')),
              ),
              EdmnFilterPills<OrderFilter>(
                options: [(OrderFilter.all, t.all), (OrderFilter.inProgress, t.filterInProgress), (OrderFilter.delivered, t.filterDelivered), (OrderFilter.cancelled, t.filterCancelled)],
                selected: _filter,
                onSelected: (f) => setState(() => _filter = f),
              ),
              const SizedBox(height: EdmnSpacing.sm),
              Expanded(
                child: AsyncView(
                  value: orders,
                  skeleton: true,
                  onRetry: () => ref.invalidate(ordersProvider),
                  data: (s) {
                    final shown = s.items.where((o) => orderMatches(_filter, o.status) && (_q.isEmpty || o.number.toUpperCase().contains(_q))).toList();
                    if (shown.isEmpty) {
                      return EdmnEmptyState(icon: Icons.receipt_long_outlined, title: t.ordersEmptyTitle, actionLabel: s.items.isEmpty ? t.browseProducts : null, onAction: () => context.go('/'));
                    }
                    return RefreshIndicator(
                      onRefresh: () => ref.refresh(ordersProvider.future),
                      child: ListView.builder(
                        key: const PageStorageKey('orders'),
                        padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.screen),
                        itemCount: shown.length + 1,
                        itemBuilder: (_, i) {
                          if (i == shown.length) {
                            return EdmnPagination(hasMore: s.hasMore, loading: s.loadingMore, error: s.error, onLoadMore: () => ref.read(ordersProvider.notifier).loadMore());
                          }
                          final o = shown[i];
                          final (label, tone) = orderStatus(t, o.status);
                          return EdmnOrderCard(
                            key: Key('order-${o.id}'),
                            number: o.number,
                            date: formatDateTime(context, o.placedAt, time: false),
                            status: EdmnStatusChip(label: label, tone: tone),
                            totalPiastres: o.grandTotalPiastres,
                            thumbnails: o.thumbnails,
                            onTap: () => context.push('/orders/${o.id}'),
                          );
                        },
                      ),
                    );
                  },
                ),
              ),
            ]),
    );
  }
}

/// Order detail = board "تتبع الطلب" per seller shipment (vertical timeline) + payment, actions and totals.
class OrderScreen extends ConsumerWidget {
  const OrderScreen({super.key, required this.orderId, this.justPlaced = false});
  final String orderId;
  final bool justPlaced;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final order = ref.watch(orderProvider(orderId));
    return EdmnAppScaffold(
      title: t.trackOrder,
      body: AsyncView(
        value: order,
        onRetry: () => ref.invalidate(orderProvider(orderId)),
        data: (o) {
          final (label, tone) = orderStatus(t, o.status);
          final pay = o.payment;
          return RefreshIndicator(
            onRefresh: () => ref.refresh(orderProvider(orderId).future),
            child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
              if (justPlaced) ...[EdmnNotice(title: t.orderPlacedTitle, message: t.orderPlacedBody, tone: EdmnTone.success), const SizedBox(height: EdmnSpacing.md)],
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('#${o.number}', textDirection: TextDirection.ltr, style: EdmnType.section.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800)),
                    EgpText(o.grandTotalPiastres, style: EdmnType.priceLarge.copyWith(color: EdmnColors.textPrimary)),
                    Text(formatDateTime(context, o.placedAt), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                  ]),
                ),
                EdmnStatusChip(label: label, tone: tone),
              ]),
              if (o.cancelReasonAr != null) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(message: o.cancelReasonAr!, tone: EdmnTone.danger)],
              if (pay != null) ...[const SizedBox(height: EdmnSpacing.md), _PaymentCard(payment: pay)],
              for (final so in o.sellerOrders) _SellerOrderSection(order: o, so: so),
              const SizedBox(height: EdmnSpacing.md),
              Text(t.orderSummary, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
              const SizedBox(height: EdmnSpacing.xs),
              EdmnAmountSummary(
                rows: [
                  (t.itemsTotal, o.merchandiseTotalPiastres),
                  (t.shippingFee, o.shippingTotalPiastres),
                  if (o.buyerFeeTotalPiastres > 0) (t.buyerFee, o.buyerFeeTotalPiastres),
                  if (o.discountTotalPiastres > 0) (t.discount, -o.discountTotalPiastres),
                ],
                totalLabel: t.total,
                totalPiastres: o.grandTotalPiastres,
              ),
              if (o.allowedActions.contains('CANCEL_UNPAID')) ...[
                const SizedBox(height: EdmnSpacing.md),
                _CancelOrderButton(orderId: o.id),
              ],
            ]),
          );
        },
      ),
    );
  }
}

class _PaymentCard extends StatelessWidget {
  const _PaymentCard({required this.payment});
  final Payment payment;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final (label, tone) = paymentStatus(t, payment.status);
    final canPay = payment.allowedActions.contains('SUBMIT_PROOF');
    return EdmnCard(
      key: const Key('payment-card'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Icon(Icons.payments_outlined, color: EdmnColors.primary),
          const SizedBox(width: EdmnSpacing.xs),
          Expanded(child: Text(t.paymentTitle, style: EdmnType.cardTitle.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700))),
          EdmnStatusChip(label: label, tone: tone),
        ]),
        if (payment.status == 'AWAITING_PAYMENT' || payment.status == 'REJECTED')
          Text(t.payBefore(formatDateTime(context, payment.dueAt)), style: EdmnType.secondary.copyWith(color: EdmnColors.warning, fontWeight: FontWeight.w700)),
        if (payment.lastRejectionReasonAr != null) Text(t.receiptRejected(payment.lastRejectionReasonAr!), style: EdmnType.secondary.copyWith(color: EdmnColors.error)),
        const SizedBox(height: EdmnSpacing.sm),
        canPay
            ? EdmnPrimaryButton(key: const Key('pay-now'), label: t.payNow, icon: Icons.upload_file_rounded, onPressed: () => context.push('/payments/${payment.id}'))
            : EdmnSecondaryButton(label: t.paymentTitle, onPressed: () => context.push('/payments/${payment.id}')),
      ]),
    );
  }
}

class _CancelOrderButton extends ConsumerStatefulWidget {
  const _CancelOrderButton({required this.orderId});
  final String orderId;
  @override
  ConsumerState<_CancelOrderButton> createState() => _CancelOrderButtonState();
}

class _CancelOrderButtonState extends ConsumerState<_CancelOrderButton> {
  final _intent = IntentKey();
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnSecondaryButton(
      key: const Key('cancel-order'),
      label: t.cancelOrder,
      destructive: true,
      loading: _busy,
      onPressed: () async {
        if (!await showEdmnConfirmation(context, title: t.cancelOrder, message: t.cancelOrderConfirm, confirmLabel: t.cancelOrder, destructive: true)) return;
        setState(() => _busy = true);
        if (!context.mounted) return;
        await runAction(context, () => ref.read(mobileApiProvider).cancelUnpaidOrder(widget.orderId, idempotencyKey: _intent.value), success: t.orderCancelled);
        ref.invalidate(orderProvider(widget.orderId));
        ref.invalidate(ordersProvider);
        if (mounted) setState(() => _busy = false);
      },
    );
  }
}

/// One seller's shipment: items, vertical tracking, refunds/disputes, and ONLY the actions the server allows.
class _SellerOrderSection extends ConsumerWidget {
  const _SellerOrderSection({required this.order, required this.so});
  final Order order;
  final OrderSellerOrdersItem so;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final (label, tone) = sellerOrderStatus(t, so.status);
    final actions = so.allowedActions;
    return Padding(
      padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.md),
      child: EdmnCard(
        key: Key('so-${so.id}'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(t.sellerOrderLabel(so.store.name), style: EdmnType.bodyStrong.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800))),
            EdmnStatusChip(label: label, tone: tone),
          ]),
          const SizedBox(height: EdmnSpacing.sm),
          SizedBox(
            height: EdmnSizes.thumb,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: so.items.length,
              separatorBuilder: (_, _) => const SizedBox(width: EdmnSpacing.xs),
              // The thumbnail opens the product: a screen reader names it after the product, not "button".
              itemBuilder: (_, i) => Semantics(
                button: so.items[i].productSlug != null,
                label: so.items[i].title,
                excludeSemantics: true,
                child: InkWell(
                  onTap: so.items[i].productSlug == null ? null : () => context.push('/products/${Uri.encodeComponent(so.items[i].productSlug!)}'),
                  child: EdmnThumb(url: so.items[i].imageUrl),
                ),
              ),
            ),
          ),
          for (final it in so.items)
            Padding(
              padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.xxs),
              child: Row(children: [
                Expanded(child: Text('${it.quantity} × ${it.title}', maxLines: 1, overflow: TextOverflow.ellipsis, style: EdmnType.secondary.copyWith(color: EdmnColors.textPrimary))),
                EgpText(it.lineTotalPiastres, style: EdmnType.secondary.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700)),
              ]),
            ),
          const Divider(height: EdmnSpacing.xl),
          Text(t.orderStatus, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
          const SizedBox(height: EdmnSpacing.sm),
          EdmnTrackingTimeline(steps: trackingSteps(context, order, so)),
          if (so.cancellationPending) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(message: t.cancellationRequested, tone: EdmnTone.warning)],
          if (so.openDispute) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(message: t.disputeOpen, tone: EdmnTone.warning)],
          for (final r in so.refunds) ...[
            const SizedBox(height: EdmnSpacing.xs),
            Row(children: [
              Expanded(child: Text(t.refundStatus, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary))),
              EgpText(r.amountPiastres, style: EdmnType.secondary.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700)),
              const SizedBox(width: EdmnSpacing.xs),
              () {
                final (l, tn) = refundStatus(t, r.status);
                return EdmnStatusChip(label: l, tone: tn);
              }(),
            ]),
          ],
          if (actions.contains('CONFIRM_RECEIPT')) ...[
            const SizedBox(height: EdmnSpacing.md),
            _ActionButton(
              key: Key('confirm-receipt-${so.id}'),
              label: t.confirmReceipt,
              primary: true,
              confirm: (t.confirmReceipt, t.confirmReceiptConfirm),
              success: t.receiptConfirmed,
              run: (key) => ref.read(mobileApiProvider).confirmReceipt(so.id, idempotencyKey: key),
              orderId: order.id,
            ),
          ],
          if (actions.contains('REQUEST_CANCELLATION')) ...[
            const SizedBox(height: EdmnSpacing.xs),
            _TextActionButton(
              key: Key('request-cancel-${so.id}'),
              label: t.requestCancellation,
              hint: t.cancellationReasonHint,
              minLength: 3,
              success: t.cancellationRequested,
              run: (text, key) => ref.read(mobileApiProvider).requestCancellation(so.id, text, idempotencyKey: key),
              orderId: order.id,
            ),
          ],
          if (actions.contains('REPORT_PROBLEM')) ...[
            const SizedBox(height: EdmnSpacing.xs),
            _ReportProblemButton(soId: so.id, orderId: order.id),
          ],
          if (actions.contains('WRITE_REVIEW')) ...[
            const SizedBox(height: EdmnSpacing.xs),
            EdmnSecondaryButton(key: Key('review-${so.id}'), label: t.writeReview, icon: Icons.star_outline_rounded, onPressed: () => context.push('/reviews/new?so=${so.id}')),
          ],
          if (actions.contains('REQUEST_RETURN')) ...[
            const SizedBox(height: EdmnSpacing.xs),
            EdmnSecondaryButton(key: Key('return-${so.id}'), label: t.requestReturn, icon: Icons.assignment_return_outlined, onPressed: () => context.push('/returns/new?so=${so.id}')),
          ],
          for (final r in so.returns) ...[
            const SizedBox(height: EdmnSpacing.xs),
            TextButton(key: Key('open-return-${r.id}'), onPressed: () => context.push('/returns/${r.id}'), child: Text('${t.returnLabel} #${r.number}')),
          ],
          for (final d in so.disputes) ...[
            const SizedBox(height: EdmnSpacing.xs),
            TextButton(key: Key('open-dispute-${d.id}'), onPressed: () => context.push('/disputes/${d.id}'), child: Text('${t.disputeLabel} #${d.number}')),
          ],
          if (actions.contains('OPEN_DISPUTE')) ...[
            const SizedBox(height: EdmnSpacing.xs),
            EdmnSecondaryButton(key: Key('dispute-${so.id}'), label: t.openDispute, destructive: true, onPressed: () => context.push('/disputes/new?so=${so.id}')),
          ],
          if (actions.contains('MESSAGE_SELLER')) ...[
            const SizedBox(height: EdmnSpacing.xs),
            EdmnSecondaryButton(
              key: Key('message-seller-${so.id}'),
              label: t.messageSeller,
              icon: Icons.chat_bubble_outline_rounded,
              onPressed: () => openConversation(context, ref, (api) => api.openOrderConversation(so.id)),
            ),
          ],
          const SizedBox(height: EdmnSpacing.xs),
          TextButton.icon(
            key: Key('help-${so.id}'),
            icon: const Icon(Icons.support_agent_rounded),
            label: Text(t.helpWithOrder),
            onPressed: () => context.push('/support/new?type=ORDER&relatedType=ORDER&relatedId=${order.id}'),
          ),
        ]),
      ),
    );
  }
}

class _ActionButton extends ConsumerStatefulWidget {
  const _ActionButton({super.key, required this.label, required this.run, required this.orderId, this.primary = false, this.confirm, this.success});
  final String label;
  final Future<void> Function(String idempotencyKey) run;
  final String orderId;
  final bool primary;
  final (String, String)? confirm;
  final String? success;
  @override
  ConsumerState<_ActionButton> createState() => _ActionButtonState();
}

class _ActionButtonState extends ConsumerState<_ActionButton> {
  final _intent = IntentKey();
  bool _busy = false;

  Future<void> _go() async {
    final c = widget.confirm;
    if (c != null && !await showEdmnConfirmation(context, title: c.$1, message: c.$2, confirmLabel: widget.label)) return;
    if (!mounted) return;
    setState(() => _busy = true);
    await runAction(context, () => widget.run(_intent.value), success: widget.success);
    ref.invalidate(orderProvider(widget.orderId));
    ref.invalidate(ordersProvider);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) => widget.primary
      ? EdmnPrimaryButton(label: widget.label, loading: _busy, onPressed: _go)
      : EdmnSecondaryButton(label: widget.label, loading: _busy, onPressed: _go);
}

/// An action that needs a short text (cancellation reason).
class _TextActionButton extends ConsumerStatefulWidget {
  const _TextActionButton({super.key, required this.label, required this.hint, required this.run, required this.orderId, this.minLength = 3, this.success});
  final String label;
  final String hint;
  final int minLength;
  final String? success;
  final String orderId;
  final Future<void> Function(String text, String idempotencyKey) run;
  @override
  ConsumerState<_TextActionButton> createState() => _TextActionButtonState();
}

class _TextActionButtonState extends ConsumerState<_TextActionButton> {
  final _intent = IntentKey();

  @override
  Widget build(BuildContext context) => EdmnSecondaryButton(
        label: widget.label,
        onPressed: () async {
          final text = await _askText(context, title: widget.label, hint: widget.hint, minLength: widget.minLength);
          if (text == null || !context.mounted) return;
          await runAction(context, () => widget.run(text, _intent.value), success: widget.success);
          ref.invalidate(orderProvider(widget.orderId));
        },
      );
}

class _ReportProblemButton extends ConsumerStatefulWidget {
  const _ReportProblemButton({required this.soId, required this.orderId});
  final String soId;
  final String orderId;
  @override
  ConsumerState<_ReportProblemButton> createState() => _ReportProblemButtonState();
}

class _ReportProblemButtonState extends ConsumerState<_ReportProblemButton> {
  final _intent = IntentKey();

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnSecondaryButton(
      key: Key('report-${widget.soId}'),
      label: t.reportProblem,
      destructive: true,
      onPressed: () async {
        final kind = await showEdmnBottomSheet<String>(
          context,
          title: t.reportProblem,
          child: Column(children: [
            ListTile(leading: const Icon(Icons.local_shipping_outlined), title: Text(t.problemNotReceived), onTap: () => Navigator.pop(context, 'NOT_RECEIVED')),
            ListTile(leading: const Icon(Icons.report_gmailerrorred_outlined), title: Text(t.problemProductIssue), onTap: () => Navigator.pop(context, 'PRODUCT_PROBLEM')),
          ]),
        );
        if (kind == null || !context.mounted) return;
        final text = await _askText(context, title: t.reportProblem, hint: t.problemDescriptionHint, minLength: 10);
        if (text == null || !context.mounted) return;
        await runAction(context, () => ref.read(mobileApiProvider).reportOrderProblem(widget.soId, kind, text, idempotencyKey: _intent.value), success: t.problemReported);
        ref.invalidate(orderProvider(widget.orderId));
      },
    );
  }
}

Future<String?> _askText(BuildContext context, {required String title, required String hint, required int minLength}) {
  final t = EdmnLocalizations.of(context);
  final c = TextEditingController();
  final form = GlobalKey<FormState>();
  return showEdmnBottomSheet<String>(
    context,
    title: title,
    child: Form(
      key: form,
      child: EdmnTextField(key: const Key('action-text'), controller: c, hint: hint, maxLines: 4, validator: (v) => (v ?? '').trim().length < minLength ? t.fieldRequired : null),
    ),
    action: Builder(
      builder: (sheet) => EdmnPrimaryButton(
        key: const Key('action-submit'),
        label: t.confirm,
        onPressed: () {
          if (form.currentState!.validate()) Navigator.pop(sheet, c.text.trim());
        },
      ),
    ),
  );
}

/// "إعادة الطلب" (board tab): completed orders' items, re-added at TODAY's server price (the server re-prices them).
class ReorderScreen extends ConsumerWidget {
  const ReorderScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final signedIn = ref.watch(signedInProvider);
    final orders = ref.watch(ordersProvider);
    return EdmnAppScaffold(
      title: t.reorder,
      body: !signedIn
          ? EdmnEmptyState(icon: Icons.replay_rounded, title: t.signInPromptTitle, message: t.signInPromptBody, actionLabel: t.signIn, onAction: () => context.push('/sign-in?next=/reorder'))
          : AsyncView(
              value: orders,
              skeleton: true,
              onRetry: () => ref.invalidate(ordersProvider),
              data: (s) {
                final done = s.items.where((o) => orderMatches(OrderFilter.delivered, o.status)).toList();
                if (done.isEmpty) return EdmnEmptyState(icon: Icons.replay_rounded, title: t.reorderEmptyTitle, message: t.reorderEmptyBody);
                return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
                  EdmnNotice(message: t.reorderNotice),
                  const SizedBox(height: EdmnSpacing.sm),
                  for (final o in done) _ReorderCard(summary: o),
                ]);
              },
            ),
    );
  }
}

class _ReorderCard extends ConsumerStatefulWidget {
  const _ReorderCard({required this.summary});
  final ListOrdersResponseItemsItem summary;
  @override
  ConsumerState<_ReorderCard> createState() => _ReorderCardState();
}

class _ReorderCardState extends ConsumerState<_ReorderCard> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final o = widget.summary;
    return EdmnCard(
      margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(child: Text('#${o.number}', textDirection: TextDirection.ltr, textAlign: TextAlign.start, style: EdmnType.cardTitle.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700))),
          Text(formatDateTime(context, o.placedAt, time: false), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
        ]),
        const SizedBox(height: EdmnSpacing.xs),
        Row(children: [for (final u in o.thumbnails) Padding(padding: const EdgeInsetsDirectional.only(end: EdmnSpacing.xs), child: EdmnThumb(url: u))]),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnSecondaryButton(
          key: Key('reorder-${o.id}'),
          label: t.orderAgain,
          icon: Icons.replay_rounded,
          loading: _busy,
          onPressed: () async {
            setState(() => _busy = true);
            final api = ref.read(mobileApiProvider);
            var added = 0;
            var failed = 0;
            try {
              final full = await ref.read(orderProvider(o.id).future);
              for (final so in full.sellerOrders) {
                for (final it in so.items) {
                  try {
                    await api.addToCart(it.variantId, it.quantity, idempotencyKey: newIdempotencyKey());
                    added++;
                  } catch (_) {
                    failed++; // unavailable now / out of stock: reported, never silently swapped
                  }
                }
              }
              ref.invalidate(cartProvider);
              if (context.mounted) showEdmnMessage(context, failed == 0 ? t.reorderAdded(added) : t.reorderPartial(added, failed), error: added == 0);
            } catch (e) {
              if (context.mounted) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
            } finally {
              if (mounted) setState(() => _busy = false);
            }
          },
        ),
      ]),
    );
  }
}
