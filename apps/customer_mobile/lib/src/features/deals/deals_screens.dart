import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/file_pick.dart';
import '../../common/ui.dart';
import '../../providers.dart';
import '../messages/messages_screens.dart' show openConversation;

/// أضمن صفقة — escrow between two parties outside the marketplace. Buyer creates and invites; seller joins and offers;
/// both agree (any material change is re-approved); buyer pays (EDMN verifies the receipt); seller ships; the buyer's
/// single-use code proves the handover; the buyer confirms; EDMN releases or refunds. The app never moves money.
final dealsProvider = FutureProvider<ListDealsResponse>((ref) => ref.watch(mobileApiProvider).deals());
final dealProvider = FutureProvider.autoDispose.family<ProtectedDeal, String>((ref, id) => ref.watch(mobileApiProvider).deal(id));
/// Re-read each time the sheet opens (expiry / attempts change on the server); never cached beyond the sheet.
final dealCodeProvider = FutureProvider.autoDispose.family<GetDealDeliveryCodeResponse, String>((ref, id) => ref.watch(mobileApiProvider).dealDeliveryCode(id));

(String, EdmnTone) dealStatus(EdmnLocalizations t, String s, {String role = 'BUYER'}) => switch (s) {
      'DRAFT' => (t.dealDraft, EdmnTone.neutral),
      'INVITED' => (t.dealInvited, EdmnTone.info),
      'SELLER_JOINED' => (t.dealSellerJoined, EdmnTone.info),
      'OFFER_PENDING_BUYER' => (role == 'BUYER' ? t.dealOfferPending : t.dealAwaitingBuyer, EdmnTone.warning),
      'CHANGE_REQUESTED' => (role == 'SELLER' ? t.dealChangeRequested : t.dealAwaitingSeller, EdmnTone.warning),
      'ACCEPTED' || 'PAYMENT_PENDING' => (t.statusPendingPayment, EdmnTone.warning),
      'PAYMENT_UNDER_REVIEW' => (t.statusPaymentUnderReview, EdmnTone.warning),
      'ACTIVE' => (t.dealFundsHeld, EdmnTone.info),
      'DELIVERED' => (t.dealDelivered, EdmnTone.info),
      'DELIVERY_HANDOVER_VERIFIED' || 'BUYER_CONFIRMATION_PENDING' => (t.dealInspection, EdmnTone.warning),
      'BUYER_CONFIRMED_RECEIPT' || 'ENTITLED_AWAITING_RELEASE' => (t.dealAwaitingRelease, EdmnTone.info),
      'COMPLETED' => (t.statusCompleted, EdmnTone.success),
      'DISPUTED' => (t.disputeOpen, EdmnTone.danger),
      'REFUND_PENDING' => (t.refundInProgress, EdmnTone.warning),
      'REFUNDED' => (t.refundCompleted, EdmnTone.neutral),
      'CANCELLED' => (t.statusCancelled, EdmnTone.danger),
      _ => (s, EdmnTone.neutral),
    };

const _order = [
  'DRAFT', 'INVITED', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'ACCEPTED', 'PAYMENT_UNDER_REVIEW', 'ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMED_RECEIPT', 'COMPLETED', //
];

int _rank(String s) => switch (s) {
      'CHANGE_REQUESTED' => 3,
      'PAYMENT_PENDING' => 4,
      'BUYER_CONFIRMATION_PENDING' => 8,
      'ENTITLED_AWAITING_RELEASE' => 9,
      _ => _order.indexOf(s),
    };

/* ───────────────────────── D01/D02 hub ───────────────────────── */

class DealsHubScreen extends ConsumerStatefulWidget {
  const DealsHubScreen({super.key});
  @override
  ConsumerState<DealsHubScreen> createState() => _DealsHubScreenState();
}

