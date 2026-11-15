import 'package:flutter/material.dart';

import '../tokens.dart';

/// Remote image with a neutral placeholder and a broken-image fallback (no third-party cache dependency).
class EdmnNetworkImage extends StatelessWidget {
  const EdmnNetworkImage({
    super.key,
    required this.url,
    this.fit = BoxFit.cover,
    this.radius = 0,
    this.semanticLabel,
  });
  final String? url;
  final BoxFit fit;
  final double radius;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    const placeholder = ColoredBox(
      color: EdmnColors.subtle,
      child: Center(
        child: Icon(Icons.image_outlined, color: EdmnColors.disabled),
      ),
    );
    final u = url;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: u == null || u.isEmpty
          ? placeholder
          : Image.network(
              u,
              fit: fit,
              semanticLabel: semanticLabel,
              errorBuilder: (_, _, _) => placeholder,
              loadingBuilder: (c, child, p) => p == null ? child : placeholder,
            ),
    );
  }
}

/// Square thumbnail in a soft bordered box (board order cards / tracking).
class EdmnThumb extends StatelessWidget {
  const EdmnThumb({super.key, required this.url, this.size = EdmnSizes.thumb});
  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    padding: const EdgeInsetsDirectional.all(EdmnSpacing.xxs),
    decoration: BoxDecoration(
      color: EdmnColors.surface,
      border: Border.all(color: EdmnColors.border),
      borderRadius: BorderRadius.circular(EdmnRadii.small),
    ),
    child: EdmnNetworkImage(
      url: url,
      fit: BoxFit.contain,
      radius: EdmnRadii.small - 4,
    ),
  );
}

/// Product gallery: swipeable large image with the board's dot indicator.
class EdmnImageGallery extends StatefulWidget {
  const EdmnImageGallery({
    super.key,
    required this.urls,
    this.height = 280,
    this.overlay = const [],
  });
  final List<String> urls;
  final double height;

  /// e.g. share action, positioned by the caller.
  final List<Widget> overlay;

  @override
  State<EdmnImageGallery> createState() => _EdmnImageGalleryState();
}

class _EdmnImageGalleryState extends State<EdmnImageGallery> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final urls = widget.urls.isEmpty ? <String?>[null] : widget.urls;
    return Column(
      children: [
        SizedBox(
          height: widget.height,
          child: Stack(
            children: [
              PageView.builder(
                itemCount: urls.length,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (_, i) => Padding(
                  padding: const EdgeInsetsDirectional.symmetric(
                    horizontal: EdmnSpacing.xxl,
                  ),
                  child: EdmnNetworkImage(url: urls[i], fit: BoxFit.contain),
                ),
              ),
              ...widget.overlay,
            ],
          ),
        ),
        if (urls.length > 1) ...[
          const SizedBox(height: EdmnSpacing.sm),
          EdmnPageDots(count: urls.length, index: _page),
        ],
      ],
    );
  }
}

class EdmnPageDots extends StatelessWidget {
  const EdmnPageDots({
    super.key,
    required this.count,
    required this.index,
    this.onDark = false,
  });
  final int count;
  final int index;
  final bool onDark;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      for (var i = 0; i < count; i++)
        AnimatedContainer(
          duration: EdmnMotion.fast,
          margin: const EdgeInsetsDirectional.symmetric(horizontal: 3),
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: i == index
                ? (onDark ? EdmnColors.onPrimary : EdmnColors.primary)
                : (onDark ? EdmnColors.accentCyan : EdmnColors.disabled),
          ),
        ),
    ],
  );
}

/// File picker field for receipts / evidence. The picker itself is injected by the app (platform plugin), so this
/// component stays testable: it only renders the selected file name, upload progress and failure.
class EdmnUploadField extends StatelessWidget {
  const EdmnUploadField({
    super.key,
    required this.label,
    required this.hint,
    this.fileName,
    this.onPick,
    this.onClear,
    this.uploading = false,
    this.error,
  });
  final String label;
  final String hint;
  final String? fileName;
  final VoidCallback? onPick;
  final VoidCallback? onClear;
  final bool uploading;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final hasFile = fileName != null;
    final borderColor = error != null
        ? EdmnColors.error
        : (hasFile ? EdmnColors.primary : EdmnColors.border);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label,
          style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary),
        ),
        const SizedBox(height: EdmnSpacing.xs),
        Semantics(
          button: true,
          label: fileName ?? hint,
          excludeSemantics: true,
          child: InkWell(
            key: const Key('upload-field'),
            onTap: uploading ? null : onPick,
            borderRadius: BorderRadius.circular(EdmnRadii.card),
            child: Container(
              padding: const EdgeInsetsDirectional.all(EdmnSpacing.md),
              decoration: BoxDecoration(
                color: hasFile ? EdmnColors.primaryLight : EdmnColors.subtle,
                border: Border.all(color: borderColor, width: 1.2),
                borderRadius: BorderRadius.circular(EdmnRadii.card),
              ),
              child: Row(
                children: [
                  Icon(
                    hasFile
                        ? Icons.insert_drive_file_outlined
                        : Icons.cloud_upload_outlined,
                    color: EdmnColors.primary,
                    size: EdmnSizes.iconLg,
                  ),
                  const SizedBox(width: EdmnSpacing.sm),
                  Expanded(
                    child: Text(
                      fileName ?? hint,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: EdmnType.body.copyWith(
                        color: hasFile
                            ? EdmnColors.textPrimary
                            : EdmnColors.textSecondary,
                      ),
                    ),
                  ),
                  if (uploading)
                    const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  else if (hasFile && onClear != null)
                    IconButton(
                      onPressed: onClear,
                      icon: const Icon(
                        Icons.close_rounded,
                        color: EdmnColors.textSecondary,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsetsDirectional.only(
              top: EdmnSpacing.xxs,
              start: EdmnSpacing.sm,
            ),
            child: Text(
              error!,
              style: EdmnType.secondary.copyWith(color: EdmnColors.error),
            ),
          ),
      ],
    );
  }
}
