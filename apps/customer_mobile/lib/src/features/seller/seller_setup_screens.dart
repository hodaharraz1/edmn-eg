import 'package:edmn_api/mobile.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/file_pick.dart';
import '../../common/governorate_field.dart';
import '../../common/ui.dart';
import '../../providers.dart';
import '../catalog/catalog_providers.dart';
import 'seller_screens.dart';

/// Seller setup screens: identity (KYC), seller application wizard, product editor, shipping rates, store settings
/// and payout REQUESTS. Every form posts to the server, which validates and decides; the app only shows results.

final identityProvider = FutureProvider<IdentityStatus>((ref) => ref.watch(mobileApiProvider).myIdentity());
final applicationProvider = FutureProvider<SellerApplication>((ref) => ref.watch(mobileApiProvider).sellerApplication());
final sellerProductEditorProvider = FutureProvider.family<SellerProductEditor, String>((ref, id) => ref.watch(mobileApiProvider).sellerProduct(id));
final shippingRatesProvider = FutureProvider<GetSellerShippingRatesResponse>((ref) => ref.watch(mobileApiProvider).shippingRates());
final storeSettingsProvider = FutureProvider<SellerStoreSettings>((ref) => ref.watch(mobileApiProvider).storeSettings());
final payoutRequestsProvider = FutureProvider<ListSellerPayoutRequestsResponse>((ref) => ref.watch(mobileApiProvider).payoutRequests());

String identityLabel(EdmnLocalizations t, String s) => switch (s) {
      'APPROVED' => t.idApproved,
      'PENDING_REVIEW' => t.idPending,
      'MORE_INFO_REQUIRED' || 'REVERIFICATION_REQUIRED' => t.idMoreInfo,
      'REJECTED' => t.idRejected,
      _ => t.idIncomplete,
    };

EdmnTone identityTone(String s) => switch (s) {
      'APPROVED' => EdmnTone.success,
      'PENDING_REVIEW' => EdmnTone.warning,
      'REJECTED' => EdmnTone.danger,
      _ => EdmnTone.info,
    };

/// Section title used inside forms.
Widget _section(String title) => Padding(
      padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.lg, bottom: EdmnSpacing.xs),
      child: Text(title, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
    );

Widget _gap() => const SizedBox(height: EdmnSpacing.sm);

/* ───────────────────────── S03 / identity (KYC) ───────────────────────── */

class IdentityScreen extends ConsumerStatefulWidget {
  const IdentityScreen({super.key});
  @override
  ConsumerState<IdentityScreen> createState() => _IdentityScreenState();
}

class _IdentityScreenState extends ConsumerState<IdentityScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _nid = TextEditingController();
  final _intent = IntentKey();
  PickedFile? _front;
  PickedFile? _back;
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _nid.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final id = ref.watch(identityProvider);
    return EdmnAppScaffold(
      title: t.identityTitle,
      body: AsyncView(
        value: id,
        onRetry: () => ref.invalidate(identityProvider),
        data: (s) {
          final canSubmit = const {'INCOMPLETE', 'MORE_INFO_REQUIRED', 'REVERIFICATION_REQUIRED'}.contains(s.status);
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            EdmnNotice(
              key: const Key('identity-status'),
              title: identityLabel(t, s.status),
              message: s.reason ?? (s.last4 == null ? t.identityWhy : t.identityLast4(s.last4!)),
              tone: identityTone(s.status),
            ),
            if (canSubmit)
              Form(
                key: _form,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  _section(t.identityTitle),
                  EdmnTextField(key: const Key('id-name'), controller: _name, hint: t.legalNameHint, icon: Icons.badge_outlined, validator: (v) => (v ?? '').trim().split(RegExp(r'\s+')).length < 3 ? t.legalNameHint : null),
                  _gap(),
                  EdmnTextField(
                    key: const Key('id-number'),
                    controller: _nid,
                    hint: t.nationalIdHint,
                    icon: Icons.pin_outlined,
                    keyboardType: TextInputType.number,
                    textDirection: TextDirection.ltr,
                    maxLength: 14,
                    validator: (v) => RegExp(r'^\d{14}$').hasMatch((v ?? '').trim()) ? null : t.nationalIdHint,
                  ),
                  _gap(),
                  EdmnUploadField(label: t.idFront, hint: t.pickImage, fileName: _front?.name, onPick: () async => _set((f) => _front = f), onClear: () => setState(() => _front = null)),
                  _gap(),
                  EdmnUploadField(label: t.idBack, hint: t.pickImage, fileName: _back?.name, onPick: () async => _set((f) => _back = f), onClear: () => setState(() => _back = null)),
                  const SizedBox(height: EdmnSpacing.lg),
                  EdmnPrimaryButton(
                    key: const Key('id-submit'),
                    label: t.submitForReview,
                    loading: _busy,
                    onPressed: () async {
                      if (!_form.currentState!.validate()) return;
                      setState(() => _busy = true);
                      final ok = await runAction(
                        context,
                        () => ref.read(mobileApiProvider).submitIdentity(
                              legalName: _name.text.trim(),
                              nationalId: _nid.text.trim(),
                              front: _front == null ? null : (_front!.bytes, _front!.name),
                              back: _back == null ? null : (_back!.bytes, _back!.name),
                              idempotencyKey: _intent.value,
                            ),
                        success: t.sentForReview,
                      );
                      if (ok) {
                        _intent.reset();
                        ref.invalidate(identityProvider);
                        ref.invalidate(applicationProvider);
                      }
                      if (mounted) setState(() => _busy = false);
                    },
                  ),
                ]),
              ),
          ]);
        },
      ),
    );
  }

  Future<void> _set(void Function(PickedFile) assign) async {
    final f = await ref.read(filePickerProvider).pick(allowPdf: false);
    if (f != null) setState(() => assign(f));
  }
}

/* ───────────────────────── S01–S07 seller application ───────────────────────── */

