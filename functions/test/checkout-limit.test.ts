/**
 * The limit on one visitor's unpaid checkouts (createCheckoutSession), and
 * the email to Travis when it turns someone away. Against in-memory
 * stand-ins for Firestore and Resend. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

// Secrets are read from the environment when a send runs.
process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';

import {
  CheckoutLimitError,
  MAX_OPEN_CHECKOUTS,
  assertCheckoutAllowed,
  buildCheckoutLimitAlertEmail,
  checkoutIpHash,
  clientIp,
  openCheckouts,
  readForwardedFor,
  sendCheckoutLimitAlert,
  visitorKey,
  type CheckoutLimitAlert,
} from '../src/lib/checkout-limit';
import type { Booking } from '../src/lib/types';
import { TOKEN, fakeFirestore, fakeResend, type Doc } from './fakes';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const minutesAgo = (m: number) => Timestamp.fromMillis(NOW - m * 60_000);
const HASH = checkoutIpHash('203.0.113.9');

function hold(id: string, overrides: Doc = {}): Doc {
  return {
    id,
    tourName: 'Morning Manatee Tour',
    date: '2026-10-18',
    timeSlot: 'morning',
    type: 'shared',
    guestCount: 2,
    customerName: 'Sam Rivera',
    customerEmail: 'sam@example.com',
    customerPhone: '352-555-0100',
    status: 'pending-payment',
    accessToken: `${TOKEN}-${id}`,
    checkoutIpHash: HASH,
    createdAt: minutesAgo(5),
    ...overrides,
  };
}

const asBookings = (docs: Doc[]) => docs as unknown as Booking[];

describe('clientIp', () => {
  test('takes the address Google appended, not the one the client sent', () => {
    assert.equal(clientIp({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }), '203.0.113.9');
    assert.equal(clientIp({ 'x-forwarded-for': '1.1.1.1,2.2.2.2,203.0.113.9' }), '203.0.113.9');
    assert.equal(clientIp({ 'x-forwarded-for': '203.0.113.9' }), '203.0.113.9');
    assert.equal(clientIp({ 'x-forwarded-for': ['198.51.100.1', '203.0.113.9'] }), '203.0.113.9');
    assert.equal(clientIp({ 'x-forwarded-for': '2001:db8:1:2::abcd' }), '2001:db8:1:2::abcd');
    assert.equal(clientIp({ 'x-forwarded-for': '::ffff:203.0.113.9' }), '203.0.113.9');
  });

  test("skips Google's own proxy hops after the visitor's address", () => {
    assert.equal(clientIp({ 'x-forwarded-for': '203.0.113.9, 35.191.12.34' }), '203.0.113.9');
    assert.equal(clientIp({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9, 130.211.2.7' }), '203.0.113.9');
    // Only Google hops: there's no visitor address to count.
    assert.equal(clientIp({ 'x-forwarded-for': '35.191.0.1' }), null);
  });

  test('gives null rather than guess, so nobody is counted under the wrong address', () => {
    assert.equal(clientIp({}), null);
    assert.equal(clientIp({ 'x-forwarded-for': '' }), null);
    // A last entry that isn't an address: don't fall back to the client's.
    assert.equal(clientIp({ 'x-forwarded-for': '203.0.113.9, unknown' }), null);
    // The emulator, or a proxy hop of ours.
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.1.1', '::1', 'fd00::1', 'fe80::1']) {
      assert.equal(clientIp({ 'x-forwarded-for': `203.0.113.9, ${ip}` }), null, ip);
    }
  });

  test('says how many entries there were and which one counted, for the launch check', () => {
    assert.deepEqual(readForwardedFor({ 'x-forwarded-for': '203.0.113.9' }), { ip: '203.0.113.9', entries: 1, index: 0 });
    assert.deepEqual(readForwardedFor({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9, 35.191.12.34' }), {
      ip: '203.0.113.9',
      entries: 3,
      index: 1,
    });
    assert.deepEqual(readForwardedFor({ 'x-forwarded-for': '203.0.113.9, 10.1.2.3' }), { ip: null, entries: 2, index: null });
    assert.deepEqual(readForwardedFor({}), { ip: null, entries: 0, index: null });
  });
});

describe('checkoutIpHash', () => {
  test('one IPv6 /64 is one visitor, however the address is written', () => {
    assert.equal(visitorKey('2001:db8:1:2::abcd'), '2001:db8:1:2::/64');
    assert.equal(visitorKey('2001:0DB8:0001:0002:ffff:0:0:1'), '2001:db8:1:2::/64');
    assert.equal(visitorKey('2001:db8::1'), '2001:db8:0:0::/64');
    assert.equal(visitorKey('64:ff9b::203.0.113.9'), '64:ff9b:0:0::/64');
    assert.equal(checkoutIpHash('2001:db8:1:2::1'), checkoutIpHash('2001:db8:1:2:aaaa:bbbb:cccc:dddd'));
    assert.notEqual(checkoutIpHash('2001:db8:1:2::1'), checkoutIpHash('2001:db8:1:3::1'));
  });

  test('IPv4 addresses are told apart, and the address isn’t in the hash', () => {
    assert.equal(visitorKey('203.0.113.9'), '203.0.113.9');
    assert.equal(visitorKey('::ffff:203.0.113.9'), '203.0.113.9');
    assert.notEqual(checkoutIpHash('203.0.113.9'), checkoutIpHash('203.0.113.10'));
    assert.match(HASH, /^[0-9a-f]{64}$/);
    assert.ok(!HASH.includes('203'));
  });
});

describe('openCheckouts', () => {
  test('counts unpaid checkouts started in the last 35 minutes', () => {
    const open = openCheckouts(
      asBookings([
        hold('recent'),
        hold('34min', { createdAt: minutesAgo(34) }),
        hold('old', { createdAt: minutesAgo(36) }),
        hold('paid', { status: 'confirmed' }),
        hold('released', { status: 'cancelled' }),
        hold('legacy-123'),
        hold('imported', { legacy: { bookingId: 9 } }),
        hold('no-time', { createdAt: undefined }),
      ]),
      { nowMs: NOW },
    );
    assert.deepEqual(open.map((b) => b.id), ['recent', '34min']);
  });

  test('leaves out the checkout this one replaces, given its token', () => {
    const docs = asBookings([hold('a'), hold('b'), hold('c')]);
    const replacing = { bookingId: 'b', accessToken: `${TOKEN}-b` };
    assert.deepEqual(openCheckouts(docs, { nowMs: NOW, replacing }).map((b) => b.id), ['a', 'c']);
    // Someone else's booking id without its token still counts.
    const guessed = { bookingId: 'b', accessToken: 'not-the-token' };
    assert.equal(openCheckouts(docs, { nowMs: NOW, replacing: guessed }).length, 3);
  });
});

describe('assertCheckoutAllowed', () => {
  const three = { h1: hold('h1'), h2: hold('h2'), h3: hold('h3') };

  test(`turns a visitor away with ${MAX_OPEN_CHECKOUTS} unpaid checkouts open`, async () => {
    const { db } = fakeFirestore({ bookings: three });
    await assert.rejects(assertCheckoutAllowed({ ipHash: HASH, db, nowMs: NOW }), (err: unknown) => {
      assert.ok(err instanceof CheckoutLimitError);
      assert.deepEqual(err.open.map((b) => b.id).sort(), ['h1', 'h2', 'h3']);
      assert.match(err.message, /call Travis at 352-586-7792/);
      return true;
    });
  });

  test('lets them through below the limit, or once one is paid, released or old', async () => {
    for (const third of [
      null,
      hold('h3', { status: 'confirmed' }),
      hold('h3', { status: 'cancelled' }),
      hold('h3', { createdAt: minutesAgo(40) }),
      hold('h3', { checkoutIpHash: checkoutIpHash('198.51.100.7') }),
    ]) {
      const { db } = fakeFirestore({ bookings: { h1: hold('h1'), h2: hold('h2'), ...(third && { h3: third }) } });
      await assertCheckoutAllowed({ ipHash: HASH, db, nowMs: NOW });
    }
  });

  test('doesn’t count the checkout being replaced', async () => {
    const { db } = fakeFirestore({ bookings: three });
    await assertCheckoutAllowed({
      ipHash: HASH,
      db,
      nowMs: NOW,
      replacing: { bookingId: 'h3', accessToken: `${TOKEN}-h3` },
    });
  });

  test('never refuses a visitor whose address couldn’t be told', async () => {
    const { db } = fakeFirestore({ bookings: three });
    await assertCheckoutAllowed({ ipHash: null, db, nowMs: NOW });
  });

  test('two checkouts at once can’t both take the last place', async () => {
    // The other checkout saves its booking while this one's transaction is
    // open. Firestore runs this one again, and it then sees three.
    const { db, col } = fakeFirestore(
      { bookings: { h1: hold('h1'), h2: hold('h2') } },
      {
        beforeCommit: (data, attempt) => {
          if (attempt === 1) data.get('bookings')!.set('other', hold('other'));
        },
      },
    );
    const attempt = db.runTransaction(async (tx) => {
      await assertCheckoutAllowed({ ipHash: HASH, db, tx, nowMs: NOW });
      tx.set(db.collection('bookings').doc('mine'), hold('mine'));
    });
    await assert.rejects(attempt, CheckoutLimitError);
    assert.ok(!col('bookings').has('mine'));
  });
});

describe('checkout limit alert', () => {
  const alert: CheckoutLimitAlert = {
    ipHash: HASH,
    attempt: {
      customer: { name: 'Sam Rivera', email: 'sam@example.com', phone: '352-555-0100' },
      tour: { name: 'Morning Manatee Tour', timeSlot: 'morning', type: 'shared' },
      date: '2026-10-18',
      guestCount: 2,
    },
    open: asBookings([hold('h1'), hold('h2', { customerName: 'Pat Lee' }), hold('h3')]),
  };

  test('says who it was, what they tried to book and what they had open', () => {
    const { subject, text, html } = buildCheckoutLimitAlertEmail(alert, 'https://example.com/');
    assert.equal(subject, '[CRMF] Checkout turned away: Sam Rivera (Sun Oct 18, 8:00 shared)');
    assert.match(text, /while 3 others from the same internet connection were still unpaid/);
    assert.match(text, /Phone: +352-555-0100 \(tel:\+13525550100\)/);
    assert.match(text, /Trip: +Sun Oct 18, 8:00 shared · Morning Manatee Tour, 2 guests/);
    assert.match(text, /- Pat Lee · Sun Oct 18, 8:00 shared, 2 guests · started 7:55 AM: https:\/\/example\.com\/admin\/bookings\/h2/);
    assert.match(text, /at most once a day/);
    assert.ok(html.includes('href="tel:+13525550100"'));
    assert.ok(html.includes('https://example.com/admin/bookings/h3'));
    // The visitor's hash is for the key, not for Travis.
    assert.ok(!text.includes(HASH));
  });

  test('goes to Travis as an admin email, once a day per visitor', async () => {
    const { resend, sent } = fakeResend();
    const { db } = fakeFirestore({});
    const deps = { db, resend, baseUrl: 'https://example.com', adminEmail: 'travis@example.com' };
    await sendCheckoutLimitAlert(alert, { ...deps, now: new Date(NOW) });
    await sendCheckoutLimitAlert(alert, { ...deps, now: new Date(NOW + 60 * 60_000) });
    // 11 PM in Crystal River is the next day in UTC: still the same day there.
    await sendCheckoutLimitAlert(alert, { ...deps, now: new Date('2026-10-18T03:00:00Z') });
    await sendCheckoutLimitAlert(alert, { ...deps, now: new Date('2026-10-18T13:00:00Z') });
    assert.deepEqual(sent.map((s) => s.payload.to), [['travis@example.com'], ['travis@example.com'], ['travis@example.com'], ['travis@example.com']]);
    assert.deepEqual(
      sent.map((s) => s.options?.idempotencyKey),
      [
        `checkout-limit/${HASH}/2026-10-17`,
        `checkout-limit/${HASH}/2026-10-17`,
        `checkout-limit/${HASH}/2026-10-17`,
        `checkout-limit/${HASH}/2026-10-18`,
      ],
    );
    assert.ok(sent.every((s) => s.payload.tags?.some((t) => t.name === 'kind' && t.value === 'admin')));
  });

  test('a later attempt that day, already alerted, is quiet', async () => {
    for (const name of ['invalid_idempotent_request', 'concurrent_idempotent_requests']) {
      const { resend } = fakeResend({ fail: { name, message: 'Same key' } });
      await sendCheckoutLimitAlert(alert, {
        db: fakeFirestore({}).db,
        resend,
        baseUrl: 'https://example.com',
        adminEmail: 'travis@example.com',
        now: new Date(NOW),
      });
    }
    const { resend } = fakeResend({ fail: { name: 'validation_error', message: 'Invalid `to` field' } });
    await assert.rejects(
      sendCheckoutLimitAlert(alert, { db: fakeFirestore({}).db, resend, baseUrl: 'https://example.com', adminEmail: 'x', now: new Date(NOW) }),
      /Resend failed/,
    );
  });
});
