import { env } from './env';

/** Public origin of the marketplace (no trailing slash). Production: https://www.edmneg.com (from APP_URL). */
export function siteOrigin(): string {
  return env().APP_URL.replace(/\/+$/, '');
}

/**
 * Absolute URL for links that leave the app (email bodies, SMS, invitations, structured data). Relative links
 * are useless in an email client. Already-absolute http(s) URLs are returned unchanged.
 */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${siteOrigin()}${path.startsWith('/') ? '' : '/'}${path}`;
}