class SellerApplicationScreen extends ConsumerWidget {
  const SellerApplicationScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final a = ref.watch(applicationProvider);
    return EdmnAppScaffold(
      title: t.becomeSeller,
      body: AsyncView(
        value: a,
        onRetry: () => ref.invalidate(applicationProvider),
        data: (app) => RefreshIndicator(
          onRefresh: () => ref.refresh(applicationProvider.future),
          child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            if (app.seller == null) ...[
              EdmnNotice(title: t.becomeSeller, message: t.becomeSellerBody),
              _gap(),
              _StartChoice(),
            ] else ...[
              EdmnCard(
                child: Row(children: [
                  Expanded(child: Text(app.seller!.store?.name ?? t.becomeSeller, style: EdmnType.cardTitle.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800))),
                  EdmnStatusChip(label: sellerStatusLabel(t, app.seller!.status), tone: app.seller!.status == 'APPROVED' ? EdmnTone.success : (app.seller!.status == 'REJECTED' ? EdmnTone.danger : EdmnTone.warning)),
                ]),
              ),
              if (app.seller!.statusReason != null) ...[_gap(), EdmnNotice(message: app.seller!.statusReason!, tone: EdmnTone.warning)],
              _section(t.checklist),
              EdmnMenuGroup(children: [
                EdmnMenuItem(
                  key: const Key('app-identity-kyc'),
                  icon: app.identity.status == 'APPROVED' ? Icons.check_circle_rounded : Icons.badge_outlined,
                  title: t.identityTitle,
                  subtitle: identityLabel(t, app.identity.status),
                  onTap: () => context.push('/account/identity'),
                ),
                for (final c in app.checklist)
                  EdmnMenuItem(
                    key: Key('app-${c.key}'),
                    icon: c.ok ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
                    title: c.label,
                    onTap: app.seller!.editable ? () => _openStep(context, ref, app, c.key) : null,
                  ),
              ]),
              if (app.seller!.editable) ...[
                const SizedBox(height: EdmnSpacing.lg),
                EdmnNotice(message: t.sellerTermsNote, icon: Icons.gavel_rounded),
                _gap(),
                _SubmitApplication(ready: app.checklist.every((c) => c.ok) && app.identity.status == 'APPROVED'),
              ],
              if (app.seller!.status == 'APPROVED') ...[
                const SizedBox(height: EdmnSpacing.lg),
                EdmnPrimaryButton(label: t.sellerCenter, onPressed: () => context.go('/seller')),
              ],
            ],
          ]),
        ),
      ),
    );
  }

  void _openStep(BuildContext context, WidgetRef ref, SellerApplication app, String key) {
    final t = EdmnLocalizations.of(context);
    final s = app.seller!;
    switch (key) {
      case 'identity':
      case 'mobile':
      case 'email':
        showEdmnBottomSheet(context, title: t.ownerDetails, child: _OwnerForm(seller: s));
      case 'business':
        showEdmnBottomSheet(context, title: t.businessDetails, child: _BusinessForm(seller: s));
      case 'store':
        showEdmnBottomSheet(context, title: t.storeDetails, child: _StoreForm(seller: s));
      case 'payout':
        showEdmnBottomSheet(context, title: t.payoutAccount, child: const _PayoutAccountForm());
      default:
        showEdmnBottomSheet(context, title: t.documents, child: _DocumentUpload(kind: _docKind(key)));
    }
  }

  String _docKind(String key) => switch (key) {
        'id_front' => 'NATIONAL_ID_FRONT',
        'id_back' => 'NATIONAL_ID_BACK',
        _ => key,
      };
}

class _StartChoice extends ConsumerStatefulWidget {
  @override
  ConsumerState<_StartChoice> createState() => _StartChoiceState();
}

class _StartChoiceState extends ConsumerState<_StartChoice> {
  String _type = 'INDIVIDUAL';
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      EdmnRadioCard<String>(
        value: _type,
        onChanged: (v) => setState(() => _type = v),
        options: [
          EdmnRadioOption(value: 'INDIVIDUAL', label: t.sellerIndividual, icon: Icons.person_outline_rounded),
          EdmnRadioOption(value: 'BUSINESS', label: t.sellerBusiness, icon: Icons.business_outlined),
        ],
      ),
      const SizedBox(height: EdmnSpacing.md),
      EdmnPrimaryButton(
        key: const Key('start-application'),
        label: t.startApplication,
        loading: _busy,
        onPressed: () async {
          setState(() => _busy = true);
          await runAction(context, () => ref.read(mobileApiProvider).startSellerApplication(_type));
          ref.invalidate(applicationProvider);
          if (mounted) setState(() => _busy = false);
        },
      ),
    ]);
  }
}

class _SubmitApplication extends ConsumerStatefulWidget {
  const _SubmitApplication({required this.ready});
  final bool ready;
  @override
  ConsumerState<_SubmitApplication> createState() => _SubmitApplicationState();
}

class _SubmitApplicationState extends ConsumerState<_SubmitApplication> {
  final _intent = IntentKey();
  bool _accepted = false;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      CheckboxListTile(
        key: const Key('accept-agreement'),
        contentPadding: EdgeInsets.zero,
        value: _accepted,
        onChanged: (v) => setState(() => _accepted = v ?? false),
        title: Text(t.acceptSellerAgreement, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
      ),
      TextButton(onPressed: () => context.push('/legal/seller-agreement'), child: Text(t.readAgreement)),
      if (!widget.ready) EdmnNotice(message: t.applicationIncomplete, tone: EdmnTone.warning),
      _gap(),
      EdmnPrimaryButton(
        key: const Key('submit-application'),
        label: t.submitForReview,
        loading: _busy,
        onPressed: !_accepted || !widget.ready
            ? null
            : () async {
                setState(() => _busy = true);
                final ok = await runAction(context, () => ref.read(mobileApiProvider).submitSellerApplication(idempotencyKey: _intent.value), success: t.sentForReview);
                if (ok) _intent.reset();
                ref.invalidate(applicationProvider);
                ref.invalidate(sellerMembershipProvider);
                if (mounted) setState(() => _busy = false);
              },
      ),
    ]);
  }
}

/// Generic bottom-sheet form: fields + save; closes on success and refreshes the application.
class _SheetForm extends ConsumerStatefulWidget {
  const _SheetForm({super.key, required this.fields, required this.save, this.extra = const [], this.governorate});
  final List<(String key, String hint, String initial, bool required, TextInputType? type)> fields;
  final Future<void> Function(Map<String, String> values) save;
  final List<Widget> extra;

  /// A governorate picked from the database list (field key, current id). Sent as the id, never as typed text.
  final (String key, int? initial)? governorate;
  @override
  ConsumerState<_SheetForm> createState() => _SheetFormState();
}

class _SheetFormState extends ConsumerState<_SheetForm> {
  /// Phone numbers, e-mails, IDs and numbers are typed and shown left-to-right even in Arabic (+2011… not …2011+).
  TextDirection? _ltr(String key, TextInputType? type) =>
      type == TextInputType.phone || type == TextInputType.emailAddress || type == TextInputType.number || const {'mobile', 'email', 'nationalId', 'supportPhone'}.contains(key) ? TextDirection.ltr : null;

  final _form = GlobalKey<FormState>();
  late final _c = {for (final f in widget.fields) f.$1: TextEditingController(text: f.$3)};
  late int? _gov = widget.governorate?.$2;
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
    return Form(
      key: _form,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final f in widget.fields) ...[
          EdmnTextField(key: Key('f-${f.$1}'), controller: _c[f.$1], hint: f.$2, keyboardType: f.$5, textDirection: _ltr(f.$1, f.$5), validator: f.$4 ? (v) => (v ?? '').trim().isEmpty ? t.fieldRequired : null : null),
          _gap(),
        ],
        if (widget.governorate != null) ...[
          GovernorateField(key: Key('f-${widget.governorate!.$1}'), value: _gov, onChanged: (v) => setState(() => _gov = v)),
          _gap(),
        ],
        ...widget.extra,
        EdmnPrimaryButton(
          key: const Key('sheet-save'),
          label: t.save,
          loading: _busy,
          onPressed: () async {
            if (!_form.currentState!.validate()) return;
            setState(() => _busy = true);
            final values = {for (final e in _c.entries) e.key: e.value.text.trim(), if (widget.governorate != null) widget.governorate!.$1: '$_gov'};
            final ok = await runAction(context, () => widget.save(values), success: t.saved);
            ref.invalidate(applicationProvider);
            if (mounted) setState(() => _busy = false);
            if (ok && context.mounted) Navigator.pop(context);
          },
        ),
      ]),
    );
  }
}

