/**
 * "Reset their booking links": a new access token, so every link made from
 * the old one stops working, and the email that fits the booking goes to
 * its current address with the new links. Against in-memory stand-ins for
 * Firestore and Resend. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';

const MCP = 'mcp-test-token-0123456789abcdefghijklmnop';

// Secrets and params are read from the environment when a request runs.
process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';
process.env.ADMIN_EMAIL = 'travis@example.com';
process.env.APP_BASE_URL = 'https://example.com';
process.env.MCP_TOKEN = MCP;

import { adminResetLinksOne, resetLinksPaths } from '../src/lib/admin-reset-links';
import { adminResetBookingLinks } from '../src/adminBookings';
import { fetchBooking } from '../src/fetchBooking';
import { cancelBooking } from '../src/cancelBooking';
import { requestReschedule } from '../src/requestReschedule';
import { releaseHold } from '../src/lib/checkout-hold';
import { moveClosedBooking } from '../src/lib/closure';
import { resendClosureOffers } from '../src/closureReminders';
import { waiverKey } from '../src/lib/waiver-link';
import { galleryKey } from '../src/lib/gallery-link';
import { db as liveDb } from '../src/lib/firebase';
import type { AdminContext } from '../src/lib/admin-auth';
import { waiverSigningLink } from '../../src/lib/waiver/link';
import { galleryKey as appGalleryKey } from '../../src/lib/gallery-link';
import { TOKEN, fakeDb, fakeResend, fakeStripe, type Doc } from './fakes';

const ADMIN: AdminContext = { uid: 'u1', email: 'travis@example.com' };
/** 10 AM marina time. */
const NOW = new Date('2026-10-20T14:00:00Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const booking = (extra: Doc = {}): Doc => ({
  id: 'b1',
  tourId: 'mid-morning-shared',
  tourName: '2hr Mid-morning Tour — Shared',
  date: '2026-11-07',
  timeSlot: 'mid-morning',
  type: 'shared',
  guestCount: 2,
  guests: [],
  customerName: 'Jane Smith',
  customerEmail: 'jane@example.com',
  customerPhone: '352-555-0100',
  accessToken: TOKEN,
  status: 'confirmed',
  paymentStatus: 'paid',
  amountPaidCents: 16800,
  amountRefundedCents: 0,
  stripePaymentIntentId: 'pi_1',
  confirmationEmailSentAt: Timestamp.fromDate(new Date('2026-10-01T12:00:00Z')),
  confirmationEmailMessageId: 'em_first',
  ...extra,
});

const closure = (decideBy: string) => ({
  blackoutId: 'bo1',
  reason: 'Closed for weather',
  decideBy,
  offeredAt: Timestamp.fromDate(new Date('2026-10-19T12:00:00Z')),
});

function setup(docs: Record<string, Doc>, opts: Parameters<typeof fakeResend>[0] = {}) {
  const { db, store, commits } = fakeDb(docs);
  const { resend, sent } = fakeResend(opts);
  const audits: Array<Parameters<NonNullable<Parameters<typeof adminResetLinksOne>[2]['audit']>>[0]> = [];
  const reset = (id = 'b1') =>
    adminResetLinksOne(id, ADMIN, {
      db,
      now: NOW,
      paths: resetLinksPaths(ADMIN.email, { db, resend }),
      audit: async (entry) => {
        audits.push(entry);
      },
    });
  return { db, store, commits, sent, audits, reset };
}

const request = (body: Record<string, unknown>, token?: string) =>
  ({
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
    header: () => undefined,
  }) as unknown as Request;

/** Calls an endpoint the way Cloud Functions would and returns its answer. */
async function call(fn: (req: Request, res: never) => unknown, req: Request) {
  const answer = { status: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      answer.status = code;
      return res;
    },
    json(body: unknown) {
      answer.body = body;
      return res;
    },
    send(body: unknown) {
      answer.body = body;
      return res;
    },
    set: () => res,
    setHeader: () => res,
    getHeader: () => undefined,
    on: () => res,
  };
  await fn(req, res as never);
  return answer;
}

