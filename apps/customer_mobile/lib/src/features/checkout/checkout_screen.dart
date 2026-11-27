import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/ui.dart';
import '../../providers.dart';
import '../cart/cart_providers.dart';
import '../orders/order_providers.dart';

final checkoutProvider = FutureProvider.family<Checkout, String?>((ref, addressId) => ref.watch(mobileApiProvider).checkout(addressId: addressId));

/// Board "إتمام الطلب": stepper العنوان → التوصيل → الدفع → تأكيد, payment methods card, server order summary,
/// "تأكيد الطلب". The order is placed with ONE checkout key per visit (a double tap or retry returns the same order)
/// and the total the buyer saw; if the server's total moved, the order is refused and the new quote is shown.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});
  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  int _step = 0;
  String? _addressId;
  String? _method;
  bool _placing = false;
  Object? _placeError;
  final _checkoutKey = IntentKey();

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final quote = ref.watch(checkoutProvider(_addressId));
    final q = quote.value;
    final selected = _addressId ?? q?.selectedAddressId;
    // Three steps (owner feedback 2026-11-27: «العنوان» then «التوصيل» made no sense as two steps):
    //   0 التوصيل = where to deliver + what shipping costs from each store, 1 الدفع, 2 تأكيد.
    final canContinue = switch (_step) {
      0 => selected != null && q?.cart.shippingResolved == true && q?.cart.hasIssues == false,
      1 => _method != null,
      _ => q?.cart.canCheckout == true && _method != null && selected != null,
    };
    return EdmnAppScaffold(
      title: t.checkoutTitle,
      onBack: _step == 0 ? null : () => setState(() => _step--),
      bottomBar: q == null
          ? null
          : EdmnPrimaryButton(
              key: const Key('checkout-next'),
              label: _step < 2 ? t.continueLabel : t.placeOrder,
              icon: _step < 2 ? null : Icons.check_rounded,
              loading: _placing,
              onPressed: !canContinue
                  ? null
                  : () {
                      if (_step < 2) {
                        setState(() {
                          _step++;
                          _addressId ??= selected;
                        });
                      } else {
                        _place(q, selected!);
                      }
                    },
            ),
      body: AsyncView(
        value: quote,
        onRetry: () => ref.invalidate(checkoutProvider(_addressId)),
        data: (q) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          EdmnStepper(labels: [t.stepDelivery, t.stepPayment, t.stepConfirm], current: _step),
          const SizedBox(height: EdmnSpacing.lg),
          if (!q.realMoneyEnabled) ...[EdmnTestMoneyNotice(message: t.testPaymentNotice), const SizedBox(height: EdmnSpacing.md)],
          ...switch (_step) {
            0 => [..._addressStep(q, selected), const SizedBox(height: EdmnSpacing.lg), ..._deliveryStep(q)],
            1 => _paymentStep(q),
            _ => _confirmStep(q, selected),
          },
          if (selected != null) ...[
            const SizedBox(height: EdmnSpacing.lg),
            Text(t.orderSummary, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
            const SizedBox(height: EdmnSpacing.xs),
            EdmnAmountSummary(
              rows: [
                (t.itemsTotal, q.cart.merchandiseTotalPiastres),
                (t.shippingFee, q.cart.shippingResolved ? q.cart.shippingTotalPiastres : null),
                if (q.cart.buyerFeeTotalPiastres > 0) (t.buyerFee, q.cart.buyerFeeTotalPiastres),
                if (q.cart.discountTotalPiastres > 0) (t.discount, -q.cart.discountTotalPiastres),
                if (_method == 'COD' && q.codFeePiastres > 0) (languageOf(context) == 'en' ? 'COD collection fee' : 'رسوم الدفع عند الاستلام', q.codFeePiastres),
              ],
              totalLabel: t.total,
              totalPiastres: q.cart.grandTotalPiastres + (_method == 'COD' ? q.codFeePiastres : 0),
            ),
          ],
          if (_placeError != null) ...[const SizedBox(height: EdmnSpacing.md), EdmnNotice(message: apiErrorMessage(context, _placeError!), tone: EdmnTone.danger)],
        ]),
      ),
    );
  }

  List<Widget> _addressStep(Checkout q, String? selected) {
    final t = EdmnLocalizations.of(context);
    return [
      Text(t.deliveryAddress, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
      const SizedBox(height: EdmnSpacing.xs),
      if (q.addresses.isEmpty)
        EdmnNotice(message: t.noAddressesTitle)
      else
        EdmnRadioCard<String>(
          value: selected,
          onChanged: (id) {
            setState(() => _addressId = id);
            final a = q.addresses.firstWhere((a) => a.id == id);
            ref.read(governorateProvider.notifier).set(a.governorateId);
          },
          options: [
            for (final a in q.addresses)
              EdmnRadioOption(value: a.id, icon: Icons.location_on_outlined, label: a.label ?? a.recipientName, subtitle: '${a.street}، ${a.city}\n${a.phone}'),
          ],
        ),
      const SizedBox(height: EdmnSpacing.sm),
      EdmnSecondaryButton(
        key: const Key('add-address'),
        label: t.addAddress,
        icon: Icons.add_location_alt_outlined,
        onPressed: () async {
          final id = await context.push<String>('/account/addresses/new');
          if (id != null) setState(() => _addressId = id);
          ref.invalidate(checkoutProvider);
        },
      ),
    ];
  }

  List<Widget> _deliveryStep(Checkout q) {
    final t = EdmnLocalizations.of(context);
    return [
      Text(t.shippingFromStores, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
      const SizedBox(height: EdmnSpacing.xs),
      for (final g in q.cart.groups)
        EdmnCard(
          margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
          padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
          child: Row(children: [
            const Icon(Icons.local_shipping_outlined, color: EdmnColors.primary),
            const SizedBox(width: EdmnSpacing.sm),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(g.store.name, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700)),
                Text(
                  g.shippingFeePiastres == null ? t.noShippingToArea : (g.etaMinDays != null && g.etaMaxDays != null ? t.deliveryEta(g.etaMinDays!, g.etaMaxDays!) : ''),
                  style: EdmnType.secondary.copyWith(color: g.shippingFeePiastres == null ? EdmnColors.error : EdmnColors.textSecondary),
                ),
              ]),
            ),
            g.shippingFeePiastres == 0
                ? Text(t.freeShipping, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.success, fontWeight: FontWeight.w800))
                : EgpText(g.shippingFeePiastres, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700)),
          ]),
        ),
      if (q.cart.hasIssues) EdmnNotice(message: t.priceChangedReview, tone: EdmnTone.warning),
    ];
  }

  List<Widget> _paymentStep(Checkout q) {
    final t = EdmnLocalizations.of(context);
    final en = languageOf(context) == 'en';
    IconData icon(String code) => switch (code) {
          'INSTAPAY' => Icons.bolt_rounded,
          'VODAFONE_CASH' || 'ORANGE_CASH' || 'ETISALAT_CASH' || 'WE_PAY' || 'BM_WALLET' => Icons.phone_iphone_rounded,
          'COD' => Icons.payments_outlined,
          _ => Icons.account_balance_outlined,
        };
    return [
      Text(t.paymentMethod, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
      const SizedBox(height: EdmnSpacing.xs),
      // Only the methods the server enables. COD appears here when the store setting is on.
      EdmnRadioCard<String>(
        value: _method,
        onChanged: (m) => setState(() => _method = m),
        options: [for (final m in q.paymentMethods) EdmnRadioOption(value: m.code, icon: icon(m.code), label: en ? m.nameEn : m.nameAr, subtitle: m.instructionsAr)],
      ),
      const SizedBox(height: EdmnSpacing.sm),
      if (_method == 'COD')
        EdmnNotice(
          message: en
              ? 'You pay ${(q.cart.grandTotalPiastres + q.codFeePiastres) / 100} EGP in cash to the courier on delivery.'
              : 'هتدفع ${(q.cart.grandTotalPiastres + q.codFeePiastres) / 100} ج.م نقدًا للمندوب عند الاستلام.',
          icon: Icons.payments_outlined,
        )
      else
        EdmnNotice(message: t.paymentWindow(q.paymentWindowHours), icon: Icons.schedule_rounded),
    ];
  }

  List<Widget> _confirmStep(Checkout q, String? selected) {
    final t = EdmnLocalizations.of(context);
    final a = q.addresses.where((a) => a.id == selected).firstOrNull;
    final m = q.paymentMethods.where((m) => m.code == _method).firstOrNull;
    return [
      EdmnCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(t.deliveryAddress, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
          Text(a == null ? '' : '${a.recipientName} — ${a.street}، ${a.city}', style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
          const Divider(height: EdmnSpacing.lg),
          Text(t.paymentMethod, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
          Text(m == null ? '' : (languageOf(context) == 'en' ? m.nameEn : m.nameAr), style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
        ]),
      ),
      const SizedBox(height: EdmnSpacing.sm),
      EdmnNotice(message: q.mandatoryRightsNoticeAr, icon: Icons.gavel_rounded),
    ];
  }

  Future<void> _place(Checkout q, String addressId) async {
    setState(() {
      _placing = true;
      _placeError = null;
    });
    try {
      final r = await ref.read(mobileApiProvider).placeOrder(PlaceOrderRequest(
            addressId: addressId,
            paymentMethod: _method!,
            checkoutKey: _checkoutKey.value,
            expectedTotalPiastres: q.cart.grandTotalPiastres + (_method == 'COD' ? q.codFeePiastres : 0),
            expectedPricingVersionId: q.cart.pricingVersionId,
          ));
      ref.invalidate(cartProvider);
      ref.invalidate(ordersProvider);
      if (mounted) context.go('/orders/${r.orderId}?placed=1');
    } on ApiFailure catch (e) {
      // The total moved (price/stock/fee change): show the fresh quote; the next attempt is a NEW intent.
      if (e.code == ApiErrorCode.conflict || e.code == ApiErrorCode.invalidState) {
        _checkoutKey.reset();
        ref.invalidate(checkoutProvider(_addressId));
      }
      setState(() => _placeError = e);
    } catch (e) {
      setState(() => _placeError = e);
    } finally {
      if (mounted) setState(() => _placing = false);
    }
  }
}