class _OwnerForm extends ConsumerWidget {
  const _OwnerForm({required this.seller});
  final SellerApplicationSeller seller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    return _SheetForm(
      fields: [
        ('legalName', t.legalNameHint, seller.legalName ?? '', true, null),
        ('nationalId', t.nationalIdHint, '', true, TextInputType.number),
        ('mobile', t.phoneOnlyHint, seller.mobile ?? '', true, TextInputType.phone),
        ('email', t.emailHint, seller.email ?? '', true, TextInputType.emailAddress),
        ('addressLine', t.streetHint, seller.addressLine ?? '', true, null),
        ('city', t.cityHint, seller.city ?? '', true, null),
      ],
      governorate: ('governorateId', seller.governorateId),
      save: (v) => ref.read(mobileApiProvider).saveApplicationIdentity({...v, 'type': seller.type, 'governorateId': int.parse(v['governorateId']!)}),
    );
  }
}

class _BusinessForm extends ConsumerWidget {
  const _BusinessForm({required this.seller});
  final SellerApplicationSeller seller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    return _SheetForm(
      fields: [
        ('businessLegalName', t.businessName, seller.businessLegalName ?? '', true, null),
        ('commercialRegistrationNo', t.commercialRegistration, '', false, null),
        ('taxRegistrationNo', t.taxRegistration, '', false, null),
        ('businessAddress', t.businessAddress, seller.businessAddress ?? '', true, null),
        ('authorizedRepresentative', t.authorizedRepresentative, seller.authorizedRepresentative ?? '', true, null),
      ],
      save: (v) => ref.read(mobileApiProvider).saveApplicationBusiness(v),
    );
  }
}

class _StoreForm extends ConsumerStatefulWidget {
  const _StoreForm({required this.seller});
  final SellerApplicationSeller seller;
  @override
  ConsumerState<_StoreForm> createState() => _StoreFormState();
}

class _StoreFormState extends ConsumerState<_StoreForm> {
  final _intent = IntentKey();
  PickedFile? _logo;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final s = widget.seller.store;
    return _SheetForm(
      fields: [
        ('name', t.storeName, s?.name ?? '', true, null),
        ('description', t.storeDescription, s?.description ?? '', false, null),
        ('returnAddress', t.returnAddress, s?.returnAddress ?? '', true, null),
        ('supportPhone', t.supportPhone, s?.supportPhone ?? '', false, TextInputType.phone),
      ],
      governorate: ('returnGovernorateId', s?.returnGovernorateId),
      extra: [
        EdmnUploadField(label: t.storeLogo, hint: t.pickImage, fileName: _logo?.name, onPick: () async {
          final f = await ref.read(filePickerProvider).pick(allowPdf: false);
          if (f != null) setState(() => _logo = f);
        }, onClear: () => setState(() => _logo = null)),
        _gap(),
      ],
      save: (v) => ref.read(mobileApiProvider).saveApplicationStore(v, logo: _logo == null ? null : (_logo!.bytes, _logo!.name), idempotencyKey: _intent.value),
    );
  }
}

class _DocumentUpload extends ConsumerStatefulWidget {
  const _DocumentUpload({required this.kind});
  final String kind;
  @override
  ConsumerState<_DocumentUpload> createState() => _DocumentUploadState();
}

class _DocumentUploadState extends ConsumerState<_DocumentUpload> {
  final _intent = IntentKey();
  PickedFile? _file;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      EdmnUploadField(label: t.documents, hint: t.pickDocument, fileName: _file?.name, onPick: () async {
        final f = await ref.read(filePickerProvider).pick();
        if (f != null) setState(() => _file = f);
      }, onClear: () => setState(() => _file = null)),
      const SizedBox(height: EdmnSpacing.md),
      EdmnPrimaryButton(
        key: const Key('doc-upload'),
        label: t.upload,
        loading: _busy,
        onPressed: _file == null
            ? null
            : () async {
                setState(() => _busy = true);
                final ok = await runAction(context, () => ref.read(mobileApiProvider).uploadApplicationDocument(widget.kind, (_file!.bytes, _file!.name), idempotencyKey: _intent.value), success: t.saved);
                ref.invalidate(applicationProvider);
                if (mounted) setState(() => _busy = false);
                if (ok && context.mounted) Navigator.pop(context);
              },
      ),
    ]);
  }
}

class _PayoutAccountForm extends ConsumerStatefulWidget {
  const _PayoutAccountForm();
  @override
  ConsumerState<_PayoutAccountForm> createState() => _PayoutAccountFormState();
}

class _PayoutAccountFormState extends ConsumerState<_PayoutAccountForm> {
  final _intent = IntentKey();
  String _type = 'INSTAPAY';

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final fields = switch (_type) {
      'BANK_ACCOUNT' => [
          ('holderName', t.holderName, '', true, null),
          ('bankName', t.destBankName, '', true, null),
          ('accountNumber', t.destAccountNumber, '', true, TextInputType.number),
          ('iban', 'IBAN', '', false, null),
        ],
      'MOBILE_WALLET' => [('holderName', t.holderName, '', true, null), ('walletProvider', t.walletProvider, '', true, null), ('walletNumber', t.destWalletNumber, '', true, TextInputType.phone)],
      _ => [('holderName', t.holderName, '', true, null), ('instapayAddress', t.destInstapayAddress, '', true, null)],
    };
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      EdmnRadioCard<String>(
        value: _type,
        onChanged: (v) => setState(() => _type = v),
        options: [
          EdmnRadioOption(value: 'INSTAPAY', label: 'InstaPay', icon: Icons.bolt_rounded),
          EdmnRadioOption(value: 'BANK_ACCOUNT', label: t.destBankName, icon: Icons.account_balance_outlined),
          EdmnRadioOption(value: 'MOBILE_WALLET', label: t.mobileWallet, icon: Icons.phone_iphone_rounded),
        ],
      ),
      _gap(),
      EdmnNotice(message: t.payoutAccountNote),
      _gap(),
      _SheetForm(key: ValueKey(_type), fields: fields, save: (v) => ref.read(mobileApiProvider).addPayoutAccount({...v, 'type': _type}, idempotencyKey: _intent.value)),
    ]);
  }
}

/* ───────────────────────── S12–S22 products ───────────────────────── */

class NewProductScreen extends ConsumerStatefulWidget {
  const NewProductScreen({super.key});
  @override
  ConsumerState<NewProductScreen> createState() => _NewProductScreenState();
}

