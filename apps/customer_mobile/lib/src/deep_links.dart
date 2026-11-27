/// PKG-LINKS-01 — maps shared https://www.edmneg.com web links onto in-app routes.
///
/// Shared links (WhatsApp, SMS, email) carry WEB paths; once Android App Links / iOS Universal Links
/// verify the domain, the OS opens them here. Anything unmapped returns null and the website stays the
/// fallback. Host-agnostic on purpose: the mapping is purely about the path shape.
library;

/// Returns the in-app location for a shared web URI, or null when the web page is the right target.
String? appLocationForWebUri(Uri uri) {
  final segs = uri.pathSegments;
  if (segs.isEmpty) return null;
  String keepQuery(String path) => uri.hasQuery ? '$path?${uri.query}' : path;

  // Web product page → app product screen.
  if (segs.length == 2 && segs[0] == 'product') return keepQuery('/products/${segs[1]}');

  // Web order page (including its /pay sub-page) → the app order screen; it shows the payment state.
  if (segs.length >= 3 && segs[0] == 'account' && segs[1] == 'orders') return keepQuery('/orders/${segs[2]}');

  // Protected-deal invitation → the join screen; the token moves from the path to the query.
  if (segs.length == 3 && segs[0] == 'deal' && segs[1] == 'invite') {
    return '/deals/join?token=${Uri.encodeQueryComponent(segs[2])}';
  }
  // Legacy invitation path (the web redirects it; the app maps it directly).
  if (segs.length == 2 && segs[0] == 'deal-invite') {
    return '/deals/join?token=${Uri.encodeQueryComponent(segs[1])}';
  }

  return null;
}
