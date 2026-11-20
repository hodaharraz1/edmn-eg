import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../tokens.dart';

/// Board layout: a blue gradient header (title centered in white, optional back/actions) with the white content sheet
/// overlapping it with rounded top corners. Used by every inner screen.
class EdmnAppScaffold extends StatelessWidget {
  const EdmnAppScaffold({
    super.key,
    this.title,
    this.headerChild,
    required this.body,
    this.leading,
    this.actions = const [],
    this.showBack,
    this.onBack,
    this.bottomBar,
    this.bottomNavigation,
    this.headerExtent = 0,
    this.sheet = true,
    this.backgroundColor = EdmnColors.surface,
  });

  final String? title;

  /// Custom header content (home header). Replaces the title row when set.
  final Widget? headerChild;
  final Widget body;
  final Widget? leading;
  final List<Widget> actions;

  /// Defaults to "can pop".
  final bool? showBack;

  /// Overrides the back action (e.g. previous checkout step).
  final VoidCallback? onBack;

  /// Pinned action area above the safe area (e.g. "أضف إلى السلة").
  final Widget? bottomBar;
  final Widget? bottomNavigation;

  /// Extra blue header height below the title row (e.g. the Protected Deal hero).
  final double headerExtent;

  /// Content sits on a rounded white sheet over the header (board). False → plain body below the header.
  final bool sheet;
  final Color backgroundColor;