class _NewProductScreenState extends ConsumerState<NewProductScreen> {
  final _title = TextEditingController();
  final _intent = IntentKey();
  String? _category;
  String _condition = 'NEW';
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final cats = ref.watch(categoriesProvider);
    final en = languageOf(context) == 'en';
    List<(String, String)> flat(List<Category> list, String prefix) => [
          for (final c in list) ...[(c.id, '$prefix${en ? c.nameEn : c.nameAr}'), ...flat(c.children, '$prefix${en ? c.nameEn : c.nameAr} › ')],
        ];
    return EdmnAppScaffold(
      title: t.addProduct,
      bottomBar: EdmnPrimaryButton(
        key: const Key('create-product'),
        label: t.continueLabel,
        loading: _busy,
        onPressed: _category == null || _title.text.trim().length < 5
            ? null
            : () async {
                setState(() => _busy = true);
                try {
                  final p = await ref.read(mobileApiProvider).createSellerProduct(categoryId: _category!, titleAr: _title.text.trim(), condition: _condition, idempotencyKey: _intent.value);
                  ref.invalidate(sellerProductsProvider);
                  if (context.mounted) context.pushReplacement('/seller/products/${p.id}/edit');
                } catch (e) {
                  if (context.mounted) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
                } finally {
                  if (mounted) setState(() => _busy = false);
                }
              },
      ),
      body: AsyncView(
        value: cats,
        onRetry: () => ref.invalidate(categoriesProvider),
        data: (list) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          EdmnTextField(key: const Key('np-title'), controller: _title, hint: t.productNameHint, icon: Icons.title_rounded, onChanged: (_) => setState(() {})),
          _section(t.category),
          DropdownButtonFormField<String>(
            key: const Key('np-category'),
            initialValue: _category,
            isExpanded: true,
            decoration: InputDecoration(hintText: t.category, prefixIcon: const Icon(Icons.category_outlined)),
            items: [for (final (id, name) in flat(list, '')) DropdownMenuItem(value: id, child: Text(name, overflow: TextOverflow.ellipsis))],
            onChanged: (v) => setState(() => _category = v),
          ),
          _section(t.filterCondition),
          EdmnRadioCard<String>(
            value: _condition,
            onChanged: (v) => setState(() => _condition = v),
            options: [
              EdmnRadioOption(value: 'NEW', label: t.conditionNew, icon: Icons.fiber_new_outlined),
              EdmnRadioOption(value: 'USED', label: t.conditionUsed, icon: Icons.recycling_rounded),
            ],
          ),
        ]),
      ),
    );
  }
}

class ProductEditorScreen extends ConsumerStatefulWidget {
  const ProductEditorScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<ProductEditorScreen> createState() => _ProductEditorScreenState();
}

class _ProductEditorScreenState extends ConsumerState<ProductEditorScreen> {
  final _imgIntent = IntentKey();
  final _submitIntent = IntentKey();
  bool _busy = false;

  Future<bool> _confirm(String title, String body) async {
    final t = EdmnLocalizations.of(context);
    return await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
            title: Text(title),
            content: Text(body),
            actions: [
              TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(t.adminCancel)),
              FilledButton(key: const Key('confirm'), onPressed: () => Navigator.of(c).pop(true), child: Text(t.confirmAction)),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _run(Future<Object?> Function() f, {String? success}) async {
    setState(() => _busy = true);
    await runAction(context, () async => f(), success: success);
    ref.invalidate(sellerProductEditorProvider(widget.id));
    ref.invalidate(sellerProductsProvider);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final p = ref.watch(sellerProductEditorProvider(widget.id));
    final api = ref.read(mobileApiProvider);
    return EdmnAppScaffold(
      title: t.editProduct,
      body: AsyncView(
        value: p,
        onRetry: () => ref.invalidate(sellerProductEditorProvider(widget.id)),
        data: (e) {
          final editable = e.status == 'DRAFT' || e.status == 'REJECTED' || e.status == 'APPROVED' || e.status == 'LIVE';
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            Row(children: [
              Expanded(child: Text(e.titleAr, style: EdmnType.section.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800))),
              EdmnStatusChip(label: productStatusLabel(t, e.status), tone: e.status == 'LIVE' ? EdmnTone.success : (e.status == 'REJECTED' ? EdmnTone.danger : EdmnTone.warning)),
            ]),
            if (e.moderationNote != null) ...[_gap(), EdmnNotice(title: t.moderationNote, message: e.moderationNote!, tone: EdmnTone.danger)],
            if (e.pendingRevision) ...[_gap(), EdmnNotice(message: t.revisionPending, tone: EdmnTone.warning)],
            if (e.submissionProblems.isNotEmpty) ...[
              _gap(),
              EdmnNotice(key: const Key('submission-problems'), title: t.beforeSubmit, message: e.submissionProblems.map((x) => '• $x').join('\n'), tone: EdmnTone.warning),
            ],
            // S13 photos
            _section(t.photos),
            SizedBox(
              height: 96,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                for (final img in e.images)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: EdmnSpacing.xs),
                    child: Stack(children: [
                      EdmnThumb(url: img.url, size: 88),
                      if (editable)
                        PositionedDirectional(
                          top: 0,
                          end: 0,
                          child: IconButton(
                            tooltip: t.delete,
                            icon: Icon(Icons.cancel_rounded, color: EdmnColors.error, semanticLabel: t.delete),
                            onPressed: _busy ? null : () => _run(() => api.deleteProductImage(e.id, img.fileId, idempotencyKey: newKey())),
                          ),
                        ),
                    ]),
                  ),
                if (editable)
                  InkWell(
                    key: const Key('add-photos'),
                    onTap: _busy
                        ? null
                        : () async {
                            final f = await ref.read(filePickerProvider).pick(allowPdf: false);
                            if (f == null) return;
                            await _run(() => api.addProductImages(e.id, [(f.bytes, f.name)], actualItem: e.condition == 'USED', idempotencyKey: _imgIntent.value));
                            _imgIntent.reset();
                          },
                    child: Container(
                      width: 88,
                      height: 88,
                      decoration: BoxDecoration(color: EdmnColors.subtle, borderRadius: BorderRadius.circular(EdmnRadii.small), border: Border.all(color: EdmnColors.border)),
                      // Named for screen readers (it was an unnamed button).
                      child: Icon(Icons.add_a_photo_outlined, color: EdmnColors.primary, semanticLabel: t.addProductPhoto),
                    ),
                  ),
              ]),
            ),
            // S15 details
            _section(t.productDescription),
            EdmnCard(
              onTap: editable ? () => showEdmnBottomSheet(context, title: t.productDescription, child: _DetailsForm(p: e)) : null,
              child: Text(e.description?.isNotEmpty == true ? e.description! : t.tapToAdd, maxLines: 4, overflow: TextOverflow.ellipsis, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
            ),
            // S16–S18 price, variants, stock
            _section(t.priceAndStock),
            for (final v in e.variants)
              EdmnCard(
                margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                onTap: editable ? () => showEdmnBottomSheet(context, title: t.priceAndStock, child: _VariantForm(p: e, variant: v)) : null,
                child: Row(children: [
                  Expanded(child: Text(v.options.values.join(' / ').isEmpty ? v.sku : v.options.values.join(' / '), style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary))),
                  Text(t.stockLine(v.stockOnHand, v.reserved, (v.stockOnHand - v.reserved).clamp(0, 1 << 30)), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                  const SizedBox(width: EdmnSpacing.xs),
                  EgpText(v.pricePiastres, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                ]),
              ),
            if (editable)
              EdmnSecondaryButton(
                key: const Key('add-variant'),
                label: e.variants.isEmpty ? t.setPrice : t.addVariant,
                icon: Icons.add_rounded,
                onPressed: () => showEdmnBottomSheet(context, title: t.priceAndStock, child: _VariantForm(p: e)),
              ),
            // S25 return policy & processing
            _section(t.returnPolicy),
            EdmnCard(
              onTap: editable ? () => showEdmnBottomSheet(context, title: t.returnPolicy, child: _LogisticsForm(p: e)) : null,
              child: Text(
                e.returnPolicyConfirmed ? (e.returnPolicyOverride ? t.productReturnCustom(e.voluntaryReturnDays ?? 0) : t.productReturnStoreDefault) : t.returnPolicyNotSet,
                style: EdmnType.body.copyWith(color: e.returnPolicyConfirmed ? EdmnColors.textPrimary : EdmnColors.warning),
              ),
            ),
            const SizedBox(height: EdmnSpacing.lg),
            // S19 preview, S20 submit, S22 visibility
            if (e.status == 'LIVE' || e.status == 'APPROVED')
              EdmnSecondaryButton(
                key: const Key('toggle-visibility'),
                label: e.isListed ? t.hideProduct : t.showProduct,
                loading: _busy,
                onPressed: () => _run(() => api.setProductListed(e.id, !e.isListed, idempotencyKey: newKey())),
              ),
            if (e.status == 'LIVE') ...[_gap(), EdmnSecondaryButton(label: t.viewAsBuyer, onPressed: () => context.push('/products/${Uri.encodeComponent(e.slug)}'))],
            // S18/S22: stop sales now, or archive (server rules: not under review, not while unpaid orders reserve stock).
            if (e.status == 'LIVE' || e.status == 'APPROVED') ...[
              _gap(),
              EdmnSecondaryButton(
                key: const Key('out-of-stock'),
                label: t.markOutOfStock,
                loading: _busy,
                onPressed: () async {
                  if (await _confirm(t.markOutOfStock, t.markOutOfStockConfirm)) await _run(() => api.markProductOutOfStock(e.id, idempotencyKey: newKey()), success: t.markedOutOfStock);
                },
              ),
            ],
            if (!const {'SUBMITTED', 'UNDER_REVIEW', 'ARCHIVED'}.contains(e.status)) ...[
              _gap(),
              TextButton.icon(
                key: const Key('archive-product'),
                style: TextButton.styleFrom(foregroundColor: EdmnColors.error),
                icon: const Icon(Icons.archive_outlined),
                label: Text(t.archiveProduct),
                onPressed: _busy
                    ? null
                    : () async {
                        if (await _confirm(t.archiveProduct, t.archiveProductConfirm)) await _run(() => api.archiveProduct(e.id, idempotencyKey: newKey()), success: t.productArchivedDone);
                      },
              ),
            ],
            if (e.status == 'DRAFT' || e.status == 'REJECTED') ...[
              _gap(),
              EdmnPrimaryButton(
                key: const Key('submit-product'),
                label: t.submitForReview,
                loading: _busy,
                onPressed: e.submissionProblems.isNotEmpty
                    ? null
                    : () async {
                        await _run(() => api.submitProduct(e.id, idempotencyKey: _submitIntent.value), success: t.sentForReview);
                        _submitIntent.reset();
                      },
              ),
            ],
          ]);
        },
      ),
    );
  }
}

