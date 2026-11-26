import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/file_pick.dart';
import '../../common/status.dart';
import '../../common/ui.dart';
import '../../providers.dart';
import '../seller/seller_setup_screens.dart' show payoutStatus;

/// Wallet (D24–D35). Every number is the server's (finance services over the ledger) — the app never adds balances up.
/// Holds, disputes and in-flight requests are never shown as withdrawable. A payout is a REQUEST: EDMN approves (two
/// people), reserves and transfers in the admin console; TRANSFER_UNCERTAIN is shown as "being verified", never as
/// paid or failed. PKG-WALLET-01 phase 1: a prepaid balance can be topped up by transfer + receipt (two-person staff
/// review) ONLY while the server's `topUp.enabled` is true (flag wallet.topUpEnabled, default off): with it off there is
/// no deposit button or balance card. No wallet-to-wallet transfer and no buyer cash-out.
final walletProvider = FutureProvider.autoDispose<GetWalletResponse>((ref) => ref.watch(mobileApiProvider).wallet());
final walletActivityProvider = FutureProvider.autoDispose.family<ListWalletActivityResponse, ({String? kind, String q})>(
    (ref, a) => ref.watch(mobileApiProvider).walletActivity(kind: a.kind, q: a.q));
final walletActivityPageProvider = FutureProvider.autoDispose.family<ListWalletActivityResponse, ({String? kind, String q, int page})>(
    (ref, a) => ref.watch(mobileApiProvider).walletActivity(kind: a.kind, q: a.q, page: a.page));
final walletActivityDetailProvider = FutureProvider.autoDispose.family<ListWalletActivityResponseItemsItem, String>((ref, id) async =>
    ListWalletActivityResponseItemsItem.fromJson((await ref.watch(mobileApiProvider).walletActivityDetail(id)).toJson()));
final walletTopupsProvider = FutureProvider.autoDispose<ListWalletTopupsResponse>((ref) => ref.watch(mobileApiProvider).walletTopups());
final accountPayoutsProvider = FutureProvider.autoDispose<ListAccountPayoutRequestsResponse>((ref) => ref.watch(mobileApiProvider).accountPayoutRequests());
final receivingAccountsProvider = FutureProvider.autoDispose<ListReceivingAccountsResponse>((ref) => ref.watch(mobileApiProvider).receivingAccounts());
final sellerStatementProvider = FutureProvider.autoDispose<GetSellerStatementResponse>((ref) => ref.watch(mobileApiProvider).sellerStatement());

String _blockReason(EdmnLocalizations t, String? r) => switch (r) {
      'IDENTITY' => t.payoutBlockIdentity,
      'NO_DESTINATION' => t.payoutBlockNoAccount,
      'DEBT' => t.payoutBlockDebt,
      'NOTHING_AVAILABLE' => t.payoutBlockNothing,
      _ => '',
    };

/* ───────────────────────── PKG-WALLET-01 deposit (only reachable while topUp.enabled) ───────────────────────── */

/// Deposit by InstaPay / bank transfer: shows EDMN's account (from the payment settings) with copy buttons, takes the
/// amount, method, receipt and an optional reference. Submitting NEVER credits: two EDMN staff verify the receipt first.
class WalletDepositScreen extends ConsumerStatefulWidget {
  const WalletDepositScreen({super.key});
  @override
  ConsumerState<WalletDepositScreen> createState() => _WalletDepositScreenState();
}

