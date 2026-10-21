/*
 * Crew app service worker, registered by /crew with scope `/crew`.
 *
 * Push only — there's deliberately no fetch handler, so the schedule is
 * always read live and never served stale from a cache.
 *
 * Payloads come from functions/src/lib/crew-push.ts: { title, body, url, tag }.
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
    self.registration.showNotification(data.title || 'Crystal River Manatee Fun', {
      body: data.body || '',
      tag: data.tag,
      // A notification that replaces one with the same tag ("Crew needed
      // again" after "No crew needed", "Back on" after a cancel) still
      // buzzes the phone. Only allowed with a tag.
      renotify: !!data.tag,
      icon: '/apple-icon',
      data: { url: data.url || '/crew' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/crew',
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const open = windows.find((w) => new URL(w.url).pathname.startsWith('/crew'));
      // The page refreshes its schedule when it comes back into view.
      if (open) return open.focus();
      return self.clients.openWindow(url);
    })(),
  );
});
