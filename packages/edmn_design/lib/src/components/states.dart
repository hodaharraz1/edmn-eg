import 'package:edmn_core/edmn_core.dart';
import 'package:flutter/material.dart';

import '../errors.dart';
import '../l10n/edmn_localizations.dart';
import '../tokens.dart';
import 'controls.dart';

/// Initial loading: a centered spinner, or [EdmnSkeletonList] for lists (board-style placeholders).
class EdmnLoadingState extends StatelessWidget {
  const EdmnLoadingState({super.key, this.message});
  final String? message;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const CircularProgressIndicator(),
        if (message != null) ...[
          const SizedBox(height: EdmnSpacing.sm),
          Text(
            message!,
            style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary),
          ),
        ],
      ],
    ),
  );
}

/// Skeleton rows shown while a list loads.
class EdmnSkeletonList extends StatefulWidget {
  const EdmnSkeletonList({super.key, this.rows = 4, this.rowHeight = 88});
  final int rows;
  final double rowHeight;

  @override
  State<EdmnSkeletonList> createState() => _EdmnSkeletonListState();
}

class _EdmnSkeletonListState extends State<EdmnSkeletonList>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: EdmnLocalizations.of(context).loading,
    child: FadeTransition(
      opacity: Tween(begin: 0.45, end: 1.0).animate(_c),
      child: ListView.separated(
        // Never scrolls: shrink-wrapped so it can also sit inside a page's own scroll view while loading.
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen),
        itemCount: widget.rows,
        separatorBuilder: (_, _) => const SizedBox(height: EdmnSpacing.sm),
        itemBuilder: (_, _) => Container(
          height: widget.rowHeight,
          decoration: BoxDecoration(
            color: EdmnColors.subtle,
            borderRadius: BorderRadius.circular(EdmnRadii.card),
          ),
        ),
      ),
    ),
  );
}

/// Empty state in the brand style: icon in a soft circle, title, message, optional action.
class EdmnEmptyState extends StatelessWidget {
  const EdmnEmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
  });
  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsetsDirectional.all(EdmnSpacing.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 88,
            height: 88,
            decoration: const BoxDecoration(
              color: EdmnColors.primaryLight,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: EdmnColors.primary, size: 40),
          ),
          const SizedBox(height: EdmnSpacing.md),
          Text(
            title,
            textAlign: TextAlign.center,
            style: EdmnType.cardTitle.copyWith(
              color: EdmnColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (message != null) ...[
            const SizedBox(height: EdmnSpacing.xs),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: EdmnType.body.copyWith(color: EdmnColors.textSecondary),
            ),
          ],
          if (actionLabel != null) ...[
            const SizedBox(height: EdmnSpacing.lg),
            SizedBox(
              width: 220,
              child: EdmnPrimaryButton(
                label: actionLabel!,
                onPressed: onAction,
              ),
            ),
          ],
        ],
      ),
    ),
  );
}

/// Error state. The icon and title follow the error kind (offline, session expired, no permission, not found, generic);
/// the message is the single localized mapping of the API code ([apiErrorMessage]).
class EdmnErrorState extends StatelessWidget {
  const EdmnErrorState({
    super.key,
    required this.error,
    this.onRetry,
    this.onSignIn,
  });
  final Object error;
  final VoidCallback? onRetry;
  final VoidCallback? onSignIn;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final code = error is ApiFailure
        ? (error as ApiFailure).code
        : ApiErrorCode.unknown;
    final (icon, title) = switch (code) {
      ApiErrorCode.network => (Icons.wifi_off_rounded, t.stateOfflineTitle),
      ApiErrorCode.unauthenticated => (
        Icons.lock_clock_outlined,
        t.stateSessionExpiredTitle,
      ),
      ApiErrorCode.forbidden => (Icons.block_rounded, t.stateNoPermissionTitle),
      ApiErrorCode.notFound => (Icons.search_off_rounded, t.stateNotFoundTitle),
      _ => (Icons.error_outline_rounded, t.stateErrorTitle),
    };
    final signIn = code == ApiErrorCode.unauthenticated && onSignIn != null;
    return EdmnEmptyState(
      icon: icon,
      title: title,
      message: apiErrorMessage(context, error),
      actionLabel: signIn ? t.signIn : (onRetry == null ? null : t.retry),
      onAction: signIn ? onSignIn : onRetry,
    );
  }
}

/// Backwards-compatible name used by the Admin App.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) =>
      EdmnErrorState(error: error, onRetry: onRetry);
}

/// Confirmation dialog for irreversible or money-related actions. Returns true only on explicit confirm.
Future<bool> showEdmnConfirmation(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = false,
}) async {
  final t = EdmnLocalizations.of(context);
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => EdmnConfirmationDialog(
      title: title,
      message: message,
      confirmLabel: confirmLabel,
      cancelLabel: t.cancel,
      destructive: destructive,
    ),
  );
  return ok ?? false;
}