class _WalletDepositScreenState extends ConsumerState<WalletDepositScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  /// One key per deposit the user is making; a retry (lost response) returns the same deposit.
  final _intent = IntentKey();
  String? _method;
  PickedFile? _file;
  String? _fileError;
  bool _busy = false;
  bool _submitted = false;
  Object? _error;

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _submit(ListWalletTopupsResponse d) async {
    final t = EdmnLocalizations.of(context);
    setState(() => _fileError = _file == null ? t.uploadReceiptHint : null);
    if (!_form.currentState!.validate() || _file == null || _method == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(mobileApiProvider).createWalletTopup(
            bytes: _file!.bytes,
            fileName: _file!.name,
            amount: _amount.text.trim(),
            method: _method!,
            payerReference: _reference.text.trim(),
            clientKey: _intent.value,
          );
      _submitted = true;
      _intent.reset();
      _amount.clear();
      _reference.clear();
      _file = null;
      ref.invalidate(walletTopupsProvider);
      ref.invalidate(walletProvider);
    } catch (e) {
      // A definite refusal ends this attempt; a lost response keeps the key so the retry returns the same deposit.
      if (!isRetryableError(e)) _intent.reset();
      _error = e;
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final topups = ref.watch(walletTopupsProvider);
    return EdmnAppScaffold(
      title: t.depositTitle,
      body: AsyncView(
        value: topups,
        onRetry: () => ref.invalidate(walletTopupsProvider),
        data: (d) {
          final remaining = (d.dailyLimitPiastres - d.usedTodayPiastres).clamp(0, d.dailyLimitPiastres);
          _method ??= d.methods.isEmpty ? null : d.methods.first.code;
          final method = d.methods.where((m) => m.code == _method).firstOrNull;
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            EdmnWalletCard(label: t.walletBalanceLabel, amountPiastres: d.balancePiastres),
            const SizedBox(height: EdmnSpacing.sm),
            Text(t.depositRemainingToday(egpOf(context, remaining)), key: const Key('deposit-remaining'), style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
            const SizedBox(height: EdmnSpacing.md),
            if (_submitted) ...[EdmnNotice(key: const Key('deposit-submitted'), message: t.depositSubmitted, tone: EdmnTone.success), const SizedBox(height: EdmnSpacing.md)],
            if (d.methods.isEmpty)
              EdmnNotice(key: const Key('deposit-no-methods'), message: t.depositNoMethods, tone: EdmnTone.warning)
            else
              Form(
                key: _form,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(t.depositMethodLabel, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                  const SizedBox(height: EdmnSpacing.xs),
                  EdmnRadioCard<String>(
                    value: _method!,
                    onChanged: (v) => setState(() => _method = v),
                    options: [
                      for (final m in d.methods)
                        EdmnRadioOption(
                          value: m.code,
                          label: switch (m.code) { 'INSTAPAY' => t.depositMethodInstapay, 'VODAFONE_CASH' => t.depositMethodWallet, _ => t.depositMethodBank },
                          subtitle: m.code == 'VODAFONE_CASH' ? t.depositMethodWalletHint : null,
                          icon: switch (m.code) { 'INSTAPAY' => Icons.bolt_rounded, 'VODAFONE_CASH' => Icons.phone_iphone_rounded, _ => Icons.account_balance_outlined },
                        ),
                    ],
                  ),
                  const SizedBox(height: EdmnSpacing.md),
                  Text(t.depositTransferTo, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                  const SizedBox(height: EdmnSpacing.xs),
                  if (method != null) for (final x in method.destinations) _DepositDestination(d: x),
                  EdmnUploadField(
                    label: t.uploadReceipt,
                    hint: t.uploadReceiptHint,
                    fileName: _file?.name,
                    uploading: _busy,
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
                    key: const Key('deposit-amount'),
                    controller: _amount,
                    hint: t.amountEgpHint,
                    icon: Icons.payments_outlined,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    textDirection: TextDirection.ltr,
                    validator: (v) {
                      final p = parseEgpToPiastres(v ?? '');
                      if (p == null || p <= 0) return t.amountInvalid;
                      if (p > remaining) return t.depositOverLimit(egpOf(context, remaining));
                      return null;
                    },
                  ),
                  const SizedBox(height: EdmnSpacing.sm),
                  EdmnTextField(key: const Key('deposit-reference'), controller: _reference, hint: t.referenceHint, icon: Icons.tag_rounded, textDirection: TextDirection.ltr),
                  if (_error != null) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(key: const Key('deposit-error'), message: apiErrorMessage(context, _error!), tone: EdmnTone.danger)],
                  const SizedBox(height: EdmnSpacing.md),
                  EdmnPrimaryButton(key: const Key('deposit-submit'), label: t.depositSubmit, loading: _busy, onPressed: () => _submit(d)),
                ]),
              ),
            const SizedBox(height: EdmnSpacing.lg),
            EdmnSectionHeader(title: t.depositsList),
            if (d.items.isEmpty)
              EdmnEmptyState(icon: Icons.account_balance_wallet_outlined, title: t.noDeposits)
            else
              for (final x in d.items) _DepositRow(x: x, onCancel: x.cancellable ? () => _cancel(x.id) : null),
          ]);
        },
      ),
    );
  }

  final _cancelIntent = IntentKey();
  Future<void> _cancel(String id) async {
    final ok = await runAction(context, () => ref.read(mobileApiProvider).cancelWalletTopup(id, idempotencyKey: _cancelIntent.value));
    _cancelIntent.reset();
    if (!mounted) return;
    if (ok) {
      ref.invalidate(walletTopupsProvider);
      ref.invalidate(walletProvider);
    }
  }
}

class _DepositDestination extends StatelessWidget {
  const _DepositDestination({required this.d});
  final ListWalletTopupsResponseMethodsItemDestinationsItem d;

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
                    if (e.key.isNotEmpty) Text(destinationLabelOf(EdmnLocalizations.of(context), e.key), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                    SelectableText(e.value, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                  ]),
                ),
                IconButton(
                  key: Key('copy-${e.key}'),
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

/// Same server field keys the payment screen labels; unknown keys are shown as sent.
String destinationLabelOf(EdmnLocalizations t, String key) => switch (key) {
      'bankName' => t.destBankName,
      'accountName' => t.destAccountName,
      'accountNumber' => t.destAccountNumber,
      'iban' => 'IBAN',
      'instapayAddress' => t.destInstapayAddress,
      'walletNumber' => t.destWalletNumber,
      _ => key,
    };

class _DepositRow extends StatelessWidget {
  const _DepositRow({required this.x, this.onCancel});
  final ListWalletTopupsResponseItemsItem x;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final (label, tone) = switch (x.status) {
      'PENDING_REVIEW' => (t.depositPending, EdmnTone.warning),
      'CREDITED' => (t.depositCredited, EdmnTone.success),
      'REJECTED' => (t.depositRejected, EdmnTone.danger),
      _ => (t.depositCancelled, EdmnTone.neutral),
    };
    return EdmnCard(
      key: Key('deposit-${x.id}'),
      margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(child: EgpText(x.amountPiastres, style: EdmnType.bodyStrong)),
          EdmnStatusChip(label: label, tone: tone),
        ]),
        if (x.status == 'REJECTED' && x.rejectReasonAr != null) Text(t.depositRejectedReason(x.rejectReasonAr!), style: EdmnType.caption.copyWith(color: EdmnColors.error)),
        if (onCancel != null) Align(alignment: AlignmentDirectional.centerStart, child: TextButton(key: Key('deposit-cancel-${x.id}'), onPressed: onCancel, child: Text(t.depositCancel))),
      ]),
    );
  }
}

/* ───────────────────────── D24/D25 wallet home + balance breakdown ───────────────────────── */

