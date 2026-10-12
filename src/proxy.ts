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

  const enforce = process.env.ENFORCE_HOSTS === 'true';
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const sellerHost = (process.env.SELLER_HOST ?? 'seller.edmneg.com').toLowerCase();
  const adminHost = (process.env.ADMIN_HOST ?? 'admin.edmneg.com').toLowerCase();
  const { pathname } = req.nextUrl;
  // Batch 2: the admin surface (money approvals, KYC documents) gets a strict nonce CSP — no inline script runs
  // unless Next.js stamped it with this request's nonce. Next reads the nonce from the request CSP header.
  const adminSurface = pathname.startsWith('/admin') || (enforce && host === adminHost);
  const csp = adminSurface && !pathname.startsWith('/api/') ? adminCsp(btoa(crypto.randomUUID())) : null;
  if (csp) headers.set('content-security-policy', csp);
  const shared = pathname.startsWith('/_next') || pathname.startsWith('/media/') || pathname.startsWith('/api/') || pathname.startsWith('/brand/') || pathname === '/favicon.ico' || pathname === '/icon.png';

  let res: NextResponse;
  if (enforce && !shared && (host === sellerHost || host === adminHost)) {
    const prefix = host === sellerHost ? '/seller' : '/admin';
    if (pathname.startsWith(prefix)) {
      res = NextResponse.next({ request: { headers } });
    } else if (host === sellerHost && ['/forgot-password', '/reset-password', '/logout'].includes(pathname)) {
      res = NextResponse.next({ request: { headers } }); // shared auth pages
    } else {
      const url = req.nextUrl.clone();
      url.pathname = `${prefix}${pathname === '/' ? '' : pathname}`;
      res = NextResponse.rewrite(url, { request: { headers } });
    }
  } else if (enforce && !shared && (pathname.startsWith('/admin') || pathname.startsWith('/seller'))) {
    const url = req.nextUrl.clone();
    url.host = pathname.startsWith('/admin') ? adminHost : sellerHost;
    url.pathname = pathname.replace(/^\/(admin|seller)/, '') || '/';
    res = NextResponse.redirect(url);
  } else {
    res = NextResponse.next({ request: { headers } });
  }
  res.headers.set('x-request-id', requestId);
  if (csp) res.headers.set('content-security-policy', csp);
  if (pathname.startsWith('/admin') || host === adminHost) {
    res.headers.set('x-robots-tag', 'noindex, nofollow');
    res.headers.set('cache-control', 'no-store');
  }
  return res;
}

export function adminCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'` + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
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

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