class _DealsHubScreenState extends ConsumerState<DealsHubScreen> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final deals = ref.watch(dealsProvider);
    return EdmnAppScaffold(
      title: t.protectedDeal,
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(dealsProvider.future),
        child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          Container(
            padding: const EdgeInsetsDirectional.all(EdmnSpacing.md),
            decoration: BoxDecoration(gradient: EdmnColors.headerGradient, borderRadius: BorderRadius.circular(EdmnRadii.card)),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Container(
                    padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.sm, vertical: EdmnSpacing.xxs),
                    decoration: BoxDecoration(color: EdmnColors.accentCyan, borderRadius: BorderRadius.circular(EdmnRadii.small)),
                    child: Text(t.protectedDeal, style: EdmnType.section.copyWith(color: EdmnColors.primaryDeep, fontWeight: FontWeight.w800)),
                  ),
                  const SizedBox(height: EdmnSpacing.xs),
                  Text(t.dealHubBody, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.onPrimary)),
                ]),
              ),
              const EdmnLogo(variant: EdmnLogoVariant.emblem, height: 64),
            ]),
          ),
          const SizedBox(height: EdmnSpacing.md),
          EdmnCard(
            child: Row(children: [
              Expanded(child: EdmnQuickAction(icon: Icons.verified_user_outlined, label: t.dealStepHold)),
              Expanded(child: EdmnQuickAction(icon: Icons.local_shipping_outlined, label: t.dealStepDeliver)),
              Expanded(child: EdmnQuickAction(icon: Icons.handshake_outlined, label: t.dealStepRelease)),
            ]),
          ),
          const SizedBox(height: EdmnSpacing.md),
          EdmnPrimaryButton(key: const Key('new-deal'), label: t.newDeal, icon: Icons.add_rounded, onPressed: () => context.push('/deals/new')),
          const SizedBox(height: EdmnSpacing.xs),
          EdmnSecondaryButton(key: const Key('have-invite'), label: t.haveInvitation, icon: Icons.link_rounded, onPressed: () => context.push('/deals/join')),
          TextButton(onPressed: () => showEdmnBottomSheet(context, title: t.howDealWorks, child: Text(t.howDealWorksBody, style: EdmnType.body)), child: Text(t.howDealWorks)),
          const SizedBox(height: EdmnSpacing.xs),
          EdmnFilterPills<bool>(options: [(false, t.dealsActive), (true, t.dealsClosed)], selected: _done, onSelected: (v) => setState(() => _done = v)),
          const SizedBox(height: EdmnSpacing.sm),
          deals.when(
            loading: () => const SizedBox(height: 160, child: EdmnLoadingState()),
            error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(dealsProvider)),
            data: (r) {
              const closed = {'COMPLETED', 'CANCELLED', 'REFUNDED'};
              final items = r.items.where((d) => closed.contains(d.status) == _done).toList();
              if (items.isEmpty) return EdmnEmptyState(icon: Icons.handshake_outlined, title: t.noDeals);
              return Column(children: [
                for (final d in items)
                  () {
                    final (l, tone) = dealStatus(t, d.status, role: d.role);
                    return EdmnSecureDealCard(
                      key: Key('deal-${d.id}'),
                      title: d.title,
                      counterparty: d.ref,
                      roleLabel: d.role == 'BUYER' ? t.dealRoleBuyer : t.dealRoleSeller,
                      amountPiastres: d.totalPiastres ?? 0,
                      status: EdmnStatusChip(label: l, tone: tone),
                      onTap: () => context.push('/deals/${d.id}'),
                    );
                  }(),
              ]);
            },
          ),
        ]),
      ),
    );
  }
}

/* ───────────────────────── D03–D10 new deal wizard ───────────────────────── */

class NewDealScreen extends ConsumerStatefulWidget {
  const NewDealScreen({super.key});
  @override
  ConsumerState<NewDealScreen> createState() => _NewDealScreenState();
}

class _NewDealScreenState extends ConsumerState<NewDealScreen> {
  int _step = 0;
  String? _dealId;
  String _condition = 'NEW';
  bool _busy = false;
  final _intent = IntentKey();
  late final _c = {
    for (final k in ['title', 'description', 'quantity', 'sourceUrl', 'unitPrice', 'deliveryMethod', 'deadlineDays', 'inspectionDays', 'customTerms', 'city', 'street', 'sellerName', 'sellerPhone']) k: TextEditingController(),
  };
  int? _gov;