String newKey() => IntentKey().value;

class _DetailsForm extends ConsumerWidget {
  const _DetailsForm({required this.p});
  final SellerProductEditor p;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final used = p.condition == 'USED';
    return _SheetForm(
      fields: [
        ('titleAr', t.productNameHint, p.titleAr, true, null),
        ('description', t.productDescription, p.description ?? '', true, TextInputType.multiline),
        ('keyFeatures', t.keyFeaturesHint, p.keyFeatures.join('\n'), false, TextInputType.multiline),
        if (used) ('conditionNotes', t.conditionNotes, p.conditionNotes ?? '', true, null),
        if (used) ('defects', t.defects, p.defects ?? '', true, null),
        ('includedAccessories', t.includedAccessories, p.includedAccessories ?? '', false, null),
        ('warrantyInfo', t.warranty, p.warrantyInfo ?? '', false, null),
      ],
      save: (v) async {
        await ref.read(mobileApiProvider).saveProductDetails(p.id, {
          'titleAr': v['titleAr'],
          'categoryId': p.categoryId,
          'description': v['description'],
          'keyFeatures': v['keyFeatures']!.split('\n').map((x) => x.trim()).where((x) => x.isNotEmpty).take(10).toList(),
          'condition': p.condition,
          if (used) 'usedGrade': p.usedGrade ?? 'GOOD',
          if (used) 'conditionNotes': v['conditionNotes'],
          if (used) 'defects': v['defects'],
          'includedAccessories': v['includedAccessories'],
          'warrantyInfo': v['warrantyInfo'],
          'attributes': p.attributes,
        });
        ref.invalidate(sellerProductEditorProvider(p.id));
      },
    );
  }
}

class _VariantForm extends ConsumerWidget {
  const _VariantForm({required this.p, this.variant});
  final SellerProductEditor p;
  final SellerProductEditorVariantsItem? variant;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final v = variant;
    String egp(int? piastres) => piastres == null ? '' : (piastres % 100 == 0 ? '${piastres ~/ 100}' : (piastres / 100).toStringAsFixed(2));
    return _SheetForm(
      fields: [
        ('sku', 'SKU', v?.sku ?? 'SKU-${DateTime.now().millisecondsSinceEpoch.toRadixString(36).toUpperCase()}', true, null),
        ('label', t.variantLabelHint, v?.options['option'] ?? '', false, null),
        ('price', t.priceEgp, egp(v?.pricePiastres), true, const TextInputType.numberWithOptions(decimal: true)),
        ('compareAt', t.compareAtEgp, egp(v?.compareAtPricePiastres), false, const TextInputType.numberWithOptions(decimal: true)),
        ('stock', t.stockOnHand, '${v?.stockOnHand ?? 1}', true, TextInputType.number),
      ],
      save: (x) async {
        final price = parseEgpToPiastres(x['price']!);
        final compare = x['compareAt']!.isEmpty ? null : parseEgpToPiastres(x['compareAt']!);
        final stock = int.tryParse(x['stock']!);
        if (price == null || stock == null || (x['compareAt']!.isNotEmpty && compare == null)) throw const FormatException();
        // The whole variant list is sent (server replaces it); other variants are kept as they are.
        final others = p.variants.where((o) => o.id != v?.id).map((o) => {
              'id': o.id,
              'sku': o.sku,
              'options': o.options,
              'price': o.pricePiastres,
              'compareAtPrice': ?o.compareAtPricePiastres,
              'stockOnHand': o.stockOnHand,
              'lowStockThreshold': o.lowStockThreshold,
              'isActive': o.isActive,
            });
        await ref.read(mobileApiProvider).saveProductVariants(p.id, [
          ...others,
          {
            'id': ?v?.id,
            'sku': x['sku'],
            'options': x['label']!.isEmpty ? <String, String>{} : {'option': x['label']},
            'price': price,
            'compareAtPrice': ?compare,
            'stockOnHand': stock,
            'lowStockThreshold': v?.lowStockThreshold ?? 2,
            'isActive': true,
          },
        ]);
        ref.invalidate(sellerProductEditorProvider(p.id));
      },
    );
  }
}

