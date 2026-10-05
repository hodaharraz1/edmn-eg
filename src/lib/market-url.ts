/**
 * Link from the Seller Center or Admin surface to a customer-marketplace page.
 * With host routing on (ENFORCE_HOSTS=true: seller.* and admin.* hosts), relative links would be
 * rewritten into the seller/admin surface, so they must point at the marketplace origin (APP_URL).
 * Server components only (reads server environment).
 */
export function marketHref(path: string): string {
  if (process.env.ENFORCE_HOSTS !== 'true' || !process.env.APP_URL) return path;
  return new URL(path, process.env.APP_URL).toString();
}
