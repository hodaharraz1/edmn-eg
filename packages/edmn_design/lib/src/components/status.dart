import 'package:flutter/material.dart';

import '../money_text.dart';
import '../tokens.dart';

enum EdmnTone { neutral, info, success, warning, danger }

/// Status pill (board: "قيد التنفيذ" blue/green, "تم التوصيل" green, "ملغي" red). Tone comes from the server status.
class EdmnStatusChip extends StatelessWidget {
  const EdmnStatusChip({
    super.key,
    required this.label,
    this.tone = EdmnTone.info,
  });
  final String label;
  final EdmnTone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      EdmnTone.neutral => (EdmnColors.subtle, EdmnColors.textSecondary),
      EdmnTone.info => (EdmnColors.infoLight, EdmnColors.primary),
      EdmnTone.success => (EdmnColors.successLight, EdmnColors.success),
      EdmnTone.warning => (EdmnColors.warningLight, EdmnColors.warning),
      EdmnTone.danger => (EdmnColors.errorLight, EdmnColors.error),
    };
    return Container(
      padding: const EdgeInsetsDirectional.symmetric(
        horizontal: EdmnSpacing.sm,
        vertical: EdmnSpacing.xxs,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(EdmnRadii.chip),
      ),
      child: Text(
        label,
        style: EdmnType.secondary.copyWith(
          color: fg,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

enum EdmnStepState { done, current, pending, failed }

class EdmnTimelineStep {
  const EdmnTimelineStep({
    required this.title,
    required this.state,
    this.time,
    this.detail,
  });
  final String title;
  final EdmnStepState state;
  final String? time;
  final String? detail;
}

/// Vertical tracking timeline (board "حالة الطلب"): green check for completed steps joined by a green line, the current
/// step in brand blue, pending steps as gray outlines. Steps come from server events only.
class EdmnTrackingTimeline extends StatelessWidget {
  const EdmnTrackingTimeline({super.key, required this.steps});
  final List<EdmnTimelineStep> steps;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (var i = 0; i < steps.length; i++)
        _TimelineRow(step: steps[i], isLast: i == steps.length - 1),
    ],
  );
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({required this.step, required this.isLast});
  final EdmnTimelineStep step;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final s = step.state;
    final Widget dot = switch (s) {
      EdmnStepState.done => const _Dot(
        color: EdmnColors.success,
        child: Icon(Icons.check_rounded, color: EdmnColors.onPrimary, size: 18),
      ),
      EdmnStepState.current => const _Dot(
        color: EdmnColors.primary,
        child: Icon(Icons.circle, color: EdmnColors.onPrimary, size: 10),
      ),
      EdmnStepState.failed => const _Dot(
        color: EdmnColors.error,
        child: Icon(Icons.close_rounded, color: EdmnColors.onPrimary, size: 18),
      ),
      EdmnStepState.pending => Container(
        width: 28,
        height: 28,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: EdmnColors.disabled, width: 2),
        ),
      ),
    };
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 32,
            child: Column(
              children: [
                dot,
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      color: s == EdmnStepState.done
                          ? EdmnColors.success
                          : EdmnColors.border,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: EdmnSpacing.sm),
          Expanded(
            child: Padding(
              padding: EdgeInsetsDirectional.only(
                bottom: isLast ? 0 : EdmnSpacing.lg,
                top: 2,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    step.title,
                    style: EdmnType.bodyStrong.copyWith(
                      color: s == EdmnStepState.pending
                          ? EdmnColors.textSecondary
                          : EdmnColors.textPrimary,
                      fontWeight: s == EdmnStepState.current
                          ? FontWeight.w800
                          : FontWeight.w700,
                    ),
                  ),
                  if (step.time != null)
                    Text(
                      step.time!,
                      style: EdmnType.secondary.copyWith(
                        color: EdmnColors.textSecondary,
                      ),
                    ),
                  if (step.detail != null)
                    Text(
                      step.detail!,
                      style: EdmnType.secondary.copyWith(
                        color: EdmnColors.textSecondary,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.color, required this.child});
  final Color color;
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    width: 28,
    height: 28,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    child: Center(child: child),
  );
}

/// Horizontal checkout stepper (board "إتمام الطلب": العنوان → التوصيل → الدفع → تأكيد).
class EdmnStepper extends StatelessWidget {
  const EdmnStepper({super.key, required this.labels, required this.current});
  final List<String> labels;
  final int current;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (var i = 0; i < labels.length; i++) ...[
        Expanded(
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: i == 0
                        ? const SizedBox()
                        : Container(
                            height: 2,
                            color: i <= current
                                ? EdmnColors.primary
                                : EdmnColors.border,
                          ),
                  ),
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i <= current
                          ? EdmnColors.primary
                          : EdmnColors.border,
                    ),
                    child: Center(
                      child: i < current
                          ? const Icon(
                              Icons.check_rounded,
                              color: EdmnColors.onPrimary,
                              size: 18,
                            )
                          : Text(
                              '${i + 1}',
                              style: EdmnType.secondary.copyWith(
                                color: i == current
                                    ? EdmnColors.onPrimary
                                    : EdmnColors.textSecondary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                    ),
                  ),
                  Expanded(
                    child: i == labels.length - 1
                        ? const SizedBox()
                        : Container(
                            height: 2,
                            color: i < current
                                ? EdmnColors.primary
                                : EdmnColors.border,
                          ),
                  ),
                ],
              ),
              const SizedBox(height: EdmnSpacing.xxs),
              Text(
                labels[i],
                textAlign: TextAlign.center,
                style: EdmnType.secondary.copyWith(
                  color: i <= current
                      ? EdmnColors.primaryDark
                      : EdmnColors.disabled,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    ],
  );
}