  @override
  Widget build(BuildContext context) {
    final canPop = showBack ?? Navigator.of(context).canPop();
    final header = EdmnHeader(
      title: title,
      leading:
          leading ??
          (canPop || onBack != null ? EdmnBackButton(onPressed: onBack) : null),
      actions: actions,
      child: headerChild,
    );
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: EdmnColors.primaryDark,
        resizeToAvoidBottomInset: true,
        bottomNavigationBar: bottomNavigation,
        body: Column(
          children: [
            header,
            Expanded(
              child: Container(
                width: double.infinity,
                decoration: BoxDecoration(
                  color: backgroundColor,
                  borderRadius: sheet
                      ? const BorderRadius.vertical(
                          top: Radius.circular(EdmnRadii.sheet),
                        )
                      : null,
                ),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  children: [
                    Expanded(child: body),
                    if (bottomBar != null)
                      SafeArea(
                        top: false,
                        minimum: const EdgeInsets.only(bottom: EdmnSpacing.sm),
                        child: Padding(
                          padding: const EdgeInsetsDirectional.fromSTEB(
                            EdmnSpacing.screen,
                            EdmnSpacing.xs,
                            EdmnSpacing.screen,
                            0,
                          ),
                          child: bottomBar,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class EdmnHeader extends StatelessWidget {
  const EdmnHeader({
    super.key,
    this.title,
    this.leading,
    this.actions = const [],
    this.child,
  });
  final String? title;
  final Widget? leading;
  final List<Widget> actions;
  final Widget? child;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(gradient: EdmnColors.headerGradient),
    child: SafeArea(
      bottom: false,
      child: Padding(
        padding: EdgeInsetsDirectional.only(
          bottom: child == null ? EdmnSpacing.sm : EdmnSpacing.md,
        ),
        child:
            child ??
            SizedBox(
              height: EdmnSizes.headerHeight - EdmnSpacing.sm,
              child: Row(
                children: [
                  SizedBox(
                    width: EdmnSizes.minTouch + EdmnSpacing.xs,
                    child: leading,
                  ),
                  Expanded(
                    child: Text(
                      title ?? '',
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: EdmnType.headerTitle.copyWith(
                        color: EdmnColors.onPrimary,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: EdmnSizes.minTouch + EdmnSpacing.xs,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: actions,
                    ),
                  ),
                ],
              ),
            ),
      ),
    ),
  );
}

class EdmnBackButton extends StatelessWidget {
  const EdmnBackButton({super.key, this.onPressed});
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => IconButton(
    color: EdmnColors.onPrimary,
    // Directional: points right in Arabic, left in English. Named through the icon's semantic label: a tooltip alone
    // reaches the web as a description, so the back button was announced as an unnamed button on every screen.
    icon: Icon(Icons.arrow_back_ios_new_rounded, size: EdmnSizes.icon, semanticLabel: MaterialLocalizations.of(context).backButtonTooltip),
    onPressed: onPressed ?? () => Navigator.of(context).maybePop(),
  );
}

/// Bottom navigation exactly as the board: four items, the active one in a light-blue pill with blue icon and label.
class EdmnBottomNavigation extends StatelessWidget {
  const EdmnBottomNavigation({
    super.key,
    required this.items,
    required this.currentIndex,
    required this.onTap,
  });
  final List<EdmnNavItem> items;
  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: EdmnColors.surface,
      border: Border(top: BorderSide(color: EdmnColors.border)),
      boxShadow: EdmnShadows.card,
    ),
    child: SafeArea(
      top: false,
      child: SizedBox(
        height: EdmnSizes.bottomNavHeight,
        child: Row(
          children: [
            for (var i = 0; i < items.length; i++)
              Expanded(
                child: _NavButton(
                  item: items[i],
                  selected: i == currentIndex,
                  onTap: () => onTap(i),
                ),
              ),
          ],
        ),
      ),
    ),
  );
}

class EdmnNavItem {
  const EdmnNavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    this.badge,
  });
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final int? badge;
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.item,
    required this.selected,
    required this.onTap,
  });
  final EdmnNavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? EdmnColors.primary : EdmnColors.textPrimary;
    return Semantics(
      selected: selected,
      button: true,
      label: item.label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(EdmnRadii.card),
        child: Padding(
          padding: const EdgeInsetsDirectional.symmetric(
            horizontal: EdmnSpacing.xxs,
            vertical: EdmnSpacing.xs,
          ),
          child: AnimatedContainer(
            duration: EdmnMotion.fast,
            decoration: BoxDecoration(
              color: selected ? EdmnColors.primaryLight : null,
              borderRadius: BorderRadius.circular(EdmnRadii.card),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Badge(
                  isLabelVisible: (item.badge ?? 0) > 0,
                  backgroundColor: EdmnColors.brandRed,
                  label: Text('${item.badge}'),
                  child: Icon(
                    selected ? item.activeIcon : item.icon,
                    color: color,
                    size: EdmnSizes.icon,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  item.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EdmnType.caption.copyWith(
                    color: color,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Section title with an optional leading icon and a "see all" link (board: "منتجات مميزة … عرض الكل >").
class EdmnSectionHeader extends StatelessWidget {
  const EdmnSectionHeader({
    super.key,
    required this.title,
    this.icon,
    this.actionLabel,
    this.onAction,
  });
  final String title;
  final IconData? icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsetsDirectional.fromSTEB(
      EdmnSpacing.screen,
      EdmnSpacing.lg,
      EdmnSpacing.screen,
      EdmnSpacing.sm,
    ),
    child: Row(
      children: [
        if (icon != null) ...[
          Icon(icon, color: EdmnColors.primary, size: EdmnSizes.icon),
          const SizedBox(width: EdmnSpacing.xs),
        ],
        Expanded(
          child: Text(
            title,
            style: EdmnType.cardTitle.copyWith(
              fontWeight: FontWeight.w700,
              color: EdmnColors.textPrimary,
            ),
          ),
        ),
        if (actionLabel != null)
          TextButton(
            onPressed: onAction,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  actionLabel!,
                  style: EdmnType.secondary.copyWith(
                    color: EdmnColors.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Icon(Icons.chevron_right_rounded, size: EdmnSizes.iconSm),
              ],
            ),
          ),
      ],
    ),
  );
}

/// Board bottom sheet: rounded top, drag handle, title, content, optional pinned action.
Future<T?> showEdmnBottomSheet<T>(
  BuildContext context, {
  required String title,
  required Widget child,
  Widget? action,
}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (c) => EdmnBottomSheet(title: title, action: action, child: child),
);

class EdmnBottomSheet extends StatelessWidget {
  const EdmnBottomSheet({
    super.key,
    required this.title,
    required this.child,
    this.action,
  });
  final String title;
  final Widget child;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsetsDirectional.only(
      bottom: MediaQuery.viewInsetsOf(context).bottom,
    ),
    child: SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(
          EdmnSpacing.screen,
          0,
          EdmnSpacing.screen,
          EdmnSpacing.md,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              title,
              style: EdmnType.section.copyWith(color: EdmnColors.textPrimary),
            ),
            const SizedBox(height: EdmnSpacing.md),
            Flexible(child: SingleChildScrollView(child: child)),
            if (action != null) ...[
              const SizedBox(height: EdmnSpacing.md),
              action!,
            ],
          ],
        ),
      ),
    ),
  );
}