class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final wallet = ref.watch(walletProvider);
    return EdmnAppScaffold(
      sunburst: true,
      title: t.wallet,
      body: AsyncView(
        value: wallet,
        onRetry: () => ref.invalidate(walletProvider),
        data: (w) {
          final b = w.balances;
          final canRequest = w.payout.blockReason == null;
          return RefreshIndicator(
            onRefresh: () => ref.refresh(walletProvider.future),
            // Bottom clearance keeps the last card above the floating nav pill (PKG-UI-01).
            child: ListView(
              padding: EdgeInsetsDirectional.fromSTEB(
                EdmnSpacing.screen,
                EdmnSpacing.screen,
                EdmnSpacing.screen,
                EdmnSpacing.screen + EdmnFloatingNavigation.clearanceOf(context),
              ),
              children: [
              EdmnWalletCard(
                key: const Key('wallet-card'),
                label: t.availableToWithdraw,
                amountPiastres: b.availablePiastres,
                footer: Row(children: [
                  Expanded(child: _CardStat(label: t.balancePending, amount: b.pendingPiastres + b.awaitingReleasePiastres)),
                  Expanded(child: _CardStat(label: t.balanceHeld, amount: b.heldPiastres + b.reservedPiastres)),
                ]),
              ),
              if (!w.realMoney) ...[const SizedBox(height: EdmnSpacing.sm), EdmnTestMoneyNotice(message: t.walletTestNotice)],
              if (w.topUp.enabled) ...[
                const SizedBox(height: EdmnSpacing.sm),
                EdmnCard(
                  key: const Key('wallet-topup-card'),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text(t.walletBalanceLabel, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                    const SizedBox(height: EdmnSpacing.xxs),
                    EgpText(w.topUp.balancePiastres, style: EdmnType.price.copyWith(color: EdmnColors.textPrimary)),
                    if (w.topUp.pending.isNotEmpty) Text(t.depositPendingCount('${w.topUp.pending.length}'), style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
                    const SizedBox(height: EdmnSpacing.sm),
                    EdmnPrimaryButton(key: const Key('wallet-deposit'), label: t.walletDeposit, icon: Icons.add_card_outlined, onPressed: () => context.push('/wallet/deposit')),
                  ]),
                ),
              ],
              if (!w.hasEarnings) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(key: const Key('no-earnings'), message: t.noEarningsYet)],
              const SizedBox(height: EdmnSpacing.md),
              EdmnCard(
                child: Row(children: [
                  Expanded(child: EdmnQuickAction(key: const Key('wallet-request'), icon: Icons.outbound_outlined, label: t.requestPayout, onTap: () => context.push('/wallet/payout'))),
                  Expanded(child: EdmnQuickAction(key: const Key('wallet-accounts'), icon: Icons.account_balance_outlined, label: t.receivingAccounts, onTap: () => context.push('/wallet/accounts'))),
                  Expanded(child: EdmnQuickAction(key: const Key('wallet-activity'), icon: Icons.receipt_long_outlined, label: t.transactionHistory, onTap: () => context.push('/wallet/activity'))),
                ]),
              ),
              if (!canRequest && w.hasEarnings) ...[
                const SizedBox(height: EdmnSpacing.sm),
                EdmnNotice(key: const Key('payout-block'), message: _blockReason(t, w.payout.blockReason), tone: EdmnTone.warning),
              ],
              const SizedBox(height: EdmnSpacing.md),
              // D25 — balance breakdown, exactly as the finance service classifies it.
              EdmnCard(
                key: const Key('balance-breakdown'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(t.balanceBreakdown, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                  const SizedBox(height: EdmnSpacing.xs),
                  _Line(t.balanceAvailable, b.availablePiastres, t.balanceAvailableHint, tone: EdmnColors.success),
                  _Line(t.balancePending, b.pendingPiastres, t.balancePendingHint),
                  _Line(t.balanceAwaitingRelease, b.awaitingReleasePiastres, t.balanceAwaitingReleaseHint),
                  _Line(t.balanceHeld, b.heldPiastres, t.balanceHeldHint, tone: EdmnColors.warning),
                  _Line(t.balanceReserved, b.reservedPiastres, t.balanceReservedHint),
                  if (b.debtPiastres > 0) _Line(t.balanceDebt, -b.debtPiastres, t.balanceDebtHint, tone: EdmnColors.error),
                  if (b.unsecuredClaimsPiastres > 0) _Line(t.balanceClaims, b.unsecuredClaimsPiastres, t.balanceClaimsHint, tone: EdmnColors.error),
                  _Line(t.balancePaidOut, b.paidOutPiastres, null),
                ]),
              ),
              if (w.sources.length > 1) ...[
                const SizedBox(height: EdmnSpacing.md),
                EdmnSectionHeader(title: t.balanceBySource),
                Row(children: [
                  for (final s in w.sources)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.xxs),
                        child: EdmnStatTile(
                          label: s.source == 'MARKETPLACE' ? (s.storeName ?? t.sourceStore) : t.protectedDeal,
                          value: EgpText(s.availablePiastres, style: EdmnType.price.copyWith(color: EdmnColors.textPrimary)),
                          icon: s.source == 'MARKETPLACE' ? Icons.storefront_outlined : Icons.verified_user_outlined,
                        ),
                      ),
                    ),
                ]),
              ],
              if (w.items.isNotEmpty) ...[
                const SizedBox(height: EdmnSpacing.md),
                EdmnSectionHeader(title: t.fundsByOrder),
                EdmnCard(
                  padding: EdgeInsets.zero,
                  child: Column(children: [
                    for (final i in w.items)
                      EdmnTransactionRow(
                        key: Key('fund-${i.entityId}'),
                        icon: i.kind == 'DEAL' ? Icons.verified_user_outlined : Icons.receipt_long_outlined,
                        title: i.kind == 'DEAL' ? '${t.protectedDeal} ${i.ref}' : t.orderRef(i.ref),
                        subtitle: _bucket(t, i.bucket),
                        amountPiastres: i.amountPiastres,
                        onTap: () => context.push(i.kind == 'DEAL' ? '/deals/${i.entityId}' : '/seller/orders/${i.entityId}'),
                      ),
                  ]),
                ),
              ],
              const SizedBox(height: EdmnSpacing.md),
              _RecentActivity(),
              const SizedBox(height: EdmnSpacing.md),
              if (!w.topUp.enabled) EdmnNotice(key: const Key('no-topup'), message: t.noPrepaidBalance, icon: Icons.info_outline_rounded),
            ]),
          );
        },
      ),
    );
  }
}

