import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../tokens.dart';

/// The reference sunburst (PKG-UI-01): a brand-blue radial glow with subtle rays fanning from the top.
/// Used by the home header and by [EdmnHeader] when `sunburst` is on, so the whole app shares one system.
class EdmnSunburstBackground extends StatelessWidget {
  const EdmnSunburstBackground({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -1.6),
            radius: 1.8,
            colors: [EdmnColors.sunburstCore, EdmnColors.sunburst, EdmnColors.sunburstDeep],
            stops: [0.0, 0.55, 1.0],
          ),
        ),
        child: CustomPaint(painter: _RaysPainter(), child: child),
      );
}

class _RaysPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = EdmnColors.rayOverlay;
    final origin = Offset(size.width / 2, -size.height * 0.6);
    const rays = 18;
    for (var i = 0; i < rays; i += 2) {
      final a1 = math.pi * (i / rays) * 1.15 - math.pi * 0.075;
      final a2 = math.pi * ((i + 0.7) / rays) * 1.15 - math.pi * 0.075;
      final path = Path()
        ..moveTo(origin.dx, origin.dy)
        ..lineTo(origin.dx + math.cos(a1) * size.height * 3, origin.dy + math.sin(a1) * size.height * 3)
        ..lineTo(origin.dx + math.cos(a2) * size.height * 3, origin.dy + math.sin(a2) * size.height * 3)
        ..close();
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_RaysPainter oldDelegate) => false;
}
