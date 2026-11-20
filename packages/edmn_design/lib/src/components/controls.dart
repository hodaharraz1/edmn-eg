import 'package:flutter/material.dart';

import '../l10n/edmn_localizations.dart';
import '../tokens.dart';

/// Pill primary button. `loading` disables it and shows a spinner, so a second tap can never send the request twice.
class EdmnPrimaryButton extends StatelessWidget {
  const EdmnPrimaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.loading = false,
    this.color,
  });
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;

  /// Only the board's white "ابدأ الآن" on the blue splash overrides the color.
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final onWhite = color == EdmnColors.surface;
    return FilledButton(
      onPressed: loading ? null : onPressed,
      style: color == null
          ? null
          : FilledButton.styleFrom(
              backgroundColor: color,
              foregroundColor: onWhite
                  ? EdmnColors.primary
                  : EdmnColors.onPrimary,
            ),
      child: loading
          ? const SizedBox.square(
              dimension: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2.4,
                color: EdmnColors.disabled,
              ),
            )
          : _Label(label: label, icon: icon),
    );
  }
}

/// Outlined pill button (board: "تفاصيل الطلب", product card "أضف").
class EdmnSecondaryButton extends StatelessWidget {
  const EdmnSecondaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.loading = false,
    this.compact = false,
    this.destructive = false,
  });
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final bool compact;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final fg = destructive ? EdmnColors.error : EdmnColors.primary;
    return OutlinedButton(
      onPressed: loading ? null : onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: fg,
        side: BorderSide(
          color: onPressed == null ? EdmnColors.border : fg,
          width: 1.2,
        ),
        minimumSize: compact
            ? const Size(0, 36)
            : const Size.fromHeight(EdmnSizes.secondaryButtonHeight),
        padding: compact
            ? const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.sm)
            : null,
        textStyle: compact ? EdmnType.bodyStrong : null,
      ),
      child: loading
          ? const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : _Label(label: label, icon: icon, small: compact),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label({required this.label, this.icon, this.small = false});
  final String label;
  final IconData? icon;
  final bool small;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      if (icon != null) ...[
        Icon(icon, size: small ? EdmnSizes.iconSm : EdmnSizes.icon),
        const SizedBox(width: EdmnSpacing.xs),
      ],
      Flexible(
        child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    ],
  );
}

/// Board text field: rounded, icon at the start, hint inside, error below. Password fields get the eye toggle.
class EdmnTextField extends StatefulWidget {
  const EdmnTextField({
    super.key,
    this.controller,
    required this.hint,
    this.icon,
    this.obscure = false,
    this.keyboardType,
    this.textInputAction,
    this.validator,
    this.onSubmitted,
    this.onChanged,
    this.enabled = true,
    this.maxLines = 1,
    this.minLines,
    this.autofillHints,
    this.label,
    this.maxLength,
    this.textDirection,
  });
  final TextEditingController? controller;
  final String hint;
  final String? label;
  final IconData? icon;
  final bool obscure;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onSubmitted;
  final ValueChanged<String>? onChanged;
  final bool enabled;
  final int maxLines;

  /// When set, the field starts at this height and grows up to [maxLines] (chat composers).
  final int? minLines;
  final int? maxLength;
  final Iterable<String>? autofillHints;

  /// Phone numbers, codes and amounts stay LTR inside Arabic screens.
  final TextDirection? textDirection;

  @override
  State<EdmnTextField> createState() => _EdmnTextFieldState();
}

class _EdmnTextFieldState extends State<EdmnTextField> {
  late bool _hidden = widget.obscure;