String _bucket(EdmnLocalizations t, String b) => switch (b) {
      'pending' => t.balancePending,
      'held' => t.balanceHeld,
      'entitledAwaitingRelease' => t.balanceAwaitingRelease,
      'available' => t.balanceAvailable,
      _ => b,
    };

String egpOf(BuildContext context, int piastres) => formatEgp(piastres, languageCode: Localizations.localeOf(context).languageCode);

class _CardStat extends StatelessWidget {
  const _CardStat({required this.label, required this.amount});
  final String label;
  final int amount;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: EdmnType.caption.copyWith(color: EdmnColors.onPrimary.withValues(alpha: 0.85))),
        EgpText(amount, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.onPrimary, fontWeight: FontWeight.w800)),
      ]);
}

class _Line extends StatelessWidget {
  const _Line(this.label, this.amount, this.hint, {this.tone});
  final String label;
  final int amount;
  final String? hint;
  final Color? tone;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsetsDirectional.symmetric(vertical: EdmnSpacing.xxs),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
              if (hint != null) Text(hint!, style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
            ]),
          ),
          EgpText(amount, style: EdmnType.bodyStrong.copyWith(color: tone ?? EdmnColors.textPrimary, fontWeight: FontWeight.w800)),
        ]),
      );
}

class _RecentActivity extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final a = ref.watch(walletActivityProvider((kind: null, q: '')));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      EdmnSectionHeader(title: t.recentActivity, actionLabel: t.viewAll, onAction: () => context.push('/wallet/activity')),
      a.when(
        loading: () => const EdmnSkeletonList(rows: 3),
        error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(walletActivityProvider)),
        data: (r) => r.items.isEmpty
            ? EdmnEmptyState(icon: Icons.receipt_long_outlined, title: t.noActivity)
            : EdmnCard(padding: EdgeInsets.zero, child: Column(children: [for (final x in r.items.take(5)) ActivityRow(x: x)])),
      ),
    ]);
  }
}

/* ───────────────────────── D26/D27 activity + detail ───────────────────────── */

(String, EdmnTone) activityStatus(EdmnLocalizations t, ListWalletActivityResponseItemsItem x) => switch (x.kind) {
      'PAYMENT' => paymentStatus(t, x.status),
      'REFUND' => refundStatus(t, x.status),
      _ => payoutStatus(t, x.status),
    };

/// Codes like «#100002» inside Arabic text are wrapped in LTR isolates so they never render reversed.
String ltrCode(String code) => '\u2066$code\u2069';

String activityTitle(EdmnLocalizations t, ListWalletActivityResponseItemsItem x) => switch (x.kind) {
      'PAYMENT' => t.activityPayment(ltrCode(x.ref)),
      'REFUND' => t.activityRefund(ltrCode(x.ref)),
      _ => t.activityPayout(ltrCode(x.ref)),
    };

class ActivityRow extends StatelessWidget {
  const ActivityRow({super.key, required this.x});
  final ListWalletActivityResponseItemsItem x;
  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final (l, tone) = activityStatus(t, x);
    return EdmnTransactionRow(
      key: Key('act-${x.id}'),
      icon: switch (x.kind) { 'PAYMENT' => Icons.payments_outlined, 'REFUND' => Icons.undo_rounded, _ => Icons.outbound_outlined },
      title: activityTitle(t, x),
      subtitle: formatDateTime(context, x.createdAt),
      amountPiastres: x.direction == 'IN' ? x.amountPiastres : -x.amountPiastres,
      status: EdmnStatusChip(label: x.isTest == true ? '$l · ${t.testTag}' : l, tone: tone),
      onTap: () => context.push('/wallet/activity/${x.id}', extra: x),
    );
  }
}

class WalletActivityScreen extends ConsumerStatefulWidget {
  const WalletActivityScreen({super.key});
  @override
  ConsumerState<WalletActivityScreen> createState() => _WalletActivityScreenState();
}

