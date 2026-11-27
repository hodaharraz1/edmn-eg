import 'dart:io' show Platform;

import 'package:edmn_api/admin.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers.dart';

class AdminSignInScreen extends ConsumerStatefulWidget {
  const AdminSignInScreen({super.key});

  @override
  ConsumerState<AdminSignInScreen> createState() => _State();
}

class _State extends ConsumerState<AdminSignInScreen> {
  final _form = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit({String? captchaToken}) async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref.read(adminApiProvider).login(
            identifier: _identifier.text.trim(),
            password: _password.text,
            device: DeviceInfo(
              installationId: await ref.read(sessionStoreProvider).installationId(),
              platform: !kIsWeb && Platform.isIOS ? 'IOS' : 'ANDROID',
              appVersion: ref.read(buildConfigProvider).appVersion,
            ),
            captchaToken: captchaToken,
          );
      ref.read(totpEnrolledProvider.notifier).set(r.mfa.enrolled);
      ref.read(adminSessionProvider.notifier).set(AdminSessionState.needsMfa);
    } catch (e) {
      // SEC-194: the server asks for a CAPTCHA only when its setting requires one. Show it, then retry the SAME sign-in
      // once with the token. A second refusal (or closing the challenge) shows the error instead of looping.
      if (e is ApiFailure && e.captchaRequired && captchaToken == null && mounted) {
        final token = await ref.read(captchaSolverProvider)(context, captchaPageUrl(ref.read(buildConfigProvider).apiBaseUrl));
        if (token != null && mounted) {
          await _submit(captchaToken: token);
          return;
        }
      }
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    String? required(String? v) => (v == null || v.trim().isEmpty) ? t.fieldRequired : null;
    return Scaffold(
      appBar: AppBar(title: Text(t.appNameAdmin)),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsetsDirectional.all(16), children: [
          TextFormField(key: const Key('identifier'), controller: _identifier, decoration: InputDecoration(labelText: t.identifierLabel), validator: required),
          const SizedBox(height: 12),
          TextFormField(key: const Key('password'), controller: _password, decoration: InputDecoration(labelText: t.passwordLabel), obscureText: true, validator: required),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(apiErrorMessage(context, _error!), key: const Key('error'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 16),
          FilledButton(key: const Key('submit'), onPressed: _busy ? null : _submit, child: Text(t.signIn)),
        ]),
      ),
    );
  }
}
