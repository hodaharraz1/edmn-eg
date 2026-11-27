import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../tokens.dart';

/// PKG-UI-01: the floating navigation bar — a frosted-glass pill floating above the bottom edge instead of the old
/// docked bar. Wrapped in [EdmnFloatingNavShell] it hides while the user scrolls down and comes back on scrolling up
/// (owner decision 2026-11-27). The press feedback, the active-tab accent and the hide/show slide stop animating under
/// MediaQuery.disableAnimations / "تقليل الحركة".
///
/// The tab set is the app's own four tabs (الرئيسية، الأقسام، المحفظة، طلباتي) in the existing order. There is no
/// centre button (owner decision 2026-11-26): the ACTIVE tab gets the brand-blue accent circle, whatever tab it is.
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
    // Owner decision (PKG-THEME-01 review): a lime circle on the frosted white bar is almost invisible (1.09:1),
    // so the active tab is a Cobalt circle carrying a lime icon (6.19:1), keeping lime as the 10% accent.
    const accentBg = EdmnColors.primary;
    final icon = Icon(
      selected ? item.activeIcon : item.icon,
      size: EdmnSizes.icon,
      color: selected ? EdmnColors.accent : EdmnColors.sunburstText,
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
            ? [BoxShadow(color: EdmnColors.primary.withValues(alpha: 0.45), blurRadius: 12, offset: const Offset(0, 4))]
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

/// Body + floating bar. The bar slides away while the user scrolls the page DOWN and slides back when they scroll UP,
/// reach the top, or switch tab. Only vertical scrolling counts (horizontal carousels and chips never hide it).
class EdmnFloatingNavShell extends StatefulWidget {
  const EdmnFloatingNavShell({super.key, required this.body, required this.navigation, this.index = 0});
  final Widget body;
  final Widget navigation;

  /// The current tab: changing it always shows the bar again.
  final int index;

  @override
  State<EdmnFloatingNavShell> createState() => _EdmnFloatingNavShellState();
}

class _EdmnFloatingNavShellState extends State<EdmnFloatingNavShell> {
  bool _visible = true;

  @override
  void didUpdateWidget(EdmnFloatingNavShell old) {
    super.didUpdateWidget(old);
    if (old.index != widget.index) _visible = true;
  }

  /// Hide/show slide: slow and smooth on purpose (owner feedback 2026-11-27: the 250 ms slide felt too fast).
  static const slideDuration = Duration(milliseconds: 550);

  /// Scroll distance (px) in one direction before the bar reacts, so small finger jitter never toggles it.
  static const _hideAfter = 48.0;
  static const _showAfter = 24.0;
  double _travel = 0;

  bool _onScroll(ScrollNotification n) {
    if (n.metrics.axis != Axis.vertical) return false;
    bool? next;
    if (n is ScrollUpdateNotification) {
      final d = n.scrollDelta ?? 0;
      if (d != 0) {
        if (d.sign != _travel.sign) _travel = 0; // direction changed: start counting again
        _travel += d;
        if (_travel > _hideAfter) next = false; // reading further down the page
        if (_travel < -_showAfter) next = true; // scrolling back up
      }
    }
    // Back at the very top (after the scroll settles) the bar is always there.
    if (n is ScrollEndNotification && n.metrics.pixels <= n.metrics.minScrollExtent) next = true;
    if (next != null && next != _visible) setState(() => _visible = next!);
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final duration = MediaQuery.disableAnimationsOf(context) ? Duration.zero : slideDuration;
    return Stack(
      children: [
        Positioned.fill(child: NotificationListener<ScrollNotification>(onNotification: _onScroll, child: widget.body)),
        PositionedDirectional(
          start: 0,
          end: 0,
          bottom: 0,
          child: IgnorePointer(
            ignoring: !_visible,
            child: AnimatedSlide(
              key: const Key('floating-nav-slide'),
              offset: _visible ? Offset.zero : const Offset(0, 1.6),
              duration: duration,
              curve: Curves.easeInOutCubic,
              child: AnimatedOpacity(opacity: _visible ? 1 : 0, duration: duration, curve: Curves.easeInOut, child: widget.navigation),
            ),
          ),
        ),
      ],
    );
  }
}
