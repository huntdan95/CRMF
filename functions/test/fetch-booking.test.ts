/**
 * What fetchBooking tells the booking page about the trip's photos
 * (`hasTripPhotos`): only for a trip the booking went out on that the crew
 * have uploaded to. And about a closed trip: one being called off right
 * now (`closurePending`), and one closed again after a reopen put them back
 * on it. Run with `npm test` in functions/.
 */
import { describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import type { Request } from 'firebase-functions/v2/https';

import { fetchBooking } from '../src/fetchBooking';
import { cancelPaidBooking } from '../src/cancelBooking';
import { db as liveDb } from '../src/lib/firebase';
import { confirmClosure, finalizeClosure, previewClosure, restoreOfferedBookings, type FinalizeDeps } from '../src/lib/close-day';
import type { CancellationMailer } from '../src/lib/admin-cancel';
import type { Booking } from '../src/lib/types';
import { TOKEN, fakeDb, fakeFirestore, fakeRefunds, fakeStripe, type Doc } from './fakes';

const TRIP = '2026-01-10';

const went: Doc = {
  id: 'b1',
  tourId: 'morning-shared',
  tourName: 'Morning Shared',
  date: TRIP,
  timeSlot: 'morning',
  type: 'shared',
  guestCount: 2,
  guests: [],
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  accessToken: TOKEN,
  status: 'completed',
  paymentStatus: 'paid',
  amountPaidCents: 20000,
  amountRefundedCents: 0,
};

const request = (body: Record<string, unknown>) =>
  ({ method: 'POST', headers: {}, body, header: () => undefined }) as unknown as Request;

/** fetchBooking's booking, with `uploaded` the trips that have files. */
async function fetched(
  doc: Doc,
  uploaded: string[],
  others: Parameters<typeof fakeDb>[1],
  t: TestContext,
) {
  const { db } = fakeDb({ b1: doc }, others);
  t.mock.method(liveDb, 'collection', (name: string) =>
    name === 'tripPhotos'
      ? {
          doc: (id: string) => ({
            collection: (sub: string) => {
              assert.equal(sub, 'files');
              return { limit: () => ({ get: async () => ({ empty: !uploaded.includes(id) }) }) };
            },
          }),
        }
      : db.collection(name),
  );
  let body: unknown;
  const res = {
    status: () => res,
    json: (b: unknown) => {
      body = b;
      return res;
    },
    set: () => res,
    setHeader: () => res,
    getHeader: () => undefined,
    on: () => res,
  };
  await fetchBooking(request({ bookingId: 'b1', accessToken: TOKEN }), res as never);
  return (body as { booking: Record<string, unknown> }).booking;
}

async function hasTripPhotos(...args: Parameters<typeof fetched>) {
  return (await fetched(...args)).hasTripPhotos;
}

describe('fetchBooking closure', () => {
  test('a refused deadline refund is passed on, so the page stops promising an automatic one', async (t) => {
    const closure = { blackoutId: 'bo0', reason: 'Closed for weather', decideBy: '2026-01-13' };
    const refused = { ...closure, refundRefused: { at: Timestamp.fromMillis(1), refundCents: 16800, stripeMessage: 'disputed' } };
    assert.deepEqual((await fetched({ ...went, status: 'confirmed', closure: refused }, [], {}, t)).closure, {
      reason: 'Closed for weather',
      decideBy: '2026-01-13',
      refundRefused: true,
    });
    t.mock.restoreAll();
    assert.deepEqual((await fetched({ ...went, status: 'confirmed', closure }, [], {}, t)).closure, {
      reason: 'Closed for weather',
      decideBy: '2026-01-13',
    });
  });

  test('the price before tax goes to the page, for the move dialog to price the closed trip as moveClosedBooking does', async (t) => {
    const closure = { blackoutId: 'bo0', reason: 'Closed for weather', decideBy: '2026-01-13' };
    const paid = { ...went, status: 'confirmed', closure, amountPaidCents: 25440, subtotalCents: 24000, salesTaxCents: 1440 };
    assert.equal((await fetched(paid, [], {}, t)).subtotalCents, 24000);
    t.mock.restoreAll();
    // Old-site and pre-tax bookings don't record it.
    assert.equal((await fetched({ ...went, status: 'confirmed', closure }, [], {}, t)).subtotalCents, null);
  });
});

describe('fetchBooking hasTripPhotos', () => {
  test('a trip they went out on, once there are photos', async (t) => {
    assert.equal(await hasTripPhotos(went, [`${TRIP}_morning`], {}, t), true);
    t.mock.restoreAll();
    assert.equal(await hasTripPhotos({ ...went, status: 'confirmed' }, [`${TRIP}_morning`], {}, t), true);
    t.mock.restoreAll();
    assert.equal(await hasTripPhotos(went, [], {}, t), false);
  });

  test('not a closed trip, a no-show, a cancellation or an unpaid checkout', async (t) => {
    const closure = { blackoutId: 'bo0', reason: 'Closed for weather', decideBy: '2026-01-13' };
    const closedMorning = { blackouts: [{ date: TRIP, affectedSlots: ['morning'], reason: 'weather' }] };
    for (const [doc, others] of [
      [{ ...went, status: 'confirmed', closure }, closedMorning],
      [{ ...went, status: 'confirmed' }, closedMorning],
      [{ ...went, status: 'no-show' }, {}],
      [{ ...went, status: 'cancelled' }, {}],
      [{ ...went, status: 'pending-payment' }, {}],
    ] as Array<[Doc, Parameters<typeof fakeDb>[1]]>) {
      assert.equal(await hasTripPhotos(doc, [`${TRIP}_morning`], others, t), false, JSON.stringify(doc));
      t.mock.restoreAll();
    }
  });
});

describe('fetchBooking closurePending', () => {
  const booked: Doc = { ...went, date: '2099-07-04', status: 'confirmed' };
  /** The 8:00 closed with `choice`, in its undo window (`state`). */
  const closing = (choice: string, state = 'pending') => ({
    blackouts: [{ date: '2099-07-04', affectedSlots: ['morning'], reason: 'weather' }],
    others: { closureActions: { bo0: { date: '2099-07-04', affectedSlots: ['morning'], choice, state } } },
  });

  test('being called off ("cancel" or "offer", in its window or going out): what cancelBooking would say', async (t) => {
    const cancel = await fetched(booked, [], closing('cancel'), t);
    assert.equal(cancel.departureClosed, true);
    assert.deepEqual(cancel.closurePending, {
      choice: 'cancel',
      message: 'Capt. Travis just called this trip off. You’ll get an email in the next few minutes about your full refund.',
    });
    t.mock.restoreAll();
    const offer = await fetched(booked, [], closing('offer', 'finalizing'), t);
    assert.equal((offer.closurePending as { choice: string }).choice, 'offer');
    assert.match((offer.closurePending as { message: string }).message, /pick a new date or take a full refund/);
  });

  test('not "leave them booked" (the trip stays on), nor once it has gone out, nor a trip nobody is closing', async (t) => {
    for (const [doc, others] of [
      [booked, closing('keep')],
      [booked, closing('cancel', 'done')],
      [booked, closing('offer', 'undone')],
      [booked, {}],
      // Already cancelled by it.
      [{ ...booked, status: 'cancelled' }, closing('cancel')],
    ] as Array<[Doc, Parameters<typeof fakeDb>[1]]>) {
      assert.equal((await fetched(doc, [], others, t)).closurePending, null, JSON.stringify([doc.status, others]));
      t.mock.restoreAll();
    }
  });
});

/**
 * Travis offered a new date, reopened the day (which put them back on, with
 * the offer's full refund until its deadline: `refundGraceUntil`), then
 * closed it again, leaving them booked. Their booking page used to read
 * that grace as "the trip is on": Where to meet, and "Past tour" once its
 * time had gone. fetchBooking has to say it's closed, and the cancel the
 * page keeps for the grace has to give the full refund.
 */
describe('fetchBooking, put back by a reopen and then closed again', () => {
  const NOW = new Date('2026-10-15T13:00:00Z'); // Thursday 9 AM at the marina
  const FRIDAY = new Date('2026-10-16T12:00:00Z'); // 8 AM, a day before the trip
  const SATURDAY = '2026-10-17';
  const travis = { uid: 'travis', email: 'travis@example.com' };

  test('“leave them booked” after the reopen: closed, nothing pending, and the grace still refunds in full', async (t) => {
    const fs = fakeFirestore({
      bookings: {
        b1: { ...went, date: SATURDAY, status: 'confirmed', amountPaidCents: 16800, stripePaymentIntentId: 'pi_1', updatedAt: Timestamp.fromMillis(1_000) },
      },
    });
    const mailer: CancellationMailer = { marina: { name: 'M', address: 'A' }, phoneDisplay: '1', async send() {} };
    const { stripe: checkout } = fakeStripe('open');
    const refunds = fakeRefunds();
    const deps = (now: Date): FinalizeDeps => ({
      db: fs.db,
      now,
      baseUrl: 'https://example.com',
      stripe: { ...checkout, ...refunds.stripe } as never,
      mailer: () => mailer,
      crew: { async push() {}, async email() {} },
    });
    const close = async (choice: 'offer' | 'keep', at: Date) => {
      const p = await previewClosure({ date: SATURDAY, affectedSlots: ['all'], reason: 'weather' }, travis, deps(at));
      const r = await confirmClosure({ confirmToken: p.choices[choice]!.confirmToken, choice, confirmText: 'CANCEL' }, travis, deps(at));
      await finalizeClosure(r.blackoutId, 'send-now', deps(new Date(at.getTime() + 60_000)), travis);
      return r.blackoutId;
    };

    // The offer goes out, then the day is reopened (adminDeleteBlackout's order).
    const offered = await close('offer', NOW);
    await restoreOfferedBookings(offered, { db: fs.db, now: new Date(NOW.getTime() + 30 * 60_000) });
    fs.col('blackouts').delete(offered);
    // Friday: closed again, left booked.
    await close('keep', FRIDAY);

    t.mock.method(liveDb, 'collection', fs.db.collection);
    let body: unknown;
    const res = {
      status: () => res,
      json: (b: unknown) => {
        body = b;
        return res;
      },
      set: () => res,
      setHeader: () => res,
      getHeader: () => undefined,
      on: () => res,
    };
    await fetchBooking(request({ bookingId: 'b1', accessToken: TOKEN }), res as never);
    const booking = (body as { booking: Record<string, unknown> }).booking;
    assert.equal(booking.status, 'confirmed');
    assert.equal(booking.closure, null);
    assert.equal(booking.refundGraceUntil, '2026-10-20');
    // What the page reads as "closed and left booked": the grace doesn't change it.
    assert.equal(booking.departureClosed, true);
    assert.equal(booking.closurePending, null);
    assert.equal(booking.hasTripPhotos, false);

    // The Cancel button the page keeps for the grace: a full refund, a day out.
    const b1 = fs.col('bookings').get('b1') as unknown as Booking;
    const out = await cancelPaidBooking('b1', b1, { reason: undefined, startTime: '08:00', now: FRIDAY }, { db: fs.db, stripe: refunds.stripe, mailer });
    assert.equal(out.kind, 'cancelled');
    assert.equal(out.kind === 'cancelled' && out.quote.refundCents, 16800);
  });
});
