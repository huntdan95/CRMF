/*
 * Admin app service worker, registered from Admin → Settings with scope
 * `/admin`, so Travis's home-screen admin app can get push notifications.
 *
 * Push only — there's deliberately no fetch handler, so admin pages are
 * always read live and never served stale from a cache.
 *
 * Payloads come from functions/src/adminNotifications.ts:
 * { title, body, url, tag }, where `url` is the admin page to open.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  // iOS revokes the subscription if a push doesn't show a notification,
  // so always show one.
  event.waitUntil(
    self.registration.showNotification(data.title || 'Manatee Fun admin', {
      body: data.body || '',
      tag: data.tag,
      // A notification that replaces one with the same tag (a booking's
      // "Cancelled" after its "New booking") still buzzes. Only allowed
      // with a tag.
      renotify: !!data.tag,
      icon: '/apple-icon',
      data: { url: data.url || '/admin' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/admin',
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Reuse an open admin window, taking it to the page the push is about.
      const open = windows.find((w) => new URL(w.url).pathname.startsWith('/admin'));
      if (open) {
        await open.focus();
        return 'navigate' in open ? open.navigate(url) : undefined;
      }
      return self.clients.openWindow(url);
    })(),
  );
});