  @override
  void initState() {
    super.initState();
    _c['quantity']!.text = '1';
    _c['deadlineDays']!.text = '7';
    _c['inspectionDays']!.text = '2';
  }

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _next() async {
    final api = ref.read(mobileApiProvider);
    setState(() => _busy = true);
    try {
      switch (_step) {
        case 0:
          final body = {
            'title': _c['title']!.text.trim(),
            'description': _c['description']!.text.trim(),
            'condition': _condition,
            'quantity': int.tryParse(_c['quantity']!.text) ?? 1,
            if (_c['sourceUrl']!.text.trim().isNotEmpty) 'sourceUrl': _c['sourceUrl']!.text.trim(),
          };
          final d = _dealId == null ? await api.createDeal(body, idempotencyKey: _intent.value) : await api.saveDealStep(_dealId!, 1, body);
          _dealId = d.id;
        case 1:
          await api.saveDealStep(_dealId!, 2, {'unitPrice': _c['unitPrice']!.text.trim()});
        case 2:
          final days = int.tryParse(_c['deadlineDays']!.text) ?? 7;
          await api.saveDealStep(_dealId!, 3, {
            'deliveryMethod': _c['deliveryMethod']!.text.trim(),
            'deliveryDeadline': DateTime.now().add(Duration(days: days)).toUtc().toIso8601String(),
            'inspectionDays': int.tryParse(_c['inspectionDays']!.text) ?? 2,
          });
          await api.saveDealStep(_dealId!, 4, {'customTerms': _c['customTerms']!.text.trim()});
        case 3:
          await api.saveDealStep(_dealId!, 5, {
            'loc_governorateId': '${_gov ?? 1}',
            'loc_city': _c['city']!.text.trim(),
            'loc_street': _c['street']!.text.trim(),
            'sellerName': _c['sellerName']!.text.trim(),
            'sellerPhone': _c['sellerPhone']!.text.trim(),
          });
        case 4:
          if (mounted) context.pushReplacement('/deals/$_dealId');
          return;
      }
      setState(() => _step++);
    } catch (e) {
      if (mounted) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final govs = ref.watch(governoratesProvider).value ?? const [];
    Widget f(String k, String hint, {TextInputType? type, int lines = 1, TextDirection? dir}) => Padding(
          padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
          child: EdmnTextField(key: Key('deal-$k'), controller: _c[k], hint: hint, keyboardType: type, maxLines: lines, textDirection: dir),
        );
    final steps = [t.dealStepItem, t.dealStepPrice, t.dealStepDelivery, t.dealStepLocation, t.stepConfirm];
    return EdmnAppScaffold(
      title: t.newDeal,
      onBack: _step == 0 ? null : () => setState(() => _step--),
      bottomBar: EdmnPrimaryButton(key: const Key('deal-next'), label: _step < 4 ? t.continueLabel : t.reviewDeal, loading: _busy, onPressed: _next),
      body: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
        EdmnStepper(labels: steps, current: _step),
        const SizedBox(height: EdmnSpacing.lg),
        ...switch (_step) {
          0 => [
              EdmnNotice(message: t.dealBuyerOnly),
              const SizedBox(height: EdmnSpacing.sm),
              f('title', t.dealTitleHint),
              f('description', t.dealDescriptionHint, lines: 4),
              EdmnRadioCard<String>(
                value: _condition,
                onChanged: (v) => setState(() => _condition = v),
                options: [
                  EdmnRadioOption(value: 'NEW', label: t.conditionNew, icon: Icons.fiber_new_outlined),
                  EdmnRadioOption(value: 'USED', label: t.conditionUsed, icon: Icons.recycling_rounded),
                ],
              ),
              const SizedBox(height: EdmnSpacing.sm),
              f('quantity', t.quantityHint, type: TextInputType.number, dir: TextDirection.ltr),
              f('sourceUrl', t.dealLinkHint, type: TextInputType.url, dir: TextDirection.ltr),
            ],
          1 => [f('unitPrice', t.priceEgp, type: const TextInputType.numberWithOptions(decimal: true), dir: TextDirection.ltr), EdmnNotice(message: t.dealFeesNote)],
          2 => [
              f('deliveryMethod', t.dealDeliveryHint),
              f('deadlineDays', t.dealDeadlineHint, type: TextInputType.number, dir: TextDirection.ltr),
              f('inspectionDays', t.dealInspectionHint, type: TextInputType.number, dir: TextDirection.ltr),
              f('customTerms', t.dealTermsHint, lines: 3),
            ],
          3 => [
              DropdownButtonFormField<int>(
                initialValue: _gov,
                isExpanded: true,
                decoration: InputDecoration(hintText: t.governorate, prefixIcon: const Icon(Icons.map_outlined)),
                items: [for (final g in govs) DropdownMenuItem(value: g.id, child: Text(languageOf(context) == 'en' ? g.nameEn : g.nameAr))],
                onChanged: (v) => setState(() => _gov = v),
              ),
              const SizedBox(height: EdmnSpacing.sm),
              f('city', t.cityHint),
              f('street', t.streetHint),
              f('sellerName', t.dealSellerNameHint),
              f('sellerPhone', t.dealSellerPhoneHint, type: TextInputType.phone, dir: TextDirection.ltr),
              EdmnNotice(message: t.dealLocationPrivacy),
            ],
          _ => [EdmnNotice(tone: EdmnTone.success, title: t.dealSaved, message: t.dealSavedBody)],
        },
      ]),
    );
  }
}

/* ───────────────────────── D06 join by invitation ───────────────────────── */

class JoinDealScreen extends ConsumerStatefulWidget {
  const JoinDealScreen({super.key, this.token});
  final String? token;
  @override
  ConsumerState<JoinDealScreen> createState() => _JoinDealScreenState();
}

