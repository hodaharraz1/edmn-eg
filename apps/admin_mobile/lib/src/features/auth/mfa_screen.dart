import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';

/// Mandatory TOTP for every Admin App session (enrolment first if the account has no authenticator yet).
/// The enrolment secret is shown once on screen, never logged or stored by the app.
class MfaScreen extends ConsumerStatefulWidget {
  const MfaScreen({super.key});

  @override
  ConsumerState<MfaScreen> createState() => _MfaState();
}

class _MfaState extends ConsumerState<MfaScreen> {
  final _code = TextEditingController();
  String? _secret;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (!ref.read(totpEnrolledProvider)) {
      ref.read(adminApiProvider).enrollTotp().then((r) {
        if (mounted) setState(() => _secret = r.secret);
      }, onError: (Object e) {
        if (mounted) setState(() => _error = e);
      });
    }
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(adminApiProvider).verifyTotp(_code.text.trim());
      ref.read(adminSessionProvider.notifier).set(AdminSessionState.ready);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.mfaTitle)),
      body: ListView(padding: const EdgeInsetsDirectional.all(16), children: [
        if (_secret != null) ...[
          Text(t.mfaEnrollHint),
          const SizedBox(height: 8),
          SelectableText(_secret!, key: const Key('totp-secret'), style: const TextStyle(fontFamily: 'monospace', fontSize: 16)),
          const SizedBox(height: 16),
        ],
        Text(t.mfaEnterCode),
        const SizedBox(height: 8),
        TextField(
          key: const Key('totp'),
          controller: _code,
          keyboardType: TextInputType.number,
          maxLength: 6,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          textDirection: TextDirection.ltr,
        ),
        if (_error != null) Text(apiErrorMessage(context, _error!), key: const Key('error'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
        const SizedBox(height: 8),
        FilledButton(key: const Key('verify'), onPressed: _busy ? null : _verify, child: Text(t.verify)),
      ]),
    );
  }
}

/// Fresh 2FA prompt for sensitive actions. Returns true when the server accepted the code (valid 10 minutes).
Future<bool> promptStepUp(BuildContext context, WidgetRef ref) async {
  final t = EdmnLocalizations.of(context);
  final code = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(t.mfaTitle),
      content: TextField(key: const Key('step-up-code'), controller: code, keyboardType: TextInputType.number, maxLength: 6, textDirection: TextDirection.ltr, decoration: InputDecoration(helperText: t.mfaEnterCode)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
        FilledButton(key: const Key('step-up-confirm'), onPressed: () => Navigator.pop(c, true), child: Text(t.verify)),
      ],
    ),
  );
  if (ok != true) return false;
  try {
    await ref.read(adminApiProvider).stepUp(code.text.trim());
    return true;
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(context, e))));
    return false;
  }
}
