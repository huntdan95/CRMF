/**
 * Push services the browsers we care about hand out endpoints on (Chrome
 * and most Android browsers, Safari, Firefox, Edge). Anything else is
 * refused when a device subscribes, so the Cloud Functions that send
 * pushes only ever post to them.
 */
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'push.apple.com',
  'push.services.mozilla.com',
  'notify.windows.com',
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      PUSH_SERVICE_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}
