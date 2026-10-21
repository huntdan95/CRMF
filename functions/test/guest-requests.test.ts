/**
 * What a booking's link can set off, and for which bookings: reschedule
 * requests and private feedback only for trips that are real (not a
 * checkout anyone can start for any address and let go of), and the trip
 * photos email not for a departure Travis closed. Against an in-memory
 * Firestore; emails land in the emulator outbox (lib/resend.ts). Run with
 * `npm test` in functions/.
 */
import { before, describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'firebase-functions/v2/https';

import { db as liveDb } from '../src/lib/firebase';
import { requestReschedule } from '../src/requestReschedule';
import { submitFeedback, tripHappened } from '../src/feedback';
import { alertCrewOfCancellation, alertCrewOfRescheduleRequest } from '../src/crewAlerts';
import { galleryKey } from '../src/lib/gallery-link';
import type { Booking } from '../src/lib/types';
import { TOKEN, fakeFirestore, type Doc } from './fakes';

process.env.RESEND_API_KEY = 'emulator-outbox';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';
process.env.ADMIN_EMAIL = 'travis@example.com';
process.env.APP_BASE_URL = 'https://example.com';
// The Storage trigger in tripPhotos.ts needs a default bucket to load.
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: 'demo-test', storageBucket: 'demo-test.appspot.com' });
let runTripPhotos: typeof import('../src/tripPhotos').runTripPhotos;
before(async () => {
  ({ runTripPhotos } = await import('../src/tripPhotos'));
});

function booking(id: string, over: Doc = {}): Doc {
  return {
    id,
    tourId: 'morning-shared',
    tourName: '2hr Morning Tour — Shared',
    date: '2099-07-04',
    timeSlot: 'morning',
    type: 'shared',
    guestCount: 2,
    guests: [],
    customerName: `Guest ${id}`,
    customerEmail: `${id}@example.com`,
    customerPhone: '352-555-0100',
    accessToken: TOKEN,
    status: 'confirmed',
    paymentStatus: 'paid',
    amountPaidCents: 16800,
    amountRefundedCents: 0,
    ...over,
  };
}

/** A checkout someone started for a stranger's address and let go of, or hasn't yet. */
const unpaid = (id: string, over: Doc = {}) =>
  booking(id, { status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, customerEmail: 'victim@example.com', ...over });

/** Points the functions' Firestore at an in-memory one. Returns what was emailed. */
function world(t: TestContext, initial: Record<string, Record<string, Doc>>) {
  const fs = fakeFirestore(initial);
  t.mock.method(liveDb, 'collection', fs.db.collection);
  t.mock.method(liveDb, 'runTransaction', fs.db.runTransaction);
  const emails = () => [...fs.col('emailOutbox').values()].map((e) => ({ to: (e.to as string[]).join(','), subject: e.subject as string, text: e.text as string }));
  return { ...fs, emails };
}

const request = (body: Record<string, unknown>) =>
  ({ method: 'POST', headers: {}, body, header: () => undefined }) as unknown as Request;

/** Calls an endpoint the way Cloud Functions would and returns its answer. */
async function call(fn: (req: Request, res: never) => unknown, body: Record<string, unknown>) {
  const answer = { status: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      answer.status = code;
      return res;
    },
    json(b: unknown) {
      answer.body = b;
      return res;
    },
    send(b: unknown) {
      answer.body = b;
      return res;
    },
    set: () => res,
    setHeader: () => res,
    getHeader: () => undefined,
    on: () => res,
  };
  await fn(request(body), res as never);
  return answer;
}

