import 'package:flutter/material.dart';

import '../money_text.dart';
import '../tokens.dart';
import 'controls.dart';
import 'media.dart';

/// White card with the board's light border, 16 radius and faint shadow.
class EdmnCard extends StatelessWidget {
  const EdmnCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsetsDirectional.all(EdmnSpacing.md),
    this.onTap,
    this.color = EdmnColors.surface,
    this.margin,
  });
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final VoidCallback? onTap;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: margin ?? EdgeInsets.zero,
    child: Material(
      color: color,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(EdmnRadii.card),
        side: const BorderSide(color: EdmnColors.border),
      ),
      shadowColor: EdmnColors.textPrimary.withValues(alpha: 0.12),
      elevation: 1.5,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    ),
  );
}

/// Board product card: image, 2-line title, bold price, outlined "أضف" with cart icon, and the board's heart in the
/// image corner when the screen passes [saved] / [onToggleSaved] (the wishlist API, VISUAL_AUDIT V-04).
class EdmnProductCard extends StatelessWidget {
  const EdmnProductCard({
    super.key,
    required this.title,
    required this.imageUrl,
    required this.pricePiastres,
    this.compareAtPiastres,
    required this.onTap,
    this.onAdd,
    this.addLabel,
    this.badge,
    this.unavailableLabel,
    this.adding = false,
    this.width = 156,
    this.saved,
    this.onToggleSaved,
    this.saveLabel,
  });
  final String title;
  final String? imageUrl;
  final int? pricePiastres;
  final int? compareAtPiastres;
  final VoidCallback onTap;
  final VoidCallback? onAdd;
  final String? addLabel;

  /// e.g. "مستعمل" condition chip.
  final String? badge;

  /// Shown instead of the add button when out of stock.
  final String? unavailableLabel;
  final bool adding;
  final double? width;

  /// Wishlist state; the heart is shown only when this is non-null.
  final bool? saved;
  final VoidCallback? onToggleSaved;

  /// Accessibility label of the heart ("أضف للمفضلة" / "شيل من المفضلة").
  final String? saveLabel;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: width,
    child: EdmnCard(
      onTap: onTap,
      padding: const EdgeInsetsDirectional.all(EdmnSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The image takes the space left by the text and button, so large accessibility fonts never overflow.
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  child: EdmnNetworkImage(
                    url: imageUrl,
                    fit: BoxFit.contain,
                    radius: EdmnRadii.small,
                  ),
                ),
                if (badge != null)
                  PositionedDirectional(
                    top: 0,
                    start: 0,
                    child: EdmnStatusChipSmall(label: badge!),
                  ),
                if (saved != null)
                  PositionedDirectional(
                    top: 0,
                    end: 0,
                    child: EdmnSaveButton(saved: saved!, onPressed: onToggleSaved, label: saveLabel),
                  ),
              ],
            ),
          ),
          const SizedBox(height: EdmnSpacing.xs),
          Text(
            title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: EdmnType.secondary.copyWith(
              color: EdmnColors.textPrimary,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: EdmnSpacing.xxs),
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: EdmnSpacing.xxs,
            children: [
              EgpText(
                pricePiastres,
                style: EdmnType.bodyStrong.copyWith(
                  color: EdmnColors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (compareAtPiastres != null &&
                  pricePiastres != null &&
                  compareAtPiastres! > pricePiastres!)
                EgpText(
                  compareAtPiastres,
                  style: EdmnType.caption.copyWith(
                    color: EdmnColors.textSecondary,
                    decoration: TextDecoration.lineThrough,
                  ),
                ),
            ],
          ),
          const SizedBox(height: EdmnSpacing.xs),
          if (unavailableLabel != null)
            Container(
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: EdmnColors.subtle,
                borderRadius: BorderRadius.circular(EdmnRadii.chip),
              ),
              child: Text(
                unavailableLabel!,
                style: EdmnType.caption.copyWith(
                  color: EdmnColors.textSecondary,
                ),
              ),
            )
          else if (addLabel != null)
            EdmnSecondaryButton(
              label: addLabel!,
              icon: Icons.add_shopping_cart_rounded,
              onPressed: onAdd,
              loading: adding,
              compact: true,
            ),
        ],
      ),
    ),
  );
}

