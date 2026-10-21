import 'dart:io' show Platform;

import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers.dart';

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key, this.next});
  final String? next;

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
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

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = ref.read(mobileApiProvider);
      final installationId = await ref.read(sessionStoreProvider).installationId();
      await api.login(
        identifier: _identifier.text.trim(),
        password: _password.text,
        device: DeviceInfo(
          installationId: installationId,
          platform: !kIsWeb && Platform.isIOS ? 'IOS' : 'ANDROID',
          appVersion: ref.read(buildConfigProvider).appVersion,
        ),
      );
      ref.read(signedInProvider.notifier).set(true);
      if (mounted) context.go(widget.next ?? '/');
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    String? required(String? v) => (v == null || v.trim().isEmpty) ? t.fieldRequired : null;
    return Scaffold(
      appBar: AppBar(title: Text(t.signIn)),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsetsDirectional.all(16), children: [
          TextFormField(
            key: const Key('identifier'),
            controller: _identifier,
            decoration: InputDecoration(labelText: t.identifierLabel),
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username],
            validator: required,
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('password'),
            controller: _password,
            decoration: InputDecoration(labelText: t.passwordLabel),
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            validator: required,
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(apiErrorMessage(context, _error!), key: const Key('sign-in-error'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 16),
          FilledButton(key: const Key('submit'), onPressed: _busy ? null : _submit, child: Text(t.signIn)),
        ]),
      ),
    );
  }
}
