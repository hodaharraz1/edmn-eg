import 'dart:typed_data';

import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/file_pick.dart';
import '../../common/status.dart';
import '../../common/ui.dart';
import '../../providers.dart';
import '../messages/messages_screens.dart' show fileBytesProvider;

/// Returns, disputes and reviews (B36–B41, C17–C22, S-returns). Eligibility, windows, allowed steps, refund state and
/// the dispute decision all come from the server. A store "accept" or an EDMN decision only REQUESTS a refund; EDMN
/// finance approves and pays it — the app never moves money and never decides a dispute.
final returnOptionsProvider = FutureProvider.autoDispose.family<GetReturnOptionsResponse, String>((ref, so) => ref.watch(mobileApiProvider).returnOptions(so));
final returnsProvider = FutureProvider.autoDispose.family<List<ReturnSummary>, bool>((ref, store) => ref.watch(mobileApiProvider).returns(store: store));
final returnProvider = FutureProvider.autoDispose.family<ReturnCase, ({String id, bool store})>((ref, a) => ref.watch(mobileApiProvider).returnCase(a.id, store: a.store));
final disputesProvider = FutureProvider.autoDispose.family<List<DisputeSummary>, bool>((ref, store) => ref.watch(mobileApiProvider).disputes(store: store));
final disputeProvider = FutureProvider.autoDispose.family<DisputeCase, ({String id, bool store})>((ref, a) => ref.watch(mobileApiProvider).dispute(a.id, store: a.store));
final reviewOptionsProvider = FutureProvider.autoDispose.family<ReviewOptions, String>((ref, so) => ref.watch(mobileApiProvider).reviewOptions(so));

(String, EdmnTone) returnStatus(EdmnLocalizations t, String s) => switch (s) {
      'REQUESTED' || 'UNDER_REVIEW' => (t.retRequested, EdmnTone.warning),
      'APPROVED' => (t.retApproved, EdmnTone.info),
      'RETURN_IN_TRANSIT' => (t.retInTransit, EdmnTone.info),
      'RECEIVED' || 'INSPECTION' => (t.retReceived, EdmnTone.info),
      'REFUND_PENDING' => (t.retRefundPending, EdmnTone.warning),
      'REFUNDED' => (t.retRefunded, EdmnTone.success),
      'REJECTED' => (t.retRejected, EdmnTone.danger),
      'DISPUTED' => (t.retDisputed, EdmnTone.warning),
      _ => (s, EdmnTone.neutral),
    };

(String, EdmnTone) disputeStatus(EdmnLocalizations t, String s) => switch (s) {
      'OPEN' => (t.dspOpen, EdmnTone.warning),
      'UNDER_REVIEW' => (t.dspUnderReview, EdmnTone.info),
      'AWAITING_INFORMATION' => (t.dspAwaitingInfo, EdmnTone.warning),
      'RESOLVED' => (t.dspResolved, EdmnTone.success),
      'CLOSED' => (t.dspClosed, EdmnTone.neutral),
      _ => (s, EdmnTone.neutral),
    };

String returnReason(EdmnLocalizations t, String r) => switch (r) {
      'CHANGED_MIND' => t.rrChangedMind,
      'WRONG_ITEM' => t.rrWrongItem,
      'DAMAGED' => t.rrDamaged,
      'DEFECTIVE' => t.rrDefective,
      'MISSING_PARTS' => t.rrMissingParts,
      'NOT_AS_DESCRIBED' => t.rrNotAsDescribed,
      'COUNTERFEIT_SUSPECTED' || 'COUNTERFEIT' => t.rrCounterfeit,
      'NOT_RECEIVED' || 'ITEM_NOT_RECEIVED' || 'DEAL_NOT_RECEIVED' => t.drNotReceived,
      'PRODUCT_PROBLEM' || 'ITEM_PROBLEM' => t.rrNotAsDescribed,
      'SELLER_UNRESPONSIVE' => t.drSellerUnresponsive,
      'OTHER' => t.rrOther,
      // Unknown server codes are never shown raw.
      _ => r.startsWith('RETURN_') ? returnReason(t, r.substring(7)) : t.rrOther,
    };

String decisionLabel(EdmnLocalizations t, String d) => switch (d) {
      'FULL_REFUND' => t.decFullRefund,
      'PARTIAL_REFUND' => t.decPartialRefund,
      'RETURN_REQUIRED' => t.decReturnRequired,
      'REPLACEMENT' => t.decReplacement,
      'RELEASE_TO_SELLER' => t.decReleaseToSeller,
      'REJECT_CLAIM' => t.decRejectClaim,
      _ => d,
    };

const _disputeReasons = ['NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'COUNTERFEIT', 'SELLER_UNRESPONSIVE', 'OTHER'];

Widget _sectionTitle(String s) => Padding(
      padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.md, bottom: EdmnSpacing.xs),
      child: Text(s, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
    );

/// Evidence picker (images / PDF), up to [max] files.
class _Evidence extends ConsumerWidget {
  const _Evidence({required this.files, required this.max, required this.onChanged});
  final List<PickedFile> files;
  final int max;
  final void Function(List<PickedFile>) onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(spacing: EdmnSpacing.xs, runSpacing: EdmnSpacing.xs, children: [
        for (final f in files) InputChip(label: Text(f.name, overflow: TextOverflow.ellipsis), onDeleted: () => onChanged([...files]..remove(f))),
      ]),
      if (files.length < max)
        EdmnUploadField(
          key: const Key('add-evidence'),
          label: t.evidenceLabel(max),
          hint: t.attachmentHint,
          onPick: () async {
            final f = await ref.read(filePickerProvider).pick();
            if (f != null) onChanged([...files, f]);
          },
        ),
    ]);
  }
}