/// Small condition / tag chip used on product images.
class EdmnStatusChipSmall extends StatelessWidget {
  const EdmnStatusChipSmall({super.key, required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsetsDirectional.symmetric(
      horizontal: EdmnSpacing.xs,
      vertical: 2,
    ),
    decoration: BoxDecoration(
      color: EdmnColors.primaryLight,
      borderRadius: BorderRadius.circular(EdmnRadii.chip),
    ),
    child: Text(
      label,
      style: EdmnType.caption.copyWith(color: EdmnColors.primaryDark),
    ),
  );
}

/// Category tile: light rounded square, icon, label (board: categories grid and the home icon row).
class EdmnCategoryItem extends StatelessWidget {
  const EdmnCategoryItem({
    super.key,
    required this.label,
    required this.icon,
    required this.onTap,
    this.compact = false,
    this.selected = false,
    this.onDark = false,
  });
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  /// Compact = the home header row (icon over label, no tile).
  final bool compact;
  final bool selected;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    if (compact) {
      final c = onDark ? EdmnColors.onPrimary : EdmnColors.textPrimary;
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(EdmnRadii.small),
        child: Padding(
          padding: const EdgeInsetsDirectional.symmetric(
            horizontal: EdmnSpacing.xs,
            vertical: EdmnSpacing.xxs,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: c, size: EdmnSizes.iconLg),
              const SizedBox(height: EdmnSpacing.xxs),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: EdmnType.caption.copyWith(
                  color: c,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: EdmnSpacing.xxs),
              AnimatedContainer(
                duration: EdmnMotion.fast,
                height: 3,
                width: selected ? 32 : 0,
                decoration: BoxDecoration(
                  color: c,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ],
          ),
        ),
      );
    }
    return Material(
      color: EdmnColors.subtle,
      borderRadius: BorderRadius.circular(EdmnRadii.tile),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(EdmnRadii.tile),
        child: Padding(
          padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: EdmnColors.primary, size: 40),
              const SizedBox(height: EdmnSpacing.xs),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: EdmnType.bodyStrong.copyWith(
                  color: EdmnColors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Account / seller-center menu row: icon in a soft circle at the start, title, chevron at the end.
class EdmnMenuItem extends StatelessWidget {
  const EdmnMenuItem({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
    this.trailing,
    this.destructive = false,
  });
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Widget? trailing;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final c = destructive ? EdmnColors.error : EdmnColors.textPrimary;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsetsDirectional.symmetric(
          horizontal: EdmnSpacing.md,
          vertical: EdmnSpacing.sm,
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: const BoxDecoration(
                color: EdmnColors.subtle,
                shape: BoxShape.circle,
              ),
              child: Icon(
                icon,
                color: destructive ? EdmnColors.error : EdmnColors.primaryDark,
                size: EdmnSizes.icon,
              ),
            ),
            const SizedBox(width: EdmnSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: EdmnType.bodyStrong.copyWith(
                      color: c,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle!,
                      style: EdmnType.secondary.copyWith(
                        color: EdmnColors.textSecondary,
                      ),
                    ),
                ],
              ),
            ),
            trailing ??
                Icon(
                  Icons.chevron_right_rounded,
                  color: EdmnColors.textSecondary,
                  size: EdmnSizes.icon,
                  textDirection: Directionality.of(context),
                ),
          ],
        ),
      ),
    );
  }
}

/// Grouped menu (board account / seller lists) — rows separated by indented dividers inside one card.
class EdmnMenuGroup extends StatelessWidget {
  const EdmnMenuGroup({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => EdmnCard(
    padding: EdgeInsets.zero,
    child: Column(
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const Divider(indent: 64, endIndent: EdmnSpacing.md),
          children[i],
        ],
      ],
    ),
  );
}

