/**
 * Official public support contact. The admin setting `marketplace.supportEmail` wins when configured; otherwise the
 * company's official address (owner-confirmed) is used, so a visitor who cannot sign in always has a way to reach
 * support. No phone, WhatsApp or hours are invented here — those come from settings only.
 */
export const OFFICIAL_SUPPORT_EMAIL = 'info@edmneg.com';

export function supportEmail(configured: string | null | undefined): string {
  const v = (configured ?? '').trim();
  return /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(v) ? v : OFFICIAL_SUPPORT_EMAIL;
}
