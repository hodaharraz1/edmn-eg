'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';

function subscribe(cb: () => void) {
  window.addEventListener('offline', cb);
  window.addEventListener('online', cb);
  return () => {
    window.removeEventListener('offline', cb);
    window.removeEventListener('online', cb);
  };
}

/**
 * UX-02: weak/lost connection — a clear fixed banner while offline, and an automatic refresh of the
 * server-rendered data the moment the connection returns. Money actions stay safe on retry because every
 * checkout/payment/top-up mutation already carries an idempotency key (see src/server/core/idempotency.ts).
 */
export function OfflineBanner() {
  const router = useRouter();
  const offline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!offline && wasOffline.current) router.refresh();
    wasOffline.current = offline;
  }, [offline, router]);
  if (!offline) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] bg-amber-100 px-4 py-2.5 text-center text-sm font-semibold text-amber-950 shadow"
    >
      الاتصال بالإنترنت انقطع. هنعيد تحميل الصفحة لوحدنا أول ما الاتصال يرجع.
    </div>
  );
}
