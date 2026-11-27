'use client';

import { useCallback } from 'react';
import { CaptchaBox, type CaptchaWidgetConfig } from '@/ui/captcha-widget';

type Bridge = { postMessage: (m: string) => void };

/** Hands a solved token to the app (JavaScript channel `EdmnCaptcha`); in a normal browser it does nothing. */
export function MobileCaptcha({ config }: { config: CaptchaWidgetConfig }) {
  const onToken = useCallback((token: string) => {
    const bridge = (window as unknown as { EdmnCaptcha?: Bridge }).EdmnCaptcha;
    if (token && bridge) bridge.postMessage(token);
  }, []);
  return (
    <div className="space-y-3 text-center">
      <p className="text-sm">أكّد إنك مش روبوت عشان تكمّل.</p>
      <CaptchaBox config={config} onToken={onToken} />
    </div>
  );
}