/// Order summary rows + highlighted total box (board cart / checkout). All values are server totals.
class EdmnAmountSummary extends StatelessWidget {
  const EdmnAmountSummary({
    super.key,
    required this.rows,
    required this.totalLabel,
    required this.totalPiastres,
    this.note,
  });
  final List<(String, int?)> rows;
  final String totalLabel;
  final int? totalPiastres;
  final String? note;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final (label, value) in rows)
        Padding(
          padding: const EdgeInsetsDirectional.symmetric(
            vertical: EdmnSpacing.xxs,
            horizontal: EdmnSpacing.xxs,
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: EdmnType.body.copyWith(
                    color: EdmnColors.textSecondary,
                  ),
                ),
              ),
              EgpText(
                value,
                style: EdmnType.bodyStrong.copyWith(
                  color: EdmnColors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      const SizedBox(height: EdmnSpacing.xs),
      Container(
        padding: const EdgeInsetsDirectional.symmetric(
          horizontal: EdmnSpacing.md,
          vertical: EdmnSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: EdmnColors.primaryLight,
          borderRadius: BorderRadius.circular(EdmnRadii.small),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                totalLabel,
                style: EdmnType.cardTitle.copyWith(
                  color: EdmnColors.textPrimary,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            EgpText(
              totalPiastres,
              key: const Key('grand-total'),
              style: EdmnType.priceLarge.copyWith(
                color: EdmnColors.textPrimary,
              ),
            ),
          ],
        ),
      ),
      if (note != null)
        Padding(
          padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.xs),
          child: Text(
            note!,
            style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary),
          ),
        ),
    ],
  );
}

/// Inline notice (info / warning / error) for pending states, policy text and blocking reasons.
class EdmnNotice extends StatelessWidget {
  const EdmnNotice({
    super.key,
    required this.message,
    this.tone = EdmnTone.info,
    this.icon,
    this.title,
  });
  final String message;
  final String? title;
  final EdmnTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, defIcon) = switch (tone) {
      EdmnTone.success => (
        EdmnColors.successLight,
        EdmnColors.success,
        Icons.check_circle_outline_rounded,
      ),
      EdmnTone.warning => (
        EdmnColors.warningLight,
        EdmnColors.warning,
        Icons.hourglass_top_rounded,
      ),
      EdmnTone.danger => (
        EdmnColors.errorLight,
        EdmnColors.error,
        Icons.error_outline_rounded,
      ),
      _ => (
        EdmnColors.primaryLight,
        EdmnColors.primaryDark,
        Icons.info_outline_rounded,
      ),
    };
    return Container(
      padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(EdmnRadii.small),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon ?? defIcon, color: fg, size: EdmnSizes.icon),
          const SizedBox(width: EdmnSpacing.xs),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null)
                  Text(
                    title!,
                    style: EdmnType.bodyStrong.copyWith(
                      color: fg,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                Text(
                  message,
                  style: EdmnType.secondary.copyWith(
                    color: EdmnColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
