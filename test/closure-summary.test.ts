/**
 * The notice Close a day and the countdown banner show after a reopen or
 * an undo (src/components/admin/closure-summary.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { backOnLines, closureSummary, reopenedLead } from '../src/components/admin/closure-summary';

const row = (id: string, customerName: string) => ({ id, customerName, date: '2026-10-17', timeSlot: 'morning' as const });

describe('backOnLines', () => {
  test('someone put back who was also sent the confirmation isn’t listed as not told', () => {
    // Paid during an offer's undo window, offered a new date when it went
    // out, then put back by the reopen, which sent the held-back confirmation.
    const lines = backOnLines({
      restored: [row('a', 'Jane Smith'), row('b', 'Bob Lee')],
      confirmationsSent: [row('a', 'Jane Smith')],
    });
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^Back on their trip: Bob Lee \(8:00 AM\)\. The customers haven’t been told/);
    assert.doesNotMatch(lines[0]!, /Jane/);
    assert.match(lines[1]!, /now sent their booking confirmation: Jane Smith/);
  });

  test('one whose confirmation didn’t go is listed once, under that', () => {
    const lines = backOnLines({ restored: [row('a', 'Jane Smith')], confirmationsFailed: [row('a', 'Jane Smith')], crewTold: true });
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^Paid while it was closed, but their booking confirmation didn’t go: Jane Smith/);
    assert.match(lines[1]!, /crew have had a message/);
  });

  test('someone on a trip that had already left is listed apart, to check whether they went', () => {
    // An undo after the 8:00 left, or a reopen tried again after it put them back.
    const lines = backOnLines({ restored: [], alreadyLeft: [row('a', 'Jane Smith')] });
    assert.deepEqual(lines, [
      'On a trip that had already left: Jane Smith (8:00 AM). It now counts as a trip that ran: check whether they went, ' +
        'and if they didn’t, move or cancel them from their booking page.',
    ]);
  });
});

describe('reopenedLead', () => {
  const day = 'Saturday, Oct 17';

  test('open for booking again when nothing else closes the day', () => {
    assert.equal(reopenedLead(day, 'undo'), 'Undone. Saturday, Oct 17 is open for booking again. Nothing went out for this closing.');
    assert.equal(reopenedLead(day, 'reopen', null), 'Saturday, Oct 17 is reopened.');
  });

  test('not while another closing of that day still covers the trips (`stillClosed` from the server)', () => {
    // Saturday left booked, then its 8:00 closed to cancel, and that undone.
    assert.equal(
      reopenedLead(day, 'undo', 'all'),
      'Undone. Saturday, Oct 17 is still closed: another closing of that day covers these trips. Nothing went out for this closing.',
    );
    assert.doesNotMatch(reopenedLead(day, 'reopen', 'all'), /reopened|open for booking/);
    // The 8:00 left booked, then the whole day closing, and that undone.
    assert.match(reopenedLead(day, 'undo', 'some'), /open for booking again, except the trips another closing of that day still covers/);
    assert.equal(reopenedLead(day, 'reopen', 'some'), 'Saturday, Oct 17 is reopened, except the trips another closing of that day still covers.');
  });
});

describe('closureSummary', () => {
  const cancelled = (id: string, customerName: string, extra: { refundCents?: number; emailed?: boolean; unpaidCheckout?: boolean } = {}) => ({
    id,
    customerName,
    timeSlot: 'morning' as const,
    guests: 2,
    refundCents: 0,
    manualRefundCents: 0,
    emailed: true,
    ...extra,
  });

  test('a cancel counts checkouts still being paid for apart from bookings, as an offer does', () => {
    const { summary } = closureSummary('cancel', {
      cancelled: [
        cancelled('a', 'Jane Smith', { refundCents: 16800 }),
        cancelled('b', 'Bob Lee', { refundCents: 16800, emailed: false }),
        cancelled('c', 'Sam Rivera', { unpaidCheckout: true }),
      ],
      offered: [],
      failed: [],
    });
    assert.deepEqual(summary, ['Cancelled 2 bookings. Emailed 1 of them.', 'Cancelled 1 unfinished checkout.', '$336 is going back to their cards.']);
    assert.equal(
      closureSummary('cancel', { cancelled: [cancelled('c', 'Sam Rivera', { unpaidCheckout: true })], offered: [], failed: [] }).summary[0],
      'Cancelled 1 unfinished checkout.',
    );
  });

  test('says so when the crew’s message didn’t reach them all, as Travis’s summary email does', () => {
    const off = { cancelled: [cancelled('a', 'Jane Smith', { refundCents: 16800 })], offered: [], failed: [] };
    assert.deepEqual(closureSummary('cancel', { ...off, crewTold: false }).problems, [
      'The message telling the crew these trips are off didn’t reach them all: tell them yourself.',
    ]);
    assert.deepEqual(closureSummary('cancel', { ...off, crewTold: true }).problems, []);
    const kept = { cancelled: [], offered: [], failed: [], kept: [{ id: 'a', customerName: 'Jane Smith', timeSlot: 'morning' as const, guests: 2 }] };
    assert.equal(
      closureSummary('keep', { ...kept, crewTold: false }).problems[1],
      'The message telling the crew these trips are closed didn’t reach them all: tell them yourself.',
    );
  });
});