class _LogisticsForm extends ConsumerStatefulWidget {
  const _LogisticsForm({required this.p});
  final SellerProductEditor p;
  @override
  ConsumerState<_LogisticsForm> createState() => _LogisticsFormState();
}

class _LogisticsFormState extends ConsumerState<_LogisticsForm> {
  late bool _override = widget.p.returnPolicyOverride;
  late bool _accepts = widget.p.acceptsVoluntaryReturns ?? true;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final p = widget.p;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SwitchListTile(key: const Key('override-policy'), contentPadding: EdgeInsets.zero, value: _override, onChanged: (v) => setState(() => _override = v), title: Text(t.customReturnPolicy)),
      if (_override) SwitchListTile(contentPadding: EdgeInsets.zero, value: _accepts, onChanged: (v) => setState(() => _accepts = v), title: Text(t.acceptsReturns)),
      _SheetForm(
        key: ValueKey('$_override$_accepts'),
        fields: [
          ('processingDays', t.processingDaysHint, '${p.processingDays ?? ''}', false, TextInputType.number),
          if (_override && _accepts) ('voluntaryReturnDays', t.returnDaysHint, '${p.voluntaryReturnDays ?? 14}', true, TextInputType.number),
        ],
        save: (v) async {
          await ref.read(mobileApiProvider).saveProductLogistics(p.id, {
            'weightGrams': null,
            'lengthCm': null,
            'widthCm': null,
            'heightCm': null,
            'processingDays': int.tryParse(v['processingDays'] ?? ''),
            'returnPolicyOverride': _override,
            'acceptsVoluntaryReturns': _override ? _accepts : null,
            'voluntaryReturnDays': _override && _accepts ? int.tryParse(v['voluntaryReturnDays'] ?? '') : null,
          });
          ref.invalidate(sellerProductEditorProvider(p.id));
        },
      ),
    ]);
  }
}

/* ───────────────────────── S23/S24 shipping rates ───────────────────────── */

class ShippingRatesScreen extends ConsumerStatefulWidget {
  const ShippingRatesScreen({super.key});
  @override
  ConsumerState<ShippingRatesScreen> createState() => _ShippingRatesScreenState();
}

class _ShippingRatesScreenState extends ConsumerState<ShippingRatesScreen> {
  Map<int, (bool, String, String, String)>? _edit;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final rates = ref.watch(shippingRatesProvider);
    final govsAsync = ref.watch(governoratesProvider);
    final govs = govsAsync.value ?? const [];
    final en = languageOf(context) == 'en';
    // Seed the editable copy BEFORE the bottom bar is decided: seeding it inside the body left the Save button hidden
    // until something else rebuilt the screen (editing only a fee never showed it).
    if (_edit == null && rates.hasValue) _edit = _editable(rates.requireValue);
    return EdmnAppScaffold(
      title: t.shippingRates,
      bottomBar: _edit == null
          ? null
          : EdmnPrimaryButton(
              key: const Key('save-rates'),
              label: t.save,
              loading: _busy,
              onPressed: () async {
                final items = <Map<String, dynamic>>[];
                final active = {for (final g in govs) g.id};
                // Only governorates in the authoritative active list are sent; a deactivated one can't be offered.
                for (final e in _edit!.entries.where((e) => active.contains(e.key))) {
                  final fee = parseEgpToPiastres(e.value.$2.isEmpty ? '0' : e.value.$2);
                  final min = int.tryParse(e.value.$3);
                  final max = int.tryParse(e.value.$4);
                  if (fee == null || min == null || max == null || min < 0 || max > 60 || min > max) {
                    showEdmnMessage(context, t.checkRates, error: true);
                    return;
                  }
                  items.add({'governorateId': e.key, 'enabled': e.value.$1, 'feePiastres': fee, 'etaMinDays': min, 'etaMaxDays': max});
                }
                setState(() => _busy = true);
                GetSellerShippingRatesResponse? saved;
                final ok = await runAction(context, () async => saved = await ref.read(mobileApiProvider).saveShippingRates(items), success: t.saved);
                if (ok && saved != null) {
                  // Edit from what the server stored. Rebuilding from the cached list (still the pre-save data while it
                  // refetches) made the next save silently revert this one.
                  setState(() => _edit = _editable(saved!));
                  ref.invalidate(shippingRatesProvider);
                }
                if (mounted) setState(() => _busy = false);
              },
            ),
      body: AsyncView(
        value: rates,
        onRetry: () => ref.invalidate(shippingRatesProvider),
        data: (r) => AsyncView(
          value: govsAsync,
          onRetry: () => ref.invalidate(governoratesProvider),
          data: (_) => _rates(t, r, govs, en),
        ),
      ),
    );
  }

  static Map<int, (bool, String, String, String)> _editable(GetSellerShippingRatesResponse r) => {
        for (final x in r.items)
          x.governorateId: (x.enabled, x.feePiastres % 100 == 0 ? '${x.feePiastres ~/ 100}' : (x.feePiastres / 100).toStringAsFixed(2), '${x.etaMinDays}', '${x.etaMaxDays}'),
      };

  Widget _rates(EdmnLocalizations t, GetSellerShippingRatesResponse r, List<ListGovernoratesResponseItemsItem> govs, bool en) {
          if (govs.isEmpty) return EdmnEmptyState(icon: Icons.map_outlined, title: t.noGovernorates);
          _edit ??= _editable(r);
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            EdmnNotice(message: t.shippingRatesNote),
            _gap(),
            for (final g in govs)
              if (_edit!.containsKey(g.id))
              () {
                final id = g.id;
                final e = _edit![id]!;
                Widget num(String k, String value, String label, void Function(String) on) => SizedBox(
                      width: k == 'fee' ? 96 : 72, // wide enough for «92.50»
                      child: TextFormField(
                        key: Key('rate-$k-$id'),
                        initialValue: value,
                        enabled: e.$1,
                        textDirection: TextDirection.ltr,
                        // The fee is in pounds and may have piastres (92.50): offer the decimal key for it.
                        keyboardType: k == 'fee' ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.number,
                        decoration: InputDecoration(labelText: label, isDense: true),
                        onChanged: on,
                      ),
                    );
                return EdmnCard(
                  key: Key('rate-$id'),
                  margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                  padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      Expanded(child: Text(en ? g.nameEn : g.nameAr, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary))),
                      // The switch carries the governorate's name so a screen reader says what it turns on.
                      Semantics(
                        label: en ? g.nameEn : g.nameAr,
                        child: Switch(key: Key('rate-on-$id'), value: e.$1, onChanged: (v) => setState(() => _edit![id] = (v, e.$2, e.$3, e.$4))),
                      ),
                    ]),
                    if (e.$1)
                      Wrap(spacing: EdmnSpacing.sm, children: [
                        num('fee', e.$2, t.feeEgp, (v) => _edit![id] = (_edit![id]!.$1, v, _edit![id]!.$3, _edit![id]!.$4)),
                        num('min', e.$3, t.etaMin, (v) => _edit![id] = (_edit![id]!.$1, _edit![id]!.$2, v, _edit![id]!.$4)),
                        num('max', e.$4, t.etaMax, (v) => _edit![id] = (_edit![id]!.$1, _edit![id]!.$2, _edit![id]!.$3, v)),
                      ]),
                  ]),
                );
              }(),
          ]);
  }
}

