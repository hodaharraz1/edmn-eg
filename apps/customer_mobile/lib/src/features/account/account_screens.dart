import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/ui.dart';
import '../../providers.dart';
import '../cart/cart_providers.dart';
import '../orders/order_providers.dart';

/// Board "حسابي": profile header and the grouped menu. Signed-out users see the sign-in prompt.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final signedIn = ref.watch(signedInProvider);
    final profile = ref.watch(profileProvider);
    final en = languageOf(context) == 'en';
    Widget languageRow() => EdmnMenuItem(
          key: const Key('menu-language'),
          icon: Icons.translate_rounded,
          title: t.language,
          trailing: Text(en ? 'English' : 'العربية', style: EdmnType.bodyStrong.copyWith(color: EdmnColors.primary)),
          onTap: () => ref.read(localeProvider.notifier).set(en ? EdmnLocales.arabic : EdmnLocales.english),
        );
    return EdmnAppScaffold(
      title: t.accountTitle,
      body: !signedIn
          ? ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
              EdmnEmptyState(icon: Icons.person_outline_rounded, title: t.signInPromptTitle, message: t.signInPromptBody, actionLabel: t.signIn, onAction: () => context.push('/sign-in?next=/account')),
              EdmnMenuGroup(children: [
                languageRow(),
                EdmnMenuItem(icon: Icons.info_outline_rounded, title: t.aboutEdmn, onTap: () => context.push('/legal/about')),
                EdmnMenuItem(icon: Icons.gavel_rounded, title: t.legal, onTap: () => context.push('/legal/terms')),
              ]),
            ])
          : AsyncView(
              value: profile,
              onRetry: () => ref.invalidate(profileProvider),
              data: (p) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
                if (p != null)
                  EdmnCard(
                    child: EdmnProfileHeader(name: p.fullName, phone: p.phone, editTooltip: t.edit, onEdit: () => context.push('/account/profile')),
                  ),
                if (p != null && (!p.phoneVerified || (p.email != null && !p.emailVerified))) ...[
                  const SizedBox(height: EdmnSpacing.sm),
                  EdmnNotice(
                    tone: EdmnTone.warning,
                    title: t.verifyTitle,
                    message: [if (!p.phoneVerified) t.verifyPhone, if (p.email != null && !p.emailVerified) t.verifyEmail].join(' · '),
                  ),
                ],
                const SizedBox(height: EdmnSpacing.md),
                EdmnMenuGroup(children: [
                  EdmnMenuItem(key: const Key('menu-profile'), icon: Icons.person_outline_rounded, title: t.personalInfo, onTap: () => context.push('/account/profile')),
                  EdmnMenuItem(key: const Key('menu-addresses'), icon: Icons.location_on_outlined, title: t.addressesTitle, onTap: () => context.push('/account/addresses')),
                  EdmnMenuItem(key: const Key('menu-payment-methods'), icon: Icons.credit_card_outlined, title: t.paymentMethods, onTap: () => context.push('/account/payment-methods')),
                  EdmnMenuItem(key: const Key('menu-wallet'), icon: Icons.account_balance_wallet_outlined, title: t.wallet, onTap: () => context.push('/wallet')),
                  EdmnMenuItem(key: const Key('menu-notifications'), icon: Icons.notifications_none_rounded, title: t.notifications, onTap: () => context.push('/notifications')),
                  EdmnMenuItem(key: const Key('menu-support'), icon: Icons.help_outline_rounded, title: t.helpSupport, onTap: () => context.push('/support')),
                  EdmnMenuItem(icon: Icons.info_outline_rounded, title: t.aboutEdmn, onTap: () => context.push('/legal/about')),
                ]),
                const SizedBox(height: EdmnSpacing.md),
                EdmnMenuGroup(children: [
                  EdmnMenuItem(key: const Key('menu-deals'), icon: Icons.verified_user_outlined, title: t.protectedDeal, onTap: () => context.push('/deals')),
                  EdmnMenuItem(key: const Key('menu-seller'), icon: Icons.storefront_outlined, title: t.sellerCenter, onTap: () => context.push('/seller')),
                ]),
                const SizedBox(height: EdmnSpacing.md),
                EdmnMenuGroup(children: [
                  languageRow(),
                  EdmnMenuItem(key: const Key('menu-security'), icon: Icons.lock_outline_rounded, title: t.security, onTap: () => context.push('/account/security')),
                  EdmnMenuItem(icon: Icons.gavel_rounded, title: t.legal, onTap: () => context.push('/legal/terms')),
                  EdmnMenuItem(
                    key: const Key('menu-sign-out'),
                    icon: Icons.logout_rounded,
                    title: t.signOut,
                    destructive: true,
                    trailing: const SizedBox(),
                    onTap: () async {
                      if (!await showEdmnConfirmation(context, title: t.signOut, message: t.signOutConfirm, confirmLabel: t.signOut, destructive: true)) return;
                      await ref.read(mobileApiProvider).logout().catchError((_) {});
                      ref.read(signedInProvider.notifier).set(false);
                      ref.invalidate(cartProvider);
                      ref.invalidate(ordersProvider);
                      if (context.mounted) context.go('/');
                    },
                  ),
                ]),
              ]),
            ),
    );
  }
}