class _JoinDealScreenState extends ConsumerState<JoinDealScreen> {
  late final _link = TextEditingController(text: widget.token ?? '');
  bool _busy = false;

  @override
  void dispose() {
    _link.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnAppScaffold(
      title: t.haveInvitation,
      body: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
        EdmnNotice(message: t.joinDealBody),
        const SizedBox(height: EdmnSpacing.md),
        EdmnTextField(key: const Key('invite-link'), controller: _link, hint: t.inviteLinkHint, icon: Icons.link_rounded, textDirection: TextDirection.ltr),
        const SizedBox(height: EdmnSpacing.md),
        EdmnPrimaryButton(
          key: const Key('join-deal'),
          label: t.joinDeal,
          loading: _busy,
          onPressed: () async {
            final token = _link.text.trim().split('/').where((x) => x.isNotEmpty).lastOrNull ?? '';
            if (token.length < 20) return showEdmnMessage(context, t.inviteLinkHint, error: true);
            setState(() => _busy = true);
            try {
              final d = await ref.read(mobileApiProvider).claimDealInvitation(token);
              ref.invalidate(dealsProvider);
              if (context.mounted) context.pushReplacement('/deals/${d.id}');
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

/* ───────────────────────── D11–D23 deal detail ───────────────────────── */

class DealScreen extends ConsumerStatefulWidget {
  const DealScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<DealScreen> createState() => _DealScreenState();
}

class _DealScreenState extends ConsumerState<DealScreen> {
  final _intent = IntentKey();
  String? _busy;
  String? _link;

  Future<void> _act(String key, Future<Object?> Function(String idem) run, {String? success, (String, String)? confirm}) async {
    if (confirm != null && !await showEdmnConfirmation(context, title: confirm.$1, message: confirm.$2, confirmLabel: confirm.$1)) return;
    if (!mounted) return;
    setState(() => _busy = key);
    final ok = await runAction(context, () async => run(_intent.value), success: success);
    if (ok) _intent.reset();
    ref.invalidate(dealProvider(widget.id));
    ref.invalidate(dealsProvider);
    if (mounted) setState(() => _busy = null);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final deal = ref.watch(dealProvider(widget.id));
    final api = ref.read(mobileApiProvider);
    return EdmnAppScaffold(
      title: t.protectedDeal,
      body: AsyncView(
        value: deal,
        onRetry: () => ref.invalidate(dealProvider(widget.id)),
        data: (d) {
          final a = d.allowedActions.toSet();
          final (label, tone) = dealStatus(t, d.status, role: d.role);
          final r = _rank(d.status);
          EdmnStepState at(int i) => d.status == 'CANCELLED' ? (i == 0 ? EdmnStepState.done : EdmnStepState.pending) : (r > i ? EdmnStepState.done : (r == i ? EdmnStepState.current : EdmnStepState.pending));
          Widget btn(String key, String l, VoidCallback onTap, {bool primary = true, bool danger = false}) => Padding(
                padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                child: primary && !danger
                    ? EdmnPrimaryButton(key: Key('deal-$key'), label: l, loading: _busy == key, onPressed: _busy == null ? onTap : null)
                    : EdmnSecondaryButton(key: Key('deal-$key'), label: l, destructive: danger, loading: _busy == key, onPressed: _busy == null ? onTap : null),
              );
          final m = d.money;
          return RefreshIndicator(
            onRefresh: () => ref.refresh(dealProvider(widget.id).future),
            child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
              Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(d.title, style: EdmnType.section.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800)),
                    Text('${d.ref} · ${d.role == 'BUYER' ? t.dealRoleBuyer : t.dealRoleSeller}', textDirection: TextDirection.ltr, textAlign: TextAlign.start, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                  ]),
                ),
                EdmnStatusChip(label: label, tone: tone),
              ]),
              if (d.financialHold) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(message: t.dealOnHold, tone: EdmnTone.warning)],
              if (_link != null) ...[
                const SizedBox(height: EdmnSpacing.sm),
                EdmnCard(
                  key: const Key('invite-link-card'),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text(t.inviteLinkReady, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                    SelectableText(_link!, textDirection: TextDirection.ltr, style: EdmnType.secondary.copyWith(color: EdmnColors.primary)),
                    EdmnSecondaryButton(label: t.copyLink, icon: Icons.copy_rounded, onPressed: () => Clipboard.setData(ClipboardData(text: _link!))),
                  ]),
                ),
              ],
              const SizedBox(height: EdmnSpacing.md),
              // D09 money from the server
              if (m.buyerPaysPiastres != null)
                EdmnCard(
                  child: EdmnAmountSummary(
                    rows: [
                      (t.itemsTotal, m.goodsTotalPiastres),
                      if ((m.shippingFeePiastres ?? 0) > 0) (t.shippingFee, m.shippingFeePiastres),
                      if (d.role == 'BUYER') (t.buyerFee, m.buyerFeePiastres),
                      if (d.role == 'SELLER') (t.commission, -(m.sellerFeePiastres ?? 0)),
                    ],
                    totalLabel: d.role == 'BUYER' ? t.dealBuyerPays : t.dealSellerReceives,
                    totalPiastres: d.role == 'BUYER' ? m.buyerPaysPiastres : m.sellerReceivesPiastres,
                    note: switch (m.basis) {
                      'AGREED' => t.dealMoneyNote,
                      'OFFER' => t.dealMoneyOffer,
                      _ => t.dealMoneyIndicative,
                    },
                  ),
                ),
              // Money step while Real Money is OFF: say so here, next to the amounts (no app-wide banner).
              if ((d.payment?.isTest ?? !ref.watch(realMoneyProvider)) && m.buyerPaysPiastres != null) ...[const SizedBox(height: EdmnSpacing.sm), EdmnTestMoneyNotice(message: t.testPaymentNotice)],
              // D16 timeline
              const SizedBox(height: EdmnSpacing.md),
              EdmnCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(t.dealTimeline, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                  const SizedBox(height: EdmnSpacing.sm),
                  EdmnTrackingTimeline(steps: [
                    EdmnTimelineStep(title: t.dealTlCreated, state: EdmnStepState.done, time: formatDateTime(context, d.createdAt)),
                    EdmnTimelineStep(title: t.dealTlInvited, state: at(1)),
                    EdmnTimelineStep(title: t.dealTlAgreed, state: at(3)),
                    EdmnTimelineStep(title: t.dealTlPaid, state: at(5)),
                    EdmnTimelineStep(title: t.dealTlHeld, state: at(6)),
                    EdmnTimelineStep(title: t.dealTlShipped, state: at(7)),
                    EdmnTimelineStep(title: t.dealTlHandover, state: at(8)),
                    EdmnTimelineStep(title: t.dealTlConfirmed, state: at(9), time: formatDateTime(context, d.buyerResponseDueAt)),
                    EdmnTimelineStep(title: t.dealTlReleased, state: d.status == 'COMPLETED' ? EdmnStepState.done : EdmnStepState.pending),
                  ]),
                ]),
              ),
              // D13 terms history (re-approval of material changes)
              if (d.terms.history.isNotEmpty) ...[
                const SizedBox(height: EdmnSpacing.md),
                EdmnCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text(t.dealTermsHistory, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                    for (final v in d.terms.history)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('v${v.version} · ${v.proposedBy == 'SELLER' ? t.dealPartySeller : t.dealPartyBuyer}', style: EdmnType.bodyStrong),
                        subtitle: Text([_termsStatus(t, v.status), ?v.message].join(' — '), style: EdmnType.secondary),
                      ),
                  ]),
                ),
              ],
              const SizedBox(height: EdmnSpacing.md),
              // Buyer actions
              if (a.contains('INVITE_SELLER'))
                btn('invite', t.inviteSeller, () => _act('invite', (_) async {
                      final r = await api.inviteDealSeller(d.id);
                      setState(() => _link = r.link);
                      return r;
                    }, confirm: (t.inviteSeller, t.dealTermsAccept))),
              if (a.contains('REFRESH_INVITATION'))
                btn('refresh', t.newInviteLink, () => _act('refresh', (_) async {
                      final r = await api.refreshDealInvitation(d.id);
                      setState(() => _link = r.link);
                      return r;
                    }), primary: false),
              if (a.contains('REVOKE_INVITATION')) btn('revoke', t.revokeInvite, () => _act('revoke', (k) => api.revokeDealInvitation(d.id, idempotencyKey: k)), primary: false),
              if (a.contains('RESPOND_TO_OFFER') && d.terms.currentVersion != null) ...[
                btn('accept', t.acceptOffer, () => _act('accept', (k) => api.respondDealOffer(d.id, d.terms.currentVersion!, 'ACCEPT', idempotencyKey: k), confirm: (t.acceptOffer, t.acceptOfferConfirm))),
                btn('change', t.requestChange, () async {
                  final msg = await _ask(context, t.requestChange, t.changeMessageHint);
                  if (msg == null) return;
                  await _act('change', (k) => api.respondDealOffer(d.id, d.terms.currentVersion!, 'REQUEST_CHANGE', change: {'message': msg, 'returnPolicy': {'type': 'NONE'}}, idempotencyKey: k));
                }, primary: false),
                btn('reject', t.rejectOffer, () => _act('reject', (k) => api.respondDealOffer(d.id, d.terms.currentVersion!, 'REJECT', idempotencyKey: k), confirm: (t.rejectOffer, t.rejectOfferConfirm)), danger: true),
              ],
              if (a.contains('START_PAYMENT'))
                btn('pay', t.payNow, () => _act('pay', (k) async {
                      final r = await api.startDealPayment(d.id, 'INSTAPAY', idempotencyKey: k);
                      if (context.mounted) context.push('/payments/${r.paymentId}');
                      return r;
                    })),
              if (d.payment != null && !a.contains('START_PAYMENT')) btn('payment', t.paymentTitle, () => context.push('/payments/${d.payment!.id}'), primary: false),
              if (a.contains('VIEW_DELIVERY_CODE')) btn('code', t.showDeliveryCode, () => showEdmnBottomSheet(context, title: t.deliveryCode, child: _DeliveryCode(dealId: d.id))),
              if (a.contains('CONFIRM_RECEIPT')) btn('confirm', t.confirmReceipt, () => _act('confirm', (k) => api.confirmDealReceipt(d.id, idempotencyKey: k), confirm: (t.confirmReceipt, t.dealConfirmReceiptConfirm))),
              if (a.contains('REPORT_NOT_RECEIVED'))
                btn('not-received', t.problemNotReceived, () async {
                  final msg = await _ask(context, t.problemNotReceived, t.problemDescriptionHint, min: 10);
                  if (msg != null) await _act('not-received', (k) => api.reportDealNotReceived(d.id, msg, idempotencyKey: k));
                }, danger: true),
              if (a.contains('OPEN_DISPUTE')) btn('dispute', t.openDispute, () => context.push('/disputes/new?deal=${d.id}'), danger: true),
              if (a.contains('CANCEL'))
                btn('cancel', t.cancelDeal, () async {
                  final msg = await _ask(context, t.cancelDeal, t.cancellationReasonHint, min: 5);
                  if (msg != null) await _act('cancel', (k) => api.cancelDeal(d.id, msg, idempotencyKey: k));
                }, danger: true),
              // Seller actions
              if (a.contains('SUBMIT_OFFER')) btn('offer', t.makeOffer, () => showEdmnBottomSheet(context, title: t.makeOffer, child: _OfferForm(deal: d))),
              if (a.contains('RESPOND_TO_CHANGE_REQUEST') && d.terms.currentVersion != null) ...[
                if (d.terms.latestMessage != null) EdmnNotice(title: t.dealChangeRequested, message: d.terms.latestMessage!, tone: EdmnTone.warning),
                const SizedBox(height: EdmnSpacing.xs),
                btn('accept-change', t.acceptChange, () => _act('accept-change', (k) => api.respondDealChange(d.id, d.terms.currentVersion!, 'ACCEPT', idempotencyKey: k))),
                btn('reject-change', t.rejectChange, () => _act('reject-change', (k) => api.respondDealChange(d.id, d.terms.currentVersion!, 'REJECT', idempotencyKey: k)), danger: true),
              ],
              if (a.contains('REJECT_INVITATION'))
                btn('decline', t.declineDeal, () async {
                  final msg = await _ask(context, t.declineDeal, t.cancellationReasonHint, min: 5);
                  if (msg == null) return;
                  await _act('decline', (k) => api.declineDeal(d.id, msg, idempotencyKey: k));
                  if (context.mounted) context.pop();
                }, danger: true),
              if (a.contains('MARK_SHIPPED')) btn('ship', t.markShippedDeal, () => showEdmnBottomSheet(context, title: t.markShippedDeal, child: _ShipForm(dealId: d.id))),
              if (a.contains('VERIFY_DELIVERY_CODE')) btn('verify', t.enterDeliveryCode, () => showEdmnBottomSheet(context, title: t.enterDeliveryCode, child: _VerifyCode(dealId: d.id))),
              if (a.contains('REGENERATE_DELIVERY_CODE')) btn('regen', t.newDeliveryCode, () => _act('regen', (k) => api.regenerateDealDeliveryCode(d.id, idempotencyKey: k)), primary: false),
              if (a.contains('MESSAGE')) btn('message', t.dealConversation, () => openConversation(context, ref, (api) => api.openDealConversation(d.id)), primary: false),
              btn('help', t.helpWithDeal, () => context.push('/support/new?type=EXTERNAL_DEAL&relatedType=DEAL&relatedId=${d.id}'), primary: false),
              const SizedBox(height: EdmnSpacing.sm),
              EdmnNotice(message: t.dealNoReleaseNote, icon: Icons.lock_outline_rounded),
            ]),
          );
        },
      ),
    );
  }
}

