import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge routing for the three surfaces served by one Next.js app:
 *   www.edmneg.com      → customer marketplace (/)
 *   seller.edmneg.com   → Seller Center (/seller/*)
 *   admin.edmneg.com    → Admin / Operations (/admin/*)
 * With ENFORCE_HOSTS=true the seller/admin paths are only reachable on their own hosts, so
 * session cookies (host-only) are naturally separated per surface.
 * Also stamps every request with a correlation id. Authorization is NOT done here — every page
 * and action re-checks it server-side.
 */
export function proxy(req: NextRequest) {
  // Correlation id: accepted from upstream only when well-formed (never an arbitrary header value in logs/audit).
  const given = req.headers.get('x-request-id');
  const requestId = given && /^[\w-]{8,64}$/.test(given) ? given : crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set('x-request-id', requestId);

  // Host routing. ENFORCE_HOSTS=true: seller.* and admin.* each on their own host. ENFORCE_ADMIN_HOST=true (final
  // audit): ONLY the admin console on its own host (its own origin, isolated from public pages), while the Seller
  // Center stays on www under /seller (one login, one service worker for buyers and sellers).
  const enforceSeller = process.env.ENFORCE_HOSTS === 'true';
  const enforceAdmin = enforceSeller || process.env.ENFORCE_ADMIN_HOST === 'true';
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const sellerHost = (process.env.SELLER_HOST ?? 'seller.edmneg.com').toLowerCase();
  const adminHost = (process.env.ADMIN_HOST ?? 'admin.edmneg.com').toLowerCase();
  const { pathname } = req.nextUrl;
  const onAdminHost = enforceAdmin && host === adminHost;
  const onSellerHost = enforceSeller && host === sellerHost;
  const adminSurface = pathname.startsWith('/admin') || onAdminHost;
  const shared =
    pathname.startsWith('/_next') || pathname.startsWith('/media/') || pathname.startsWith('/api/') || pathname.startsWith('/brand/') ||
    ['/favicon.ico', '/icon.png', '/sw.js', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest'].includes(pathname);
  // Every page (marketplace, account, Seller Center, admin) runs under a strict per-request nonce CSP: no inline
  // script executes unless Next.js stamped it with this request's nonce (Next reads it from the request CSP header).
  // All pages render per request already (root layout), so the nonce costs no static caching.
  const csp = shared ? null : pageCsp(btoa(crypto.randomUUID()));
  if (csp) headers.set('content-security-policy', csp);
  // The page the visitor actually asked for, so a login wall can send them back to it (validated by safeNext on
  // use). Always overwritten/removed here — a client-supplied value never reaches the app.
  if (shared) headers.delete('x-edmn-path');
  else headers.set('x-edmn-path', pathname + req.nextUrl.search);

  let res: NextResponse;
  if (!shared && (onSellerHost || onAdminHost)) {
    const prefix = onSellerHost ? '/seller' : '/admin';
    if (pathname.startsWith(prefix)) {
      res = NextResponse.next({ request: { headers } });
    } else if (onSellerHost && ['/forgot-password', '/reset-password'].includes(pathname)) {
      res = NextResponse.next({ request: { headers } }); // shared auth pages
    } else {
      const url = req.nextUrl.clone();
      url.pathname = `${prefix}${pathname === '/' ? '' : pathname}`;
      res = NextResponse.rewrite(url, { request: { headers } });
    }
  } else if (!shared && ((enforceAdmin && pathname.startsWith('/admin')) || (enforceSeller && pathname.startsWith('/seller')))) {
    const url = req.nextUrl.clone();
    url.host = pathname.startsWith('/admin') ? adminHost : sellerHost;
    url.port = '';
    url.pathname = pathname.replace(/^\/(admin|seller)/, '') || '/';
    res = NextResponse.redirect(url);
  } else {
    res = NextResponse.next({ request: { headers } });
  }
  res.headers.set('x-request-id', requestId);
  if (csp) res.headers.set('content-security-policy', csp);
  if (adminSurface) {
    res.headers.set('x-robots-tag', 'noindex, nofollow');
    res.headers.set('cache-control', 'no-store');
  }
  return res;
}

/**
 * style-src keeps 'unsafe-inline' (documented limitation): React `style={{…}}` attributes are used across the UI
 * (aspect ratios, computed positions, CSS custom properties) and style attributes cannot carry a nonce.
 * Scripts — the actual XSS vector — are nonce-only.
 */
export function pageCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'` + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
/** @deprecated kept for existing callers — the admin surface uses the same policy as every page. */
export const adminCsp = pageCsp;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
