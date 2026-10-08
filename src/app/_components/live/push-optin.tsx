'use client';

import { BellRing, BellOff, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

type PushState = 'loading' | 'unsupported' | 'not-configured' | 'default' | 'denied' | 'granted-off' | 'enabled';

function b64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg?.pushManager.getSubscription() ?? null;
}

/**
 * EDMN-owned explanation first; the browser permission prompt appears ONLY after the user clicks
 * «تفعيل الإشعارات». A denied permission is never re-requested — we explain how to change it instead.
 */
export function PushOptIn({ vapidKey, variant = 'card' }: { vapidKey: string | null; variant?: 'card' | 'banner' }) {
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) return setState('unsupported');
      if (!vapidKey) return setState('not-configured');
      if (Notification.permission === 'denied') return setState('denied');
      if (Notification.permission === 'granted') return setState((await currentSubscription().catch(() => null)) ? 'enabled' : 'granted-off');
      setState('default');
      try {
        if (variant === 'banner' && Number(localStorage.getItem('edmn:push:dismissed') ?? 0) > Date.now() - 14 * 86_400_000) setDismissed(true);
      } catch {
        /* ignore */
      }
    })();
  }, [vapidKey, variant]);

  async function enable() {
    if (!vapidKey) return;
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'default');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(vapidKey) }));
      const res = await fetch('/api/push/subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error('save');
      setState('enabled');
    } catch {
      setError('مقدرناش نفعّل الإشعارات على المتصفح ده. جرّب تاني أو استخدم متصفح تاني.');
      setState(Notification.permission === 'granted' ? 'granted-off' : 'default');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const sub = await currentSubscription();
      if (sub) {
        await fetch('/api/push/subscription', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState('granted-off');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return null;
  if (variant === 'banner' && (state !== 'default' || dismissed)) return null;

  const box = cn('rounded-2xl p-4 ring-1', variant === 'banner' ? 'bg-brand-50 ring-brand-100' : 'bg-white ring-line');
  return (
    <section className={box} data-testid="push-optin" data-state={state} aria-labelledby="push-optin-title">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-brand-700 ring-1 ring-line" aria-hidden>
          {state === 'enabled' ? <CheckCircle2 className="size-5 text-emerald-600" /> : state === 'denied' ? <BellOff className="size-5" /> : <BellRing className="size-5" />}
        </span>
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <h2 id="push-optin-title" className="font-bold">
            إشعارات المتصفح
          </h2>
          {state === 'default' || state === 'granted-off' ? (
            <>
              <p>فعّل إشعارات اضمن علشان تعرف فورًا لما البائع أو المشتري يبعتلك رسالة.</p>
              <p className="text-xs text-muted">الإشعار بيقول إن فيه رسالة جديدة وبخصوص أنهي طلب — من غير نص الرسالة أو المرفقات، إلا لو اخترت تعرض المعاينة.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={enable} disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800 disabled:opacity-60" data-testid="push-enable">
                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} تفعيل الإشعارات
                </button>
                {variant === 'banner' && (
                  <button
                    type="button"
                    className="h-10 rounded-xl px-3 text-muted hover:bg-white"
                    onClick={() => {
                      setDismissed(true);
                      try {
                        localStorage.setItem('edmn:push:dismissed', String(Date.now()));
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    مش دلوقتي
                  </button>
                )}
              </div>
            </>
          ) : state === 'enabled' ? (
            <div className="space-y-2">
              <p data-testid="push-status">الإشعارات مفعّلة على الجهاز ده.</p>
              <button type="button" onClick={disable} disabled={busy} className="h-9 rounded-lg px-3 text-sm text-red-700 ring-1 ring-line hover:bg-page">
                إيقاف على الجهاز ده
              </button>
            </div>
          ) : state === 'denied' ? (
            <p data-testid="push-status">
              إشعارات اضمن متقفلة من إعدادات المتصفح. لو حابب تفعّلها: افتح إعدادات الموقع من علامة القفل جنب العنوان، واسمح بالإشعارات، وبعدين ارجع هنا.
            </p>
          ) : state === 'not-configured' ? (
            <p data-testid="push-status">إشعارات المتصفح مش متاحة على اضمن دلوقتي. هتوصلك التنبيهات جوه الموقع وبالبريد.</p>
          ) : (
            <p data-testid="push-status">المتصفح ده مش بيدعم إشعارات المواقع. هتوصلك التنبيهات جوه الموقع وبالبريد الإلكتروني.</p>
          )}
          {error && (
            <p className="flex items-center gap-1 text-xs font-semibold text-red-700" role="alert">
              <Info className="size-3.5" aria-hidden /> {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
