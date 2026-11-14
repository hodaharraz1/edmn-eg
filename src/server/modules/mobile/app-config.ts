import { smsAvailable } from '@/server/core/runtime-env';
import { currentLegal, legalCodeForSlug, LEGAL_CODES } from '@/server/modules/cms/service';
import { getSetting, realMoneyEnabled } from '@/server/modules/settings';

/**
 * Public bootstrap data for the mobile apps. Every policy value comes from server-side settings (admin-editable,
 * audited); the apps hardcode none of it. Real Money is exposed READ-ONLY — nothing here can change it.
 */
export async function publicAppConfig() {
  const [customer, admin, realMoney, maintenance] = await Promise.all([
    getSetting('mobile.minVersion.customer'),
    getSetting('mobile.minVersion.admin'),
    realMoneyEnabled(),
    getSetting('marketplace.maintenanceMode'),
  ]);
  return {
    minSupportedVersion: { customer, admin },
    defaultLocale: 'ar' as const,
    locales: ['ar', 'en'] as Array<'ar' | 'en'>,
    currency: 'EGP' as const,
    realMoneyEnabled: realMoney,
    maintenanceMode: maintenance,
    // The buyer sees the delivery code in the app; SMS is the fallback channel when a provider can deliver it.
    deliveryOtp: { inApp: true, sms: smsAvailable() },
  };
}

export async function publicLegalDocument(slug: string) {
  const code = legalCodeForSlug(slug);
  if (!code) return null;
  const d = await currentLegal(code);
  if (!d) return null;
  return { code, slug: LEGAL_CODES[code].slug, title: d.title, version: d.version, body: d.body, approved: d.status === 'APPROVED', updatedAt: d.updatedAt.toISOString() };
}