/// Private evidence thumbnails (downloaded with the session; only parties can read them).
class _EvidenceGrid extends ConsumerWidget {
  const _EvidenceGrid({required this.fileIds});
  final List<String> fileIds;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Wrap(spacing: EdmnSpacing.xs, runSpacing: EdmnSpacing.xs, children: [
        for (final id in fileIds)
          Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(border: Border.all(color: EdmnColors.border), borderRadius: BorderRadius.circular(EdmnRadii.small)),
            child: SizedBox(
              width: 88,
              height: 88,
              child: ref.watch(fileBytesProvider(id)).when(
                    loading: () => const ColoredBox(color: EdmnColors.subtle),
                    error: (_, _) => const ColoredBox(color: EdmnColors.subtle, child: Icon(Icons.description_outlined)),
                    // Named for screen readers (it was an unnamed tappable area): «image attachment», opens the viewer.
                    data: (b) => Semantics(
                      button: true,
                      label: EdmnLocalizations.of(context).imageAttachment,
                      excludeSemantics: true,
                      child: GestureDetector(
                        onTap: () => showDialog<void>(context: context, builder: (_) => Dialog(child: InteractiveViewer(child: Image.memory(b)))),
                        child: Image.memory(b, fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: EdmnColors.subtle, child: Icon(Icons.picture_as_pdf_outlined, color: EdmnColors.error))),
                      ),
                    ),
                  ),
            ),
          ),
      ]);
}

/* ───────────────────────── B36/B37 return request ───────────────────────── */

class NewReturnScreen extends ConsumerStatefulWidget {
  const NewReturnScreen({super.key, required this.sellerOrderId});
  final String sellerOrderId;
  @override
  ConsumerState<NewReturnScreen> createState() => _NewReturnScreenState();
}

class _NewReturnScreenState extends ConsumerState<NewReturnScreen> {
  final _intent = IntentKey();
  final _desc = TextEditingController();
  final _qty = <String, int>{};
  String? _reason;
  List<PickedFile> _files = [];
  bool _busy = false;

  @override
  void dispose() {
    _desc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final opt = ref.watch(returnOptionsProvider(widget.sellerOrderId));
    return EdmnAppScaffold(
      title: t.requestReturn,
      body: AsyncView(
        value: opt,
        onRetry: () => ref.invalidate(returnOptionsProvider(widget.sellerOrderId)),
        data: (o) {
          final w = o.window;
          final reason = o.reasons.where((r) => r.code == _reason).firstOrNull;
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            // Policy window from the server (statutory / voluntary / protected-reason deadline).
            EdmnCard(
              key: const Key('return-window'),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(t.returnWindowTitle, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                const SizedBox(height: EdmnSpacing.xxs),
                Text(t.returnWindowBody(w.effectiveDays, w.statutoryDays), style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                if (w.deadline != null) Text(t.changeOfMindUntil(formatDateTime(context, w.deadline, time: false)), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                if (w.protectedDeadline != null) Text(t.protectedUntil(formatDateTime(context, w.protectedDeadline, time: false)), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
              ]),
            ),
            if (!o.eligible) ...[
              const SizedBox(height: EdmnSpacing.md),
              EdmnNotice(
                key: const Key('return-blocked'),
                tone: EdmnTone.warning,
                message: switch (o.blockReason) { 'NOT_DELIVERED' => t.returnNotDelivered, 'WINDOW_CLOSED' => t.returnWindowClosed, _ => t.returnNothingLeft },
              ),
              const SizedBox(height: EdmnSpacing.sm),
              EdmnSecondaryButton(label: t.openDispute, onPressed: () => context.pushReplacement('/disputes/new?so=${widget.sellerOrderId}')),
            ] else ...[
              _sectionTitle(t.whichItems),
              for (final it in o.items.where((i) => i.returnableQuantity > 0))
                EdmnCard(
                  key: Key('ret-item-${it.orderItemId}'),
                  margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(it.title, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                        Text(t.returnableOf(it.returnableQuantity, it.quantity), style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
                        EgpText(it.unitPricePiastres, style: EdmnType.secondary),
                      ]),
                    ),
                    EdmnQuantityStepper(
                      key: Key('ret-qty-${it.orderItemId}'),
                      value: _qty[it.orderItemId] ?? 0,
                      min: 0,
                      max: it.returnableQuantity,
                      onChanged: (v) => setState(() => _qty[it.orderItemId] = v),
                    ),
                  ]),
                ),
              _sectionTitle(t.returnReason),
              EdmnRadioCard<String>(
                key: const Key('ret-reasons'),
                value: _reason ?? '',
                onChanged: (v) => setState(() => _reason = v),
                options: [
                  for (final r in o.reasons)
                    EdmnRadioOption(
                      value: r.code,
                      label: returnReason(t, r.code),
                      icon: r.protected ? Icons.report_problem_outlined : Icons.undo_rounded,
                      enabled: r.available,
                      subtitle: !r.available ? t.reasonWindowClosed : (r.requiresEvidence ? t.photosRequired : null),
                    ),
                ],
              ),
              const SizedBox(height: EdmnSpacing.sm),
              EdmnTextField(key: const Key('ret-desc'), controller: _desc, hint: t.returnDescriptionHint, maxLines: 4, maxLength: 2000),
              const SizedBox(height: EdmnSpacing.sm),
              _Evidence(files: _files, max: 6, onChanged: (f) => setState(() => _files = f)),
              const SizedBox(height: EdmnSpacing.sm),
              EdmnNotice(message: t.returnRefundNote),
              const SizedBox(height: EdmnSpacing.md),
              EdmnPrimaryButton(
                key: const Key('ret-submit'),
                label: t.sendReturnRequest,
                loading: _busy,
                onPressed: () async {
                  final items = [for (final e in _qty.entries) if (e.value > 0) <String, Object>{'orderItemId': e.key, 'quantity': e.value}];
                  if (items.isEmpty) return showEdmnMessage(context, t.chooseItemToReturn, error: true);
                  if (_reason == null) return showEdmnMessage(context, t.chooseReason, error: true);
                  if ((reason?.requiresEvidence ?? false) && _files.isEmpty) return showEdmnMessage(context, t.photosRequired, error: true);
                  if (_desc.text.trim().length < 10) return showEdmnMessage(context, t.describeMore, error: true);
                  setState(() => _busy = true);
                  ReturnCase? created;
                  final ok = await runAction(context, () async {
                    created = await ref.read(mobileApiProvider).createReturn(
                          sellerOrderId: widget.sellerOrderId,
                          reason: _reason!,
                          description: _desc.text.trim(),
                          items: items,
                          evidence: [for (final f in _files) (f.bytes, f.name)],
                          idempotencyKey: _intent.value,
                        );
                  }, success: t.returnRequestSent);
                  if (mounted) setState(() => _busy = false);
                  if (ok && created != null && context.mounted) {
                    ref.invalidate(returnsProvider);
                    context.pushReplacement('/returns/${created!.id}');
                  }
                },
              ),
            ],
          ]);
        },
      ),
    );
  }
}