/// Stat tile (board seller center): label, big value, icon in a tinted circle.
class EdmnStatTile extends StatelessWidget {
  const EdmnStatTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.tint = EdmnColors.primary,
  });
  final String label;
  final Widget value;
  final IconData icon;
  final Color tint;

  @override
  Widget build(BuildContext context) => EdmnCard(
    padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: tint.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: tint, size: EdmnSizes.icon),
        ),
        const SizedBox(width: EdmnSpacing.xs),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: EdmnType.secondary.copyWith(
                  color: EdmnColors.textSecondary,
                ),
              ),
              DefaultTextStyle.merge(
                style: EdmnType.section.copyWith(color: EdmnColors.textPrimary),
                child: FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: value),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

/// Seller / store summary (board seller center header): store icon, name, sub-line and an active chip.
class EdmnSellerSummary extends StatelessWidget {
  const EdmnSellerSummary({
    super.key,
    required this.name,
    this.subtitle,
    this.status,
  });
  final String name;
  final String? subtitle;
  final Widget? status;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: EdmnSizes.avatar,
        height: EdmnSizes.avatar,
        decoration: const BoxDecoration(
          color: EdmnColors.primary,
          shape: BoxShape.circle,
          boxShadow: EdmnShadows.card,
        ),
        child: const Icon(
          Icons.storefront_rounded,
          color: EdmnColors.onPrimary,
          size: EdmnSizes.iconLg,
        ),
      ),
      const SizedBox(width: EdmnSpacing.sm),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              name,
              style: EdmnType.cardTitle.copyWith(
                color: EdmnColors.textPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (subtitle != null)
              Text(
                subtitle!,
                style: EdmnType.secondary.copyWith(
                  color: EdmnColors.textSecondary,
                ),
              ),
          ],
        ),
      ),
      ?status,
    ],
  );
}

/// Profile header (board account): avatar circle, name, phone (LTR), edit action.
class EdmnProfileHeader extends StatelessWidget {
  const EdmnProfileHeader({
    super.key,
    required this.name,
    this.phone,
    this.onEdit,
    this.editTooltip,
  });
  final String name;
  final String? phone;
  final VoidCallback? onEdit;
  final String? editTooltip;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: EdmnSizes.avatar + 8,
        height: EdmnSizes.avatar + 8,
        decoration: const BoxDecoration(
          color: EdmnColors.primary,
          shape: BoxShape.circle,
          boxShadow: EdmnShadows.card,
        ),
        child: const Icon(
          Icons.person_rounded,
          color: EdmnColors.onPrimary,
          size: 40,
        ),
      ),
      const SizedBox(width: EdmnSpacing.sm),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              name,
              style: EdmnType.cardTitle.copyWith(
                color: EdmnColors.textPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (phone != null)
              Text(
                phone!,
                textDirection: TextDirection.ltr,
                style: EdmnType.body.copyWith(color: EdmnColors.textSecondary),
              ),
          ],
        ),
      ),
      if (onEdit != null)
        IconButton(
          tooltip: editTooltip,
          onPressed: onEdit,
          icon: const Icon(
            Icons.edit_outlined,
            color: EdmnColors.primaryDark,
            size: EdmnSizes.icon,
          ),
        ),
    ],
  );
}

