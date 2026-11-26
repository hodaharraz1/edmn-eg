import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../tokens.dart';

/// PKG-UI-01: the floating navigation bar from the reference video — a frosted-glass pill floating above the bottom
/// edge instead of the old docked bar. The reference keeps the bar visible while scrolling, so the bar is pinned and
/// does not auto-hide; the press feedback and the active-tab accent animate (and stop animating under
/// MediaQuery.disableAnimations / "تقليل الحركة").
///
/// The tab set is the app's own four tabs (الرئيسية، الأقسام، المحفظة، طلباتي) in the existing order. The reference
/// video's center slot is a green brand circle; per the owner's decision (2026-11-26, no centre button), the ACTIVE
/// tab gets the green accent circle instead, whatever tab it is.
class EdmnFloatingNavigation extends StatelessWidget {
  const EdmnFloatingNavigation({
    super.key,
    required this.items,
    required this.currentIndex,
    required this.onTap,
  });

  final List<EdmnFloatingNavItem> items;
  final int currentIndex;
  final ValueChanged<int> onTap;

  /// Vertical space a screen should reserve at the bottom so content is never hidden under the bar (bar height +
  /// margins). Screens inside the shell add `EdmnFloatingNavigation.clearanceOf(context)` to their scroll padding.
  static const double barHeight = 64;

  static double clearanceOf(BuildContext context) => barHeight + EdmnSpacing.lg + MediaQuery.viewPaddingOf(context).bottom;

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final padding = MediaQuery.viewPaddingOf(context);
    return Padding(
      padding: EdgeInsetsDirectional.fromSTEB(
        EdmnSpacing.md,
        0,
        EdmnSpacing.md,
        EdmnSpacing.sm + padding.bottom,
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(EdmnRadii.chip),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
          child: Container(
            height: barHeight,
            decoration: BoxDecoration(
              color: EdmnColors.surface.withValues(alpha: 0.82),
              borderRadius: BorderRadius.circular(EdmnRadii.chip),
              border: Border.all(color: EdmnColors.surface.withValues(alpha: 0.9)),
              boxShadow: EdmnShadows.floating,
            ),
            child: Row(
              children: [
                for (var i = 0; i < items.length; i++)
                  Expanded(
                    child: _FloatingNavButton(
                      item: items[i],
                      selected: i == currentIndex,
                      reduceMotion: reduceMotion,
                      onTap: () => onTap(i),
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

class EdmnFloatingNavItem {
  const EdmnFloatingNavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    this.badge,
    this.key,
  });
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final int? badge;
  final Key? key;
}

class _FloatingNavButton extends StatelessWidget {
  const _FloatingNavButton({
    required this.item,
    required this.selected,
    required this.reduceMotion,
    required this.onTap,
  });
  final EdmnFloatingNavItem item;
  final bool selected;
  final bool reduceMotion;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    const accentBg = EdmnColors.accentGreen;
    final icon = Icon(
      selected ? item.activeIcon : item.icon,
      size: EdmnSizes.icon,
      color: selected ? EdmnColors.onPrimary : EdmnColors.sunburstText,
    );
    final circle = AnimatedContainer(
      duration: reduceMotion ? Duration.zero : EdmnMotion.normal,
      curve: Curves.easeOutCubic,
      // 44px visual circle: the tappable area is the whole 62px-tall slot (well above the 48px minimum),
      // and circle + label must fit the bar without overflow.
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: selected ? accentBg : Colors.transparent,
        boxShadow: selected
            ? [BoxShadow(color: EdmnColors.accentGreen.withValues(alpha: 0.45), blurRadius: 12, offset: const Offset(0, 4))]
            : null,
      ),
      child: Center(
        child: Badge(
          isLabelVisible: (item.badge ?? 0) > 0,
          backgroundColor: EdmnColors.brandRed,
          label: Text('${item.badge}'),
          child: icon,
        ),
      ),
    );
    return Semantics(
      selected: selected,
      button: true,
      label: item.label,
      child: InkWell(
        key: item.key,
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: SizedBox(
          height: double.infinity,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              circle,
              const SizedBox(height: 2),
              Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: EdmnType.caption.copyWith(
                  color: EdmnColors.sunburstText,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