/* ───────────────────────── B38–B40 / S returns: list + detail ───────────────────────── */

class ReturnsScreen extends ConsumerWidget {
  const ReturnsScreen({super.key, this.store = false});
  final bool store;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final list = ref.watch(returnsProvider(store));
    return EdmnAppScaffold(
      title: store ? t.storeReturnRequests : t.myReturns,
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(returnsProvider(store).future),
        child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          list.when(
            loading: () => const EdmnSkeletonList(),
            error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(returnsProvider(store))),
            data: (items) => items.isEmpty
                ? EdmnEmptyState(icon: Icons.assignment_return_outlined, title: t.noReturns)
                : Column(children: [
                    for (final r in items)
                      () {
                        final (l, tone) = returnStatus(t, r.status);
                        return EdmnCard(
                          key: Key('ret-${r.id}'),
                          margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                          onTap: () => context.push(store ? '/seller/returns/${r.id}' : '/returns/${r.id}'),
                          child: Row(children: [
                            const Icon(Icons.assignment_return_outlined, color: EdmnColors.primary),
                            const SizedBox(width: EdmnSpacing.sm),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text('${t.returnLabel} \u2066#${r.number}\u2069', style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                                Text('${returnReason(t, r.reason)} · ${formatDateTime(context, r.createdAt, time: false)}', style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
                              ]),
                            ),
                            EdmnStatusChip(label: l, tone: tone),
                          ]),
                        );
                      }(),
                  ]),
          ),
        ]),
      ),
    );
  }
}

class ReturnScreen extends ConsumerStatefulWidget {
  const ReturnScreen({super.key, required this.id, this.store = false});
  final String id;
  final bool store;
  @override
  ConsumerState<ReturnScreen> createState() => _ReturnScreenState();
}

class _ReturnScreenState extends ConsumerState<ReturnScreen> {
  final _intent = IntentKey();
  String? _busy;

  ({String id, bool store}) get _args => (id: widget.id, store: widget.store);