/// Wallet balance card (board): blue gradient, label, big amount, wallet icon. Only the server's numbers are shown.
class EdmnWalletCard extends StatelessWidget {
  const EdmnWalletCard({
    super.key,
    required this.label,
    required this.amountPiastres,
    this.footer,
  });
  final String label;
  final int? amountPiastres;
  final Widget? footer;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      gradient: EdmnColors.headerGradient,
      borderRadius: BorderRadius.circular(EdmnRadii.card),
      boxShadow: EdmnShadows.floating,
    ),
    padding: const EdgeInsetsDirectional.all(EdmnSpacing.lg),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(
              Icons.account_balance_wallet_outlined,
              color: EdmnColors.onPrimary,
              size: 48,
            ),
            const SizedBox(width: EdmnSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: EdmnType.bodyStrong.copyWith(
                      color: EdmnColors.onPrimary,
                    ),
                  ),
                  EgpText(
                    amountPiastres,
                    style: EdmnType.balance.copyWith(
                      color: EdmnColors.onPrimary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (footer != null) ...[
          const SizedBox(height: EdmnSpacing.sm),
          footer!,
        ],
      ],
    ),
  );
}

/// Quick action (board wallet: "شحن الرصيد / تحويل رصيد / سجل المعاملات").
class EdmnQuickAction extends StatelessWidget {
  const EdmnQuickAction({
    super.key,
    required this.icon,
    required this.label,
    this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(EdmnRadii.small),
    child: Padding(
      padding: const EdgeInsetsDirectional.symmetric(
        vertical: EdmnSpacing.sm,
        horizontal: EdmnSpacing.xxs,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            color: onTap == null ? EdmnColors.disabled : EdmnColors.primary,
            size: EdmnSizes.iconLg,
          ),
          const SizedBox(height: EdmnSpacing.xs),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            style: EdmnType.bodyStrong.copyWith(
              color: onTap == null
                  ? EdmnColors.disabled
                  : EdmnColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    ),
  );
}

/// Transaction row (board wallet): icon in soft circle, title, timestamp, signed amount colored by direction.
class EdmnTransactionRow extends StatelessWidget {
  const EdmnTransactionRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.amountPiastres,
    this.status,
    this.onTap,
  });
  final IconData icon;
  final String title;
  final String subtitle;

  /// Signed: positive = credit (green), negative = debit (red). Pending amounts pass [status].
  final int amountPiastres;
  final Widget? status;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsetsDirectional.symmetric(
        horizontal: EdmnSpacing.md,
        vertical: EdmnSpacing.sm,
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: const BoxDecoration(
              color: EdmnColors.subtle,
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              color: EdmnColors.primaryDark,
              size: EdmnSizes.icon,
            ),
          ),
          const SizedBox(width: EdmnSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: EdmnType.bodyStrong.copyWith(
                    color: EdmnColors.textPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  subtitle,
                  style: EdmnType.secondary.copyWith(
                    color: EdmnColors.textSecondary,
                  ),
                ),
                if (status != null)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(
                      top: EdmnSpacing.xxs,
                    ),
                    child: status!,
                  ),
              ],
            ),
          ),
          EgpText(
            amountPiastres,
            signed: true,
            style: EdmnType.bodyStrong.copyWith(
              color: amountPiastres >= 0
                  ? EdmnColors.success
                  : EdmnColors.error,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    ),
  );
}

/// Order card (board "طلباتي"): number, date, status chip, item thumbnails, total, chevron.
class EdmnOrderCard extends StatelessWidget {
  const EdmnOrderCard({
    super.key,
    required this.number,
    required this.date,
    required this.status,
    required this.totalPiastres,
    this.thumbnails = const [],
    this.onTap,
  });
  final String number;
  final String date;
  final Widget status;
  final int totalPiastres;
  final List<String?> thumbnails;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => EdmnCard(
    onTap: onTap,
    margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '#$number',
                      textDirection: TextDirection.ltr,
                      textAlign: TextAlign.start,
                      style: EdmnType.cardTitle.copyWith(
                        color: EdmnColors.textPrimary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  status,
                ],
              ),
              Text(
                date,
                style: EdmnType.secondary.copyWith(
                  color: EdmnColors.textSecondary,
                ),
              ),
              const SizedBox(height: EdmnSpacing.xs),
              Row(
                children: [
                  for (final t in thumbnails.take(3))
                    Padding(
                      padding: const EdgeInsetsDirectional.only(
                        end: EdmnSpacing.xs,
                      ),
                      child: EdmnThumb(url: t),
                    ),
                  const Spacer(),
                  EgpText(
                    totalPiastres,
                    style: EdmnType.price.copyWith(
                      color: EdmnColors.textPrimary,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: EdmnSpacing.xs),
        const Icon(
          Icons.chevron_right_rounded,
          color: EdmnColors.textSecondary,
        ),
      ],
    ),
  );
}