String _termsStatus(EdmnLocalizations t, String s) => switch (s) {
      'PROPOSED' => t.termsProposed,
      'ACCEPTED' => t.termsAccepted,
      'REJECTED' => t.termsRejected,
      'SUPERSEDED' => t.termsSuperseded,
      _ => s,
    };

Future<String?> _ask(BuildContext context, String title, String hint, {int min = 3}) {
  final t = EdmnLocalizations.of(context);
  final c = TextEditingController();
  return showEdmnBottomSheet<String>(
    context,
    title: title,
    child: EdmnTextField(key: const Key('ask-text'), controller: c, hint: hint, maxLines: 4),
    action: Builder(builder: (s) => EdmnPrimaryButton(key: const Key('ask-ok'), label: t.confirm, onPressed: () => c.text.trim().length >= min ? Navigator.pop(s, c.text.trim()) : null)),
  );
}

class _DeliveryCode extends ConsumerWidget {
  const _DeliveryCode({required this.dealId});
  final String dealId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final code = ref.watch(dealCodeProvider(dealId));
    return code.when(
      loading: () => const SizedBox(height: 120, child: EdmnLoadingState()),
      error: (e, _) => EdmnNotice(message: apiErrorMessage(context, e), tone: EdmnTone.danger),
      data: (c) => !c.available
          ? EdmnNotice(message: t.noActiveCode, tone: EdmnTone.warning)
          : Column(children: [
              Text(c.code!, key: const Key('delivery-code'), textDirection: TextDirection.ltr, style: EdmnType.balance.copyWith(color: EdmnColors.primaryDark, letterSpacing: 8)),
              const SizedBox(height: EdmnSpacing.xs),
              Text(t.codeExpires(formatDateTime(context, c.expiresAt), c.attemptsLeft ?? 0), textAlign: TextAlign.center, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
              const SizedBox(height: EdmnSpacing.sm),
              EdmnNotice(message: t.codeWarning, tone: EdmnTone.warning),
            ]),
    );
  }
}