/* ───────────────────────── S09/S10/S25 store settings ───────────────────────── */

class StoreSettingsScreen extends ConsumerWidget {
  const StoreSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final s = ref.watch(storeSettingsProvider);
    return EdmnAppScaffold(
      title: t.storeSettings,
      body: AsyncView(
        value: s,
        onRetry: () => ref.invalidate(storeSettingsProvider),
        data: (st) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          EdmnCard(child: EdmnSellerSummary(name: st.name, subtitle: st.description)),
          _gap(),
          _StoreMediaCard(s: st),
          _gap(),
          _StoreSettingsForm(s: st),
        ]),
      ),
    );
  }
}

/// Logo and banner (S05). Uploaded through the secure store-media route; the screen shows the server's public URLs.
class _StoreMediaCard extends ConsumerStatefulWidget {
  const _StoreMediaCard({required this.s});
  final SellerStoreSettings s;
  @override
  ConsumerState<_StoreMediaCard> createState() => _StoreMediaCardState();
}

class _StoreMediaCardState extends ConsumerState<_StoreMediaCard> {
  String? _busy;

  Future<void> _change(String field) async {
    final t = EdmnLocalizations.of(context);
    final f = await ref.read(filePickerProvider).pick(allowPdf: false);
    if (f == null || !mounted) return;
    setState(() => _busy = field);
    final file = (f.bytes, f.name);
    await runAction(
      context,
      () => ref.read(mobileApiProvider).saveStoreMedia(logo: field == 'logo' ? file : null, banner: field == 'banner' ? file : null, idempotencyKey: newKey()),
      success: t.storeMediaSaved,
    );
    ref.invalidate(storeSettingsProvider);
    if (mounted) setState(() => _busy = null);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final s = widget.s;
    Widget preview(String? url, double height, String label) => ClipRRect(
          borderRadius: BorderRadius.circular(EdmnRadii.small),
          child: Container(
            height: height,
            color: EdmnColors.subtle,
            alignment: Alignment.center,
            child: url == null
                ? Icon(Icons.image_outlined, color: EdmnColors.textSecondary, semanticLabel: label)
                : Image.network(url, fit: BoxFit.cover, width: double.infinity, height: height, semanticLabel: label, errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined)),
          ),
        );
    return EdmnCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(t.storeMedia, style: EdmnType.cardTitle),
        const SizedBox(height: EdmnSpacing.xs),
        preview(s.bannerUrl, 110, t.storeBannerLabel),
        const SizedBox(height: EdmnSpacing.xs),
        EdmnSecondaryButton(key: const Key('change-banner'), label: t.changeBanner, loading: _busy == 'banner', onPressed: _busy == null ? () => _change('banner') : null),
        const SizedBox(height: EdmnSpacing.sm),
        Row(children: [
          SizedBox(width: 72, child: preview(s.logoUrl, 72, t.storeLogoLabel)),
          const SizedBox(width: EdmnSpacing.sm),
          Expanded(child: EdmnSecondaryButton(key: const Key('change-logo'), label: t.changeLogo, loading: _busy == 'logo', onPressed: _busy == null ? () => _change('logo') : null)),
        ]),
        const SizedBox(height: EdmnSpacing.xs),
        Text(t.storeMediaHint, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
      ]),
    );
  }
}

class _StoreSettingsForm extends ConsumerStatefulWidget {
  const _StoreSettingsForm({required this.s});
  final SellerStoreSettings s;
  @override
  ConsumerState<_StoreSettingsForm> createState() => _StoreSettingsFormState();
}

class _StoreSettingsFormState extends ConsumerState<_StoreSettingsForm> {
  late bool _accepts = widget.s.acceptsVoluntaryReturns;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final s = widget.s;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      // Own Material so the tile's ink and background show on the rounded page surface.
      Material(type: MaterialType.transparency, child: SwitchListTile(key: const Key('store-accepts-returns'), contentPadding: EdgeInsets.zero, value: _accepts, onChanged: (v) => setState(() => _accepts = v), title: Text(t.acceptsReturns))),
      _SheetForm(
        key: ValueKey(_accepts),
        fields: [
          ('name', t.storeName, s.name, true, null),
          ('description', t.storeDescription, s.description ?? '', false, TextInputType.multiline),
          ('returnAddress', t.returnAddress, s.returnAddress ?? '', true, null),
          ('supportPhone', t.supportPhone, s.supportPhone ?? '', false, TextInputType.phone),
          ('defaultProcessingDays', t.processingDaysHint, '${s.defaultProcessingDays ?? 2}', true, TextInputType.number),
          if (_accepts) ('voluntaryReturnDays', t.returnDaysHint, '${s.voluntaryReturnDays ?? 14}', true, TextInputType.number),
        ],
        save: (v) async {
          await ref.read(mobileApiProvider).saveStoreSettings({
            'name': v['name'],
            'description': v['description'],
            'returnAddress': v['returnAddress'],
            'supportPhone': v['supportPhone'],
            'acceptsVoluntaryReturns': _accepts,
            'voluntaryReturnDays': _accepts ? int.tryParse(v['voluntaryReturnDays'] ?? '') : null,
            'returnConditionKeys': s.returnConditionKeys,
            'defaultProcessingDays': int.tryParse(v['defaultProcessingDays']!) ?? 2,
            'freeShippingThreshold': s.freeShippingThresholdPiastres,
          });
          ref.invalidate(storeSettingsProvider);
        },
      ),
    ]);
  }
}

/* ───────────────────────── S32/S33 payout requests ───────────────────────── */

final storePayoutAccountProvider = FutureProvider.autoDispose<GetSellerPayoutAccountResponse>((ref) => ref.watch(mobileApiProvider).sellerPayoutAccount());

(String, EdmnTone) payoutStatus(EdmnLocalizations t, String s) => switch (s) {
      'REQUESTED' || 'UNDER_REVIEW' => (t.payoutUnderReview, EdmnTone.warning),
      'APPROVED' || 'PROCESSING' => (t.payoutProcessing, EdmnTone.info),
      'PAID' => (t.payoutPaid, EdmnTone.success),
      // Neither paid nor failed: EDMN is verifying the transfer — never retried or shown as failed.
      'TRANSFER_UNCERTAIN' => (t.payoutUncertain, EdmnTone.warning),
      'REJECTED' => (t.payoutRejected, EdmnTone.danger),
      'FAILED_BEFORE_TRANSFER' || 'RETURNED' => (t.payoutNotTransferred, EdmnTone.danger),
      'CANCELLED' => (t.statusCancelled, EdmnTone.neutral),
      _ => (s, EdmnTone.neutral),
    };

