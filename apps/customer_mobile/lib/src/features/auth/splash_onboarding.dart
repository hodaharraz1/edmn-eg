import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers.dart';

/// Board "البداية" background: brand gradient with soft light arcs (no imagery).
class _BrandBackground extends StatelessWidget {
  const _BrandBackground({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.light,
        child: DecoratedBox(
          decoration: const BoxDecoration(gradient: EdmnColors.headerGradient),
          child: Stack(children: [
            PositionedDirectional(top: -120, end: -140, child: _Arc(size: 320)),
            PositionedDirectional(bottom: -160, start: -160, child: _Arc(size: 360)),
            Positioned.fill(child: child),
          ]),
        ),
      );
}

class _Arc extends StatelessWidget {
  const _Arc({required this.size});
  final double size;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: EdmnColors.accentCyan.withValues(alpha: 0.08), width: 36)),
      );
}

/// Splash: original logo while the session is restored, then straight to the right screen (no fixed delay).
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});
  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> {
  bool _left = false;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final boot = ref.watch(bootstrapProvider);
    // Navigate once the session restore finished (works whether it finished before or after the first frame).
    if (!_left && (boot.hasValue || boot.hasError)) {
      _left = true;
      final r = boot.value;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        context.go(r != null && !r.onboarded && !r.signedIn ? '/onboarding' : '/');
      });
    }
    return Scaffold(
      body: _BrandBackground(
        child: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            EdmnMarketLockup(marketLabel: t.marketLabel, height: 150),
            const SizedBox(height: EdmnSpacing.xxl),
            const SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2.5, color: EdmnColors.onPrimary)),
          ]),
        ),
      ),
    );
  }
}

/// Onboarding (board "البداية"): three pages with the dots, "ابدأ الآن" white pill and the sign-in link.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});
  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _pages = PageController();
  int _page = 0;

  Future<void> _finish(String to) async {
    await ref.read(appPrefsProvider).write('onboarded', '1');
    if (mounted) context.go(to);
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final titles = [t.onboardingShopTitle, t.onboardingProtectTitle, t.onboardingDealTitle];
    final last = _page == titles.length - 1;
    return Scaffold(
      body: _BrandBackground(
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.xl),
            child: Column(children: [
              Align(
                alignment: AlignmentDirectional.topEnd,
                child: TextButton(
                  key: const Key('onboarding-skip'),
                  onPressed: () => _finish('/'),
                  child: Text(t.skip, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.onPrimary)),
                ),
              ),
              Expanded(
                child: PageView.builder(
                  controller: _pages,
                  itemCount: titles.length,
                  onPageChanged: (i) => setState(() => _page = i),
                  itemBuilder: (_, i) => Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    EdmnMarketLockup(marketLabel: t.marketLabel, height: 150),
                    const SizedBox(height: EdmnSpacing.xxl),
                    Text(titles[i], textAlign: TextAlign.center, style: EdmnType.pageTitle.copyWith(color: EdmnColors.onPrimary, fontSize: 28)),
                  ]),
                ),
              ),
              EdmnPageDots(count: titles.length, index: _page, onDark: true),
              const SizedBox(height: EdmnSpacing.xl),
              EdmnPrimaryButton(
                key: const Key('onboarding-start'),
                label: last ? t.startNow : t.next,
                color: EdmnColors.surface,
                onPressed: () => last ? _finish('/') : _pages.nextPage(duration: EdmnMotion.normal, curve: Curves.easeOut),
              ),
              const SizedBox(height: EdmnSpacing.sm),
              Wrap(alignment: WrapAlignment.center, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Text(t.haveAccount, style: EdmnType.body.copyWith(color: EdmnColors.onPrimary)),
                TextButton(
                  onPressed: () => _finish('/sign-in'),
                  child: Text(t.signIn, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.accentCyan, decoration: TextDecoration.underline, decorationColor: EdmnColors.accentCyan)),
                ),
              ]),
              const SizedBox(height: EdmnSpacing.md),
            ]),
          ),
        ),
      ),
    );
  }
}