/// Personal information: name (audited server update), phone/email with their verification state.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});
  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _name = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _busy = false;
  bool _filled = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final profile = ref.watch(profileProvider);
    return EdmnAppScaffold(
      title: t.personalInfo,
      bottomBar: EdmnPrimaryButton(
        key: const Key('save-profile'),
        label: t.save,
        loading: _busy,
        onPressed: () async {
          if (!_form.currentState!.validate()) return;
          setState(() => _busy = true);
          final ok = await runAction(context, () => ref.read(mobileApiProvider).updateMe(fullName: _name.text.trim()), success: t.saved);
          if (ok) ref.invalidate(profileProvider);
          if (mounted) setState(() => _busy = false);
        },
      ),
      body: AsyncView(
        value: profile,
        onRetry: () => ref.invalidate(profileProvider),
        data: (p) {
          if (p == null) return const SizedBox();
          if (!_filled) {
            _name.text = p.fullName;
            _filled = true;
          }
          Widget verifyRow(IconData icon, String value, bool verified, String channel) => EdmnCard(
                margin: const EdgeInsetsDirectional.only(top: EdmnSpacing.sm),
                padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
                child: Row(children: [
                  Icon(icon, color: EdmnColors.primary),
                  const SizedBox(width: EdmnSpacing.sm),
                  Expanded(child: Text(value, textDirection: TextDirection.ltr, textAlign: TextAlign.start, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary))),
                  verified
                      ? EdmnStatusChip(label: t.verified, tone: EdmnTone.success)
                      : TextButton(key: Key('verify-$channel'), onPressed: () => context.push('/verify?channel=$channel'), child: Text(t.verify)),
                ]),
              );
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            Form(
              key: _form,
              child: EdmnTextField(key: const Key('profile-name'), controller: _name, hint: t.fullNameHint, icon: Icons.person_outline_rounded, validator: (v) => (v ?? '').trim().length < 3 ? t.nameTooShort : null),
            ),
            if (p.phone != null) verifyRow(Icons.phone_outlined, p.phone!, p.phoneVerified, 'PHONE'),
            if (p.email != null) verifyRow(Icons.mail_outline_rounded, p.email!, p.emailVerified, 'EMAIL'),
          ]);
        },
      ),
    );
  }
}

/// Security: change password (signs out other devices; this one gets new tokens) and the device list.
class SecurityScreen extends ConsumerStatefulWidget {
  const SecurityScreen({super.key});
  @override
  ConsumerState<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends ConsumerState<SecurityScreen> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnAppScaffold(
      title: t.security,
      body: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
        Text(t.changePassword, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
        const SizedBox(height: EdmnSpacing.sm),
        Form(
          key: _form,
          child: Column(children: [
            EdmnTextField(key: const Key('current-password'), controller: _current, hint: t.currentPasswordHint, icon: Icons.lock_outline_rounded, obscure: true, validator: (v) => (v ?? '').isEmpty ? t.fieldRequired : null),
            const SizedBox(height: EdmnSpacing.sm),
            EdmnTextField(key: const Key('new-password'), controller: _next, hint: t.newPasswordHint, icon: Icons.lock_reset_rounded, obscure: true, validator: (v) => (v ?? '').length < 8 ? t.passwordTooShort : null),
          ]),
        ),
        const SizedBox(height: EdmnSpacing.md),
        EdmnPrimaryButton(
          key: const Key('change-password'),
          label: t.changePassword,
          loading: _busy,
          onPressed: () async {
            if (!_form.currentState!.validate()) return;
            setState(() => _busy = true);
            final ok = await runAction(context, () => ref.read(mobileApiProvider).changePassword(current: _current.text, next: _next.text), success: t.passwordChanged);
            if (ok) {
              _current.clear();
              _next.clear();
            }
            if (mounted) setState(() => _busy = false);
          },
        ),
        const SizedBox(height: EdmnSpacing.lg),
        EdmnMenuGroup(children: [EdmnMenuItem(key: const Key('menu-devices'), icon: Icons.devices_outlined, title: t.devices, onTap: () => context.push('/account/devices'))]),
      ]),
    );
  }
}

final addressesProvider = FutureProvider<List<Address>>((ref) => ref.watch(mobileApiProvider).addresses());