describe('requestReschedule', () => {
  const ask = (bookingId: string) =>
    call(requestReschedule, { bookingId, accessToken: TOKEN, requestedDate: '2099-07-10' });

  test('not on a checkout nobody paid for: no request, and nobody is emailed', async (t) => {
    const w = world(t, { bookings: { open: unpaid('open'), gone: unpaid('gone', { status: 'cancelled' }) } });

    const open = await ask('open');
    assert.equal(open.status, 409);
    assert.match((open.body as { error: string }).error, /hasn’t been paid for yet/);
    assert.equal((await ask('gone')).status, 409);
    assert.equal(w.col('rescheduleRequests').size, 0);
    assert.deepEqual(w.emails(), []);
  });

  test('a paid trip, or an old-site deposit, goes to Travis with the customer’s copy', async (t) => {
    const w = world(t, {
      bookings: { paid: booking('paid'), 'legacy-9': booking('legacy-9', { status: 'pending-payment', paymentStatus: 'pending' }) },
    });

    assert.equal((await ask('paid')).status, 200);
    assert.equal((await ask('legacy-9')).status, 200);
    assert.equal(w.col('rescheduleRequests').size, 2);
    assert.deepEqual(w.emails().map((e) => e.to).sort(), ['legacy-9@example.com', 'paid@example.com', 'travis@example.com', 'travis@example.com']);
  });

  test('not while Travis is calling the trip off: in minutes the closure cancels them or offers a new date', async (t) => {
    // The 8:00 closed, in its undo window ("cancel") or going out ("offer").
    const w = world(t, {
      bookings: { paid: booking('paid'), 'legacy-9': booking('legacy-9', { status: 'pending-payment', paymentStatus: 'pending' }) },
      blackouts: { bo1: { date: '2099-07-04', affectedSlots: ['morning'] }, bo2: { date: '2099-07-04', affectedSlots: ['all'] } },
      closureActions: {
        bo1: { date: '2099-07-04', affectedSlots: ['morning'], choice: 'cancel', state: 'pending' },
        bo2: { date: '2099-07-04', affectedSlots: ['all'], choice: 'offer', state: 'finalizing' },
      },
    });

    const paid = await ask('paid');
    assert.equal(paid.status, 409);
    assert.equal((paid.body as { code: string }).code, 'closure-pending');
    assert.match((paid.body as { error: string }).error, /^Capt\. Travis just called this trip off\. You’ll get an email in the next few minutes/);
    assert.equal((await ask('legacy-9')).status, 409);
    w.col('closureActions').set('bo1', { ...w.col('closureActions').get('bo1'), state: 'undone' });
    assert.equal((await ask('paid')).status, 409);
    assert.equal(w.col('rescheduleRequests').size, 0);
    assert.deepEqual(w.emails(), []);
  });

  test('a trip closed with “leave them booked” stays on: a request goes through, even in its undo window', async (t) => {
    const w = world(t, {
      bookings: { paid: booking('paid') },
      blackouts: { bo1: { date: '2099-07-04', affectedSlots: ['all'] } },
      closureActions: { bo1: { date: '2099-07-04', affectedSlots: ['all'], choice: 'keep', state: 'pending' } },
    });
    assert.equal((await ask('paid')).status, 200);
    assert.equal(w.col('rescheduleRequests').size, 1);
  });

  test('a cruise only to a date the cruise runs: out of season is a 400 with its season, and nobody is emailed', async (t) => {
    const cruise = { tourId: 'sunset-private', tourName: 'Sunset Cruise — Private', timeSlot: 'sunset', type: 'private' };
    const w = world(t, { bookings: { cruise: booking('cruise', cruise), morning: booking('morning') } });
    const move = (bookingId: string, requestedDate: string, requestedSlot?: string) =>
      call(requestReschedule, { bookingId, accessToken: TOKEN, requestedDate, ...(requestedSlot && { requestedSlot }) });

    // "No preference" on a cruise booking is a cruise too.
    for (const slot of ['sunset', undefined]) {
      const r = await move('cruise', '2099-12-05', slot);
      assert.equal(r.status, 400);
      assert.equal(
        (r.body as { error: string }).error,
        'The sunset cruise runs April 1 – November 14. Pick a date in the season, or call Travis.',
      );
    }
    assert.equal(w.col('rescheduleRequests').size, 0);
    assert.deepEqual(w.emails(), []);

    // Its last evening is fine, and so is December for a two-hour tour.
    assert.equal((await move('cruise', '2099-11-14', 'sunset')).status, 200);
    assert.equal((await move('morning', '2099-12-05')).status, 200);
    assert.equal(w.col('rescheduleRequests').size, 2);
  });
});

describe('the crew’s reschedule alert', () => {
  test('skips a booking that isn’t going ahead (a request filed before requestReschedule checked)', async (t) => {
    world(t, {
      bookings: { b1: unpaid('b1', { status: 'cancelled' }) },
      rescheduleRequests: { r1: { bookingId: 'b1', requestedDate: '2099-07-10', requestedSlot: null, notes: null, status: 'open' } },
    });
    assert.equal(await alertCrewOfRescheduleRequest('r1'), 'not-going-ahead');
  });
});