  Future<void> _run(String key, Future<Object?> Function(String idem) action, {String? success}) async {
    setState(() => _busy = key);
    final ok = await runAction(context, () async => action(_intent.value), success: success);
    if (ok) _intent.reset();
    ref.invalidate(returnProvider(_args));
    ref.invalidate(returnsProvider);
    if (mounted) setState(() => _busy = null);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final ret = ref.watch(returnProvider(_args));
    final api = ref.read(mobileApiProvider);
    return EdmnAppScaffold(
      title: t.returnLabel,
      body: AsyncView(
        value: ret,
        onRetry: () => ref.invalidate(returnProvider(_args)),
        data: (r) {
          final a = r.allowedActions.toSet();
          final (l, tone) = returnStatus(t, r.status);
          const flow = ['REQUESTED', 'APPROVED', 'RETURN_IN_TRANSIT', 'RECEIVED', 'REFUND_PENDING', 'REFUNDED'];
          final rank = switch (r.status) { 'UNDER_REVIEW' => 0, 'INSPECTION' => 3, _ => flow.indexOf(r.status) };
          EdmnStepState st(int i) => r.status == 'REJECTED' || r.status == 'DISPUTED' ? (i == 0 ? EdmnStepState.done : EdmnStepState.pending) : (rank > i ? EdmnStepState.done : (rank == i ? EdmnStepState.current : EdmnStepState.pending));
          Widget btn(String k, String label, VoidCallback onTap, {bool danger = false, bool primary = true}) => Padding(
                padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                child: primary && !danger
                    ? EdmnPrimaryButton(key: Key('ret-$k'), label: label, loading: _busy == k, onPressed: _busy == null ? onTap : null)
                    : EdmnSecondaryButton(key: Key('ret-$k'), label: label, destructive: danger, loading: _busy == k, onPressed: _busy == null ? onTap : null),
              );
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${t.returnLabel} \u2066#${r.number}\u2069', style: EdmnType.section.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800)),
                  Text('${t.orderRefLabel} \u2066#${r.orderLabel}\u2069${r.storeName != null ? ' · ${r.storeName}' : ''}', style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                ]),
              ),
              EdmnStatusChip(label: l, tone: tone),
            ]),
            const SizedBox(height: EdmnSpacing.md),
            EdmnCard(
              child: EdmnTrackingTimeline(steps: [
                EdmnTimelineStep(title: t.retRequested, state: st(0), time: formatDateTime(context, r.createdAt)),
                EdmnTimelineStep(title: t.retApproved, state: st(1)),
                EdmnTimelineStep(title: t.retInTransit, state: st(2)),
                EdmnTimelineStep(title: t.retReceived, state: st(3)),
                EdmnTimelineStep(title: t.retRefundPending, state: st(4)),
                EdmnTimelineStep(title: t.retRefunded, state: st(5)),
              ]),
            ),
            if (r.decisionReason != null) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(title: t.storeDecision, message: r.decisionReason!, tone: r.status == 'REJECTED' ? EdmnTone.danger : EdmnTone.info)],
            _sectionTitle(t.returnedItems),
            EdmnCard(
              child: Column(children: [
                for (final it in r.items)
                  Row(children: [
                    Expanded(child: Text('${it.quantity} × ${it.title}', style: EdmnType.body.copyWith(color: EdmnColors.textPrimary))),
                    EgpText(it.unitPricePiastres * it.quantity, style: EdmnType.bodyStrong),
                  ]),
                const Divider(),
                Align(alignment: AlignmentDirectional.centerStart, child: Text('${returnReason(t, r.reason)} — ${r.description}', style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary))),
              ]),
            ),
            if (r.evidence.isNotEmpty) ...[_sectionTitle(t.evidenceTitle), _EvidenceGrid(fileIds: [for (final e in r.evidence) e.fileId])],
            if (r.shipBackTo != null) ...[
              _sectionTitle(t.shipBackTitle),
              EdmnCard(
                key: const Key('ship-back-to'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(r.shipBackTo!.address, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                  const SizedBox(height: EdmnSpacing.xxs),
                  Text(switch (r.shipBackTo!.shippingPayer) { 'SELLER' => t.returnShipSellerPays, 'BUYER' => t.returnShipBuyerPays, _ => t.returnShipByReason }, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                ]),
              ),
            ],
            if (r.returnCarrier != null) ...[const SizedBox(height: EdmnSpacing.xs), Text(t.shippedBackWith(r.returnCarrier!, r.returnTracking ?? '—'), style: EdmnType.secondary)],
            if (r.refunds.isNotEmpty) ...[
              _sectionTitle(t.refundStatus),
              for (final x in r.refunds)
                () {
                  final (rl, rt) = refundStatus(t, x.status);
                  return EdmnCard(
                    key: Key('ret-refund-${x.id}'),
                    margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                    child: Row(children: [
                      Expanded(child: EgpText(x.amountPiastres, style: EdmnType.price)),
                      if (x.reference != null) Padding(padding: const EdgeInsetsDirectional.only(end: EdmnSpacing.xs), child: Text(x.reference!, textDirection: TextDirection.ltr, style: EdmnType.caption)),
                      EdmnStatusChip(label: rl, tone: rt),
                    ]),
                  );
                }(),
              EdmnNotice(message: t.refundByEdmnNote, icon: Icons.lock_outline_rounded),
            ],
            if (r.disputeId != null) ...[const SizedBox(height: EdmnSpacing.sm), btn('dispute', t.viewDispute, () => context.push(widget.store ? '/seller/disputes/${r.disputeId}' : '/disputes/${r.disputeId}'), primary: false)],
            const SizedBox(height: EdmnSpacing.md),
            // Buyer steps
            if (a.contains('SHIP_BACK'))
              btn('ship', t.iShippedItBack, () async {
                final v = await _twoFields(context, t.iShippedItBack, t.carrierHint, t.trackingHint);
                if (v != null) await _run('ship', (k) => api.shipBackReturn(r.id, v.$1, v.$2, idempotencyKey: k));
              }),
            // Store steps
            if (a.contains('APPROVE')) btn('approve', t.approveReturn, () => _run('approve', (k) => api.storeReturnStep(r.id, 'APPROVE', idempotencyKey: k), success: t.saved)),
            if (a.contains('REJECT'))
              btn('reject', t.rejectReturn, () async {
                final why = await _askText(context, t.rejectReturn, t.rejectReasonHint);
                if (why != null) await _run('reject', (k) => api.storeReturnStep(r.id, 'REJECT', reason: why, idempotencyKey: k));
              }, danger: true),
            if (a.contains('MARK_RECEIVED')) btn('received', t.markReturnReceived, () => _run('received', (k) => api.storeReturnStep(r.id, 'MARK_RECEIVED', idempotencyKey: k))),
            if (a.contains('START_INSPECTION')) btn('inspect', t.startInspection, () => _run('inspect', (k) => api.storeReturnStep(r.id, 'START_INSPECTION', idempotencyKey: k)), primary: false),
            if (a.contains('ACCEPT'))
              btn('accept', t.acceptReturnRefund, () async {
                final opts = await showEdmnBottomSheet<(bool, bool)>(context, title: t.acceptReturnRefund, child: const _AcceptForm());
                if (opts != null) await _run('accept', (k) => api.storeReturnStep(r.id, 'ACCEPT', includeShipping: opts.$1, restock: opts.$2, idempotencyKey: k), success: t.refundRequested);
              }),
            if (a.contains('ESCALATE'))
              btn('escalate', t.escalateToEdmn, () async {
                final why = await _askText(context, t.escalateToEdmn, t.escalateHint, min: 10);
                if (why == null || !context.mounted) return;
                setState(() => _busy = 'escalate');
                String? disputeId;
                final ok = await runAction(context, () async => disputeId = await api.escalateReturn(r.id, why, store: widget.store, idempotencyKey: _intent.value));
                if (ok) _intent.reset();
                if (mounted) setState(() => _busy = null);
                ref.invalidate(returnProvider(_args));
                if (ok && disputeId != null && context.mounted) context.push(widget.store ? '/seller/disputes/$disputeId' : '/disputes/$disputeId');
              }, danger: true),
          ]);
        },
      ),
    );
  }
}