class PayoutRequestsScreen extends ConsumerWidget {
  const PayoutRequestsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final list = ref.watch(payoutRequestsProvider);
    final funds = ref.watch(sellerFundsProvider);
    final membership = ref.watch(sellerMembershipProvider).value;
    final canRequest = membership?.permissions.contains('finance.withdraw') ?? false;
    return EdmnAppScaffold(
      title: t.payoutRequests,
      bottomBar: !canRequest
          ? null
          : EdmnPrimaryButton(
              key: const Key('new-payout'),
              label: t.requestPayout,
              icon: Icons.outbound_outlined,
              onPressed: (funds.value?.withdrawablePiastres ?? 0) <= 0 ? null : () => showEdmnBottomSheet(context, title: t.requestPayout, child: _PayoutRequestForm(max: funds.value!.withdrawablePiastres)),
            ),
      body: AsyncView(
        value: list,
        skeleton: true,
        onRetry: () => ref.invalidate(payoutRequestsProvider),
        data: (r) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          if (funds.value != null) EdmnWalletCard(label: t.withdrawable, amountPiastres: funds.value!.withdrawablePiastres),
          if (!ref.watch(realMoneyProvider)) ...[_gap(), EdmnTestMoneyNotice(message: t.payoutTestNotice)],
          ref.watch(storePayoutAccountProvider).maybeWhen(
                data: (a) => a.account == null
                    ? Padding(padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.sm), child: EdmnNotice(key: const Key('no-payout-account'), message: t.payoutBlockNoAccount, tone: EdmnTone.warning))
                    : Padding(
                        padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.sm),
                        child: EdmnCard(
                          key: const Key('store-payout-account'),
                          child: Row(children: [
                            const Icon(Icons.account_balance_outlined, color: EdmnColors.primary),
                            const SizedBox(width: EdmnSpacing.xs),
                            Expanded(child: Text(t.payoutDestination, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary))),
                            Text(a.account!.label, textDirection: TextDirection.ltr, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                          ]),
                        ),
                      ),
                orElse: () => const SizedBox.shrink(),
              ),
          if (funds.value?.blockReasonAr != null) ...[_gap(), EdmnNotice(message: funds.value!.blockReasonAr!, tone: EdmnTone.danger)],
          _gap(),
          EdmnNotice(message: t.payoutRequestNote),
          _section(t.payoutHistory),
          if (r.items.isEmpty) EdmnEmptyState(icon: Icons.receipt_long_outlined, title: t.noPayouts),
          for (final w in r.items)
            () {
              final (label, tone) = payoutStatus(t, w.status);
              return EdmnCard(
                key: Key('payout-${w.id}'),
                margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    Expanded(child: EgpText(w.amountPiastres, style: EdmnType.price.copyWith(color: EdmnColors.textPrimary))),
                    EdmnStatusChip(label: label, tone: tone),
                  ]),
                  Text(formatDateTime(context, w.createdAt), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                  if (w.reference != null) Text(t.paidReference(w.reference!), style: EdmnType.secondary.copyWith(color: EdmnColors.success)),
                  if (w.reasonAr != null) Text(w.reasonAr!, style: EdmnType.secondary.copyWith(color: EdmnColors.error)),
                  if (w.status == 'TRANSFER_UNCERTAIN') Text(t.payoutUncertainNote, style: EdmnType.secondary.copyWith(color: EdmnColors.warning)),
                  if (w.cancellable && canRequest)
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: TextButton(
                        key: Key('cancel-payout-${w.id}'),
                        onPressed: () async {
                          if (!await showEdmnConfirmation(context, title: t.cancelRequest, message: t.cancelPayoutConfirm, confirmLabel: t.cancelRequest, destructive: true)) return;
                          if (!context.mounted) return;
                          await runAction(context, () => ref.read(mobileApiProvider).cancelPayoutRequest(w.id, idempotencyKey: newKey()));
                          ref.invalidate(payoutRequestsProvider);
                          ref.invalidate(sellerFundsProvider);
                        },
                        child: Text(t.cancelRequest, style: const TextStyle(color: EdmnColors.error)),
                      ),
                    ),
                ]),
              );
            }(),
        ]),
      ),
    );
  }
}

class _PayoutRequestForm extends ConsumerStatefulWidget {
  const _PayoutRequestForm({required this.max});
  final int max;
  @override
  ConsumerState<_PayoutRequestForm> createState() => _PayoutRequestFormState();
}

class _PayoutRequestFormState extends ConsumerState<_PayoutRequestForm> {
  final _amount = TextEditingController();
  final _intent = IntentKey();
  PreviewSellerPayoutRequestResponse? _preview;
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final amount = parseEgpToPiastres(_amount.text);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t.maxWithdrawable(formatEgpString(context, widget.max)), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
      _gap(),
      EdmnTextField(
        key: const Key('payout-amount'),
        controller: _amount,
        hint: t.amountEgp,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        textDirection: TextDirection.ltr,
        onChanged: (_) => setState(() => _preview = null),
      ),
      _gap(),
      if (!ref.watch(realMoneyProvider)) ...[EdmnTestMoneyNotice(message: t.payoutTestNotice), _gap()],
      if (_preview != null)
        EdmnAmountSummary(
          rows: [(t.amountDue, _preview!.amountPiastres), (t.transferCost, -_preview!.transferCostPiastres)],
          totalLabel: t.youReceive,
          totalPiastres: _preview!.netPiastres,
          note: [..._preview!.warnings, ..._preview!.violations].join('\n').isEmpty ? null : [..._preview!.warnings, ..._preview!.violations].join('\n'),
        ),
      _gap(),
      EdmnPrimaryButton(
        key: const Key('payout-submit'),
        label: _preview == null ? t.reviewAmount : t.sendRequest,
        loading: _busy,
        onPressed: amount == null || amount <= 0 || amount > widget.max || (_preview != null && _preview!.violations.isNotEmpty)
            ? null
            : () async {
                setState(() => _busy = true);
                try {
                  final api = ref.read(mobileApiProvider);
                  if (_preview == null) {
                    final p = await api.previewPayout(amount);
                    setState(() => _preview = p);
                  } else {
                    final r = await api.requestPayout(amount, clientKey: _intent.value);
                    ref.invalidate(payoutRequestsProvider);
                    ref.invalidate(sellerFundsProvider);
                    if (context.mounted) {
                      showEdmnMessage(context, r.created ? t.payoutRequested : t.payoutAlreadyRequested);
                      Navigator.pop(context);
                    }
                  }
                } catch (e) {
                  if (context.mounted) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
                } finally {
                  if (mounted) setState(() => _busy = false);
                }
              },
      ),
    ]);
  }
}

String formatEgpString(BuildContext context, int piastres) => formatEgp(piastres, languageCode: languageOf(context));
