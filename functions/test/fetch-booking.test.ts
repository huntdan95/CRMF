/**
 * What fetchBooking tells the booking page about the trip's photos
 * (`hasTripPhotos`): only for a trip the booking went out on that the crew
 * have uploaded to. Run with `npm test` in functions/.
 */
import { describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'firebase-functions/v2/https';

import { fetchBooking } from '../src/fetchBooking';
import { db as liveDb } from '../src/lib/firebase';
import { TOKEN, fakeDb, type Doc } from './fakes';

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

/** fetchBooking's answer, with `uploaded` the trips that have files. */
async function hasTripPhotos(
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
  return (body as { booking: { hasTripPhotos: boolean } }).booking.hasTripPhotos;
}

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