class _AcceptForm extends StatefulWidget {
  const _AcceptForm();
  @override
  State<_AcceptForm> createState() => _AcceptFormState();
}

class _AcceptFormState extends State<_AcceptForm> {
  bool _shipping = false;
  bool _restock = true;
  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      EdmnNotice(message: t.acceptRefundNote),
      SwitchListTile(key: const Key('accept-shipping'), contentPadding: EdgeInsets.zero, value: _shipping, onChanged: (v) => setState(() => _shipping = v), title: Text(t.includeShippingRefund)),
      SwitchListTile(key: const Key('accept-restock'), contentPadding: EdgeInsets.zero, value: _restock, onChanged: (v) => setState(() => _restock = v), title: Text(t.restockItems)),
      const SizedBox(height: EdmnSpacing.sm),
      EdmnPrimaryButton(key: const Key('accept-confirm'), label: t.confirm, onPressed: () => Navigator.pop(context, (_shipping, _restock))),
    ]);
  }
}

Future<String?> _askText(BuildContext context, String title, String hint, {int min = 3}) {
  final t = EdmnLocalizations.of(context);
  final c = TextEditingController();
  return showEdmnBottomSheet<String>(
    context,
    title: title,
    child: EdmnTextField(key: const Key('ask-text'), controller: c, hint: hint, maxLines: 4),
    action: Builder(builder: (s) => EdmnPrimaryButton(key: const Key('ask-ok'), label: t.confirm, onPressed: () => c.text.trim().length >= min ? Navigator.pop(s, c.text.trim()) : null)),
  );
}

Future<(String, String)?> _twoFields(BuildContext context, String title, String hint1, String hint2) {
  final t = EdmnLocalizations.of(context);
  final a = TextEditingController();
  final b = TextEditingController();
  return showEdmnBottomSheet<(String, String)>(
    context,
    title: title,
    child: Column(children: [
      EdmnTextField(key: const Key('field-1'), controller: a, hint: hint1),
      const SizedBox(height: EdmnSpacing.sm),
      EdmnTextField(key: const Key('field-2'), controller: b, hint: hint2, textDirection: TextDirection.ltr),
    ]),
    action: Builder(builder: (s) => EdmnPrimaryButton(key: const Key('fields-ok'), label: t.confirm, onPressed: () => a.text.trim().length >= 2 ? Navigator.pop(s, (a.text.trim(), b.text.trim())) : null)),
  );
}

/* ───────────────────────── C18/C19 open dispute ───────────────────────── */

class NewDisputeScreen extends ConsumerStatefulWidget {
  const NewDisputeScreen({super.key, this.sellerOrderId, this.dealId});
  final String? sellerOrderId;
  final String? dealId;
  @override
  ConsumerState<NewDisputeScreen> createState() => _NewDisputeScreenState();
}

class _NewDisputeScreenState extends ConsumerState<NewDisputeScreen> {
  final _intent = IntentKey();
  final _desc = TextEditingController();
  final _amount = TextEditingController();
  String? _reason;
  List<PickedFile> _files = [];
  bool _busy = false;

