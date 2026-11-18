import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers.dart';
import 'sign_in_screen.dart' show AuthLayout;

/// The reset token inside whatever the user pasted: the full link from the email / SMS, or the token alone.
String? resetTokenFrom(String input) {
  final raw = input.trim();
  if (raw.isEmpty) return null;
  final uri = Uri.tryParse(raw);
  final token = (uri != null && uri.queryParameters['token'] != null) ? uri.queryParameters['token']! : raw;
  return RegExp(r'^[A-Za-z0-9_\-]{20,200}$').hasMatch(token) ? token : null;
}

/// B08 — set a new password with the single-use token from the reset link (`/reset-password?token=…`, the same path
/// as the web link). The token is never stored or logged. On success every session is signed out by the server, so
/// the app clears its own session and sends the user to sign in.
class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key, this.token});
  final String? token;
  @override
  ConsumerState<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _link = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  bool _done = false;
  Object? _error;
  String? _problem;

  bool get _hasLinkToken => resetTokenFrom(widget.token ?? '') != null;

  @override
  void dispose() {
    _link.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final t = EdmnLocalizations.of(context);
    final token = _hasLinkToken ? resetTokenFrom(widget.token!) : resetTokenFrom(_link.text);
    setState(() {
      _error = null;
      _problem = null;
    });
    if (token == null) return setState(() => _problem = t.resetLinkInvalid);
    if (_password.text.length < 8) return setState(() => _problem = t.passwordTooShort);
    // Same rule as the server (letters and digits), so a server refusal below can only mean the link.
    if (!RegExp(r'[A-Za-z\u0600-\u06FF]').hasMatch(_password.text) || !RegExp(r'\d').hasMatch(_password.text)) return setState(() => _problem = t.passwordRules);
    if (_password.text != _confirm.text) return setState(() => _problem = t.passwordsDoNotMatch);
    setState(() => _busy = true);
    try {
      await ref.read(mobileApiProvider).resetPassword(token, _password.text);
      // The server revoked every session: drop the local one too.
      await ref.read(mobileApiProvider).client.clearSession();
      ref.read(signedInProvider.notifier).set(false);
      if (mounted) setState(() => _done = true);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return AuthLayout(
      title: t.resetPasswordTitle,
      subtitle: _done ? null : t.resetPasswordBody,
      showBack: true,
      children: _done
          ? [
              EdmnNotice(key: const Key('reset-done'), tone: EdmnTone.success, title: t.passwordChanged, message: t.passwordChangedBody),
              const SizedBox(height: EdmnSpacing.md),
              EdmnPrimaryButton(key: const Key('reset-to-sign-in'), label: t.signIn, onPressed: () => context.go('/sign-in')),
            ]
          : [
              if (!_hasLinkToken) ...[
                EdmnTextField(key: const Key('reset-link'), controller: _link, hint: t.pasteResetLink, icon: Icons.link_rounded, textDirection: TextDirection.ltr),
                const SizedBox(height: EdmnSpacing.sm),
              ],
              EdmnTextField(key: const Key('reset-password'), controller: _password, hint: t.newPasswordHint, icon: Icons.lock_outline_rounded, obscure: true, autofillHints: const [AutofillHints.newPassword]),
              const SizedBox(height: EdmnSpacing.sm),
              EdmnTextField(key: const Key('reset-confirm'), controller: _confirm, hint: t.confirmPasswordHint, icon: Icons.lock_outline_rounded, obscure: true, autofillHints: const [AutofillHints.newPassword]),
              const SizedBox(height: EdmnSpacing.xs),
              Text(t.passwordRules, style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
              const SizedBox(height: EdmnSpacing.md),
              if (_problem != null) ...[EdmnNotice(key: const Key('reset-problem'), message: _problem!, tone: EdmnTone.danger), const SizedBox(height: EdmnSpacing.sm)],
              if (_error != null) ...[
                EdmnNotice(
                  key: const Key('reset-error'),
                  // The password was checked locally, so a validation refusal is the link (expired, used or replaced).
                  message: _error is ApiFailure && (_error as ApiFailure).code == ApiErrorCode.validationFailed ? t.resetLinkExpired : apiErrorMessage(context, _error!),
                  tone: EdmnTone.danger,
                ),
                const SizedBox(height: EdmnSpacing.xs),
                Align(alignment: AlignmentDirectional.centerStart, child: TextButton(key: const Key('reset-new-link'), onPressed: () => context.go('/forgot-password'), child: Text(t.requestNewResetLink))),
                const SizedBox(height: EdmnSpacing.sm),
              ],
              EdmnPrimaryButton(key: const Key('reset-submit'), label: t.saveNewPassword, loading: _busy, onPressed: _submit),
            ],
    );
  }
}