describe('adminResetLinksOne', () => {
  test('a new token, in one transaction, and the confirmation with the new links goes to the address on it now', async () => {
    const { store, commits, sent, reset } = setup({ b1: booking({ customerEmail: 'jane@exmaple.com' }) });
    // Travis puts in the right address (Edit booking), then resets the links.
    store.set('b1', { ...store.get('b1')!, customerEmail: 'jane@example.com' });

    const result = await reset();

    assert.deepEqual(result, { kind: 'reset', email: { outcome: 'sent', kind: 'confirmation', to: 'jane@example.com' } });
    const fresh = store.get('b1')!.accessToken as string;
    assert.notEqual(fresh, TOKEN);
    assert.match(fresh, UUID, 'a UUID, like the one checkout made');
    assert.deepEqual(commits, [{ reads: ['bookings/b1'], writes: ['bookings/b1'] }]);

    assert.equal(sent.length, 1);
    const { payload, options } = sent[0]!;
    assert.deepEqual(payload.to, ['jane@example.com']);
    assert.equal(payload.bcc, 'travis@example.com');
    assert.deepEqual(payload.tags?.[0], { name: 'kind', value: 'confirmation' });
    assert.match(payload.subject, /^Tour confirmed for /);
    // A new confirmation, not a repeat of the first one.
    assert.deepEqual(options, { idempotencyKey: 'booking-confirmation/b1/em_first' });
    assert.ok(payload.text!.includes(`https://example.com/my-booking/b1?t=${fresh}`), 'the new manage link');
    assert.ok(payload.text!.includes(`https://example.com/waiver/b1?k=${waiverKey(fresh)}`), 'the new waiver link');
    for (const old of [TOKEN, waiverKey(TOKEN)]) {
      assert.ok(!payload.html!.includes(old) && !payload.text!.includes(old), 'nothing made from the old token');
    }
    assert.equal(store.get('b1')!.confirmationEmailMessageId, 'em_1');
  });

  test('the old token and the old waiver key stop working; the new ones work', async (t) => {
    const { db, store, reset } = setup({ b1: booking() });
    await reset();
    const fresh = store.get('b1')!.accessToken as string;

    // The customer functions read the booking from Firestore: this one.
    t.mock.method(liveDb, 'collection', db.collection);

    const read = (accessToken: string) => call(fetchBooking, request({ bookingId: 'b1', accessToken }));
    assert.deepEqual(await read(TOKEN), { status: 403, body: { error: 'Invalid access token' } });
    const ok = await read(fresh);
    assert.equal(ok.status, 200);
    assert.equal((ok.body as { booking: { accessToken: string } }).booking.accessToken, fresh);

    const cancel = await call(cancelBooking, request({ bookingId: 'b1', accessToken: TOKEN }));
    assert.deepEqual(cancel, { status: 403, body: { error: 'Invalid access token' } });
    const move = await call(requestReschedule, request({ bookingId: 'b1', accessToken: TOKEN, requestedDate: '2026-11-20' }));
    assert.deepEqual(move, { status: 403, body: { error: 'Invalid access token' } });
    assert.equal(store.get('b1')!.status, 'confirmed', 'nothing cancelled');

    const { stripe } = fakeStripe('open');
    assert.equal(await releaseHold({ bookingId: 'b1', accessToken: TOKEN }, { stripe, db }), 'not-found');
    const moved = await moveClosedBooking(
      { bookingId: 'b1', accessToken: TOKEN, newDate: '2026-11-20', newTourSlug: 'mid-morning-shared' },
      { db, getTour: async () => assert.fail('got past the token'), getSeasons: async () => [] },
    );
    assert.deepEqual(moved, { kind: 'bad-token' });

    // Signing links are a hash of the token, checked against the booking's
    // current one (bookingForWaiver in src/lib/waiver/server.ts, the same
    // hash): the old key isn't the new one, and the admin page's copy of the
    // link has the new key, matching the email's.
    assert.notEqual(waiverKey(TOKEN), waiverKey(fresh));
    const adminLink = await waiverSigningLink('https://example.com', 'b1', fresh);
    assert.equal(adminLink, `https://example.com/waiver/b1?k=${waiverKey(fresh)}`);
    assert.notEqual(await waiverSigningLink('https://example.com', 'b1', TOKEN), adminLink);
  });

  test('while they’re choosing after a closure, the “pick a new date” email goes instead', async () => {
    const { store, sent, reset } = setup({ b1: booking({ date: '2026-10-21', closure: closure('2026-10-24') }) });

    const result = await reset();

    assert.deepEqual(result, { kind: 'reset', email: { outcome: 'sent', kind: 'closureOffer', to: 'jane@example.com' } });
    const fresh = store.get('b1')!.accessToken as string;
    assert.equal(sent.length, 1);
    const { payload, options } = sent[0]!;
    assert.deepEqual(payload.to, ['jane@example.com']);
    assert.equal(payload.bcc, 'travis@example.com');
    assert.deepEqual(payload.tags?.[0], { name: 'kind', value: 'closureOffer' });
    assert.ok(payload.text!.includes(`https://example.com/my-booking/b1?t=${fresh}`));
    assert.ok(!payload.html!.includes(TOKEN) && !payload.text!.includes(TOKEN));
    const key = options?.idempotencyKey ?? '';
    assert.match(key, /^reset-links\/b1\/[0-9a-f]{16}$/);
    assert.ok(!key.includes(fresh), 'the key isn’t the token');
  });

  test('an offer that never went out is recorded as emailed, so the hourly resend doesn’t send it again', async () => {
    // Resend refused it as the closure went out: no offerEmailedAt.
    const { db, store, sent, reset } = setup({ b1: booking({ date: '2026-10-21', closure: closure('2026-10-24') }) });

    await reset();

    assert.equal(sent.length, 1);
    assert.deepEqual((store.get('b1')!.closure as { offerEmailedAt?: Timestamp }).offerEmailedAt, Timestamp.fromDate(NOW));
    const resent: string[] = [];
    const mailer = {
      send: async (m: { bookingId: string }) => void resent.push(m.bookingId),
      marina: { name: 'Pete’s Pier', address: '1 Main St' },
      phoneDisplay: '352-555-0100',
    };
    assert.deepEqual(await resendClosureOffers({ db, now: NOW, baseUrl: 'https://example.com', mailer }), { sent: [], failed: [] });
    assert.deepEqual(resent, []);

    // One that had gone keeps the time it went.
    const earlier = Timestamp.fromDate(new Date('2026-10-19T12:05:00Z'));
    const again = setup({ b1: booking({ date: '2026-10-21', closure: { ...closure('2026-10-24'), offerEmailedAt: earlier } }) });
    await again.reset();
    assert.deepEqual((again.store.get('b1')!.closure as { offerEmailedAt?: Timestamp }).offerEmailedAt, earlier);
  });

  test('nothing fits: the links are reset and nothing is sent, saying why', async () => {
    const cases: Array<[string, Doc, string]> = [
      ['cancelled', booking({ status: 'cancelled' }), 'The booking is cancelled.'],
      ['completed', booking({ status: 'completed', date: '2026-10-18' }), 'The trip is over.'],
      ['past', booking({ date: '2026-10-18' }), 'The trip date has passed.'],
      [
        'reservation',
        booking({ id: 'legacy-9', status: 'pending-payment', legacy: { bookingId: 9 } as Doc['legacy'] }),
        'It’s an old-website reservation, not a confirmed booking, so there’s no confirmation to send.',
      ],
      ['no address', booking({ customerEmail: '' }), 'There’s no email address on the booking.'],
      ['too late to choose', booking({ date: '2026-10-15', closure: closure('2026-10-18') }), 'The time to pick a new date has passed, so they’re being refunded.'],
      [
        'refund turned down',
        booking({
          date: '2026-10-15',
          closure: { ...closure('2026-10-18'), refundRefused: { at: Timestamp.fromDate(new Date('2026-10-19T10:00:00Z')), refundCents: 26000, stripeMessage: 'disputed' } },
        }),
        'The time to pick a new date has passed, and Stripe turned down their refund: call them.',
      ],
    ];
    for (const [name, doc, reason] of cases) {
      const { store, sent, audits, reset } = setup({ b1: doc });
      assert.deepEqual(await reset(), { kind: 'reset', email: { outcome: 'skipped', reason } }, name);
      assert.notEqual(store.get('b1')!.accessToken, TOKEN, `${name}: still reset`);
      assert.equal(sent.length, 0, name);
      assert.equal(audits.length, 1, name);
    }
  });

  test('after the trip, the photos email goes again with the new gallery link, if one went', async () => {
    const trip = { uploadToken: 'u'.repeat(32), photoCount: 3 };
    const { db, store } = fakeDb(
      { b1: booking({ status: 'completed', date: '2026-10-17', photosSentAt: Timestamp.fromDate(new Date('2026-10-18T13:00:00Z')) }) },
      { others: { tripPhotos: { '2026-10-17_mid-morning': trip } } },
    );
    const { resend, sent } = fakeResend();

    const result = await adminResetLinksOne('b1', ADMIN, { db, now: NOW, paths: resetLinksPaths(ADMIN.email, { db, resend }), audit: async () => {} });

    assert.deepEqual(result, { kind: 'reset', email: { outcome: 'sent', kind: 'photos', to: 'jane@example.com' } });
    const fresh = store.get('b1')!.accessToken as string;
    assert.equal(sent.length, 1);
    const { payload, options } = sent[0]!;
    assert.deepEqual(payload.to, ['jane@example.com']);
    assert.equal(payload.bcc, 'travis@example.com');
    assert.deepEqual(payload.tags?.[0], { name: 'kind', value: 'photos' });
    // The gallery's own key, made from the new token: the app checks the
    // same hash (src/lib/gallery-link.ts), and the old key isn't it.
    assert.ok(payload.text!.includes(`https://example.com/my-booking/b1/photos?k=${galleryKey(fresh)}`), 'the new gallery link');
    assert.equal(appGalleryKey(fresh), galleryKey(fresh));
    assert.notEqual(galleryKey(TOKEN), galleryKey(fresh));
    assert.ok(!payload.html!.includes(fresh) && !payload.text!.includes(fresh), 'not the token itself');
    assert.ok(!payload.html!.includes(TOKEN) && !payload.text!.includes(TOKEN));
    assert.match(options?.idempotencyKey ?? '', /^reset-links\/b1\/[0-9a-f]{16}\/photos$/);
  });

  test('after the trip, nothing goes if the gallery is empty now or they never had a photos email', async () => {
    const sentAt = Timestamp.fromDate(new Date('2026-10-18T13:00:00Z'));
    const cases: Array<[string, Doc, Doc, string]> = [
      [
        'gallery emptied',
        booking({ status: 'completed', date: '2026-10-17', photosSentAt: sentAt }),
        { uploadToken: 'u'.repeat(32), photoCount: 0 },
        'The trip is over, and there’s nothing in their photo gallery now.',
      ],
      ['no photos email', booking({ status: 'completed', date: '2026-10-17' }), { uploadToken: 'u'.repeat(32), photoCount: 3 }, 'The trip is over.'],
      ['no-show', booking({ status: 'no-show', date: '2026-10-17', photosSentAt: sentAt }), { uploadToken: 'u'.repeat(32), photoCount: 3 }, 'The trip is over.'],
    ];
    for (const [name, doc, trip, reason] of cases) {
      const { db } = fakeDb({ b1: doc }, { others: { tripPhotos: { '2026-10-17_mid-morning': trip } } });
      const { resend, sent } = fakeResend();
      const result = await adminResetLinksOne('b1', ADMIN, { db, now: NOW, paths: resetLinksPaths(ADMIN.email, { db, resend }), audit: async () => {} });
      assert.deepEqual(result, { kind: 'reset', email: { outcome: 'skipped', reason } }, name);
      assert.equal(sent.length, 0, name);
    }
  });

  test('on a departure Travis closed and left them booked, no “locked in” confirmation', async () => {
    const { db, store } = fakeDb(
      { b1: booking() },
      { blackouts: [{ date: '2026-11-07', affectedSlots: ['mid-morning'], reason: 'weather' }] },
    );
    const { resend, sent } = fakeResend();

    const result = await adminResetLinksOne('b1', ADMIN, { db, now: NOW, paths: resetLinksPaths(ADMIN.email, { db, resend }), audit: async () => {} });

    assert.deepEqual(result, {
      kind: 'reset',
      email: { outcome: 'skipped', reason: 'You closed that departure, and a confirmation would tell them it’s still on.' },
    });
    assert.notEqual(store.get('b1')!.accessToken, TOKEN, 'still reset');
    assert.equal(sent.length, 0);
  });

  test('the email failing doesn’t undo the reset, and says so', async () => {
    const { store, audits, reset } = setup({ b1: booking() }, { fail: { name: 'validation_error', message: 'Invalid `to` field' } });

    const result = await reset();

    const email = { outcome: 'failed', kind: 'confirmation', to: 'jane@example.com', reason: 'Resend failed: Invalid `to` field' };
    assert.deepEqual(result, { kind: 'reset', email });
    assert.notEqual(store.get('b1')!.accessToken, TOKEN);
    assert.deepEqual(audits[0]!.payload, { action: 'reset-links', email });
  });

  test('audited once, with what was emailed, and never the token or a key made from it', async () => {
    const { store, audits, reset } = setup({ b1: booking() });
    await reset();
    const fresh = store.get('b1')!.accessToken as string;

    assert.deepEqual(audits, [
      {
        admin: ADMIN,
        action: 'booking.update',
        targetId: 'b1',
        payload: { action: 'reset-links', email: { outcome: 'sent', kind: 'confirmation', to: 'jane@example.com' } },
      },
    ]);
    const logged = JSON.stringify(audits);
    for (const secret of [TOKEN, fresh, waiverKey(TOKEN), waiverKey(fresh)]) {
      assert.ok(!logged.includes(secret));
    }
  });

  test('not while they’re still paying online, and not for a booking that isn’t there', async () => {
    const { store, commits, sent, audits, reset } = setup({
      b1: booking({ status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0 }),
    });

    assert.deepEqual(await reset(), { kind: 'still-paying' });
    assert.equal(store.get('b1')!.accessToken, TOKEN, 'Stripe sends them back with this one');
    assert.deepEqual(await reset('nope'), { kind: 'not-found' });
    assert.deepEqual(commits.flatMap((c) => c.writes), []);
    assert.equal(sent.length, 0);
    assert.equal(audits.length, 0);
  });
});

describe('adminResetBookingLinks', () => {
  test('refuses the MCP token before touching anything', async (t) => {
    t.mock.method(liveDb, 'collection', () => assert.fail('touched Firestore'));
    const answer = await call(adminResetBookingLinks, request({ bookingId: 'b1' }, MCP));
    assert.deepEqual(answer, { status: 401, body: { error: 'Invalid or expired token' } });
  });
});