  @override
  void dispose() {
    _desc.dispose();
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnAppScaffold(
      title: t.openDispute,
      bottomBar: EdmnPrimaryButton(
        key: const Key('dsp-submit'),
        label: t.openDispute,
        loading: _busy,
        onPressed: () async {
          if (_reason == null) return showEdmnMessage(context, t.chooseReason, error: true);
          if (_desc.text.trim().length < 20) return showEdmnMessage(context, t.describeMore20, error: true);
          final amount = _amount.text.trim().isEmpty ? null : parseEgpToPiastres(_amount.text);
          if (_amount.text.trim().isNotEmpty && (amount == null || amount <= 0)) return showEdmnMessage(context, t.amountInvalid, error: true);
          setState(() => _busy = true);
          DisputeCase? d;
          final ok = await runAction(context, () async {
            d = await ref.read(mobileApiProvider).openDispute(
                  sellerOrderId: widget.sellerOrderId,
                  dealId: widget.dealId,
                  reasonCode: _reason!,
                  description: _desc.text.trim(),
                  claimedAmountPiastres: amount,
                  evidence: [for (final f in _files) (f.bytes, f.name)],
                  idempotencyKey: _intent.value,
                );
          }, success: t.disputeOpened);
          if (mounted) setState(() => _busy = false);
          if (ok && d != null && context.mounted) {
            ref.invalidate(disputesProvider);
            context.pushReplacement('/disputes/${d!.id}');
          }
        },
      ),
      body: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
        EdmnNotice(key: const Key('dsp-frozen-note'), message: t.disputeFreezeNote, icon: Icons.lock_outline_rounded),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnNotice(message: t.disputeTryFirst, tone: EdmnTone.info),
        _sectionTitle(t.disputeReasonTitle),
        DropdownButtonFormField<String>(
          key: const Key('dsp-reason'),
          initialValue: _reason,
          isExpanded: true,
          decoration: InputDecoration(hintText: t.chooseReason),
          items: [for (final r in _disputeReasons) DropdownMenuItem(value: r, child: Text(returnReason(t, r)))],
          onChanged: (v) => setState(() => _reason = v),
        ),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnTextField(key: const Key('dsp-desc'), controller: _desc, hint: t.disputeDescriptionHint, maxLines: 5, maxLength: 4000),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnTextField(key: const Key('dsp-amount'), controller: _amount, hint: t.disputeClaimHint, keyboardType: const TextInputType.numberWithOptions(decimal: true), textDirection: TextDirection.ltr),
        const SizedBox(height: EdmnSpacing.sm),
        _Evidence(files: _files, max: 8, onChanged: (f) => setState(() => _files = f)),
      ]),
    );
  }
}

/* ───────────────────────── C17, C20–C22 disputes ───────────────────────── */

class DisputesScreen extends ConsumerWidget {
  const DisputesScreen({super.key, this.store = false});
  final bool store;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final list = ref.watch(disputesProvider(store));
    return EdmnAppScaffold(
      title: store ? t.storeDisputes : t.myDisputes,
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(disputesProvider(store).future),
        child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          list.when(
            loading: () => const EdmnSkeletonList(),
            error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(disputesProvider(store))),
            data: (items) => items.isEmpty
                ? EdmnEmptyState(icon: Icons.gavel_outlined, title: t.noDisputes)
                : Column(children: [
                    for (final d in items)
                      () {
                        final (l, tone) = disputeStatus(t, d.status);
                        return EdmnCard(
                          key: Key('dsp-${d.id}'),
                          margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                          onTap: () => context.push(store ? '/seller/disputes/${d.id}' : '/disputes/${d.id}'),
                          child: Row(children: [
                            Icon(d.kind == 'DEAL' ? Icons.verified_user_outlined : Icons.gavel_outlined, color: EdmnColors.primary),
                            const SizedBox(width: EdmnSpacing.sm),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text('${t.disputeLabel} \u2066#${d.number}\u2069', style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                                Text('${returnReason(t, d.reasonCode)} · ${d.role == 'CLAIMANT' ? t.youOpenedIt : t.againstYou}', style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
                                if (d.decision != null) Text(decisionLabel(t, d.decision!), style: EdmnType.caption.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w700)),
                              ]),
                            ),
                            EdmnStatusChip(label: l, tone: tone),
                          ]),
                        );
                      }(),
                  ]),
          ),
        ]),
      ),
    );
  }
}

class DisputeScreen extends ConsumerStatefulWidget {
  const DisputeScreen({super.key, required this.id, this.store = false});
  final String id;
  final bool store;
  @override
  ConsumerState<DisputeScreen> createState() => _DisputeScreenState();
}

class _DisputeScreenState extends ConsumerState<DisputeScreen> {
  final _intent = IntentKey();
  final _reply = TextEditingController();
  PickedFile? _file;
  bool _busy = false;