class EdmnConfirmationDialog extends StatelessWidget {
  const EdmnConfirmationDialog({
    super.key,
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.cancelLabel,
    this.destructive = false,
  });
  final String title;
  final String message;
  final String confirmLabel;
  final String cancelLabel;
  final bool destructive;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      title,
      style: EdmnType.cardTitle.copyWith(
        color: EdmnColors.textPrimary,
        fontWeight: FontWeight.w700,
      ),
    ),
    content: Text(
      message,
      style: EdmnType.body.copyWith(color: EdmnColors.textSecondary),
    ),
    actionsPadding: const EdgeInsetsDirectional.fromSTEB(
      EdmnSpacing.md,
      0,
      EdmnSpacing.md,
      EdmnSpacing.md,
    ),
    actions: [
      Row(
        children: [
          Expanded(
            child: EdmnSecondaryButton(
              key: const Key('dialog-cancel'),
              label: cancelLabel,
              onPressed: () => Navigator.pop(context, false),
            ),
          ),
          const SizedBox(width: EdmnSpacing.sm),
          Expanded(
            child: EdmnPrimaryButton(
              key: const Key('dialog-confirm'),
              label: confirmLabel,
              color: destructive ? EdmnColors.error : null,
              onPressed: () => Navigator.pop(context, true),
            ),
          ),
        ],
      ),
    ],
  );
}

/// "Load more" footer for paginated lists: spinner while loading, retry on failure, nothing at the end.
class EdmnPagination extends StatelessWidget {
  const EdmnPagination({
    super.key,
    required this.hasMore,
    required this.loading,
    this.error,
    required this.onLoadMore,
  });
  final bool hasMore;
  final bool loading;
  final Object? error;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    if (loading) {
      return const Padding(
        padding: EdgeInsetsDirectional.all(EdmnSpacing.md),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (error != null) {
      return Padding(
        padding: const EdgeInsetsDirectional.all(EdmnSpacing.md),
        child: Column(
          children: [
            Text(
              apiErrorMessage(context, error!),
              textAlign: TextAlign.center,
              style: EdmnType.secondary.copyWith(color: EdmnColors.error),
            ),
            TextButton(onPressed: onLoadMore, child: Text(t.retry)),
          ],
        ),
      );
    }
    if (!hasMore) return const SizedBox(height: EdmnSpacing.md);
    return Padding(
      padding: const EdgeInsetsDirectional.all(EdmnSpacing.md),
      child: EdmnSecondaryButton(
        key: const Key('load-more'),
        label: t.loadMore,
        onPressed: onLoadMore,
      ),
    );
  }
}

/// Snackbar helper for transient success / failure after an action (never for page-level errors).
void showEdmnMessage(
  BuildContext context,
  String message, {
  bool error = false,
}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? EdmnColors.error : EdmnColors.textPrimary,
      ),
    );
}

/// Shown for any unknown or broken link (deep link, notification, typo): never a framework error page.
class EdmnNotFoundScreen extends StatelessWidget {
  const EdmnNotFoundScreen({super.key, required this.onHome});
  final VoidCallback onHome;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: EdmnEmptyState(
          key: const Key('not-found'),
          icon: Icons.link_off_rounded,
          title: t.pageNotFoundTitle,
          message: t.pageNotFoundBody,
          actionLabel: t.home,
          onAction: onHome,
        ),
      ),
    );
  }
}

/// Covers the whole app while it is not in the foreground, so the system's app-switcher snapshot and screen
/// recordings never show secrets or personal data (MASVS-PLATFORM, policy SEC-127). Used by the staff app; on Android
/// it complements FLAG_SECURE, on iOS it is the only protection (iOS has no FLAG_SECURE).
class EdmnPrivacyShield extends StatefulWidget {
  const EdmnPrivacyShield({super.key, required this.child});
  final Widget child;

  @override
  State<EdmnPrivacyShield> createState() => _EdmnPrivacyShieldState();
}

class _EdmnPrivacyShieldState extends State<EdmnPrivacyShield> with WidgetsBindingObserver {
  bool _covered = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final cover = state != AppLifecycleState.resumed;
    if (cover != _covered) setState(() => _covered = cover);
  }

  @override
  Widget build(BuildContext context) => Stack(
    textDirection: TextDirection.ltr,
    children: [
      widget.child,
      if (_covered)
        const Positioned.fill(
          key: Key('privacy-shield'),
          child: ColoredBox(
            color: EdmnColors.primaryDeep,
            child: Center(child: Icon(Icons.lock_outline_rounded, color: EdmnColors.surface, size: 56)),
          ),
        ),
    ],
  );
}
