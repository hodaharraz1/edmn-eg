import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers.dart';

DeviceInfo deviceInfo(String installationId, String appVersion) => DeviceInfo(
      installationId: installationId,
      platform: defaultTargetPlatform == TargetPlatform.iOS ? 'IOS' : 'ANDROID',
      deviceName: null,
      appVersion: appVersion,
    );

/// Board "تسجيل الدخول": blue header with the original logo on a curved edge, white form below.
class AuthLayout extends StatelessWidget {
  const AuthLayout({super.key, required this.title, this.subtitle, required this.children, this.showBack = false});
  final String title;
  final String? subtitle;
  final List<Widget> children;
  final bool showBack;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: EdmnColors.surface,
        body: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ClipPath(
              clipper: _CurveClipper(),
              child: DecoratedBox(
                decoration: const BoxDecoration(gradient: EdmnColors.headerGradient),
                child: SafeArea(
                  bottom: false,
                  child: Padding(
                    padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.xs, 0, EdmnSpacing.xs, EdmnSpacing.xxl + EdmnSpacing.md),
                    child: Column(children: [
                      Align(alignment: AlignmentDirectional.centerStart, child: showBack ? const EdmnBackButton() : const SizedBox(height: EdmnSizes.minTouch)),
                      EdmnMarketLockup(marketLabel: t.marketLabel, height: 110),
                    ]),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(EdmnSpacing.xl, EdmnSpacing.xs, EdmnSpacing.xl, EdmnSpacing.xl),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(title, textAlign: TextAlign.center, style: EdmnType.section.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800)),
                if (subtitle != null) ...[
                  const SizedBox(height: EdmnSpacing.xs),
                  Text(subtitle!, textAlign: TextAlign.center, style: EdmnType.body.copyWith(color: EdmnColors.textSecondary)),
                ],
                const SizedBox(height: EdmnSpacing.xl),
                ...children,
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

class _CurveClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size s) => Path()
    ..lineTo(0, s.height - 40)
    ..quadraticBezierTo(s.width * 0.25, s.height - 70, s.width * 0.6, s.height - 30)
    ..quadraticBezierTo(s.width * 0.85, s.height, s.width, s.height - 50)
    ..lineTo(s.width, 0)
    ..close();
  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}

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
      final store = ref.read(sessionStoreProvider);
      await ref.read(mobileApiProvider).login(identifier: _identifier.text.trim(), password: _password.text, device: deviceInfo(await store.installationId(), ref.read(buildConfigProvider).appVersion));
      ref.read(signedInProvider.notifier).set(true);
      ref.invalidate(profileProvider);
      // Push token registration (PKG-PUSH-01): no-op until a push SDK is wired — the default provider has no token.
      final api = ref.read(mobileApiProvider);
      await PushTokenRegistrar(register: (t, k) => api.registerPushToken(token: t, idempotencyKey: k), unregister: (k) => api.unregisterPushToken(idempotencyKey: k)).registerIfAvailable(newIdempotencyKey);
      if (!mounted) return;
      // Land on home first and open the requested page on top of it, so that page always has a back arrow
      // (a plain go(next) left it as the only page: no way back to the store).
      final next = widget.next;
      const tabs = {'/', '/categories', '/wallet', '/cart', '/orders'};
      if (next != null && tabs.contains(next)) {
        context.go(next); // a main tab: open it directly (the bottom bar is the way around)
      } else {
        context.go('/');
        if (next != null && next.isNotEmpty) context.push(next);
      }
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
    return AuthLayout(
      title: t.welcomeTitle,
      subtitle: t.welcomeSubtitle,
      showBack: context.canPop(),
      children: [
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              EdmnTextField(
                key: const Key('identifier'),
                controller: _identifier,
                hint: t.phoneHint,
                icon: Icons.phone_outlined,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.username, AutofillHints.telephoneNumber],
                validator: required,
              ),
              const SizedBox(height: EdmnSpacing.sm),
              EdmnTextField(
                key: const Key('password'),
                controller: _password,
                hint: t.passwordLabel,
                icon: Icons.lock_outline_rounded,
                obscure: true,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.password],
                validator: required,
                onSubmitted: (_) => _submit(),
              ),
            ]),
          ),
        ),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(key: const Key('forgot'), onPressed: () => context.push('/forgot-password'), child: Text(t.forgotPassword)),
        ),
        if (_error != null) ...[
          EdmnNotice(message: apiErrorMessage(context, _error!), tone: EdmnTone.danger),
          const SizedBox(height: EdmnSpacing.sm),
        ],
        EdmnPrimaryButton(key: const Key('sign-in'), label: t.signIn, loading: _busy, onPressed: _submit),
        const SizedBox(height: EdmnSpacing.lg),
        Row(children: [
          const Expanded(child: Divider()),
          Padding(padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.sm), child: Text(t.or, style: EdmnType.body.copyWith(color: EdmnColors.textSecondary))),
          const Expanded(child: Divider()),
        ]),
        const SizedBox(height: EdmnSpacing.md),
        // Apple / Google sign-in (board) are not offered: the backend has no social login. Recorded in VISUAL_AUDIT.md
        // instead of showing buttons that cannot work.
        EdmnSecondaryButton(key: const Key('guest'), label: t.continueAsGuest, onPressed: () => context.go('/')),
        const SizedBox(height: EdmnSpacing.md),
        Wrap(alignment: WrapAlignment.center, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text(t.noAccount, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
          TextButton(key: const Key('to-register'), onPressed: () => context.push('/register'), child: Text(t.createAccount)),
        ]),
      ],
    );
  }
}

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});
  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _marketingConsent = false; // marketing consent is OFF by default (PKG-PRIVACY-01)
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    for (final c in [_name, _phone, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final store = ref.read(sessionStoreProvider);
      await ref.read(mobileApiProvider).register(
            fullName: _name.text.trim(),
            phone: _phone.text.trim(),
            email: _email.text.trim(),
            password: _password.text,
            marketingConsent: _marketingConsent,
            device: deviceInfo(await store.installationId(), ref.read(buildConfigProvider).appVersion),
          );
      ref.read(signedInProvider.notifier).set(true);
      ref.invalidate(profileProvider);
      if (mounted) context.go('/verify?channel=PHONE');
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return AuthLayout(
      title: t.registerTitle,
      showBack: true,
      children: [
        Form(
          key: _form,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            EdmnTextField(key: const Key('reg-name'), controller: _name, hint: t.fullNameHint, icon: Icons.person_outline_rounded, textInputAction: TextInputAction.next, validator: (v) => (v ?? '').trim().length < 3 ? t.nameTooShort : null),
            const SizedBox(height: EdmnSpacing.sm),
            EdmnTextField(
              key: const Key('reg-phone'),
              controller: _phone,
              hint: t.phoneOnlyHint,
              icon: Icons.phone_outlined,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              textInputAction: TextInputAction.next,
              validator: (v) => RegExp(r'^01[0125]\d{8}$').hasMatch((v ?? '').trim()) ? null : t.invalidPhone,
            ),
            const SizedBox(height: EdmnSpacing.sm),
            EdmnTextField(
              key: const Key('reg-email'),
              controller: _email,
              hint: t.emailHint,
              icon: Icons.mail_outline_rounded,
              keyboardType: TextInputType.emailAddress,
              textDirection: TextDirection.ltr,
              textInputAction: TextInputAction.next,
              validator: (v) => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch((v ?? '').trim()) ? null : t.fieldRequired,
            ),
            const SizedBox(height: EdmnSpacing.sm),
            EdmnTextField(key: const Key('reg-password'), controller: _password, hint: t.newPasswordHint, icon: Icons.lock_outline_rounded, obscure: true, validator: (v) => (v ?? '').length < 8 ? t.passwordTooShort : null),
            CheckboxListTile(
              key: const Key('reg-marketing-consent'),
              contentPadding: EdgeInsets.zero,
              value: _marketingConsent,
              onChanged: (v) => setState(() => _marketingConsent = v ?? false),
              title: Text(t.marketingConsentLabel, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
            ),
          ]),
        ),
        const SizedBox(height: EdmnSpacing.sm),
        Text(t.acceptTerms, textAlign: TextAlign.center, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
        TextButton(onPressed: () => context.push('/legal/terms'), child: Text(t.legal)),
        if (_error != null) ...[EdmnNotice(message: apiErrorMessage(context, _error!), tone: EdmnTone.danger), const SizedBox(height: EdmnSpacing.sm)],
        EdmnPrimaryButton(key: const Key('register'), label: t.createAccount, loading: _busy, onPressed: _submit),
        const SizedBox(height: EdmnSpacing.sm),
        Wrap(alignment: WrapAlignment.center, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text(t.haveAccount, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
          TextButton(onPressed: () => context.pop(), child: Text(t.signIn)),
        ]),
      ],
    );
  }
}

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});
  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _identifier = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  Object? _error;

  @override
  void dispose() {
    _identifier.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return AuthLayout(
      title: t.forgotTitle,
      subtitle: t.forgotBody,
      showBack: true,
      children: [
        if (_sent)
          ...[
            EdmnNotice(key: const Key('reset-sent'), message: t.resetLinkSent, tone: EdmnTone.success),
            const SizedBox(height: EdmnSpacing.sm),
            EdmnSecondaryButton(key: const Key('have-reset-link'), label: t.haveResetLink, icon: Icons.link_rounded, onPressed: () => context.push('/reset-password')),
          ]
        else ...[
          EdmnTextField(key: const Key('forgot-identifier'), controller: _identifier, hint: t.phoneHint, icon: Icons.phone_outlined, keyboardType: TextInputType.emailAddress),
          const SizedBox(height: EdmnSpacing.md),
          if (_error != null) ...[EdmnNotice(message: apiErrorMessage(context, _error!), tone: EdmnTone.danger), const SizedBox(height: EdmnSpacing.sm)],
          EdmnPrimaryButton(
            key: const Key('send-reset'),
            label: t.sendResetLink,
            loading: _busy,
            onPressed: () async {
              if (_identifier.text.trim().length < 3) return;
              setState(() {
                _busy = true;
                _error = null;
              });
              try {
                await ref.read(mobileApiProvider).forgotPassword(_identifier.text.trim());
                setState(() => _sent = true);
              } catch (e) {
                setState(() => _error = e);
              } finally {
                if (mounted) setState(() => _busy = false);
              }
            },
          ),
        ],
      ],
    );
  }
}

