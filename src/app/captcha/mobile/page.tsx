import type { Metadata } from 'next';
import { loadCaptchaPublic } from '@/server/auth/captcha-public';
import { MobileCaptcha } from './mobile-captcha';

export const metadata: Metadata = { title: 'التحقق', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * PKG-FOLLOWUP-02: the page the Customer and Admin apps show in a web view when the server asks for a CAPTCHA. It draws the
 * provider's widget with the PUBLIC site key and hands the token to the app. It holds no secret and sets no cookie.
 */
export default async function MobileCaptchaPage() {
  const captcha = await loadCaptchaPublic();
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-4">
      {captcha ? <MobileCaptcha config={captcha} /> : <p role="alert" className="text-center text-sm">التحقق غير متاح حاليًا. جرّب تاني بعد شوية.</p>}
    </main>
  );
}
