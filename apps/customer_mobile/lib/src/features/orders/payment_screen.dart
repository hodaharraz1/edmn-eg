import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../common/file_pick.dart';
import '../../common/status.dart';
import '../../common/ui.dart';
import '../../providers.dart';
import 'order_providers.dart';

/// Manual payment: where to transfer (the order's snapshot), how much, until when, previous receipts and the upload
/// form. Uploading a receipt NEVER marks the payment paid: it is queued for EDMN staff review (shown as such).
class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key, required this.paymentId});
  final String paymentId;
  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _payer = TextEditingController();
  final _intent = IntentKey();
  PickedFile? _file;
  String? _fileError;
  bool _uploading = false;
  Object? _error;
  bool _submitted = false;

  @override
  void dispose() {
    for (final c in [_amount, _reference, _payer]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit(GetPaymentResponse p) async {
    final t = EdmnLocalizations.of(context);
    setState(() => _fileError = _file == null ? t.uploadReceiptHint : null);
    if (!_form.currentState!.validate() || _file == null) return;
    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      await ref.read(mobileApiProvider).submitPaymentProof(
            p.id,
            bytes: _file!.bytes,
            fileName: _file!.name,
            claimedAmount: _amount.text.trim(),
            reference: _reference.text.trim(),
            payerName: _payer.text.trim(),
            clientKey: _intent.value,
          );
      _submitted = true;
      ref.invalidate(paymentProvider(p.id));
      if (p.orderId != null) {
        ref.invalidate(orderProvider(p.orderId!));
        ref.invalidate(ordersProvider);
      }
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final payment = ref.watch(paymentProvider(widget.paymentId));
    final p = payment.value;
    final canSubmit = p != null && p.allowedActions.contains('SUBMIT_PROOF') && !_submitted;
    return EdmnAppScaffold(
      title: t.paymentTitle,
      bottomBar: canSubmit ? EdmnPrimaryButton(key: const Key('submit-receipt'), label: t.submitReceipt, loading: _uploading, onPressed: () => _submit(p)) : null,
      body: AsyncView(
        value: payment,
        onRetry: () => ref.invalidate(paymentProvider(widget.paymentId)),
        data: (p) {
          final (label, tone) = paymentStatus(t, p.status);
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            if (p.isTest) ...[EdmnTestMoneyNotice(message: t.testPaymentNotice), const SizedBox(height: EdmnSpacing.md)],
            if (_submitted) ...[EdmnNotice(key: const Key('receipt-submitted'), message: t.receiptSubmitted, tone: EdmnTone.success), const SizedBox(height: EdmnSpacing.md)],
            EdmnCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(child: Text(t.amountDue, style: EdmnType.body.copyWith(color: EdmnColors.textSecondary))),
                  EdmnStatusChip(label: label, tone: tone),
                ]),
                EgpText(p.amountDuePiastres, style: EdmnType.balance.copyWith(color: EdmnColors.textPrimary)),
                if (p.orderNumber != null) Text('#${p.orderNumber}', textDirection: TextDirection.ltr, textAlign: TextAlign.start, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                if (p.status == 'AWAITING_PAYMENT' || p.status == 'REJECTED')
                  Text(t.payBefore(formatDateTime(context, p.dueAt)), style: EdmnType.bodyStrong.copyWith(color: EdmnColors.warning)),
                if (p.lastRejectionReasonAr != null) ...[const SizedBox(height: EdmnSpacing.xs), EdmnNotice(message: t.receiptRejected(p.lastRejectionReasonAr!), tone: EdmnTone.danger)],
              ]),
            ),
            if (p.destinations.isNotEmpty) ...[
              const SizedBox(height: EdmnSpacing.lg),
              Text(t.transferTo, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
              const SizedBox(height: EdmnSpacing.xs),
              for (final d in p.destinations) _Destination(d: d),
            ],
            if (p.submissions.isNotEmpty) ...[
              const SizedBox(height: EdmnSpacing.lg),
              Text(t.submissions, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
              for (final s in p.submissions)
                Padding(
                  padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.xs),
                  child: Row(children: [
                    const Icon(Icons.receipt_outlined, color: EdmnColors.primary),
                    const SizedBox(width: EdmnSpacing.xs),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        EgpText(s.claimedAmountPiastres, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                        Text(formatDateTime(context, s.submittedAt), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                        if (s.reviewReasonAr != null) Text(s.reviewReasonAr!, style: EdmnType.secondary.copyWith(color: EdmnColors.error)),
                      ]),
                    ),
                    EdmnStatusChip(
                      label: switch (s.status) { 'ACCEPTED' => t.paymentConfirmed, 'REJECTED' => t.paymentRejected, 'SUPERSEDED' => t.superseded, _ => t.receiptUnderReview },
                      tone: switch (s.status) { 'ACCEPTED' => EdmnTone.success, 'REJECTED' => EdmnTone.danger, 'SUPERSEDED' => EdmnTone.neutral, _ => EdmnTone.warning },
                    ),
                  ]),
                ),
            ],
            if (p.allowedActions.contains('SUBMIT_PROOF') && !_submitted) ...[
              const SizedBox(height: EdmnSpacing.lg),
              Form(
                key: _form,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  EdmnUploadField(
                    label: t.uploadReceipt,
                    hint: t.uploadReceiptHint,
                    fileName: _file?.name,
                    uploading: _uploading,
                    error: _fileError,
                    onClear: () => setState(() => _file = null),
                    onPick: () async {
                      final f = await ref.read(filePickerProvider).pick();
                      if (f != null) {
                        setState(() {
                          _file = f;
                          _fileError = null;
                        });
                      }
                    },
                  ),
                  const SizedBox(height: EdmnSpacing.sm),
                  EdmnTextField(
                    key: const Key('claimed-amount'),
                    controller: _amount,
                    hint: t.claimedAmountHint,
                    icon: Icons.payments_outlined,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    textDirection: TextDirection.ltr,
                    validator: (v) => parseEgpToPiastres(v ?? '') == null ? t.fieldRequired : null,
                  ),
                  const SizedBox(height: EdmnSpacing.sm),
                  EdmnTextField(key: const Key('reference'), controller: _reference, hint: t.referenceHint, icon: Icons.tag_rounded, textDirection: TextDirection.ltr),
                  const SizedBox(height: EdmnSpacing.sm),
                  EdmnTextField(key: const Key('payer-name'), controller: _payer, hint: t.payerNameHint, icon: Icons.person_outline_rounded),
                ]),
              ),
              if (_error != null) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(message: apiErrorMessage(context, _error!), tone: EdmnTone.danger)],
            ],
          ]);
        },
      ),
    );
  }
}