class AddressesScreen extends ConsumerWidget {
  const AddressesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final list = ref.watch(addressesProvider);
    final govs = ref.watch(governoratesProvider).value ?? const [];
    String govName(int id) {
      final g = govs.where((g) => g.id == id).firstOrNull;
      return g == null ? '' : (languageOf(context) == 'en' ? g.nameEn : g.nameAr);
    }

    return EdmnAppScaffold(
      title: t.addressesTitle,
      bottomBar: EdmnPrimaryButton(key: const Key('new-address'), label: t.addAddress, icon: Icons.add_location_alt_outlined, onPressed: () => context.push('/account/addresses/new')),
      body: AsyncView(
        value: list,
        skeleton: true,
        onRetry: () => ref.invalidate(addressesProvider),
        data: (items) => items.isEmpty
            ? EdmnEmptyState(icon: Icons.location_off_outlined, title: t.noAddressesTitle)
            : ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
                for (final a in items)
                  EdmnCard(
                    key: Key('address-${a.id}'),
                    margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
                    onTap: () => context.push('/account/addresses/${a.id}', extra: a),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Icon(Icons.location_on_outlined, color: EdmnColors.primary),
                      const SizedBox(width: EdmnSpacing.sm),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text(a.label ?? a.recipientName, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w700))),
                            if (a.isDefault) EdmnStatusChip(label: t.defaultAddress, tone: EdmnTone.info),
                          ]),
                          Text('${a.recipientName} · ${a.phone}', style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                          Text('${a.street}، ${a.city}، ${govName(a.governorateId)}', style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                        ]),
                      ),
                    ]),
                  ),
              ]),
      ),
    );
  }
}

/// Create / edit an address. Governorates come from the database. Returns the new id when created.
class AddressFormScreen extends ConsumerStatefulWidget {
  const AddressFormScreen({super.key, this.address});
  final Address? address;
  @override
  ConsumerState<AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends ConsumerState<AddressFormScreen> {
  final _form = GlobalKey<FormState>();
  late final _c = {
    for (final k in ['label', 'recipient', 'phone', 'city', 'district', 'street', 'building', 'floor', 'apartment', 'landmark']) k: TextEditingController(),
  };
  int? _gov;
  bool _default = false;
  bool _busy = false;
  final _intent = IntentKey();

  @override
  void initState() {
    super.initState();
    final a = widget.address;
    if (a != null) {
      _c['label']!.text = a.label ?? '';
      _c['recipient']!.text = a.recipientName;
      _c['phone']!.text = a.phone;
      _c['city']!.text = a.city;
      _c['district']!.text = a.district ?? '';
      _c['street']!.text = a.street;
      _c['building']!.text = a.building ?? '';
      _c['floor']!.text = a.floor ?? '';
      _c['apartment']!.text = a.apartment ?? '';
      _c['landmark']!.text = a.landmark ?? '';
      _gov = a.governorateId;
      _default = a.isDefault;
    }
  }

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  String? _opt(String k) => _c[k]!.text.trim().isEmpty ? null : _c[k]!.text.trim();

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final govs = ref.watch(governoratesProvider);
    final editing = widget.address != null;
    String? req(String? v) => (v ?? '').trim().length < 2 ? t.fieldRequired : null;
    Widget field(String k, String hint, {IconData? icon, FormFieldValidator<String>? v, TextInputType? type, TextDirection? dir}) => Padding(
          padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
          child: EdmnTextField(key: Key('addr-$k'), controller: _c[k], hint: hint, icon: icon, validator: v, keyboardType: type, textDirection: dir),
        );
    return EdmnAppScaffold(
      title: editing ? t.edit : t.addAddress,
      actions: [
        if (editing)
          IconButton(
            key: const Key('delete-address'),
            tooltip: t.delete,
            color: EdmnColors.onPrimary,
            icon: const Icon(Icons.delete_outline_rounded),
            onPressed: () async {
              if (!await showEdmnConfirmation(context, title: t.delete, message: t.deleteAddressConfirm, confirmLabel: t.delete, destructive: true)) return;
              if (!context.mounted) return;
              final ok = await runAction(context, () => ref.read(mobileApiProvider).deleteAddress(widget.address!.id, idempotencyKey: _intent.value));
              ref.invalidate(addressesProvider);
              if (ok && context.mounted) context.pop();
            },
          ),
      ],
      bottomBar: EdmnPrimaryButton(
        key: const Key('save-address'),
        label: t.save,
        loading: _busy,
        onPressed: () async {
          if (!_form.currentState!.validate() || _gov == null) return;
          setState(() => _busy = true);
          final req = CreateAddressRequest(
            label: _opt('label'),
            recipientName: _c['recipient']!.text.trim(),
            phone: _c['phone']!.text.trim(),
            governorateId: _gov!,
            city: _c['city']!.text.trim(),
            district: _opt('district'),
            street: _c['street']!.text.trim(),
            building: _opt('building'),
            floor: _opt('floor'),
            apartment: _opt('apartment'),
            landmark: _opt('landmark'),
            isDefault: _default,
          );
          String? id;
          final ok = await runAction(context, () async {
            if (editing) {
              await ref.read(mobileApiProvider).updateAddress(widget.address!.id, req);
              id = widget.address!.id;
            } else {
              id = await ref.read(mobileApiProvider).createAddress(req, idempotencyKey: _intent.value);
            }
          }, success: t.saved);
          ref.invalidate(addressesProvider);
          if (mounted) setState(() => _busy = false);
          if (ok && context.mounted) context.pop(id);
        },
      ),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          field('label', t.addressLabelHint, icon: Icons.bookmark_border_rounded),
          field('recipient', t.recipientHint, icon: Icons.person_outline_rounded, v: req),
          field('phone', t.phoneOnlyHint, icon: Icons.phone_outlined, type: TextInputType.phone, dir: TextDirection.ltr, v: (v) => RegExp(r'^01[0125]\d{8}$').hasMatch((v ?? '').trim()) ? null : t.invalidPhone),
          Padding(
            padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
            child: govs.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => Text(apiErrorMessage(context, e), style: EdmnType.secondary.copyWith(color: EdmnColors.error)),
              data: (list) => DropdownButtonFormField<int>(
                key: const Key('addr-governorate'),
                initialValue: _gov,
                isExpanded: true,
                decoration: InputDecoration(hintText: t.governorate, prefixIcon: const Icon(Icons.map_outlined)),
                validator: (v) => v == null ? t.fieldRequired : null,
                items: [for (final g in list) DropdownMenuItem(value: g.id, child: Text(languageOf(context) == 'en' ? g.nameEn : g.nameAr))],
                onChanged: (v) => setState(() => _gov = v),
              ),
            ),
          ),
          field('city', t.cityHint, icon: Icons.location_city_outlined, v: req),
          field('district', t.districtHint),
          field('street', t.streetHint, icon: Icons.signpost_outlined, v: (v) => (v ?? '').trim().length < 3 ? t.fieldRequired : null),
          Row(children: [
            Expanded(child: field('building', t.buildingHint)),
            const SizedBox(width: EdmnSpacing.xs),
            Expanded(child: field('floor', t.floorHint)),
            const SizedBox(width: EdmnSpacing.xs),
            Expanded(child: field('apartment', t.apartmentHint)),
          ]),
          field('landmark', t.landmarkHint),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _default,
            title: Text(t.defaultAddress, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
            onChanged: (v) => setState(() => _default = v),
          ),
        ]),
      ),
    );
  }
}