class _VerifyCode extends ConsumerStatefulWidget {
  const _VerifyCode({required this.dealId});
  final String dealId;
  @override
  ConsumerState<_VerifyCode> createState() => _VerifyCodeState();
}

class _VerifyCodeState extends ConsumerState<_VerifyCode> {
  final _c = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      EdmnTextField(key: const Key('verify-code'), controller: _c, hint: t.codeHint, keyboardType: TextInputType.number, textDirection: TextDirection.ltr, maxLength: 8),
      const SizedBox(height: EdmnSpacing.md),
      EdmnPrimaryButton(
        key: const Key('verify-code-submit'),
        label: t.verify,
        loading: _busy,
        onPressed: () async {
          setState(() => _busy = true);
          final ok = await runAction(context, () => ref.read(mobileApiProvider).verifyDealDeliveryCode(widget.dealId, _c.text.trim()), success: t.verified);
          ref.invalidate(dealProvider(widget.dealId));
          if (mounted) setState(() => _busy = false);
          if (ok && context.mounted) Navigator.pop(context);
        },
      ),
    ]);
  }
}

class _ShipForm extends ConsumerStatefulWidget {
  const _ShipForm({required this.dealId});
  final String dealId;
  @override
  ConsumerState<_ShipForm> createState() => _ShipFormState();
}