describe('the crew’s cancellation alert', () => {
  test('not for a customer who took the refund after Travis closed their trip: the closure told the crew', async (t) => {
    world(t, {
      bookings: {
        b1: booking('b1', {
          status: 'cancelled',
          cancelledBy: 'customer',
          closure: { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2099-07-07' },
        }),
      },
    });
    assert.equal(await alertCrewOfCancellation('b1'), 'closed');
  });
});

describe('submitFeedback', () => {
  const tell = (bookingId: string) => call(submitFeedback, { bookingId, accessToken: TOKEN, message: 'The boat was great.' });

  test('not on an unpaid checkout, a cancelled booking, or a trip still to come', async (t) => {
    const w = world(t, {
      bookings: {
        open: unpaid('open', { date: '2020-01-01' }),
        gone: unpaid('gone', { date: '2020-01-01', status: 'cancelled' }),
        soon: booking('soon'),
      },
    });

    for (const id of ['open', 'gone', 'soon']) {
      const r = await tell(id);
      assert.equal(r.status, 409, id);
      assert.match((r.body as { error: string }).error, /after your trip/);
    }
    assert.equal(w.col('guestFeedback').size, 0);
    assert.deepEqual(w.emails(), []);
  });

  test('after a trip that ran, it reaches Travis', async (t) => {
    const w = world(t, { bookings: { done: booking('done', { date: '2020-01-01', status: 'completed' }) } });

    assert.equal((await tell('done')).status, 200);
    assert.equal(w.col('guestFeedback').size, 1);
    assert.deepEqual(w.emails().map((e) => e.to), ['travis@example.com']);
  });

  test('a confirmed trip counts once the boat is back, not before', () => {
    const b = booking('b1', { date: '2026-11-10' }) as Booking;
    // The 8:00 trip is out until 10:00 AM (EST: 15:00 UTC).
    assert.equal(tripHappened(b, new Date('2026-11-10T14:59:00Z')), false);
    assert.equal(tripHappened(b, new Date('2026-11-10T15:00:00Z')), true);
    assert.equal(tripHappened({ ...b, id: 'legacy-3', status: 'pending-payment' }, new Date('2026-11-11T12:00:00Z')), true);
    assert.equal(tripHappened({ ...b, status: 'pending-payment' }, new Date('2026-11-11T12:00:00Z')), false);
  });
});

describe('the trip photos email', () => {
  test('skips a departure Travis closed and left them booked on; the gallery link is its own key', async (t) => {
    // 10:00 AM at the marina on Wednesday, November 11: the day after.
    const now = new Date('2026-11-11T15:00:00Z');
    const lastUploadAt = { toMillis: () => Date.parse('2026-11-10T20:00:00Z') };
    const trip = (timeSlot: string) => ({ date: '2026-11-10', timeSlot, uploadToken: `u-${timeSlot}`, photoCount: 4, lastUploadAt });
    const w = world(t, {
      bookings: {
        ran: booking('ran', { date: '2026-11-10' }),
        closed: booking('closed', { date: '2026-11-10', timeSlot: 'mid-morning', tourId: 'mid-morning-shared' }),
        marked: booking('marked', { date: '2026-11-10', timeSlot: 'mid-morning', tourId: 'mid-morning-shared', status: 'completed' }),
      },
      tripPhotos: { '2026-11-10_morning': trip('morning'), '2026-11-10_mid-morning': trip('mid-morning') },
      blackouts: { bo1: { date: '2026-11-10', affectedSlots: ['mid-morning'] } },
    });

    assert.deepEqual(await runTripPhotos(now), { sent: 2, failed: 0, skipped: 0 });
    // Travis marking it completed says it ran after all.
    assert.deepEqual(w.emails().map((e) => e.to).sort(), ['marked@example.com', 'ran@example.com']);
    assert.equal(w.col('bookings').get('closed')!.photosSentAt, undefined);

    const text = w.emails().find((e) => e.to === 'ran@example.com')!.text;
    assert.ok(text.includes(`https://example.com/my-booking/ran/photos?k=${galleryKey(TOKEN)}`));
    assert.ok(!text.includes(TOKEN), 'not the booker’s access token');
  });
});
