/**
 * The scheduled guest and crew messages, run against an in-memory
 * Firestore: who gets trip prep, directions, the crew's 8 PM schedule and
 * the review requests, around trips Travis has closed. Emails land in the
 * emulator outbox (lib/resend.ts) instead of going out. Run with
 * `npm test` in functions/.
 */
import { describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import { db as liveDb } from '../src/lib/firebase';
import { runTripPrep } from '../src/tripPrep';
import { runDayOfDirections } from '../src/dayOfDirections';
import { runCrewSchedule } from '../src/crewSchedule';
import { runHeldReviewRequests, runReviewList, runReviewRequests } from '../src/reviewRequests';
import { sendReviewRequest } from '../src/postTourFollowup';
import { alertCrewOfBooking, alertCrewOfCancellation } from '../src/crewAlerts';
import { adminMarkOne } from '../src/lib/admin-mark';
import { TOKEN, fakeFirestore, type Doc } from './fakes';

process.env.RESEND_API_KEY = 'emulator-outbox';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';
process.env.ADMIN_EMAIL = 'travis@example.com';
process.env.APP_BASE_URL = 'https://example.com';

function booking(id: string, over: Doc = {}): Doc {
  return {
    id,
    tourId: 'morning-shared',
    tourName: '2hr Morning Tour — Shared',
    date: '2026-11-10',
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

/** Points the functions' Firestore at an in-memory one. Returns what was emailed. */
function world(t: TestContext, initial: Record<string, Record<string, Doc>>) {
  const fs = fakeFirestore(initial);
  // Queries take `select` (which fields come back) and return everything.
  type Q = { where: (...a: unknown[]) => Q; select?: () => Q };
  const selectable = (q: Q): Q => ({ ...q, where: (...a) => selectable(q.where(...a)), select: () => selectable(q) });
  t.mock.method(liveDb, 'collection', (name: string) => {
    const c = fs.db.collection(name) as unknown as Q;
    return { ...c, where: (...a: unknown[]) => selectable(c.where(...a)) };
  });
  t.mock.method(liveDb, 'runTransaction', fs.db.runTransaction);
  t.mock.method(liveDb, 'doc', (path: string) => {
    const [name, id] = path.split('/');
    return fs.db.collection(name!).doc(id!);
  });
  t.mock.method(liveDb, 'batch', () => {
    const ops: Array<() => Promise<unknown>> = [];
    return {
      set: (r: { set: (d: Doc) => Promise<unknown> }, d: Doc) => void ops.push(() => r.set(d)),
      update: (r: { update: (d: Doc) => Promise<unknown> }, d: Doc) => void ops.push(() => r.update(d)),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  });
  const emails = () =>
    [...fs.col('emailOutbox').values()].map((e) => ({
      to: (e.to as string[]).join(','),
      subject: e.subject as string,
      text: e.text as string,
    }));
  return { ...fs, emails };
}

describe('trip prep and directions', () => {
  test('trip prep skips departures Travis has closed or is closing, on every day it covers', async (t) => {
    // 9:00 AM at the marina (EST) on Sunday, November 8, 2026.
    const now = new Date('2026-11-08T14:00:00Z');
    const w = world(t, {
      bookings: {
        open: booking('open'),
        closed: booking('closed', { timeSlot: 'mid-morning', tourId: 'mid-morning-shared' }),
        later: booking('later', { date: '2026-11-11' }),
      },
      blackouts: {
        bo1: { date: '2026-11-10', affectedSlots: ['mid-morning'] },
        bo2: { date: '2026-11-11', affectedSlots: ['all'] },
      },
    });

    assert.deepEqual(await runTripPrep(now), { sent: 1, failed: 0, skipped: 0 });
    assert.deepEqual(w.emails().map((e) => e.to), ['open@example.com']);
    assert.equal(w.col('bookings').get('closed')!.prepSentAt, undefined);
  });

  test('directions skip a closed departure, the whole-day charter under a closed slot too', async (t) => {
    // 6:30 AM at the marina on Tuesday, November 10.
    const now = new Date('2026-11-10T11:30:00Z');
    const w = world(t, {
      bookings: {
        open: booking('open'),
        charter: booking('charter', { timeSlot: 'whole-day', tourId: 'whole-day-private', type: 'private' }),
      },
      // Closing 1:00 PM closes the charter that runs through it.
      blackouts: { bo1: { date: '2026-11-10', affectedSlots: ['early-afternoon'] } },
    });

    assert.deepEqual(await runDayOfDirections(now), { sent: 1, failed: 0, skipped: 0 });
    assert.deepEqual(w.emails().map((e) => e.to), ['open@example.com']);
  });
});

describe('the 8 PM crew schedule', () => {
  // 8:00 PM at the marina on Monday, November 9: tomorrow is November 10.
  const now = new Date('2026-11-10T01:00:00Z');

  test('counts everyone going out, marks closed trips, and leaves out those choosing a new date', async (t) => {
    const w = world(t, {
      bookings: {
        a: booking('a', { guestCount: 4 }),
        // Refunded in full but left on the trip: still coming.
        refunded: booking('refunded', { paymentStatus: 'refunded', amountRefundedCents: 16800 }),
        'legacy-7': booking('legacy-7', { status: 'pending-payment', guestCount: 0, legacy: { bookingId: 7 } }),
        kept: booking('kept', { timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' }),
        calling: booking('calling', { timeSlot: 'early-afternoon', tourId: 'early-afternoon-shared' }),
        choosing: booking('choosing', { timeSlot: 'mid-morning', closure: { blackoutId: 'bo0', reason: 'Closed for weather', decideBy: '2026-11-13' } }),
      },
      blackouts: {
        bo1: { date: '2026-11-10', affectedSlots: ['late-afternoon'] },
        bo2: { date: '2026-11-10', affectedSlots: ['early-afternoon'] },
      },
      closureActions: { bo2: { date: '2026-11-10', state: 'pending', choice: 'cancel', affectedSlots: ['early-afternoon'] } },
      crew: {
        lacy: { name: 'Lacy', email: 'lacy@example.com' },
        faith: { name: 'Faith', email: 'faith@example.com', alertsOn: false },
      },
    });

    assert.equal(await runCrewSchedule(now), 'sent');
    const [email, ...rest] = w.emails();
    assert.equal(rest.length, 0);
    assert.equal(email!.to, 'lacy@example.com');
    assert.equal(email!.subject, '[CRMF] Tomorrow: 1 trip, 6+ guests, 2 closed');
    assert.match(email!.text, /- Guest legacy-7 \(party size unknown\)/);
    assert.match(email!.text, /- Guest refunded \(2\)/);
    assert.match(email!.text, /BEING CALLED OFF: 1:00 PM SHARED/);
    assert.match(email!.text, /CLOSED: 3:30 PM SHARED .* 2 GUESTS\nClosed to new bookings\. Travis is contacting the guests/);
    assert.doesNotMatch(email!.text, /Guest choosing/);
    // Only the trip going out gets an upload link.
    assert.equal(email!.text.match(/Photo upload:/g)?.length, 1);
  });

  test('says a trip Travis runs solo needs no crew, and no wetsuits on the sunset cruise', async (t) => {
    const w = world(t, {
      bookings: {
        a: booking('a'),
        cruise: booking('cruise', { timeSlot: 'sunset', tourId: 'sunset-private', type: 'private', tourName: 'Private Sunset Cruise' }),
      },
      soloTrips: { '2026-11-10_morning': { date: '2026-11-10', timeSlot: 'morning' } },
      crew: { lacy: { name: 'Lacy', email: 'lacy@example.com' } },
    });

    assert.equal(await runCrewSchedule(now), 'sent');
    const text = w.emails()[0]!.text;
    assert.match(text, /8:00 AM SHARED .* · NO CREW NEEDED/);
    assert.equal(text.match(/Wetsuits:/g)?.length, 1, 'only the manatee tour has a wetsuit line');
  });

  test('a crew member it couldn’t reach at 8 gets it at the next run, and nobody else does', async (t) => {
    const w = world(t, {
      bookings: { a: booking('a') },
      crew: {
        lacy: { name: 'Lacy', email: 'lacy@example.com' },
        faith: { name: 'Faith', email: 'faith@example.com' },
      },
    });
    // Resend is down for the first email of the evening (Lacy's).
    let down = true;
    const collection = liveDb.collection.bind(liveDb);
    t.mock.method(liveDb, 'collection', (name: string) => {
      const c = collection(name);
      if (name !== 'emailOutbox' || !down) return c;
      down = false;
      return {
        ...c,
        doc: () => {
          throw new Error('Resend is down');
        },
      };
    });
    const hour = (n: number) => new Date(now.getTime() + n * 3_600_000);

    assert.equal(await runCrewSchedule(now), 'sent');
    assert.deepEqual(w.emails().map((e) => e.to), ['faith@example.com']);
    assert.deepEqual(w.col('crewSchedules').get('2026-11-10')!.crewFailedIds, ['lacy']);
    // 9 PM: just Lacy.
    assert.equal(await runCrewSchedule(hour(1)), 'sent');
    assert.deepEqual(w.emails().map((e) => e.to), ['faith@example.com', 'lacy@example.com']);
    assert.deepEqual(w.col('crewSchedules').get('2026-11-10')!.crewFailedIds, []);
    // 10 PM: nothing more.
    assert.equal(await runCrewSchedule(hour(2)), 'already-sent');
    assert.equal(w.emails().length, 2);
  });

  test('a later run that reaches nobody leaves when it last went out alone', async (t) => {
    // 8 PM reached Faith but not Lacy, who has been taken off the crew since.
    const at8 = Timestamp.fromDate(now);
    const w = world(t, {
      bookings: { a: booking('a') },
      crewSchedules: { '2026-11-10': { date: '2026-11-10', sentAt: at8, crewSent: 1, crewFailedIds: ['lacy'] } },
      crew: { faith: { name: 'Faith', email: 'faith@example.com' } },
    });

    assert.equal(await runCrewSchedule(new Date(now.getTime() + 3_600_000)), 'no-crew');
    assert.equal(w.emails().length, 0);
    const run = w.col('crewSchedules').get('2026-11-10')!;
    // A day closed after 8 PM wasn't in any schedule the crew got.
    assert.equal(run.sentAt, at8);
    assert.deepEqual(run.crewFailedIds, []);
  });

  test('no trips at 8: a booking made after doesn’t start one at the next run', async (t) => {
    const w = world(t, { bookings: {}, crew: { lacy: { name: 'Lacy', email: 'lacy@example.com' } } });
    assert.equal(await runCrewSchedule(now), 'no-trips');
    w.col('bookings').set('a', booking('a'));
    assert.equal(await runCrewSchedule(new Date(now.getTime() + 3_600_000)), 'no-trips');
    assert.equal(w.emails().length, 0);
  });
});

describe('review requests', () => {
  // Wednesday, June 17, 2026: the sunset cruise leaves at 7:00 PM and is
  // back at 9:00, so it's still out when the evening run goes.
  const day = '2026-06-17';
  const at = (hhmm: string, date = day) => new Date(`${date}T${hhmm}:00-04:00`);
  const bookings = {
    open: booking('open', { date: day }),
    closed: booking('closed', { date: day, timeSlot: 'mid-morning', tourId: 'mid-morning-shared' }),
    ran: booking('ran', { date: day, timeSlot: 'mid-morning', tourId: 'mid-morning-shared', status: 'completed' }),
    choosing: booking('choosing', { date: day, closure: { blackoutId: 'bo0', reason: 'Closed for weather', decideBy: '2026-06-20' } }),
    cruise: booking('cruise', { date: day, timeSlot: 'sunset', tourId: 'sunset-private', type: 'private', tourName: 'Private Sunset Cruise' }),
  };
  const blackouts = { bo1: { date: day, affectedSlots: ['mid-morning'] } };

  test('the 6 PM list leaves out closed trips and puts a cruise still out at 7:00 on tomorrow', async (t) => {
    const w = world(t, { bookings, blackouts });

    assert.equal(await runReviewList(at('18:00')), 'sent');
    const [list] = w.emails();
    assert.equal(list!.to, 'travis@example.com');
    assert.equal(list!.subject, '[CRMF] 2 review requests go out at 7:00');
    assert.match(list!.text, /- 8:00 AM shared: Guest open \(2 guests\)\n- 10:30 AM shared: Guest ran/);
    assert.match(list!.text, /Back after 7:00, so theirs goes out tomorrow morning:\n\n- .* sunset cruise: Guest cruise/);
    assert.doesNotMatch(list!.text, /Guest closed|Guest choosing/);
  });

  test('7 PM sends to trips that are back; the cruise goes the next morning', async (t) => {
    const w = world(t, { bookings, blackouts });

    await runReviewRequests(at('19:00'));
    assert.deepEqual(w.emails().map((e) => e.to).sort(), ['open@example.com', 'ran@example.com']);
    assert.equal(w.col('bookings').get('cruise')!.postTourFollowupSentAt, undefined);

    await runHeldReviewRequests(at('09:30', '2026-06-18'));
    const cruise = w.emails().find((e) => e.to === 'cruise@example.com');
    assert.match(cruise!.subject, /How was your sunset cruise/);
    assert.match(cruise!.text, /Thanks for coming out on the water yesterday\./);
    assert.equal(w.emails().length, 3, 'nothing for the closed trip or the one choosing');
  });

  test('a day left booked where one trip went out after all: only that one, once marked, gets the request', async (t) => {
    // The whole day was closed, leaving them booked. The 8:00 went out
    // after all; the 1:00 didn't.
    const w = world(t, {
      bookings: {
        ran: booking('ran', { date: day }),
        didnt: booking('didnt', { date: day, timeSlot: 'early-afternoon', tourId: 'early-afternoon-shared' }),
      },
      blackouts: { bo1: { date: day, affectedSlots: ['all'] } },
      closureActions: { bo1: { state: 'done', choice: 'keep', date: day } },
    });
    const nextMorning = at('10:30', '2026-06-18');
    await runHeldReviewRequests(nextMorning);
    assert.equal(w.emails().length, 0, 'closed: nothing yet');

    // Marked on its own from the booking page, the day still closed.
    assert.deepEqual(await adminMarkOne('ran', 'completed', { db: w.db, now: nextMorning, ranAnyway: true }), { kind: 'marked', closedBy: ['bo1'] });
    assert.deepEqual(await adminMarkOne('didnt', 'completed', { db: w.db, now: nextMorning }), { kind: 'departure-closed' });
    assert.ok(w.col('blackouts').has('bo1'));

    await runHeldReviewRequests(at('11:30', '2026-06-18'));
    assert.deepEqual(w.emails().map((e) => e.to), ['ran@example.com']);
    assert.equal(w.col('bookings').get('didnt')!.postTourFollowupSentAt, undefined);
  });

  test('the photos line follows the photos email: promised, linked once it’s gone, left out once none can come', async (t) => {
    const w = world(t, {
      bookings: {
        // Sent that evening: the photos email goes from the next morning.
        waiting: booking('waiting', { date: day }),
        // Held past the next morning, when the photos email went.
        emailed: booking('emailed', { date: day, photosSentAt: Timestamp.fromMillis(1) }),
        // Sent 10 days on, with no photos emailed: that email only goes
        // for 7 days after the trip.
        late: booking('late', { date: '2026-06-08' }),
      },
    });
    const now = at('19:00', '2026-06-17');
    const nextEvening = at('19:00', '2026-06-18');
    for (const id of ['waiting', 'emailed', 'late']) {
      assert.deepEqual(await sendReviewRequest(id, { now: id === 'waiting' ? now : nextEvening }), { sent: true }, id);
    }
    const email = (id: string) => w.emails().find((e) => e.to === `${id}@example.com`)!;
    assert.match(email('waiting').text, /Your GoPro photos will arrive in a separate email\./);
    assert.match(email('emailed').text, /Your GoPro photos are in your gallery:\n {3}https:\/\/example\.com\/my-booking\/emailed\/photos\?k=/);
    assert.doesNotMatch(email('emailed').text, /separate email/);
    assert.doesNotMatch(email('late').text, /GoPro/);
  });

  test('an old-site booking thanked by hand before launch gets its gallery, not photos promised by an email that can’t reach it', async (t) => {
    const legacy = { status: 'confirmed', legacy: { bookingId: 7 } };
    const w = world(t, {
      bookings: {
        'legacy-7': booking('legacy-7', { date: day, ...legacy }),
        'legacy-8': booking('legacy-8', { date: day, timeSlot: 'mid-morning', tourId: 'mid-morning-shared', ...legacy }),
      },
      // The morning trip has photos; nothing was uploaded for the 10:30.
      tripPhotos: { [`${day}_morning`]: { date: day, timeSlot: 'morning', uploadToken: 'tok', photoCount: 12 } },
    });
    // SEND_TOUR_REMINDERS is off, so only the booking page's resend (force) sends it.
    for (const id of ['legacy-7', 'legacy-8']) {
      assert.deepEqual(await sendReviewRequest(id, { force: true, now: at('19:00', '2026-06-17') }), { sent: true }, id);
    }
    const email = (id: string) => w.emails().find((e) => e.to === `${id}@example.com`)!;
    assert.match(email('legacy-7').text, /Your GoPro photos are in your gallery:\n {3}https:\/\/example\.com\/my-booking\/legacy-7\/photos\?k=/);
    assert.doesNotMatch(email('legacy-7').text, /separate email/);
    assert.doesNotMatch(email('legacy-8').text, /GoPro/);
  });
});

describe('crew alerts', () => {
  // Far enough ahead that it's never in the past.
  const date = '2099-05-09';
  const crew = { lacy: { name: 'Lacy', email: 'lacy@example.com' } };

  test('a booking paid on a closed trip is marked, and an old-site party of unknown size counts as on the boat', async (t) => {
    const w = world(t, {
      bookings: {
        b1: booking('b1', { date }),
        'legacy-3': booking('legacy-3', { date, status: 'pending-payment', guestCount: 0, legacy: { bookingId: 3 } }),
        gone: booking('gone', { date, status: 'cancelled', guestCount: 4 }),
      },
      blackouts: { bo1: { date, affectedSlots: ['morning'] } },
      crew,
    });

    assert.equal(await alertCrewOfBooking('b1'), 'sent');
    const [email] = w.emails();
    assert.equal(email!.subject, '[CRMF] New booking on a closed trip: Sat May 9, 8:00 AM shared, 2 guests');
    assert.match(email!.text, /^On a trip Travis closed: they paid after he closed it/);
    assert.match(email!.text, /Guests: 2 \(2\+ on the boat\)/);
  });

  test('a booking on a trip Travis runs solo says no crew is needed', async (t) => {
    const w = world(t, {
      bookings: { b1: booking('b1', { date }) },
      soloTrips: { [`${date}_morning`]: { date, timeSlot: 'morning' } },
      crew,
    });

    assert.equal(await alertCrewOfBooking('b1'), 'sent');
    const [email] = w.emails();
    assert.equal(email!.subject, '[CRMF] New booking: Sat May 9, 8:00 AM shared, 2 guests · No crew needed');
    assert.match(email!.text, /No crew needed: Travis is running it solo\./);
  });

  test('a cancellation never says nobody is left when an old-site party still is', async (t) => {
    const w = world(t, {
      bookings: {
        b1: booking('b1', { date, status: 'cancelled', cancelledBy: 'customer' }),
        'legacy-3': booking('legacy-3', { date, status: 'pending-payment', guestCount: 0, legacy: { bookingId: 3 } }),
      },
      crew,
    });

    assert.equal(await alertCrewOfCancellation('b1'), 'sent');
    assert.match(w.emails()[0]!.text, /Still going: party size unknown/);
  });
});