/// OTP verification of the phone or email (6 digits, resend with cooldown, expired / wrong code errors from the server).
class VerifyScreen extends ConsumerStatefulWidget {
  const VerifyScreen({super.key, required this.channel});
  final String channel;
  @override
  ConsumerState<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends ConsumerState<VerifyScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  bool _sending = false;
  int _cooldown = 0;
  Object? _error;
  bool _sentOnce = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(mobileApiProvider).sendVerificationCode(widget.channel);
      _sentOnce = true;
      if (mounted) showEdmnMessage(context, EdmnLocalizations.of(context).codeSent);
      setState(() => _cooldown = 60);
      _tick();
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _tick() => Future.delayed(const Duration(seconds: 1), () {
        if (!mounted || _cooldown <= 0) return;
        setState(() => _cooldown--);
        _tick();
      });

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final phone = widget.channel == 'PHONE';
    return AuthLayout(
      title: t.verifyTitle,
      subtitle: phone ? t.verifyPhoneBody : t.verifyEmailBody,
      showBack: true,
      children: [
        EdmnTextField(
          key: const Key('otp'),
          controller: _code,
          hint: t.codeHint,
          icon: Icons.pin_outlined,
          keyboardType: TextInputType.number,
          textDirection: TextDirection.ltr,
          maxLength: 6,
        ),
        const SizedBox(height: EdmnSpacing.md),
        if (_error != null) ...[EdmnNotice(message: apiErrorMessage(context, _error!), tone: EdmnTone.danger), const SizedBox(height: EdmnSpacing.sm)],
        EdmnPrimaryButton(
          key: const Key('verify'),
          label: t.verify,
          loading: _busy,
          onPressed: () async {
            if (!RegExp(r'^\d{6}$').hasMatch(_code.text.trim())) {
              setState(() => _error = const ApiFailure(code: ApiErrorCode.validationFailed));
              return;
            }
            setState(() {
              _busy = true;
              _error = null;
            });
            try {
              await ref.read(mobileApiProvider).confirmVerificationCode(widget.channel, _code.text.trim());
              ref.invalidate(profileProvider);
              if (context.mounted) {
                showEdmnMessage(context, t.verified);
                context.canPop() ? context.pop() : context.go('/');
              }
            } catch (e) {
              setState(() => _error = e);
            } finally {
              if (mounted) setState(() => _busy = false);
            }
          },
        ),
        const SizedBox(height: EdmnSpacing.sm),
        TextButton(
          key: const Key('resend'),
          onPressed: _sending || _cooldown > 0 ? null : _send,
          child: Text(_cooldown > 0 ? t.resendIn(_cooldown) : (_sentOnce ? t.resendCode : t.sendCode)),
        ),
        TextButton(onPressed: () => context.go('/'), child: Text(t.skip)),
      ],
    );
  }
}
