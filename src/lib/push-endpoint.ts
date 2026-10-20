import { parse } from 'node:url';

/**
 * Push services the browsers we care about hand out endpoints on (Chrome
 * and most Android browsers, Safari, Firefox, Edge). Anything else is
 * refused when a device subscribes, so the Cloud Functions that send
 * pushes only ever post to them. functions/src/lib/crew-push.ts checks
 * saved endpoints again with a copy of this before each send; keep the
 * two the same.
 */
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'push.apple.com',
  'push.services.mozilla.com',
  'notify.windows.com',
];

/**
 * Plain DNS labels only. The browser's URL parser lets characters like
 * `{` and `'` into a hostname, and web-push connects with Node's older
 * url.parse(), which cuts the host off there: `https://127.0.0.1{.fcm.googleapis.com`
 * passes a suffix check but is sent to 127.0.0.1. Requiring both parsers to
 * agree on the host closes any gap this pattern misses.
 */
const PLAIN_HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      PLAIN_HOSTNAME.test(url.hostname) &&
      parse(endpoint).hostname === url.hostname &&
      PUSH_SERVICE_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}
