/**
 * Travis closing a departure and offering a new date or a refund: the
 * customer moving, and the refund for those who don't answer in time.
 * Against in-memory stand-ins for Firestore, Stripe and email.
 * Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { closureDecideBy, markClosed, moveClosedBooking, type MoveDeps } from '../src/lib/closure';
import { settleExpiredClosures } from '../src/settleClosedBookings';
import { buildClosureOfferEmail } from '../src/lib/email-templates';
import type { CancellationMailer } from '../src/lib/admin-cancel';
import type { SeasonRates } from '../src/lib/pricing';
import type { Tour } from '../src/lib/types';
import { TOKEN, fakeDb, fakeRefunds, fakeStripe, type Doc } from './fakes';

// 9:00 AM at the marina (EST) on Sunday, November 8, 2026.
const NOW = new Date('2026-11-08T14:00:00Z');

function tour(slug: string, timeSlot: Tour['timeSlot'], type: Tour['type'], price: number): Tour {
  return {
    id: slug,
    slug,
    name: slug,
    timeSlot,
    startTime: { morning: '08:00', 'mid-morning': '10:30', 'early-afternoon': '13:00', 'late-afternoon': '15:30', 'whole-day': '07:00' }[timeSlot],
    durationHours: timeSlot === 'whole-day' ? 8 : 2,
    type,
    pricePerPerson: type === 'shared' ? price : null,
    flatPrice: type === 'private' ? price : null,
    maxGuests: 6,
    description: '',
    included: [],
    active: true,
  };
}

const TOURS = [
  tour('morning-shared', 'morning', 'shared', 8400),
  tour('late-afternoon-shared', 'late-afternoon', 'shared', 8400),
  tour('morning-private', 'morning', 'private', 50000),
  tour('whole-day-private', 'whole-day', 'private', 89500),
];

function deps(db: MoveDeps['db'], seasons: SeasonRates[] = []): MoveDeps {
  return {
    db,
    now: NOW,
    getTour: async (slug) => TOURS.find((t) => t.slug === slug) ?? null,
    getSeasons: async (date) => seasons.filter((s) => s.startDate <= date && s.endDate >= date),
  };
}

const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-11-12', offeredAt: {} };

const closed: Doc = {
  id: 'b1',
  tourId: 'morning-shared',
  tourName: '2hr Morning Tour — Shared',
  date: '2026-11-09',
  timeSlot: 'morning',
  type: 'shared',
  guestCount: 2,
  guests: [],
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  accessToken: TOKEN,
  status: 'confirmed',
  paymentStatus: 'paid',
  amountPaidCents: 16800,
  amountRefundedCents: 0,
  stripePaymentIntentId: 'pi_1',
  closure,
};

const moveTo = (newDate: string, newTourSlug = 'morning-shared') => ({
  bookingId: 'b1',
  accessToken: TOKEN,
  newDate,
  newTourSlug,
});

describe('moveClosedBooking', () => {
  test('moves to an open departure, clears the closure and notes the move', async () => {
    const { db, store } = fakeDb({ b1: { ...closed, adminNotes: 'Anniversary trip' } });

    const r = await moveClosedBooking(moveTo('2026-11-14', 'late-afternoon-shared'), deps(db));

    assert.equal(r.kind, 'moved');
    const b = store.get('b1')!;
    assert.equal(b.date, '2026-11-14');
    assert.equal(b.timeSlot, 'late-afternoon');
    assert.equal(b.tourId, 'late-afternoon-shared');
    assert.equal(b.status, 'confirmed');
    assert.equal('closure' in b, false);
    assert.equal(
      b.adminNotes,
      'Anniversary trip\n2026-11-08: Moved by the customer from 2026-11-09 (morning, closed for weather) to 2026-11-14 (late-afternoon).',
    );
  });

  test('can move to another departure the same day when only one was closed', async () => {
    const { db, store } = fakeDb({ b1: closed });
    const r = await moveClosedBooking(moveTo('2026-11-09', 'late-afternoon-shared'), deps(db));
    assert.equal(r.kind, 'moved');
    assert.equal(store.get('b1')!.timeSlot, 'late-afternoon');
  });

  test('refuses a wrong link, a booking that isn’t closed, and one past its deadline', async () => {
    const { db } = fakeDb({
      b1: closed,
      open: { ...closed, id: 'open', closure: undefined },
      late: { ...closed, id: 'late', closure: { ...closure, decideBy: '2026-11-07' } },
      gone: { ...closed, id: 'gone', status: 'cancelled' },
    });
    assert.equal((await moveClosedBooking({ ...moveTo('2026-11-14'), accessToken: 'wrong-token' }, deps(db))).kind, 'bad-token');
    assert.equal((await moveClosedBooking({ ...moveTo('2026-11-14'), bookingId: 'open' }, deps(db))).kind, 'not-closed');
    assert.equal((await moveClosedBooking({ ...moveTo('2026-11-14'), bookingId: 'gone' }, deps(db))).kind, 'not-closed');
    assert.equal((await moveClosedBooking({ ...moveTo('2026-11-14'), bookingId: 'late' }, deps(db))).kind, 'expired');
    assert.equal((await moveClosedBooking({ ...moveTo('2026-11-14'), bookingId: 'nope' }, deps(db))).kind, 'not-found');
  });

  test('only to the same kind of tour, and not back onto the closed departure', async () => {
    const { db, store } = fakeDb({ b1: closed });
    for (const [date, slug] of [
      ['2026-11-14', 'morning-private'],
      ['2026-11-14', 'whole-day-private'],
      ['2026-11-09', 'morning-shared'],
    ] as const) {
      const r = await moveClosedBooking(moveTo(date, slug), deps(db));
      assert.equal(r.kind, 'not-allowed', `${date} ${slug}`);
    }
    assert.equal(store.get('b1')!.date, '2026-11-09');
  });

  test('not into a date priced higher than the one closed', async () => {
    const { db } = fakeDb({ b1: closed });
    const holiday: SeasonRates = {
      id: 's1',
      name: 'Thanksgiving',
      startDate: '2026-11-26',
      endDate: '2026-11-29',
      prices: { 'morning-shared': 9900 },
    };
    const r = await moveClosedBooking(moveTo('2026-11-27'), deps(db, [holiday]));
    assert.equal(r.kind, 'not-allowed');
    if (r.kind === 'not-allowed') assert.match(r.message, /priced higher \(\$198, against \$168\)/);
    assert.equal((await moveClosedBooking(moveTo('2026-11-20'), deps(db, [holiday]))).kind, 'moved');
  });

  test('a shared booking with no party size on file is sent to Travis', async () => {
    const { db } = fakeDb({ 'legacy-9': { ...closed, id: 'legacy-9', guestCount: 0, legacy: { bookingId: 9 } } });
    const r = await moveClosedBooking({ ...moveTo('2026-11-14'), bookingId: 'legacy-9' }, deps(db));
    assert.equal(r.kind, 'not-allowed');
  });

  test('an old-site private booking with no party size can still move', async () => {
    const { db, store } = fakeDb({
      'legacy-7': {
        ...closed,
        id: 'legacy-7',
        tourId: 'morning-private',
        type: 'private',
        guestCount: 0,
        status: 'pending-payment',
        legacy: { bookingId: 7, oldStatus: 'reserved' },
      },
    });
    const r = await moveClosedBooking({ ...moveTo('2026-11-14', 'morning-private'), bookingId: 'legacy-7' }, deps(db));
    assert.equal(r.kind, 'moved');
    assert.equal(store.get('legacy-7')!.date, '2026-11-14');
  });

  test('not onto a full, privately booked or closed departure', async () => {
    const { db, store } = fakeDb(
      {
        b1: closed,
        full: { ...closed, id: 'full', date: '2026-11-14', guestCount: 5, closure: undefined },
        charter: { ...closed, id: 'charter', date: '2026-11-15', timeSlot: 'morning', type: 'private', closure: undefined },
      },
      { blackouts: [{ date: '2026-11-16', affectedSlots: ['all'], reason: 'weather' }] },
    );
    for (const date of ['2026-11-14', '2026-11-15', '2026-11-16']) {
      const r = await moveClosedBooking(moveTo(date), deps(db));
      assert.equal(r.kind, 'unavailable', date);
    }
    // Leaves within the hour (tomorrow is fine; today's 8:00 has gone).
    assert.equal((await moveClosedBooking(moveTo('2026-11-08'), deps(db))).kind, 'unavailable');
    assert.equal(store.get('b1')!.date, '2026-11-09');
  });

  test('does nothing if the booking was refunded in another tab meanwhile', async () => {
    const { db, store } = fakeDb(
      { b1: closed },
      {
        beforeCommit: (s, attempt) => {
          if (attempt === 1) s.set('b1', { ...s.get('b1'), status: 'cancelled' });
        },
      },
    );
    const r = await moveClosedBooking(moveTo('2026-11-14'), deps(db));
    assert.equal(r.kind, 'not-closed');
    assert.equal(store.get('b1')!.date, '2026-11-09');
    assert.equal(store.get('b1')!.status, 'cancelled');
  });
});

describe('markClosed', () => {
  test('marks confirmed and old-site bookings, not checkouts in progress or cancelled ones', async () => {
    const { db, store } = fakeDb({
      b1: { ...closed, closure: undefined },
      'legacy-3': { ...closed, id: 'legacy-3', status: 'pending-payment', closure: undefined, legacy: { bookingId: 3 } },
      checkout: { ...closed, id: 'checkout', status: 'pending-payment', closure: undefined },
      gone: { ...closed, id: 'gone', status: 'cancelled', closure: undefined },
    });
    const c = { blackoutId: 'bo9', reason: 'Closed for weather', decideBy: '2026-11-12' };
    assert.ok(await markClosed('b1', c, { db }));
    assert.ok(await markClosed('legacy-3', c, { db }));
    assert.equal(await markClosed('checkout', c, { db }), null);
    assert.equal(await markClosed('gone', c, { db }), null);
    assert.equal((store.get('b1')!.closure as { decideBy: string }).decideBy, '2026-11-12');
    assert.equal(store.get('checkout')!.closure, undefined);
  });

  test('gives customers a few days past the closed date to choose', () => {
    assert.equal(closureDecideBy('2026-11-09', '2026-11-08'), '2026-11-12');
    // Closing today, or a day already past, still leaves the full window.
    assert.equal(closureDecideBy('2026-11-08', '2026-11-08'), '2026-11-11');
  });
});

describe('settleExpiredClosures', () => {
  function mailer() {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const m: CancellationMailer = {
      marina: { name: 'Marina', address: '1 Dock St' },
      phoneDisplay: '352-586-7792',
      async send({ to, subject, text }) {
        sent.push({ to, subject, text });
      },
    };
    return { mailer: m, sent };
  }

  test('cancels and fully refunds bookings nobody chose for, and leaves the rest', async () => {
    const { db, store } = fakeDb({
      b1: { ...closed, closure: { ...closure, decideBy: '2026-11-07' } },
      waiting: { ...closed, id: 'waiting', stripePaymentIntentId: 'pi_2' },
      lastDay: { ...closed, id: 'lastDay', closure: { ...closure, decideBy: '2026-11-08' }, stripePaymentIntentId: 'pi_3' },
      moved: { ...closed, id: 'moved', closure: undefined, stripePaymentIntentId: 'pi_4' },
      refunded: { ...closed, id: 'refunded', status: 'cancelled', closure: { ...closure, decideBy: '2026-11-01' } },
    });
    const { stripe: checkout } = fakeStripe('complete');
    const { stripe: refunds, created } = fakeRefunds();
    const { mailer: m, sent } = mailer();

    const r = await settleExpiredClosures({ db, stripe: { ...checkout, ...refunds } as never, mailer: m, now: NOW });

    assert.deepEqual(r, { settled: ['b1'], failed: [] });
    assert.deepEqual(created, [{ amount: 16800, key: 'blackout-cancel-b1' }]);
    const b = store.get('b1')!;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.paymentStatus, 'refunded');
    assert.equal(b.cancellationReason, 'Closed for weather');
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.text, /full refund of \$168 has been issued/);
    for (const id of ['waiting', 'lastDay', 'moved']) assert.equal(store.get(id)!.status, 'confirmed', id);
  });

  test('an old-site booking is cancelled with a note for Travis to refund by hand', async () => {
    const { db, store } = fakeDb({
      'legacy-5': {
        ...closed,
        id: 'legacy-5',
        stripePaymentIntentId: undefined,
        status: 'pending-payment',
        amountPaidCents: 10000,
        legacy: { bookingId: 5, oldStatus: 'reserved' },
        closure: { ...closure, decideBy: '2026-11-07' },
      },
    });
    const { stripe: checkout } = fakeStripe('complete');
    const { stripe: refunds, created } = fakeRefunds();
    const { mailer: m, sent } = mailer();

    await settleExpiredClosures({ db, stripe: { ...checkout, ...refunds } as never, mailer: m, now: NOW });

    assert.deepEqual(created, []);
    assert.equal(store.get('legacy-5')!.status, 'cancelled');
    assert.match(String(store.get('legacy-5')!.adminNotes), /\$100 was paid on the old website\. Refund it by hand\./);
    assert.match(sent[0]!.text, /Capt\. Travis will refund your \$100 himself/);
  });
});

describe('buildClosureOfferEmail', () => {
  const ctx = {
    reason: 'Closed for weather',
    decideBy: '2026-11-12',
    baseUrl: 'https://example.com',
    phoneDisplay: '352-586-7792',
  };

  test('offers a new date or a card refund, with the deadline and the booking page link', () => {
    const { subject, text } = buildClosureOfferEmail({ ...ctx, booking: closed as never });
    assert.equal(subject, 'Your Monday, Nov 9 tour can’t go out: pick a new date or a refund');
    assert.match(text, /can’t run your 8:00 AM tour on Monday, November 9, 2026\. Sorry about that\.\nReason: Closed for weather/);
    assert.match(text, /full refund of \$168 to your card/);
    assert.match(text, /by Thursday, November 12, 2026, we’ll refund you in full automatically/);
    assert.match(text, new RegExp(`https://example.com/my-booking/b1\\?t=${TOKEN}`));
  });

  test('says Travis refunds old-site money himself, and nothing’s owed when nothing was paid', () => {
    const legacy = buildClosureOfferEmail({ ...ctx, booking: { ...closed, id: 'legacy-1', amountPaidCents: 10000 } as never });
    assert.match(legacy.text, /get your \$100 back: Travis refunds it himself/);
    const unpaid = buildClosureOfferEmail({ ...ctx, booking: { ...closed, amountPaidCents: 0 } as never });
    assert.match(unpaid.text, /haven’t been charged/);
    assert.match(unpaid.text, /we’ll cancel the booking/);
  });
});