class _WalletActivityScreenState extends ConsumerState<WalletActivityScreen> {
  String? _kind;
  int _page = 1;
  String _q = '';
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final args = (kind: _kind, q: _q, page: _page);
    final list = ref.watch(walletActivityPageProvider(args));
    return EdmnAppScaffold(
      title: t.transactionHistory,
      body: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
        EdmnTextField(
          key: const Key('activity-search'),
          controller: _search,
          hint: t.searchByReference,
          icon: Icons.search_rounded,
          keyboardType: TextInputType.text,
          textInputAction: TextInputAction.search,
          onSubmitted: (v) => setState(() { _q = v.trim(); _page = 1; }),
        ),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnFilterPills<String?>(
          options: [(null, t.filterAll), ('PAYMENT', t.filterPayments), ('REFUND', t.filterRefunds), ('PAYOUT', t.filterPayouts)],
          selected: _kind,
          onSelected: (v) => setState(() { _kind = v; _page = 1; }),
        ),
        const SizedBox(height: EdmnSpacing.sm),
        list.when(
          loading: () => const EdmnSkeletonList(),
          error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(walletActivityPageProvider(args))),
          data: (r) => r.items.isEmpty
              ? EdmnEmptyState(icon: Icons.receipt_long_outlined, title: t.noActivity)
              : Column(children: [
                  EdmnCard(padding: EdgeInsets.zero, child: Column(children: [for (final x in r.items) ActivityRow(x: x)])),
                  if (r.hasMore) EdmnSecondaryButton(key: const Key('activity-next'), label: t.next, onPressed: () => setState(() => _page++)),
                ]),
        ),
        if (_page > 1) EdmnSecondaryButton(key: const Key('activity-previous'), label: t.previousPage, onPressed: () => setState(() => _page--)),
      ]),
    );
  }
}

class WalletActivityDetailScreen extends ConsumerWidget {
  const WalletActivityDetailScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncView(
    value: ref.watch(walletActivityDetailProvider(id)),
    onRetry: () => ref.invalidate(walletActivityDetailProvider(id)),
    data: (x) => RefreshIndicator(
      onRefresh: () => ref.refresh(walletActivityDetailProvider(id).future),
      child: _ActivityDetailBody(item: x),
    ),
  );
}

class _ActivityDetailBody extends StatelessWidget {
  const _ActivityDetailBody({required this.item});
  final ListWalletActivityResponseItemsItem item;
  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final x = item;
    final (l, tone) = activityStatus(t, x);
    return EdmnAppScaffold(
      title: t.transactionDetails,
      body: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
        EdmnCard(
          child: Column(children: [
            Text(activityTitle(t, x), style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textSecondary)),
            const SizedBox(height: EdmnSpacing.xs),
            EgpText(x.direction == 'IN' ? x.amountPiastres : -x.amountPiastres, signed: true, style: EdmnType.balance.copyWith(color: x.direction == 'IN' ? EdmnColors.success : EdmnColors.textPrimary)),
            const SizedBox(height: EdmnSpacing.xs),
            EdmnStatusChip(label: l, tone: tone),
          ]),
        ),
        if (x.isTest == true) ...[const SizedBox(height: EdmnSpacing.sm), EdmnTestMoneyNotice(message: t.activityTestNotice)],
        if (x.isTest == null) ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(message: t.activityMoneyModeUnknown)],
        if (x.kind == 'PAYOUT' && x.status == 'TRANSFER_UNCERTAIN') ...[const SizedBox(height: EdmnSpacing.sm), EdmnNotice(message: t.payoutUncertainNote, tone: EdmnTone.warning)],
        const SizedBox(height: EdmnSpacing.md),
        EdmnCard(
          child: Column(children: [
            _Kv(t.referenceNumber, x.ref, ltr: true),
            _Kv(t.dateLabel, formatDateTime(context, x.createdAt)),
            if (x.method != null) _Kv(t.methodLabel, methodLabel(t, x.method!)),
            if (x.reference != null) _Kv(t.transferReference, x.reference!, ltr: true),
            if (x.note != null && x.note!.isNotEmpty) _Kv(x.kind == 'PAYOUT' ? t.destinationLabel : t.noteLabel, x.note!),
          ]),
        ),
        if (x.link != null) ...[
          const SizedBox(height: EdmnSpacing.md),
          EdmnSecondaryButton(
            key: const Key('activity-open'),
            label: switch (x.link!.kind) { 'PAYMENT' => t.paymentTitle, 'DEAL' => t.protectedDeal, _ => t.orderDetails },
            onPressed: () => context.push(switch (x.link!.kind) { 'PAYMENT' => '/payments/${x.link!.id}', 'DEAL' => '/deals/${x.link!.id}', _ => '/orders/${x.link!.id}' }),
          ),
        ],
      ]),
    );
  }
}

String methodLabel(EdmnLocalizations t, String m) => switch (m) {
      'INSTAPAY' => t.methodInstapay,
      'VODAFONE_CASH' || 'ORANGE_CASH' || 'ETISALAT_CASH' || 'WE_PAY' || 'BM_WALLET' || 'MOBILE_WALLET' => t.methodWallet,
      'BANK_TRANSFER' || 'BANK_ACCOUNT' => t.methodBank,
      'COD' => 'الدفع عند الاستلام',
      _ => m,
    };

class _Kv extends StatelessWidget {
  const _Kv(this.k, this.v, {this.ltr = false});
  final String k;
  final String v;
  final bool ltr;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsetsDirectional.symmetric(vertical: EdmnSpacing.xxs),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(k, style: EdmnType.body.copyWith(color: EdmnColors.textSecondary))),
          Flexible(child: SelectableText(v, textDirection: ltr ? TextDirection.ltr : null, textAlign: TextAlign.end, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary))),
        ]),
      );
}

/* ───────────────────────── D32/D35 payout request + result, request list ───────────────────────── */

class AccountPayoutScreen extends ConsumerStatefulWidget {
  const AccountPayoutScreen({super.key});
  @override
  ConsumerState<AccountPayoutScreen> createState() => _AccountPayoutScreenState();
}

