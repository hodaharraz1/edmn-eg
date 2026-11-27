import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../common/ui.dart';
import '../../providers.dart';

final deletionRequestProvider = FutureProvider<GetAccountDeletionRequestResponseRequest?>((ref) async => (await ref.watch(mobileApiProvider).accountDeletionRequest()).request);

/// Account deletion REQUEST (C30): the customer asks EDMN to close the account. The request deletes nothing by
/// itself; while anything is open the server refuses and the recorded BLOCKED state (with its Arabic reasons) is
/// shown here. A PENDING request can be withdrawn at any time before EDMN completes it.
class AccountDeletionScreen extends ConsumerStatefulWidget {
  const AccountDeletionScreen({super.key});

  @override
  ConsumerState<AccountDeletionScreen> createState() => _AccountDeletionScreenState();
}

class _AccountDeletionScreenState extends ConsumerState<AccountDeletionScreen> {
  final reasonController = TextEditingController();
  final submitKey = IntentKey();
  final cancelKey = IntentKey();
  bool busy = false;

  @override
  void dispose() {
    reasonController.dispose();
    super.dispose();
  }

  Future<void> run(Future<void> Function() action, {String? success}) async {
    setState(() => busy = true);
    try {
      await action();
      if (mounted && success != null) showEdmnMessage(context, success);
    } catch (e) {
      // A refusal (validation_failed) is recorded server-side as BLOCKED; refreshing shows its reasons below.
      if (mounted && e is ApiFailure && e.code != ApiErrorCode.validationFailed) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
    } finally {
      if (mounted) setState(() => busy = false);
      ref.invalidate(deletionRequestProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final request = ref.watch(deletionRequestProvider);

    return EdmnAppScaffold(
      title: t.accountDeletion,
      body: AsyncView(
        value: request,
        skeleton: true,
        onRetry: () => ref.invalidate(deletionRequestProvider),
        data: (r) {
          final pending = r?.status == 'PENDING';
          final blocked = r?.status == 'BLOCKED' ? r! : null;
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            if (pending) ...[
              EdmnNotice(key: const Key('deletion-pending'), tone: EdmnTone.warning, title: t.accountDeletionPending, message: '${t.accountDeletionPendingBody}\n${t.accountDeletionRequestedAt}: ${formatDateTime(context, r!.createdAt)}'),
              const SizedBox(height: EdmnSpacing.md),
              EdmnSecondaryButton(
                key: const Key('deletion-cancel'),
                label: t.accountDeletionCancel,
                destructive: true,
                onPressed: busy
                    ? null
                    : () async {
                        if (!await showEdmnConfirmation(context, title: t.accountDeletionCancel, message: t.accountDeletionCancelConfirm, confirmLabel: t.accountDeletionCancel, destructive: true)) return;
                        await run(() async {
                          await ref.read(mobileApiProvider).cancelAccountDeletionRequest(idempotencyKey: cancelKey.value);
                          cancelKey.reset();
                        }, success: t.accountDeletionCancelled);
                      },
              ),
            ] else ...[
              EdmnNotice(message: t.accountDeletionBody),
              if (blocked != null) ...[
                const SizedBox(height: EdmnSpacing.md),
                EdmnNotice(key: const Key('deletion-blocked'), tone: EdmnTone.danger, title: t.accountDeletionBlockedTitle, message: t.accountDeletionBlockedBody),
                EdmnMenuGroup(children: [
                  for (final b in blocked.blockers)
                    EdmnMenuItem(
                      key: Key('blocker-${b.code}'),
                      icon: Icons.error_outline_rounded,
                      title: b.label,
                      trailing: const SizedBox(),
                    ),
                ]),
              ],
              const SizedBox(height: EdmnSpacing.md),
              EdmnTextField(key: const Key('deletion-reason'), controller: reasonController, hint: t.accountDeletionReasonHint, maxLength: 500, maxLines: 2),
              const SizedBox(height: EdmnSpacing.md),
              EdmnPrimaryButton(
                key: const Key('deletion-submit'),
                label: t.accountDeletionSubmit,
                loading: busy,
                onPressed: () async {
                  if (!await showEdmnConfirmation(context, title: t.accountDeletion, message: t.accountDeletionConfirm, confirmLabel: t.accountDeletionSubmit, destructive: true)) return;
                  final reason = reasonController.text.trim();
                  await run(() async {
                    await ref.read(mobileApiProvider).requestAccountDeletion(reason: reason.isEmpty ? null : reason, idempotencyKey: submitKey.value);
                    submitKey.reset();
                  }, success: t.accountDeletionSent);
                },
              ),
            ],
          ]);
        },
      ),
    );
  }
}