/// Legal / about pages from the content API (approved documents only).
final legalProvider = FutureProvider.family<LegalDocument, String>((ref, slug) => ref.watch(mobileApiProvider).legalDocument(slug));

class LegalScreen extends ConsumerWidget {
  const LegalScreen({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final doc = ref.watch(legalProvider(slug));
    return EdmnAppScaffold(
      title: doc.value?.title ?? EdmnLocalizations.of(context).legal,
      body: AsyncView(
        value: doc,
        onRetry: () => ref.invalidate(legalProvider(slug)),
        data: (d) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          Text(d.body, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
        ]),
      ),
    );
  }
}

/// A service whose mobile API is not built yet. It says so plainly — it never shows a fake balance, list or button
/// that pretends to work. Each use is listed in docs/mobile/SCREEN_INVENTORY.md as NOT DONE.
class NotYetAvailableScreen extends StatelessWidget {
  const NotYetAvailableScreen({super.key, required this.title, required this.icon});
  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnAppScaffold(
      title: title,
      body: EdmnEmptyState(key: const Key('not-yet-available'), icon: icon, title: t.comingFromServer, message: t.notAvailableYetBody),
    );
  }
}

/// Payment methods: the methods are chosen per order at checkout (manual transfer); no card is ever stored.
class PaymentMethodsScreen extends ConsumerWidget {
  const PaymentMethodsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final quote = ref.watch(_methodsProvider);
    final en = languageOf(context) == 'en';
    return EdmnAppScaffold(
      title: t.paymentMethods,
      body: AsyncView(
        value: quote,
        onRetry: () => ref.invalidate(_methodsProvider),
        data: (q) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          EdmnNotice(message: t.paymentMethodsNote),
          const SizedBox(height: EdmnSpacing.sm),
          EdmnMenuGroup(children: [
            for (final m in q.paymentMethods) EdmnMenuItem(icon: Icons.account_balance_outlined, title: en ? m.nameEn : m.nameAr, subtitle: m.instructionsAr, trailing: const SizedBox()),
          ]),
        ]),
      ),
    );
  }
}

final _methodsProvider = FutureProvider<Checkout>((ref) => ref.watch(mobileApiProvider).checkout());