class _AccountPayoutScreenState extends ConsumerState<AccountPayoutScreen> {
  final _amount = TextEditingController();
  /// One key per payout the user is requesting; a retry (lost response) returns the same request.
  final _intent = IntentKey();
  String? _dest;
  PreviewAccountPayoutRequestResponse? _preview;
  CreateAccountPayoutRequestResponse? _done;
  bool _busy = false;
  int? _pendingAmount;
  String? _pendingDest;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final wallet = ref.watch(walletProvider);
    final api = ref.read(mobileApiProvider);
    final requests = ref.watch(accountPayoutsProvider);
    return EdmnAppScaffold(
      title: t.requestPayout,
      body: AsyncView(
        value: wallet,
        onRetry: () => ref.invalidate(walletProvider),
        data: (w) {
          final dests = w.payout.destinations;
          _dest ??= dests.isEmpty ? null : dests.first.key;
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            if (_done != null) ...[
              // D35 — result: a request only; nothing has been transferred.
              EdmnNotice(
                key: const Key('payout-result'),
                tone: EdmnTone.success,
                title: _done!.created ? t.payoutRequestSent : t.payoutRequestAlreadySent,
                message: t.payoutRequestResult(_done!.request.number),
              ),
              const SizedBox(height: EdmnSpacing.md),
            ],
            EdmnWalletCard(label: t.availableToWithdraw, amountPiastres: w.balances.availablePiastres),
            if (!w.realMoney) ...[const SizedBox(height: EdmnSpacing.sm), EdmnTestMoneyNotice(message: t.payoutTestNotice)],
            const SizedBox(height: EdmnSpacing.md),
            if (w.payout.blockReason != null)
              EdmnNotice(
                key: const Key('payout-block'),
                message: _blockReason(t, w.payout.blockReason),
                tone: EdmnTone.warning,
              )
            else ...[
              Text(t.payoutDestination, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
              const SizedBox(height: EdmnSpacing.xs),
              EdmnRadioCard<String>(
                value: _dest!,
                onChanged: (v) => setState(() {
                  if (_busy || _pendingAmount != null) return;
                  _dest = v;
                  _preview = null;
                }),
                options: [
                  for (final d in dests)
                    EdmnRadioOption(
                      value: d.key,
                      label: d.label,
                      subtitle: d.scope == 'STORE_AND_DEALS' ? t.destStoreAndDeals : t.destDealsOnly,
                      icon: d.scope == 'STORE_AND_DEALS' ? Icons.storefront_outlined : Icons.account_balance_wallet_outlined,
                    ),
                ],
              ),
              const SizedBox(height: EdmnSpacing.md),
              EdmnTextField(
                key: const Key('payout-amount'),
                enabled: !_busy && _pendingAmount == null,
                controller: _amount,
                hint: t.amountEgpHint,
                icon: Icons.payments_outlined,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                textDirection: TextDirection.ltr,
                onChanged: (_) => setState(() => _preview = null),
              ),
              Text(t.payoutMinimum(egpOf(context, w.payout.minimumPiastres)), style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
              const SizedBox(height: EdmnSpacing.sm),
              if (_preview != null)
                EdmnCard(
                  key: const Key('payout-preview'),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    if (!_preview!.fits) EdmnNotice(message: t.payoutDoesNotFit, tone: EdmnTone.danger),
                    for (final s in _preview!.sources)
                      Row(children: [
                        Expanded(child: Text(s.source == 'MARKETPLACE' ? t.sourceStore : t.protectedDeal, style: EdmnType.body)),
                        EgpText(s.amountPiastres, style: EdmnType.bodyStrong),
                      ]),
                    _Line(t.transferCost, _preview!.transferCostPiastres, null),
                    _Line(t.payoutNetAmount, _preview!.netPiastres, null),
                    for (final note in [..._preview!.violations, ..._preview!.warnings]) EdmnNotice(message: note, tone: EdmnTone.warning),
                    Text(t.payoutPreviewNote, style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
                  ]),
                ),
              const SizedBox(height: EdmnSpacing.sm),
              if (_preview == null || !_preview!.fits)
                EdmnSecondaryButton(
                  key: const Key('payout-preview-btn'),
                  label: t.checkAmount,
                  loading: _busy,
                  onPressed: () async {
                    final amount = parseEgpToPiastres(_amount.text);
                    if (amount == null || amount <= 0) return showEdmnMessage(context, t.amountInvalid, error: true);
                    setState(() => _busy = true);
                    await runAction(context, () async {
                      final p = await api.previewAccountPayout(amount, _dest!);
                      if (mounted) setState(() => _preview = p);
                    });
                    if (mounted) setState(() => _busy = false);
                  },
                )
              else
                EdmnPrimaryButton(
                  key: const Key('payout-submit'),
                  label: t.sendPayoutRequest,
                  loading: _busy,
                  onPressed: () async {
                    final amount = _pendingAmount ?? parseEgpToPiastres(_amount.text)!;
                    final ok = await showEdmnConfirmation(context, title: t.sendPayoutRequest, message: t.payoutConfirmBody(egpOf(context, amount), dests.firstWhere((d) => d.key == _dest).label), confirmLabel: t.sendPayoutRequest);
                    if (!ok || !context.mounted) return;
                    _pendingAmount ??= amount;
                    _pendingDest ??= _dest!;
                    setState(() => _busy = true);
                    final sent = await runAction(context, () async {
                      try {
                        final r = await api.requestAccountPayout(_pendingAmount!, _pendingDest!, _intent.value);
                        if (mounted) setState(() => _done = r);
                      } catch (e) {
                        if (!isRetryableError(e)) { _pendingAmount = null; _pendingDest = null; _intent.reset(); }
                        rethrow;
                      }
                    });
                    if (!mounted) return;
                    if (sent) {
                      _pendingAmount = null;
                      _pendingDest = null;
                      _intent.reset();
                      _amount.clear();
                      _preview = null;
                      ref.invalidate(walletProvider);
                      ref.invalidate(accountPayoutsProvider);
                      ref.invalidate(walletActivityProvider);
                    }
                    if (mounted) setState(() => _busy = false);
                  },
                ),
            ],
            const SizedBox(height: EdmnSpacing.lg),
            EdmnSectionHeader(title: t.payoutRequests),
            requests.when(
              loading: () => const EdmnSkeletonList(rows: 2),
              error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(accountPayoutsProvider)),
              data: (r) => r.items.isEmpty
                  ? EdmnEmptyState(icon: Icons.outbound_outlined, title: t.noPayoutRequests)
                  : Column(children: [for (final x in r.items) _RequestCard(x: x)]),
            ),
          ]);
        },
      ),
    );
  }
}