  @override
  Widget build(BuildContext context) => TextFormField(
    controller: widget.controller,
    obscureText: _hidden,
    keyboardType: widget.keyboardType,
    textInputAction: widget.textInputAction,
    validator: widget.validator,
    onFieldSubmitted: widget.onSubmitted,
    onChanged: widget.onChanged,
    enabled: widget.enabled,
    maxLines: widget.obscure ? 1 : widget.maxLines,
    minLines: widget.obscure ? null : widget.minLines,
    maxLength: widget.maxLength,
    autofillHints: widget.autofillHints,
    textDirection: widget.textDirection,
    style: EdmnType.body.copyWith(color: EdmnColors.textPrimary),
    decoration: InputDecoration(
      hintText: widget.hint,
      labelText: widget.label,
      counterText: '',
      prefixIcon: widget.icon == null
          ? null
          : Icon(widget.icon, size: EdmnSizes.icon),
      suffixIcon: widget.obscure
          ? IconButton(
              tooltip: widget.hint,
              icon: Icon(
                _hidden
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                size: EdmnSizes.icon,
              ),
              onPressed: () => setState(() => _hidden = !_hidden),
            )
          : null,
    ),
  );
}

/// Pill search bar on a subtle background (board: home and categories).
class EdmnSearchBar extends StatelessWidget {
  const EdmnSearchBar({
    super.key,
    required this.hint,
    this.controller,
    this.onSubmitted,
    this.onTap,
    this.onChanged,
    this.readOnly = false,
    this.onDark = false,
    this.autofocus = false,
    this.onClear,
  });
  final String hint;
  final TextEditingController? controller;
  final ValueChanged<String>? onSubmitted;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onTap;
  final VoidCallback? onClear;
  final bool readOnly;
  final bool autofocus;

  /// On the blue home header the bar is a translucent dark pill with white text (board).
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final fg = onDark ? EdmnColors.onPrimary : EdmnColors.textPrimary;
    final hintColor = onDark
        ? EdmnColors.onPrimary.withValues(alpha: 0.85)
        : EdmnColors.textSecondary;
    return TextField(
      key: const Key('search'),
      controller: controller,
      readOnly: readOnly,
      autofocus: autofocus,
      onTap: onTap,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      textInputAction: TextInputAction.search,
      style: EdmnType.body.copyWith(color: fg),
      cursorColor: fg,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: EdmnType.body.copyWith(color: hintColor),
        filled: true,
        fillColor: onDark
            ? EdmnColors.primaryDeep.withValues(alpha: 0.55)
            : EdmnColors.subtle,
        prefixIcon: Icon(Icons.search_rounded, color: fg, size: EdmnSizes.icon),
        suffixIcon: onClear == null
            ? null
            : IconButton(
                icon: Icon(
                  Icons.close_rounded,
                  color: hintColor,
                  size: EdmnSizes.iconSm,
                ),
                onPressed: onClear,
              ),
        contentPadding: const EdgeInsetsDirectional.symmetric(
          horizontal: EdmnSpacing.md,
          vertical: EdmnSpacing.sm,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(EdmnRadii.field),
          borderSide: BorderSide(
            color: onDark ? EdmnColors.primary : EdmnColors.border,
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(EdmnRadii.field),
          borderSide: BorderSide(
            color: onDark ? EdmnColors.primary : EdmnColors.border,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(EdmnRadii.field),
          borderSide: BorderSide(
            color: onDark ? EdmnColors.accentCyan : EdmnColors.primary,
            width: 1.5,
          ),
        ),
      ),
    );
  }
}

/// Board quantity stepper: "+ 1 −" in a small rounded pill.
class EdmnQuantityStepper extends StatelessWidget {
  const EdmnQuantityStepper({
    super.key,
    required this.value,
    this.onChanged,
    this.min = 1,
    this.max = 99,
    this.busy = false,
  });
  final int value;
  final ValueChanged<int>? onChanged;
  final int min;
  final int max;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final enabled = onChanged != null && !busy;
    final t = EdmnLocalizations.of(context);
    // Named through the icon's semantic label (a tooltip as well would make screen readers say it twice).
    Widget btn(IconData i, int next, String key) => SizedBox.square(
      dimension: 36,
      child: IconButton(
        key: Key(key),
        padding: EdgeInsets.zero,
        iconSize: EdmnSizes.iconSm,
        color: EdmnColors.textPrimary,
        disabledColor: EdmnColors.disabled,
        icon: Icon(i, semanticLabel: key == 'qty-inc' ? t.qtyIncrease : t.qtyDecrease),
        onPressed: enabled && next >= min && next <= max
            ? () => onChanged!(next)
            : null,
      ),
    );
    return Container(
      decoration: BoxDecoration(
        color: EdmnColors.surface,
        border: Border.all(color: EdmnColors.border),
        borderRadius: BorderRadius.circular(EdmnRadii.chip),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          btn(Icons.add_rounded, value + 1, 'qty-inc'),
          SizedBox(
            width: 28,
            child: busy
                ? const Center(
                    child: SizedBox.square(
                      dimension: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : Text(
                    '$value',
                    textAlign: TextAlign.center,
                    style: EdmnType.bodyStrong.copyWith(
                      color: EdmnColors.textPrimary,
                    ),
                  ),
          ),
          btn(Icons.remove_rounded, value - 1, 'qty-dec'),
        ],
      ),
    );
  }
}

