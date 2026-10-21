/**
 * The push-service check a device's subscription has to pass when it's
 * saved (src/lib/push-endpoint.ts), against the copy the Cloud Functions
 * run again before sending (functions/src/lib/crew-push.ts). Run with
 * `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isPushServiceEndpoint } from '../src/lib/push-endpoint';
import { isPushServiceEndpoint as functionsCheck } from '../functions/src/lib/crew-push';

const accepted = [
  'https://fcm.googleapis.com/fcm/send/abc:APA91b',
  'https://web.push.apple.com/QGx',
  'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
  'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
];

// The first three pass a plain suffix check on `new URL().hostname`, but
// web-push (url.parse) would connect to localhost.
const refused = [
  'https://127.0.0.1{.fcm.googleapis.com/x',
  "https://localhost'.push.apple.com/x",
  'https://localhost".push.apple.com/x',
  'https://%31%32%37.0.0.1.fcm.googleapis.com/x',
  'https://fcm.googleapis.com:8443/x',
  'https://u:p@fcm.googleapis.com/x',
  'https://fcm.googleapis.com./x',
  'http://fcm.googleapis.com/x',
  'https://fcm.googleapis.com.evil.com/x',
  'https://evilfcm.googleapis.com.example/x',
];

describe('isPushServiceEndpoint', () => {
  test('takes the endpoints browsers hand out', () => {
    for (const e of accepted) assert.ok(isPushServiceEndpoint(e), e);
  });

  test('refuses hosts the two URL parsers disagree on, ports, logins and plain http', () => {
    for (const e of refused) assert.ok(!isPushServiceEndpoint(e), e);
  });

  test('the functions’ copy agrees', () => {
    for (const e of [...accepted, ...refused]) assert.equal(functionsCheck(e), isPushServiceEndpoint(e), e);
  });
});
