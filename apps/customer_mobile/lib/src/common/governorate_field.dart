import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import 'ui.dart';

/// A form field that picks an Egyptian governorate from the authoritative list (`GET /governorates`, active rows only).
/// The value is the governorate's database id; the name shown follows the app language. An id the list doesn't
/// contain (removed or deactivated) is never accepted silently: the field fails validation until a listed one is
/// chosen, and the server refuses it as well.
class GovernorateField extends ConsumerWidget {
  const GovernorateField({super.key, required this.value, required this.onChanged, this.label});

  final int? value;
  final ValueChanged<int> onChanged;
  final String? label;

  static String nameOf(BuildContext context, ListGovernoratesResponseItemsItem g) => languageOf(context) == 'en' ? g.nameEn : g.nameAr;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final title = label ?? t.governorate;
    final govs = ref.watch(governoratesProvider);
    return govs.when(
      loading: () => Semantics(
        label: title,
        child: const Padding(padding: EdgeInsetsDirectional.symmetric(vertical: EdmnSpacing.md), child: LinearProgressIndicator()),
      ),
      error: (e, _) => Row(children: [
        Expanded(child: Text(apiErrorMessage(context, e), style: EdmnType.secondary.copyWith(color: EdmnColors.error))),
        TextButton(key: const Key('governorate-retry'), onPressed: () => ref.invalidate(governoratesProvider), child: Text(t.retry)),
      ]),
      data: (list) => list.isEmpty
          ? EdmnNotice(key: const Key('governorate-empty'), message: t.noGovernorates, tone: EdmnTone.warning)
          : FormField<int>(
              // Re-key on the value so an outside change (e.g. a refreshed application) resets the field state.
              key: ValueKey('governorate-$value'),
              initialValue: value,
              validator: (v) {
                if (v == null) return t.fieldRequired;
                if (!list.any((g) => g.id == v)) return t.governorateUnavailable;
                return null;
              },
              builder: (state) {
                final current = list.where((g) => g.id == state.value).firstOrNull;
                final shown = current == null ? (state.value == null ? t.selectGovernorate : t.governorateUnavailable) : nameOf(context, current);
                return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Semantics(
                    button: true,
                    label: '$title: $shown',
                    excludeSemantics: true,
                    child: InkWell(
                      key: const Key('governorate-field'),
                      borderRadius: BorderRadius.circular(EdmnRadii.field),
                      onTap: () async {
                        final picked = await showEdmnBottomSheet<int>(context, title: t.selectGovernorate, child: _GovernoratePicker(list: list, selected: state.value));
                        if (picked != null) {
                          state.didChange(picked);
                          onChanged(picked);
                        }
                      },
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: title,
                          prefixIcon: const Icon(Icons.map_outlined),
                          suffixIcon: const Icon(Icons.arrow_drop_down_rounded),
                          errorText: state.errorText,
                        ),
                        child: Text(shown, style: EdmnType.body.copyWith(color: current == null ? EdmnColors.textSecondary : EdmnColors.textPrimary)),
                      ),
                    ),
                  ),
                ]);
              },
            ),
    );
  }
}

class _GovernoratePicker extends StatefulWidget {
  const _GovernoratePicker({required this.list, required this.selected});
  final List<ListGovernoratesResponseItemsItem> list;
  final int? selected;
  @override
  State<_GovernoratePicker> createState() => _GovernoratePickerState();
}

class _GovernoratePickerState extends State<_GovernoratePicker> {
  String _q = '';

  /// Arabic search ignores the common spelling variants (أ/إ/آ → ا, ة → ه, ى → ي) and case for English names.
  static String _norm(String s) => s.toLowerCase().replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ة', 'ه').replaceAll('ى', 'ي').trim();

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final q = _norm(_q);
    final shown = q.isEmpty ? widget.list : widget.list.where((g) => _norm(g.nameAr).contains(q) || _norm(g.nameEn).contains(q)).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      EdmnTextField(key: const Key('governorate-search'), hint: t.searchGovernorate, icon: Icons.search_rounded, onChanged: (v) => setState(() => _q = v)),
      const SizedBox(height: EdmnSpacing.xs),
      if (shown.isEmpty)
        Padding(
          padding: const EdgeInsetsDirectional.symmetric(vertical: EdmnSpacing.md),
          child: Text(t.noGovernorateMatch, key: const Key('governorate-no-match'), textAlign: TextAlign.center, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
        ),
      for (final g in shown)
        ListTile(
          key: Key('gov-${g.id}'),
          title: Text(GovernorateField.nameOf(context, g), style: EdmnType.body),
          selected: g.id == widget.selected,
          trailing: g.id == widget.selected ? const Icon(Icons.check_rounded, color: EdmnColors.primary) : null,
          onTap: () => Navigator.pop(context, g.id),
        ),
    ]);
  }
}
