/**
 * The notice Close a day and the countdown banner show after a reopen or
 * an undo (src/components/admin/closure-summary.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { backOnLines, reopenedLead } from '../src/components/admin/closure-summary';

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
