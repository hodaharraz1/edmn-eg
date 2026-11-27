import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'l10n/edmn_localizations.dart';

/// SEC-194 (L3) on the mobile apps. The server asks for a CAPTCHA only when its `auth.captchaMode` requires one; the
/// app then shows the provider's challenge and retries the same sign-in with the token as `captchaToken`.
///
/// Shows the challenge and returns its token (null when the user closes it). Tests inject a fake solver.
typedef CaptchaSolver = Future<String?> Function(BuildContext context, Uri pageUrl);

/// The page that hosts the provider's widget. It lives on the same origin as the API: the server renders the widget
/// with the PUBLIC site key from its settings and the provider chosen by `CAPTCHA_PROVIDER`, so the app holds no key,
/// no secret and no tracking SDK. The page hands the token back through the `EdmnCaptcha` JavaScript channel.
Uri captchaPageUrl(String apiBaseUrl) => Uri.parse(apiBaseUrl).resolve('/captcha/mobile');

/// Main-frame navigation stays on the page's own origin. The provider's frames load inside the page; the web view never
/// browses anywhere else.
bool captchaNavigationAllowed(Uri page, String target, {bool isMainFrame = true}) {
  if (!isMainFrame) return true;
  final u = Uri.tryParse(target);
  if (u == null) return false;
  return u.scheme == page.scheme && u.host == page.host && u.port == page.port;
}

/// A token from the page, or null when it is empty or implausibly long (the server also rejects more than 4096 chars).
String? captchaTokenFromMessage(String message) {
  final t = message.trim();
  return t.isEmpty || t.length > 4096 ? null : t;
}

/// The default [CaptchaSolver]: a bottom sheet with a web view of [pageUrl].
Future<String?> showCaptchaChallenge(BuildContext context, Uri pageUrl) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    isDismissible: true,
    builder: (_) => CaptchaChallengeSheet(pageUrl: pageUrl),
  );
}

class CaptchaChallengeSheet extends StatefulWidget {
  const CaptchaChallengeSheet({super.key, required this.pageUrl});
  final Uri pageUrl;

  @override
  State<CaptchaChallengeSheet> createState() => _CaptchaChallengeSheetState();
}

class _CaptchaChallengeSheetState extends State<CaptchaChallengeSheet> {
  late final WebViewController _controller;
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel(
        'EdmnCaptcha',
        onMessageReceived: (m) {
          final token = captchaTokenFromMessage(m.message);
          if (token != null && mounted) Navigator.of(context).pop(token);
        },
      )
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (r) => captchaNavigationAllowed(widget.pageUrl, r.url, isMainFrame: r.isMainFrame) ? NavigationDecision.navigate : NavigationDecision.prevent,
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onWebResourceError: (e) {
          if ((e.isForMainFrame ?? true) && mounted) {
            setState(() {
              _failed = true;
              _loading = false;
            });
          }
        },
      ))
      ..loadRequest(widget.pageUrl);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.6,
      child: Column(children: [
        ListTile(
          title: Text(t.captchaTitle, key: const Key('captcha-title')),
          trailing: IconButton(key: const Key('captcha-close'), tooltip: t.cancel, icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.of(context).pop()),
        ),
        Expanded(
          child: _failed
              ? Center(
                  child: Padding(
                    padding: const EdgeInsetsDirectional.all(24),
                    child: Text(t.captchaLoadFailed, key: const Key('captcha-error'), textAlign: TextAlign.center),
                  ),
                )
              : Stack(children: [
                  WebViewWidget(controller: _controller),
                  if (_loading) const Center(child: CircularProgressIndicator()),
                ]),
        ),
      ]),
    );
  }
}