  ({String id, bool store}) get _args => (id: widget.id, store: widget.store);

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final dsp = ref.watch(disputeProvider(_args));
    return EdmnAppScaffold(
      title: t.disputeLabel,
      body: AsyncView(
        value: dsp,
        onRetry: () => ref.invalidate(disputeProvider(_args)),
        data: (d) {
          final (l, tone) = disputeStatus(t, d.status);
          final rank = switch (d.status) { 'OPEN' => 0, 'UNDER_REVIEW' || 'AWAITING_INFORMATION' => 1, _ => 3 };
          EdmnStepState st(int i) => rank > i ? EdmnStepState.done : (rank == i ? EdmnStepState.current : EdmnStepState.pending);
          final ctxPath = d.context.kind == 'DEAL' ? '/deals/${d.context.id}' : (widget.store ? '/seller/orders/${d.context.id}' : '/orders/${d.context.orderId}');
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${t.disputeLabel} \u2066#${d.number}\u2069', style: EdmnType.section.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800)),
                  Text('${d.context.kind == 'DEAL' ? t.protectedDeal : t.orderRefLabel} \u2066${d.context.ref}\u2069 · ${d.role == 'CLAIMANT' ? t.youOpenedIt : t.againstYou}', style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                ]),
              ),
              EdmnStatusChip(label: l, tone: tone),
            ]),
            if (d.fundsFrozen) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(key: const Key('dsp-frozen'), message: t.disputeFundsFrozen, tone: EdmnTone.warning, icon: Icons.lock_outline_rounded)],
            const SizedBox(height: EdmnSpacing.md),
            EdmnCard(
              child: EdmnTrackingTimeline(steps: [
                EdmnTimelineStep(title: t.dspOpen, state: st(0), time: formatDateTime(context, d.createdAt)),
                EdmnTimelineStep(title: t.dspUnderReview, state: st(1)),
                EdmnTimelineStep(title: t.dspResolved, state: st(2), time: formatDateTime(context, d.decision?.decidedAt)),
              ]),
            ),
            // C22 — EDMN's decision (made in the admin console) and the refunds it requested.
            if (d.decision != null) ...[
              _sectionTitle(t.edmnDecision),
              EdmnCard(
                key: const Key('dsp-decision'),
                color: EdmnColors.primaryLight,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(decisionLabel(t, d.decision!.code), style: EdmnType.bodyStrong.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                  if (d.decision!.amountPiastres != null) EgpText(d.decision!.amountPiastres, style: EdmnType.price),
                  if (d.decision!.note != null) Text(d.decision!.note!, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                ]),
              ),
            ],
            if (d.refunds.isNotEmpty) ...[
              _sectionTitle(t.refundStatus),
              for (final x in d.refunds)
                () {
                  final (rl, rt) = refundStatus(t, x.status);
                  return EdmnCard(margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs), child: Row(children: [Expanded(child: EgpText(x.amountPiastres, style: EdmnType.price)), EdmnStatusChip(label: rl, tone: rt)]));
                }(),
              EdmnNotice(message: t.refundByEdmnNote, icon: Icons.lock_outline_rounded),
            ],
            _sectionTitle(t.theClaim),
            EdmnCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(returnReason(t, d.reasonCode), style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                Text(d.description, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                if (d.claimedAmountPiastres != null) Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [Text('${t.claimedAmount}: ', style: EdmnType.secondary), EgpText(d.claimedAmountPiastres, style: EdmnType.bodyStrong)]),
              ]),
            ),
            if (d.evidence.isNotEmpty) ...[_sectionTitle(t.evidenceTitle), _EvidenceGrid(fileIds: [for (final e in d.evidence) e.fileId])],
            _sectionTitle(t.disputeConversation),
            if (d.messages.isEmpty) Text(t.noMessagesYet, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
            for (final m in d.messages)
              Align(
                alignment: m.mine ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
                child: Container(
                  key: Key('dmsg-${m.id}'),
                  constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
                  margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                  padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
                  decoration: BoxDecoration(
                    color: m.from == 'EDMN' ? EdmnColors.primaryLight : EdmnColors.surface,
                    border: Border.all(color: EdmnColors.border),
                    borderRadius: BorderRadius.circular(EdmnRadii.card),
                  ),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(m.mine ? t.you : switch (m.from) { 'EDMN' => t.edmnTeam, 'CLAIMANT' => t.buyerParty, _ => t.sellerParty }, style: EdmnType.caption.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                    Text(m.body, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                    Text(formatDateTime(context, m.createdAt), style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
                  ]),
                ),
              ),
            if (d.allowedActions.contains('REPLY')) ...[
              const SizedBox(height: EdmnSpacing.sm),
              EdmnTextField(key: const Key('dsp-reply'), controller: _reply, hint: t.writeReply, maxLines: 4, maxLength: 4000),
              const SizedBox(height: EdmnSpacing.xs),
              EdmnUploadField(label: t.addEvidenceFile, hint: t.attachmentHint, fileName: _file?.name, onPick: () async {
                final f = await ref.read(filePickerProvider).pick();
                if (f != null) setState(() => _file = f);
              }, onClear: () => setState(() => _file = null)),
              const SizedBox(height: EdmnSpacing.xs),
              EdmnPrimaryButton(
                key: const Key('dsp-send'),
                label: t.send,
                loading: _busy,
                onPressed: () async {
                  if (_reply.text.trim().length < 2) return;
                  setState(() => _busy = true);
                  final ok = await runAction(context, () => ref.read(mobileApiProvider).replyDispute(d.id, _reply.text.trim(), attachment: _file == null ? null : (_file!.bytes, _file!.name), store: widget.store, idempotencyKey: _intent.value));
                  if (ok) {
                    _intent.reset();
                    _reply.clear();
                    _file = null;
                  }
                  ref.invalidate(disputeProvider(_args));
                  if (mounted) setState(() => _busy = false);
                },
              ),
            ],
            const SizedBox(height: EdmnSpacing.md),
            EdmnSecondaryButton(key: const Key('dsp-context'), label: d.context.kind == 'DEAL' ? t.protectedDeal : t.orderDetails, onPressed: () => context.push(ctxPath)),
            const SizedBox(height: EdmnSpacing.xs),
            // Linked to the existing support desk (ticket about the same order / deal).
            EdmnSecondaryButton(
              key: const Key('dsp-support'),
              label: t.contactSupportAboutDispute,
              icon: Icons.support_agent_rounded,
              onPressed: () => context.push('/support/new?type=DISPUTE&relatedType=${d.context.kind == 'DEAL' ? 'DEAL' : 'SELLER_ORDER'}&relatedId=${d.context.id}'),
            ),
          ]);
        },
      ),
    );
  }
}

