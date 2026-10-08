/*
 * EDMN service worker — Web Push ONLY.
 *
 * Deliberately has NO fetch handler and caches nothing: it can never serve stale application code,
 * interfere with authentication, or delay a deploy. Versioned so an update replaces it immediately.
 * A notification click only opens a same-origin EDMN path; the page re-checks login and authorization
 * server-side (the push itself grants no access to anything).
 */
const SW_VERSION = 'edmn-push-1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function safePath(url) {
  try {
    const u = new URL(url, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search : '/account/messages';
  } catch {
    return '/account/messages';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' ? data.title.slice(0, 80) : 'اضمن';
  const body = typeof data.body === 'string' ? data.body.slice(0, 200) : 'لديك رسالة جديدة';
  const url = safePath(data.url || '/account/messages');
  event.waitUntil(
    (async () => {
      // If an EDMN tab is focused the live channel already shows a toast: don't duplicate it.
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.some((w) => w.focused && w.visibilityState === 'visible')) return;
      await self.registration.showNotification(title, {
        body,
        tag: typeof data.tag === 'string' ? data.tag : undefined,
        renotify: false,
        icon: '/icon.png',
        badge: '/icon.png',
        dir: 'rtl',
        lang: 'ar',
        data: { url, deliveryId: typeof data.deliveryId === 'string' ? data.deliveryId : null, v: SW_VERSION },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url, deliveryId } = event.notification.data || {};
  const target = safePath(url || '/account/messages');
  event.waitUntil(
    (async () => {
      if (deliveryId) {
        // Telemetry only (opened). Never evidence of delivery or receipt.
        fetch('/api/notifications/opened', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deliveryId }), credentials: 'same-origin' }).catch(() => {});
      }
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          await w.focus();
          if ('navigate' in w) return w.navigate(target);
          return;
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The browser rotated the subscription: re-register the new one for the signed-in user (cookie session).
  event.waitUntil(
    (async () => {
      const sub = event.newSubscription || (await self.registration.pushManager.getSubscription());
      if (!sub) return;
      await fetch('/api/push/subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }), credentials: 'same-origin' }).catch(() => {});
    })(),
  );
});
