/**
 * The notice Close a day and the countdown banner show after a reopen or
 * an undo (src/components/admin/closure-summary.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { backOnLines } from '../src/components/admin/closure-summary';

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
});