class _RequestCard extends ConsumerWidget {
  const _RequestCard({required this.x});
  final ListAccountPayoutRequestsResponseItemsItem x;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final (l, tone) = payoutStatus(t, x.status);
    return EdmnCard(
      key: Key('acc-payout-${x.id}'),
      margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: EdmnSpacing.xs, runSpacing: EdmnSpacing.xxs, children: [
          EgpText(x.amountPiastres, style: EdmnType.price.copyWith(color: EdmnColors.textPrimary)),
          EdmnStatusChip(label: x.isTest == true ? '$l · ${t.testTag}' : l, tone: tone),
        ]),
        Text('#${x.number} · ${x.destination}', style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
        Text(formatDateTime(context, x.createdAt), style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
        if (x.reference != null) Text(t.paidReference(x.reference!), style: EdmnType.secondary.copyWith(color: EdmnColors.success)),
        if (x.reasonAr != null) Text(x.reasonAr!, style: EdmnType.secondary.copyWith(color: EdmnColors.error)),
        if (x.status == 'TRANSFER_UNCERTAIN') Text(t.payoutUncertainNote, style: EdmnType.secondary.copyWith(color: EdmnColors.warning)),
        if (x.cancellable)
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: EdmnSecondaryButton(
              key: Key('cancel-acc-payout-${x.id}'),
              label: t.cancelRequest,
              compact: true,
              destructive: true,
              onPressed: () async {
                if (!await showEdmnConfirmation(context, title: t.cancelRequest, message: t.cancelPayoutConfirm, confirmLabel: t.cancelRequest)) return;
                if (!context.mounted) return;
                await runAction(context, () => ref.read(mobileApiProvider).cancelAccountPayout(x.id, idempotencyKey: newIdempotencyKey()));
                ref.invalidate(accountPayoutsProvider);
                ref.invalidate(walletProvider);
              },
            ),
          ),
      ]),
    );
  }
}

/* ───────────────────────── D33 receiving accounts ───────────────────────── */

(String, EdmnTone) accountStatus(EdmnLocalizations t, String s) => switch (s) {
      'APPROVED' => (t.accountVerified, EdmnTone.success),
      'PENDING_REVIEW' => (t.accountUnderReview, EdmnTone.warning),
      'MORE_INFO_REQUIRED' || 'REVERIFICATION_REQUIRED' => (t.accountNeedsInfo, EdmnTone.warning),
      'REJECTED' => (t.accountRejected, EdmnTone.danger),
      _ => (s, EdmnTone.neutral),
    };

class ReceivingAccountsScreen extends ConsumerWidget {
  const ReceivingAccountsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final list = ref.watch(receivingAccountsProvider);
    return EdmnAppScaffold(
      title: t.receivingAccounts,
      bottomBar: EdmnPrimaryButton(
        key: const Key('add-account'),
        label: t.addReceivingAccount,
        icon: Icons.add_rounded,
        onPressed: () async {
          final added = await showEdmnBottomSheet<bool>(context, title: t.addReceivingAccount, child: const _AccountForm());
          if (added == true) {
            ref.invalidate(receivingAccountsProvider);
            ref.invalidate(walletProvider);
          }
        },
      ),
      body: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
        EdmnNotice(message: t.receivingAccountsNote, icon: Icons.verified_user_outlined),
        const SizedBox(height: EdmnSpacing.md),
        list.when(
          loading: () => const EdmnSkeletonList(rows: 2),
          error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(receivingAccountsProvider)),
          data: (r) => r.items.isEmpty
              ? EdmnEmptyState(icon: Icons.account_balance_outlined, title: t.noReceivingAccounts)
              : Column(children: [
                  for (final a in r.items)
                    () {
                      final (l, tone) = accountStatus(t, a.status);
                      return EdmnCard(
                        key: Key('account-${a.id}'),
                        margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Row(children: [
                            Icon(a.type == 'BANK_ACCOUNT' ? Icons.account_balance_outlined : (a.type == 'INSTAPAY' ? Icons.bolt_rounded : Icons.phone_iphone_rounded), color: EdmnColors.primary),
                            const SizedBox(width: EdmnSpacing.xs),
                            Expanded(child: Text(a.label, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary))),
                            EdmnStatusChip(label: l, tone: tone),
                          ]),
                          Text(a.holderName, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                          if (a.reviewNote != null) Text(a.reviewNote!, style: EdmnType.secondary.copyWith(color: EdmnColors.error)),
                          Align(
                            alignment: AlignmentDirectional.centerEnd,
                            child: TextButton(
                              key: Key('archive-${a.id}'),
                              onPressed: () async {
                                if (!await showEdmnConfirmation(context, title: t.removeAccount, message: t.removeAccountConfirm, confirmLabel: t.removeAccount)) return;
                                if (!context.mounted) return;
                                await runAction(context, () => ref.read(mobileApiProvider).archiveReceivingAccount(a.id, idempotencyKey: newIdempotencyKey()));
                                ref.invalidate(receivingAccountsProvider);
                                ref.invalidate(walletProvider);
                              },
                              child: Text(t.removeAccount, style: const TextStyle(color: EdmnColors.error)),
                            ),
                          ),
                        ]),
                      );
                    }(),
                ]),
        ),
      ]),
    );
  }
}

