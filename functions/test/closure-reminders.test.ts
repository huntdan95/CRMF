/**
 * The one reminder to customers who haven't picked a new date or a refund,
 * the day before settleClosedBookings refunds them.
 * Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { closureReminderDue, sendClosureReminders, settlesAt } from '../src/closureReminders';
import { TOKEN, fakeFirestore, type Doc } from './fakes';

const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-20', offeredAt: {} };

function booking(id: string, over: Doc = {}): Doc {
  return {
    id,
    tourId: 'morning-shared',
    tourName: '2hr Morning Tour — Shared',
    date: '2026-10-17',
    timeSlot: 'morning',
    type: 'shared',
    guestCount: 2,
    customerName: `Guest ${id}`,
    customerEmail: `${id}@example.com`,
    accessToken: TOKEN,
    status: 'confirmed',
    amountPaidCents: 16800,
    amountRefundedCents: 0,
    closure,
    ...over,
  };
}

function setup(bookings: Record<string, Doc>) {
  const fs = fakeFirestore({ bookings });
  const sent: Array<{ to: string; subject: string; text: string; key: string }> = [];
  const run = (now: Date) =>
    sendClosureReminders({
      db: fs.db,
      now,
      baseUrl: 'https://example.com',
      async send({ to, subject, text, idempotencyKey }) {
        sent.push({ to, subject, text, key: idempotencyKey });
      },
    });
  return { ...fs, sent, run };
}

describe('closure reminders', () => {
  test('settle time is 6:00 AM marina time the day after the deadline', () => {
    assert.equal(settlesAt('2026-10-20').toISOString(), '2026-10-21T10:00:00.000Z');
    // After the clocks go back.
    assert.equal(settlesAt('2026-11-02').toISOString(), '2026-11-03T11:00:00.000Z');
  });

  test('sends once, 24 hours before the refund, and not before or after', async () => {
    const s = setup({ a: booking('a') });
    // Two days out: too early.
    assert.deepEqual(await s.run(new Date('2026-10-19T12:00:00Z')), { sent: [], failed: [] });
    // 6:30 AM on the deadline day: due.
    const r = await s.run(new Date('2026-10-20T10:30:00Z'));
    assert.deepEqual(r.sent, ['a']);
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0]!.subject, 'Reminder: pick a new date or a refund for your Saturday, Oct 17 tour by Tuesday, Oct 20');
    assert.match(s.sent[0]!.text, /haven’t picked a new date or a refund yet/);
    assert.match(s.sent[0]!.text, /https:\/\/example\.com\/my-booking\/a\?t=/);
    assert.equal(s.sent[0]!.key, 'closure-reminder/a/bo1');
    assert.ok((s.col('bookings').get('a')!.closure as { reminderSentAt?: unknown }).reminderSentAt);
    // The next hourly runs: nothing more.
    await s.run(new Date('2026-10-20T11:00:00Z'));
    await s.run(new Date('2026-10-21T09:00:00Z'));
    assert.equal(s.sent.length, 1);
  });

  test('skips customers who chose, were settled, or have no email, and nothing after the refund time', async () => {
    const s = setup({
      moved: booking('moved', { closure: undefined }),
      refunded: booking('refunded', { status: 'cancelled' }),
      noEmail: booking('noEmail', { customerEmail: '' }),
      late: booking('late', { closure: { ...closure, decideBy: '2026-10-19' } }),
    });
    const r = await s.run(new Date('2026-10-20T10:30:00Z'));
    assert.deepEqual(r, { sent: [], failed: [] });
    assert.equal(s.sent.length, 0);
    assert.equal(closureReminderDue(booking('x', { closure: { ...closure, decideBy: '2026-10-19' } }) as never, new Date('2026-10-20T10:30:00Z')), false);
  });

  test('a closure a reopen left behind is reminded too: they’re still choosing, and are refunded at the deadline', async () => {
    // Reopened by the previous version, which only took the blackout down.
    const s = setup({ a: booking('a') });
    s.col('closureActions').set('bo1', { state: 'done', date: '2026-10-17' });
    assert.deepEqual((await s.run(new Date('2026-10-20T10:30:00Z'))).sent, ['a']);
  });

  test('a failed send is tried again next hour, and a customer who moves meanwhile isn’t stamped', async () => {
    const s = setup({ a: booking('a') });
    let fail = true;
    const r1 = await sendClosureReminders({
      db: s.db,
      now: new Date('2026-10-20T10:30:00Z'),
      baseUrl: 'https://example.com',
      async send() {
        if (fail) throw new Error('Resend down');
      },
    });
    assert.deepEqual(r1, { sent: [], failed: ['a'] });
    fail = false;
    assert.deepEqual((await s.run(new Date('2026-10-20T11:30:00Z'))).sent, ['a']);

    const t = setup({ b: booking('b') });
    await sendClosureReminders({
      db: t.db,
      now: new Date('2026-10-20T10:30:00Z'),
      baseUrl: 'https://example.com',
      async send() {
        // They move to a new date while the email is going out.
        const { closure: _c, ...rest } = t.col('bookings').get('b')!;
        void _c;
        t.col('bookings').set('b', rest);
      },
    });
    assert.equal(t.col('bookings').get('b')!.closure, undefined);
  });
});