/* ───────────────────────── B41 reviews ───────────────────────── */

class WriteReviewScreen extends ConsumerWidget {
  const WriteReviewScreen({super.key, required this.sellerOrderId});
  final String sellerOrderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final opt = ref.watch(reviewOptionsProvider(sellerOrderId));
    return EdmnAppScaffold(
      title: t.writeReview,
      body: AsyncView(
        value: opt,
        onRetry: () => ref.invalidate(reviewOptionsProvider(sellerOrderId)),
        data: (o) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          if (!o.eligible) EdmnNotice(key: const Key('review-not-eligible'), message: t.reviewAfterDelivery, tone: EdmnTone.warning),
          if (o.eligible) ...[
            EdmnNotice(message: t.reviewVerifiedNote),
            _sectionTitle(t.rateProducts),
            for (final it in o.items)
              Padding(
                padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
                child: it.reviewed
                    ? EdmnCard(key: Key('reviewed-${it.orderItemId}'), child: Row(children: [Expanded(child: Text(it.title, style: EdmnType.bodyStrong)), EdmnStatusChip(label: t.reviewed, tone: EdmnTone.success)]))
                    : _ReviewForm(key: Key('rev-form-${it.orderItemId}'), title: it.title, onSubmit: (rating, title, body, photos, key) => ref.read(mobileApiProvider).reviewProduct(it.orderItemId, rating, title: title, body: body, photos: photos, idempotencyKey: key), onDone: () => ref.invalidate(reviewOptionsProvider(sellerOrderId)), withPhotos: true),
              ),
            _sectionTitle(t.rateStore(o.storeName ?? '')),
            o.sellerReviewed
                ? EdmnCard(key: const Key('seller-reviewed'), child: Row(children: [Expanded(child: Text(o.storeName ?? '', style: EdmnType.bodyStrong)), EdmnStatusChip(label: t.reviewed, tone: EdmnTone.success)]))
                : _ReviewForm(key: const Key('rev-form-seller'), title: o.storeName ?? '', onSubmit: (rating, _, body, _, key) => ref.read(mobileApiProvider).reviewSeller(sellerOrderId, rating, body: body, idempotencyKey: key), onDone: () => ref.invalidate(reviewOptionsProvider(sellerOrderId))),
          ],
        ]),
      ),
    );
  }
}

class _ReviewForm extends ConsumerStatefulWidget {
  const _ReviewForm({super.key, required this.title, required this.onSubmit, required this.onDone, this.withPhotos = false});
  final String title;
  final Future<Object?> Function(int rating, String title, String body, List<(Uint8List, String)> photos, String key) onSubmit;
  final VoidCallback onDone;
  final bool withPhotos;
  @override
  ConsumerState<_ReviewForm> createState() => _ReviewFormState();
}

class _ReviewFormState extends ConsumerState<_ReviewForm> {
  final _intent = IntentKey();
  final _title = TextEditingController();
  final _body = TextEditingController();
  int _stars = 0;
  List<PickedFile> _photos = [];
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(widget.title, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          for (var i = 1; i <= 5; i++)
            IconButton(
              key: Key('${widget.key is ValueKey ? (widget.key as ValueKey).value : ''}-star-$i'),
              tooltip: t.starRatingLabel(i),
              icon: Icon(i <= _stars ? Icons.star_rounded : Icons.star_outline_rounded, color: EdmnColors.warning, size: 34, semanticLabel: t.starRatingLabel(i)),
              onPressed: () => setState(() => _stars = i),
            ),
        ]),
        if (widget.withPhotos) ...[EdmnTextField(controller: _title, hint: t.reviewTitleHint, maxLength: 120), const SizedBox(height: EdmnSpacing.xs)],
        EdmnTextField(controller: _body, hint: t.reviewBodyHint, maxLines: 3, maxLength: 3000),
        if (widget.withPhotos) ...[const SizedBox(height: EdmnSpacing.xs), _Evidence(files: _photos, max: 4, onChanged: (f) => setState(() => _photos = f))],
        const SizedBox(height: EdmnSpacing.sm),
        EdmnPrimaryButton(
          key: Key('${widget.key is ValueKey ? (widget.key as ValueKey).value : ''}-submit'),
          label: t.publishReview,
          loading: _busy,
          onPressed: _stars == 0
              ? null
              : () async {
                  setState(() => _busy = true);
                  final ok = await runAction(context, () => widget.onSubmit(_stars, _title.text.trim(), _body.text.trim(), [for (final p in _photos) (p.bytes, p.name)], _intent.value), success: t.reviewPublished);
                  if (mounted) setState(() => _busy = false);
                  if (ok) widget.onDone();
                },
        ),
      ]),
    );
  }
}

/// Test-visible wrapper around the private [_ReviewForm] so widget tests can pump the star row
/// without standing up the provider tree the surrounding screens need. Production routes use
/// [_ReviewForm] directly; nothing in the app imports this.
@visibleForTesting
Widget buildReviewFormForTest(BuildContext context, WidgetRef ref, {Key? key}) {
  return _ReviewForm(key: key, title: 'عنصر', onSubmit: (rating, title, body, photos, k) async => null, onDone: () {});
}