class _AccountForm extends ConsumerStatefulWidget {
  const _AccountForm();
  @override
  ConsumerState<_AccountForm> createState() => _AccountFormState();
}

class _AccountFormState extends ConsumerState<_AccountForm> {
  String _type = 'INSTAPAY';
  final _intent = IntentKey();
  final _c = {for (final k in ['holderName', 'instapayAddress', 'walletProvider', 'walletNumber', 'bankName', 'iban', 'accountNumber']) k: TextEditingController()};
  bool _busy = false;

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
    Widget f(String k, String hint, {TextInputType? type, bool ltr = false}) => Padding(
          padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
          child: EdmnTextField(key: Key('acc-$k'), controller: _c[k], hint: hint, keyboardType: type, textDirection: ltr ? TextDirection.ltr : null),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      EdmnRadioCard<String>(
        value: _type,
        onChanged: (v) => setState(() => _type = v),
        options: [
          EdmnRadioOption(value: 'INSTAPAY', label: t.methodInstapay, icon: Icons.bolt_rounded),
          EdmnRadioOption(value: 'MOBILE_WALLET', label: t.methodWallet, icon: Icons.phone_iphone_rounded),
          EdmnRadioOption(value: 'BANK_ACCOUNT', label: t.methodBank, icon: Icons.account_balance_outlined),
        ],
      ),
      const SizedBox(height: EdmnSpacing.sm),
      f('holderName', t.holderNameFull),
      if (_type == 'INSTAPAY') f('instapayAddress', t.destInstapayAddress, ltr: true),
      if (_type == 'MOBILE_WALLET') ...[f('walletProvider', t.walletProviderHint), f('walletNumber', t.walletNumberHint, type: TextInputType.phone, ltr: true)],
      if (_type == 'BANK_ACCOUNT') ...[f('bankName', t.bankNameHint), f('iban', t.ibanHint, ltr: true), f('accountNumber', t.accountNumberHint, type: TextInputType.number, ltr: true)],
      EdmnNotice(message: t.accountHolderMustMatch, tone: EdmnTone.info),
      const SizedBox(height: EdmnSpacing.md),
      EdmnPrimaryButton(
        key: const Key('acc-submit'),
        label: t.submitForReview,
        loading: _busy,
        onPressed: () async {
          final v = {for (final e in _c.entries) e.key: e.value.text.trim()};
          final account = <String, dynamic>{
            'type': _type,
            'holderName': v['holderName'],
            if (_type == 'INSTAPAY') 'instapayAddress': v['instapayAddress'],
            if (_type == 'MOBILE_WALLET') ...{'walletProvider': v['walletProvider'], 'walletNumber': v['walletNumber']},
            if (_type == 'BANK_ACCOUNT') ...{'bankName': v['bankName'], 'iban': v['iban'], 'accountNumber': v['accountNumber']},
          };
          setState(() => _busy = true);
          final ok = await runAction(context, () => ref.read(mobileApiProvider).addReceivingAccount(account, idempotencyKey: _intent.value), success: t.accountSubmitted);
          if (mounted) setState(() => _busy = false);
          if (ok && context.mounted) Navigator.pop(context, true);
        },
      ),
    ]);
  }
}

/* ───────────────────────── Seller statement (finance.view) ───────────────────────── */

class SellerStatementScreen extends ConsumerWidget {
  const SellerStatementScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final st = ref.watch(sellerStatementProvider);
    return EdmnAppScaffold(
      title: t.financialStatement,
      body: AsyncView(
        value: st,
        onRetry: () => ref.invalidate(sellerStatementProvider),
        data: (s) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          EdmnCard(
            key: const Key('statement-totals'),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              _Line(t.totalSales, s.totals.grossSalesPiastres, null),
              _Line(t.edmnFees, -s.totals.edmnFeesPiastres, null),
              _Line(t.refundsTotal, -s.totals.refundsPiastres, null),
              const Divider(),
              _Line(t.balancePending, s.totals.pendingPiastres, t.balancePendingHint),
              _Line(t.balanceReserved, s.totals.reservedPiastres, t.balanceReservedHint),
              if (s.totals.debtPiastres > 0) _Line(t.balanceDebt, -s.totals.debtPiastres, t.balanceDebtHint, tone: EdmnColors.error),
            ]),
          ),
          const SizedBox(height: EdmnSpacing.md),
          EdmnSectionHeader(title: t.ledgerEntries),
          if (s.rows.isEmpty)
            EdmnEmptyState(icon: Icons.receipt_long_outlined, title: t.noActivity)
          else
            EdmnCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (final r in s.rows)
                  EdmnTransactionRow(
                    key: Key('st-${r.id}'),
                    icon: r.netEffectPiastres >= 0 ? Icons.south_west_rounded : Icons.north_east_rounded,
                    title: r.description,
                    subtitle: '${formatDateTime(context, r.date)} · ${r.orderRef ?? r.reference}',
                    amountPiastres: r.pendingDeltaPiastres + r.availableDeltaPiastres + r.reservedDeltaPiastres,
                  ),
              ]),
            ),
        ]),
      ),
    );
  }
}
