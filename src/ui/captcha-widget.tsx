'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from './action-form';

/** What the login pages pass down: the PUBLIC half only. */
export interface CaptchaWidgetConfig {
  mode: 'after_failures' | 'always';
  provider: 'turnstile' | 'hcaptcha' | 'recaptcha';
  siteKey: string;
  scriptUrl: string;
  global: string;
}

type Api = { render: (el: HTMLElement, o: Record<string, unknown>) => unknown; reset?: (id?: unknown) => void };

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-captcha-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('captcha script failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.captchaSrc = src;
    s.onload = () => {
      s.dataset.loaded = '1';
      resolve();
    };
    s.onerror = () => reject(new Error('captcha script failed'));
    document.head.appendChild(s);
  });
}

/**
 * The provider's widget, drawn into a box and writing its answer to a hidden `captchaToken` field of the surrounding
 * form (the server action reads that field). Pass `onToken` for a page that is not a form (the mobile page).
 */
export function CaptchaBox({ config, onToken }: { config: CaptchaWidgetConfig; onToken?: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  const state = useFormState();
  const widgetId = useRef<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    loadScript(config.scriptUrl)
      .then(() => {
        const api = (window as unknown as Record<string, Api | undefined>)[config.global];
        if (cancelled || !api || !box.current || widgetId.current !== null) return;
        const set = (t: string) => {
          if (field.current) field.current.value = t;
          onToken?.(t);
        };
        widgetId.current = api.render(box.current, { sitekey: config.siteKey, callback: set, 'expired-callback': () => set(''), 'error-callback': () => set('') });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [config, onToken]);
  // A refused attempt spends the token: ask the provider for a fresh one.
  useEffect(() => {
    if (state.at && state.error && widgetId.current !== null) {
      if (field.current) field.current.value = '';
      const api = (window as unknown as Record<string, Api | undefined>)[config.global];
      api?.reset?.(widgetId.current);
    }
  }, [state, config.global]);
  return (
    <div data-testid="captcha-box">
      <input ref={field} type="hidden" name="captchaToken" defaultValue="" />
      <div ref={box} />
      {failed && <p role="alert" className="text-sm text-red-700">تعذّر تحميل التحقق. تأكد من الاتصال وحدّث الصفحة.</p>}
    </div>
  );
}

/**
 * Inside an ActionForm. `always`: shown from the start. `after_failures`: shown only once the server has answered that
 * a CAPTCHA is required (a field error named `captcha`), so a normal sign-in never sees it.
 */
export function LoginCaptcha({ config }: { config: CaptchaWidgetConfig | null }) {
  const state = useFormState();
  if (!config) return null;
  const asked = Boolean(state.fieldErrors?.captcha);
  if (config.mode === 'after_failures' && !asked) return null;
  return (
    <div className="space-y-2" data-testid="login-captcha">
      <p className="text-sm text-muted">أكّد إنك مش روبوت عشان تكمّل.</p>
      <CaptchaBox config={config} />
    </div>
  );
}
