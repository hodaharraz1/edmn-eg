import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';
import '../auth/mfa_screen.dart';

/// Revoke every session of another account (lost device, compromise, offboarding). The server enforces the
/// permission, fresh 2FA, a written reason and "never yourself"; the app only asks for step-up when told to.
class RevokeUserSessionsScreen extends ConsumerStatefulWidget {
  const RevokeUserSessionsScreen({super.key});

  @override
  ConsumerState<RevokeUserSessionsScreen> createState() => _State();
}

class _State extends ConsumerState<RevokeUserSessionsScreen> {
  final _userId = TextEditingController();
  final _reason = TextEditingController();
  String? _idempotencyKey;
  String? _result;
  Object? _error;

  @override
  void dispose() {
    _userId.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit({bool afterStepUp = false}) async {
    // One key per intent: a retry after a dropped response replays instead of acting twice.
    _idempotencyKey ??= newIdempotencyKey();
    setState(() => _error = null);
    try {
      final n = await ref.read(adminApiProvider).revokeUserSessions(_userId.text.trim(), reason: _reason.text.trim(), idempotencyKey: _idempotencyKey!);
      setState(() {
        _result = EdmnLocalizations.of(context).signedOutOthers(n);
        _idempotencyKey = null;
      });
    } on ApiFailure catch (e) {
      if (e.code == ApiErrorCode.stepUpRequired && !afterStepUp && mounted) {
        _idempotencyKey = null; // the refused attempt stored nothing; a new attempt gets a new key
        if (await promptStepUp(context, ref)) return _submit(afterStepUp: true);
      }
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.signOutOtherDevices)),
      body: ListView(padding: const EdgeInsetsDirectional.all(16), children: [
        TextField(key: const Key('user-id'), controller: _userId, decoration: const InputDecoration(labelText: 'User ID'), textDirection: TextDirection.ltr),
        const SizedBox(height: 12),
        TextField(key: const Key('reason'), controller: _reason, decoration: const InputDecoration(labelText: 'السبب / Reason'), maxLines: 2),
        const SizedBox(height: 16),
        FilledButton(key: const Key('submit'), onPressed: _submit, child: Text(t.confirm)),
        if (_result != null) Padding(padding: const EdgeInsetsDirectional.only(top: 12), child: Text(_result!, key: const Key('result'))),
        if (_error != null) Padding(padding: const EdgeInsetsDirectional.only(top: 12), child: Text(apiErrorMessage(context, _error!), key: const Key('error'))),
      ]),
    );
  }
}