class _Destination extends StatelessWidget {
  const _Destination({required this.d});
  final GetPaymentResponseDestinationsItem d;

  @override
  Widget build(BuildContext context) => EdmnCard(
        margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(d.label, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700))),
            if (d.isTest) const EdmnStatusChip(label: 'TEST', tone: EdmnTone.warning),
          ]),
          for (final e in d.details.entries)
            Padding(
              padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.xs),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    if (e.key.isNotEmpty) Text(destinationLabel(EdmnLocalizations.of(context), e.key), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                    SelectableText(e.value, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                  ]),
                ),
                IconButton(
                  tooltip: MaterialLocalizations.of(context).copyButtonLabel,
                  icon: Icon(Icons.copy_rounded, size: EdmnSizes.iconSm, color: EdmnColors.primary, semanticLabel: MaterialLocalizations.of(context).copyButtonLabel),
                  onPressed: () => Clipboard.setData(ClipboardData(text: e.value)),
                ),
              ]),
            ),
          if (d.instructionsAr != null) Text(d.instructionsAr!, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
        ]),
      );
}

/// Known destination fields (server keys) → localized labels; unknown keys are shown as sent.
String destinationLabel(EdmnLocalizations t, String key) => switch (key) {
      'bankName' => t.destBankName,
      'accountName' => t.destAccountName,
      'accountNumber' => t.destAccountNumber,
      'iban' => 'IBAN',
      'instapayAddress' => t.destInstapayAddress,
      'walletNumber' => t.destWalletNumber,
      _ => key,
    };