/// Selectable filter pills (board: "الكل / قيد التنفيذ / تم التوصيل / ملغي").
class EdmnFilterPills<T> extends StatelessWidget {
  const EdmnFilterPills({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });
  final List<(T, String)> options;
  final T selected;
  final ValueChanged<T> onSelected;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    padding: const EdgeInsetsDirectional.symmetric(
      horizontal: EdmnSpacing.screen,
    ),
    child: Row(
      children: [
        for (final (value, label) in options)
          Padding(
            padding: const EdgeInsetsDirectional.only(end: EdmnSpacing.xs),
            child: ChoiceChip(
              label: Text(label),
              selected: value == selected,
              onSelected: (_) => onSelected(value),
              side: value == selected
                  ? BorderSide.none
                  : const BorderSide(color: EdmnColors.surface),
              backgroundColor: EdmnColors.surface,
            ),
          ),
      ],
    ),
  );
}

/// Radio list inside a bordered card (board: checkout "طريقة الدفع").
class EdmnRadioCard<T> extends StatelessWidget {
  const EdmnRadioCard({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
  });
  final List<EdmnRadioOption<T>> options;
  final T? value;
  final ValueChanged<T>? onChanged;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: EdmnColors.surface,
      border: Border.all(color: EdmnColors.border),
      borderRadius: BorderRadius.circular(EdmnRadii.card),
      boxShadow: EdmnShadows.card,
    ),
    child: RadioGroup<T>(
      groupValue: value,
      onChanged: (v) {
        if (v != null) onChanged?.call(v);
      },
      child: Column(
        children: [
          for (var i = 0; i < options.length; i++) ...[
            if (i > 0)
              const Divider(indent: EdmnSpacing.md, endIndent: EdmnSpacing.md),
            // One accessible element per option: the radio carries the option's label and subtitle, so a screen
            // reader announces «إنستاباي، زر اختيار» instead of three unnamed radios (found by the checkout journey).
            MergeSemantics(
              child: InkWell(
                onTap: onChanged == null || !options[i].enabled
                    ? null
                    : () => onChanged!(options[i].value),
                child: Padding(
                  padding: const EdgeInsetsDirectional.symmetric(
                    horizontal: EdmnSpacing.sm,
                    vertical: EdmnSpacing.xs,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        options[i].icon,
                        color: EdmnColors.primaryDark,
                        size: EdmnSizes.icon,
                      ),
                      const SizedBox(width: EdmnSpacing.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              options[i].label,
                              style: EdmnType.bodyStrong.copyWith(
                                color: options[i].enabled
                                    ? EdmnColors.textPrimary
                                    : EdmnColors.disabled,
                              ),
                            ),
                            if (options[i].subtitle != null)
                              Text(
                                options[i].subtitle!,
                                style: EdmnType.secondary.copyWith(
                                  color: EdmnColors.textSecondary,
                                ),
                              ),
                          ],
                        ),
                      ),
                      Radio<T>(
                        key: Key('radio-${options[i].value}'),
                        value: options[i].value,
                        enabled: options[i].enabled,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    ),
  );
}

class EdmnRadioOption<T> {
  const EdmnRadioOption({
    required this.value,
    required this.label,
    required this.icon,
    this.subtitle,
    this.enabled = true,
  });
  final T value;
  final String label;
  final String? subtitle;
  final IconData icon;
  final bool enabled;
}