class _ShipFormState extends ConsumerState<_ShipForm> {
  final _note = TextEditingController();
  final _intent = IntentKey();
  PickedFile? _proof;
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      EdmnTextField(key: const Key('ship-note'), controller: _note, hint: t.shipNoteHint, maxLines: 3),
      const SizedBox(height: EdmnSpacing.sm),
      EdmnUploadField(label: t.waybill, hint: t.waybillHint, fileName: _proof?.name, onPick: () async {
        final f = await ref.read(filePickerProvider).pick();
        if (f != null) setState(() => _proof = f);
      }, onClear: () => setState(() => _proof = null)),
      const SizedBox(height: EdmnSpacing.md),
      EdmnPrimaryButton(
        key: const Key('ship-submit'),
        label: t.markShippedDeal,
        loading: _busy,
        onPressed: () async {
          if (_note.text.trim().length < 3) return;
          setState(() => _busy = true);
          final ok = await runAction(
            context,
            () => ref.read(mobileApiProvider).markDealShipped(widget.dealId, _note.text.trim(), [if (_proof != null) (_proof!.bytes, _proof!.name)], idempotencyKey: _intent.value),
            success: t.saved,
          );
          ref.invalidate(dealProvider(widget.dealId));
          if (mounted) setState(() => _busy = false);
          if (ok && context.mounted) Navigator.pop(context);
        },
      ),
    ]);
  }
}

