/**
 * Who a push is actually sent to (lib/crew-push.ts): only push-service
 * endpoints, and for admin pushes only addresses that are still admins.
 * The push services are stubbed. Run with `npm test` in functions/.
 */
import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';

import { isPushServiceEndpoint, sendAdminPush, sendCrewPush } from '../src/lib/crew-push';
import { fakeFirestore } from './fakes';

process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.ADMIN_EMAIL = 'travis@example.com';
process.env.OTHER_ADMIN_EMAILS = 'dan@example.com';

const keys = { p256dh: 'p256dh', auth: 'auth' };
const message = { title: 'New booking', body: 'Jane Smith · 4 guests', url: '/admin', tag: 't' };

/** Records the endpoints web-push was asked to post to. */
function stubPushServices() {
  const posted: string[] = [];
  mock.method(webpush, 'sendNotification', async (sub: { endpoint: string }) => {
    posted.push(sub.endpoint);
    return { statusCode: 201, body: '', headers: {} };
  });
  return posted;
}

afterEach(() => mock.restoreAll());

describe('isPushServiceEndpoint', () => {
  test('takes the endpoints browsers hand out', () => {
    for (const e of [
      'https://fcm.googleapis.com/fcm/send/abc:APA91b',
      'https://web.push.apple.com/QGx',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
    ]) {
      assert.ok(isPushServiceEndpoint(e), e);
    }
  });

  test('refuses a host url.parse() reads differently, a port, a login or plain http', () => {
    for (const e of [
      'https://127.0.0.1{.fcm.googleapis.com/x',
      "https://localhost'.push.apple.com/x",
      'https://localhost`.push.apple.com/x',
      'https://%31%32%37.0.0.1.fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://u:p@fcm.googleapis.com/x',
      'https://fcm.googleapis.com./x',
      'https://evil.com\\.fcm.googleapis.com/x',
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.com/x',
      'not a url',
    ]) {
      assert.ok(!isPushServiceEndpoint(e), e);
    }
  });
});

describe('sending', () => {
  test('a saved subscription that isn’t on a push service is deleted, not posted to', async () => {
    const posted = stubPushServices();
    const { db, col } = fakeFirestore({
      crewPushSubscriptions: {
        good: { crewId: 'c1', endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys },
        bad: { crewId: 'c2', endpoint: 'https://127.0.0.1{.fcm.googleapis.com/x', keys },
      },
    });
    const result = await sendCrewPush(message, {}, { db });
    assert.deepEqual(posted, ['https://fcm.googleapis.com/fcm/send/a']);
    assert.deepEqual(result, { sent: 1, failed: 0, removed: 1 });
    assert.deepEqual([...col('crewPushSubscriptions').keys()], ['good']);
  });

  test('admin pushes skip and delete devices saved by someone who is no longer an admin', async () => {
    const posted = stubPushServices();
    const { db, col } = fakeFirestore({
      adminPushSubscriptions: {
        travis: { email: 'travis@example.com', endpoint: 'https://web.push.apple.com/t', keys },
        dan: { email: 'dan@example.com', endpoint: 'https://fcm.googleapis.com/fcm/send/d', keys },
        former: { email: 'helper@example.com', endpoint: 'https://fcm.googleapis.com/fcm/send/h', keys },
      },
    });
    const result = await sendAdminPush(message, {}, { db });
    assert.deepEqual(posted.sort(), ['https://fcm.googleapis.com/fcm/send/d', 'https://web.push.apple.com/t']);
    assert.deepEqual(result, { sent: 2, failed: 0, removed: 1 });
    assert.deepEqual([...col('adminPushSubscriptions').keys()].sort(), ['dan', 'travis']);
  });
});