/// Protected Deal summary card.
class EdmnSecureDealCard extends StatelessWidget {
  const EdmnSecureDealCard({
    super.key,
    required this.title,
    required this.counterparty,
    required this.amountPiastres,
    required this.status,
    this.roleLabel,
    this.onTap,
  });
  final String title;
  final String counterparty;
  final int amountPiastres;
  final Widget status;
  final String? roleLabel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => EdmnCard(
    onTap: onTap,
    margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
    child: Row(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: const BoxDecoration(
            color: EdmnColors.primaryLight,
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.verified_user_outlined,
            color: EdmnColors.primary,
          ),
        ),
        const SizedBox(width: EdmnSpacing.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: EdmnType.bodyStrong.copyWith(
                  color: EdmnColors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                [?roleLabel, counterparty].join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: EdmnType.secondary.copyWith(
                  color: EdmnColors.textSecondary,
                ),
              ),
              const SizedBox(height: EdmnSpacing.xxs),
              status,
            ],
          ),
        ),
        EgpText(
          amountPiastres,
          style: EdmnType.bodyStrong.copyWith(
            color: EdmnColors.textPrimary,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

/// Notification row: unread dot, title, body, time.
class EdmnNotificationItem extends StatelessWidget {
  const EdmnNotificationItem({
    super.key,
    required this.title,
    required this.body,
    required this.time,
    this.unread = false,
    this.onTap,
  });
  final String title;
  final String body;
  final String time;
  final bool unread;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Container(
      color: unread ? EdmnColors.primaryLight.withValues(alpha: 0.5) : null,
      padding: const EdgeInsetsDirectional.symmetric(
        horizontal: EdmnSpacing.md,
        vertical: EdmnSpacing.sm,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(
              color: EdmnColors.subtle,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.notifications_none_rounded,
              color: EdmnColors.primaryDark,
            ),
          ),
          const SizedBox(width: EdmnSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: EdmnType.bodyStrong.copyWith(
                    color: EdmnColors.textPrimary,
                    fontWeight: unread ? FontWeight.w700 : FontWeight.w600,
                  ),
                ),
                Text(
                  body,
                  style: EdmnType.secondary.copyWith(
                    color: EdmnColors.textSecondary,
                  ),
                ),
                Text(
                  time,
                  style: EdmnType.caption.copyWith(
                    color: EdmnColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          if (unread)
            Container(
              width: 8,
              height: 8,
              margin: const EdgeInsetsDirectional.only(top: 6),
              decoration: const BoxDecoration(
                color: EdmnColors.brandRed,
                shape: BoxShape.circle,
              ),
            ),
        ],
      ),
    ),
  );
}

/// The board's wishlist heart: outlined when not saved, filled brand red when saved, on a white circle.
class EdmnSaveButton extends StatelessWidget {
  const EdmnSaveButton({super.key, required this.saved, required this.onPressed, this.label, this.size = 32});
  final bool saved;
  final VoidCallback? onPressed;
  final String? label;
  final double size;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    toggled: saved,
    label: label,
    child: Material(
      color: EdmnColors.surface,
      shape: const CircleBorder(side: BorderSide(color: EdmnColors.border)),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(
            saved ? Icons.favorite_rounded : Icons.favorite_border_rounded,
            size: size * 0.56,
            color: saved ? EdmnColors.brandRed : EdmnColors.textSecondary,
          ),
        ),
      ),
    ),
  );
}