/// Seller offer: price, shipping fee, delivery time, defects, return policy; the first offer also carries the seller's
/// name, pickup location and payout account (verified by EDMN before any payout).
class _OfferForm extends ConsumerStatefulWidget {
  const _OfferForm({required this.deal});
  final ProtectedDeal deal;
  @override
  ConsumerState<_OfferForm> createState() => _OfferFormState();
}

class _OfferFormState extends ConsumerState<_OfferForm> {
  final _intent = IntentKey();
  late final _c = {
    for (final k in ['fullName', 'city', 'street', 'holderName', 'instapay', 'unitPrice', 'shippingFee', 'deliveryMethod', 'minDays', 'maxDays', 'defects', 'returnDays']) k: TextEditingController(),
  };
  int? _gov;
  bool _returns = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _c['shippingFee']!.text = '0';
    _c['minDays']!.text = '1';
    _c['maxDays']!.text = '3';
  }

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final first = widget.deal.status == 'SELLER_JOINED';
    final govs = ref.watch(governoratesProvider).value ?? const [];
    Widget f(String k, String hint, {TextInputType? type}) =>
        Padding(padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm), child: EdmnTextField(key: Key('offer-$k'), controller: _c[k], hint: hint, keyboardType: type));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (first) ...[
        f('fullName', t.fullNameHint),
        DropdownButtonFormField<int>(
          initialValue: _gov,
          isExpanded: true,
          decoration: InputDecoration(hintText: t.governorate),
          items: [for (final g in govs) DropdownMenuItem(value: g.id, child: Text(languageOf(context) == 'en' ? g.nameEn : g.nameAr))],
          onChanged: (v) => setState(() => _gov = v),
        ),
        const SizedBox(height: EdmnSpacing.sm),
        f('city', t.cityHint),
        f('street', t.streetHint),
        f('holderName', t.holderName),
        f('instapay', t.destInstapayAddress),
      ],
      f('unitPrice', t.dealUnitPriceHint, type: const TextInputType.numberWithOptions(decimal: true)),
      f('shippingFee', t.shippingFee, type: const TextInputType.numberWithOptions(decimal: true)),
      f('deliveryMethod', t.dealDeliveryHint),
      Row(children: [Expanded(child: f('minDays', t.etaMin, type: TextInputType.number)), const SizedBox(width: EdmnSpacing.xs), Expanded(child: f('maxDays', t.etaMax, type: TextInputType.number))]),
      f('defects', t.defects),
      SwitchListTile(contentPadding: EdgeInsets.zero, value: _returns, onChanged: (v) => setState(() => _returns = v), title: Text(t.acceptsReturns)),
      if (_returns) f('returnDays', t.returnDaysHint, type: TextInputType.number),
      EdmnNotice(message: t.dealTermsAccept),
      const SizedBox(height: EdmnSpacing.sm),
      EdmnPrimaryButton(
        key: const Key('offer-submit'),
        label: t.sendOffer,
        loading: _busy,
        onPressed: () async {
          final v = {for (final e in _c.entries) e.key: e.value.text.trim()};
          setState(() => _busy = true);
          final ok = await runAction(
            context,
            () => ref.read(mobileApiProvider).submitDealOffer(widget.deal.id, {
              if (first) 'details': {'fullName': v['fullName']},
              if (first) 'location': {'governorateId': _gov ?? 1, 'city': v['city'], 'street': v['street']},
              if (first) 'payout': {'type': 'INSTAPAY', 'holderName': v['holderName'], 'instapayAddress': v['instapay']},
              'offer': {
                if (v['unitPrice']!.isNotEmpty) 'unitPrice': v['unitPrice'],
                'shippingFee': v['shippingFee'],
                'deliveryMethod': v['deliveryMethod'],
                'processingDays': 1,
                'deliveryMinDays': int.tryParse(v['minDays']!) ?? 1,
                'deliveryMaxDays': int.tryParse(v['maxDays']!) ?? 3,
                'defects': v['defects'],
              },
              'returnPolicy': _returns ? {'type': 'VOLUNTARY', 'windowDays': int.tryParse(v['returnDays']!) ?? 7} : {'type': 'NONE'},
            }, idempotencyKey: _intent.value),
            success: t.offerSent,
          );
          ref.invalidate(dealProvider(widget.deal.id));
          if (mounted) setState(() => _busy = false);
          if (ok && context.mounted) Navigator.pop(context);
        },
      ),
    ]);
  }
}
