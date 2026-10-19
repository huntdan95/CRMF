/**
 * The day-before reminder email, against in-memory stand-ins for Firestore,
 * email and the forecast. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { sendTourReminders, type ReminderDeps } from '../src/tourReminders';
import { TOKEN, fakeDb, type Doc } from './fakes';

// 9:00 AM at the marina (EST) on Sunday, November 8, 2026.
const NOW = new Date('2026-11-08T14:00:00Z');
const TOMORROW = '2026-11-09';
const longAgo = { toMillis: () => NOW.getTime() - 7 * 24 * 3600 * 1000 };

const base: Doc = {
  tourId: 'morning-shared',
  tourName: '2hr Morning Tour — Shared',
  date: TOMORROW,
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
  createdAt: longAgo,
};

function run(
  docs: Record<string, Doc>,
  opts: { failFor?: string; forecast?: ReminderDeps['forecast']; blackouts?: Array<Record<string, unknown>> } = {},
) {
  const { db, store } = fakeDb(docs, { blackouts: opts.blackouts });
  const sent: Array<{ to: string; subject: string; text: string; bookingId: string; idempotencyKey: string }> = [];
  const result = sendTourReminders({
    db,
    now: NOW,
    baseUrl: 'https://example.com',
    forecast: opts.forecast ?? (async () => null),
    async send(msg) {
      if (msg.bookingId === opts.failFor) throw new Error('Resend is down');
      sent.push(msg);
      return { id: `em_${sent.length}` };
    },
  });
  return { result, store, sent };
}

describe('sendTourReminders', () => {
  test('emails tomorrow’s bookings and marks the departure reminded', async () => {
    const { result, store, sent } = run({
      b1: { ...base, id: 'b1' },
      today: { ...base, id: 'today', date: '2026-11-08' },
      later: { ...base, id: 'later', date: '2026-11-10' },
    });

    assert.deepEqual(await result, { sent: ['b1'], failed: [] });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, 'pat@example.com');
    assert.equal(sent[0]!.subject, 'Tomorrow at 8:00 AM: your manatee tour');
    assert.equal(sent[0]!.idempotencyKey, 'tour-reminder/b1/2026-11-09/morning');
    assert.match(sent[0]!.text, /Arrive by:\s+7:45 AM/);
    assert.match(sent[0]!.text, new RegExp(`https://example.com/my-booking/b1\\?t=${TOKEN}`));
    assert.equal(store.get('b1')!.reminderSentFor, '2026-11-09/morning');
    assert.equal(store.get('b1')!.reminderMessageId, 'em_1');
    assert.equal(store.get('today')!.reminderSentFor, undefined);
  });

  test('skips bookings that aren’t going out, were just booked, or were already reminded', async () => {
    const { result, sent } = run({
      cancelled: { ...base, id: 'cancelled', status: 'cancelled' },
      checkout: { ...base, id: 'checkout', status: 'pending-payment', paymentStatus: 'pending' },
      closed: {
        ...base,
        id: 'closed',
        closure: { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-11-12', offeredAt: longAgo as never },
      },
      reminded: { ...base, id: 'reminded', reminderSentFor: '2026-11-09/morning' },
      justBooked: { ...base, id: 'justBooked', createdAt: { toMillis: () => NOW.getTime() - 2 * 3600 * 1000 } },
      unpaidOldSite: { ...base, id: 'legacy-2', status: 'pending-payment', legacy: { bookingId: 2, oldStatus: 'pending payment' } },
    });

    assert.deepEqual(await result, { sent: [], failed: [] });
    assert.equal(sent.length, 0);
  });

  test('skips departures Travis has closed, or is closing right now', async () => {
    const { result, store } = run(
      {
        morning: { ...base, id: 'morning' },
        charter: { ...base, id: 'charter', timeSlot: 'whole-day', type: 'private' },
        late: { ...base, id: 'late', timeSlot: 'late-afternoon' },
      },
      {
        // Up from the moment he confirms, through the undo window.
        blackouts: [
          { date: TOMORROW, affectedSlots: ['morning'], reason: 'weather' },
          { date: '2026-11-10', affectedSlots: ['all'], reason: 'weather' },
        ],
      },
    );
    assert.deepEqual(await result, { sent: ['late'], failed: [] });
    // Unmarked: if he reopens the day, the next run sends theirs.
    assert.equal(store.get('morning')!.reminderSentFor, undefined);
  });

  test('reminds an old-site reservation with a deposit, and points it to Travis instead of the manage page', async () => {
    const { result, sent } = run({
      'legacy-1': {
        ...base,
        id: 'legacy-1',
        type: 'private',
        tourName: '2hr Morning Tour — Private',
        guestCount: 0,
        status: 'pending-payment',
        amountPaidCents: 10000,
        legacy: { bookingId: 1, oldStatus: 'reserved' },
      },
    });

    assert.deepEqual(await result, { sent: ['legacy-1'], failed: [] });
    assert.match(sent[0]!.text, /Call or text Travis at 352-586-7792/);
    assert.doesNotMatch(sent[0]!.text, /my-booking/);
    // Party size unknown on the old site: no "Guests: 0".
    assert.doesNotMatch(sent[0]!.text, /Guests:/);
  });

  test('a booking moved to tomorrow gets a reminder even if it had one for its old date', async () => {
    const { result } = run({ b1: { ...base, id: 'b1', reminderSentFor: '2026-11-02/morning' } });
    assert.deepEqual(await result, { sent: ['b1'], failed: [] });
  });

  test('one failed send doesn’t stop the rest, and stays unmarked for the next run', async () => {
    const { result, store } = run(
      { b1: { ...base, id: 'b1' }, b2: { ...base, id: 'b2', customerEmail: 'sam@example.com' } },
      { failFor: 'b1' },
    );
    assert.deepEqual(await result, { sent: ['b2'], failed: ['b1'] });
    assert.equal(store.get('b1')!.reminderSentFor, undefined);
  });

  test('includes the forecast, and asks for a warm layer on a cool day', async () => {
    const forecastDates: string[] = [];
    const { result, sent } = run(
      { b1: { ...base, id: 'b1' }, b2: { ...base, id: 'b2', timeSlot: 'late-afternoon' } },
      {
        forecast: async (date) => {
          forecastDates.push(date);
          return { label: 'Partly cloudy', highF: 64, lowF: 48, rainPct: 10 };
        },
      },
    );
    await result;
    // One lookup for the day, not one per booking.
    assert.deepEqual(forecastDates, [TOMORROW]);
    assert.match(sent[0]!.text, /Partly cloudy, high 64°F, low 48°F, 10% chance of rain/);
    assert.match(sent[0]!.text, /bring a warm layer/);
  });

  test('goes out without a forecast when there isn’t one, and doesn’t look one up for nobody', async () => {
    let lookups = 0;
    const { result: none } = run({}, { forecast: async () => (lookups++, null) });
    await none;
    assert.equal(lookups, 0);

    const { result, sent } = run({ b1: { ...base, id: 'b1' } });
    await result;
    assert.doesNotMatch(sent[0]!.text, /forecast/i);
    assert.doesNotMatch(sent[0]!.text, /warm layer/);
  });
});
