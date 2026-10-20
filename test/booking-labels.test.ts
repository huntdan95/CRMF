/**
 * The admin booking page's stale-closure check and mark buttons
 * (src/components/admin/booking-labels.ts), which have to agree with
 * isStaleClosure and adminMarkOne on the server. Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { canMarkAfterTour, departureClosed, emailKindLabel, isStaleClosure } from '../src/components/admin/booking-labels';
import type { BookingDoc } from '../src/lib/admin-firestore';
import { EMAIL_KIND_LABEL } from '../functions/src/lib/email-log';

const done = { state: 'done' as const };

describe('isStaleClosure', () => {
  test('left behind by the previous version’s reopen: nothing covers the trip, and no reopenedAt', () => {
    assert.equal(isStaleClosure('morning', [], done), true);
    assert.equal(isStaleClosure('morning', [{ affectedSlots: ['late-afternoon'] }], null), true);
  });

  test('not while a closed day covers it, the closure is going out, or this version reopened it', () => {
    assert.equal(isStaleClosure('morning', [{ affectedSlots: ['all'] }], done), false);
    assert.equal(isStaleClosure('morning', [{ affectedSlots: ['morning'] }], done), false);
    // Closing a slot the whole-day charter runs through closes the charter.
    assert.equal(isStaleClosure('whole-day', [{ affectedSlots: ['mid-morning'] }], done), false);
    assert.equal(isStaleClosure('morning', [], { state: 'pending' }), false);
    assert.equal(isStaleClosure('morning', [], { state: 'finalizing' }), false);
    assert.equal(isStaleClosure('morning', [], { state: 'done', reopenedAt: { seconds: 1, nanoseconds: 0 } }), false);
  });
});

describe('departureClosed', () => {
  test('a blackout on the day covers the departure, or the whole-day charter running through it', () => {
    assert.equal(departureClosed('morning', [{ affectedSlots: ['all'] }]), true);
    assert.equal(departureClosed('morning', [{ affectedSlots: ['late-afternoon'] }, { affectedSlots: ['morning'] }]), true);
    assert.equal(departureClosed('whole-day', [{ affectedSlots: ['early-afternoon'] }]), true);
    assert.equal(departureClosed('morning', [{ affectedSlots: ['late-afternoon'] }]), false);
    assert.equal(departureClosed('late-afternoon', [{ affectedSlots: ['whole-day'] }]), false);
    assert.equal(departureClosed('morning', []), false);
  });
});

describe('canMarkAfterTour', () => {
  const waiting = {
    id: 'b1',
    date: '2020-01-04',
    timeSlot: 'morning',
    status: 'confirmed',
    closure: { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2020-01-07' },
  } as BookingDoc;

  test('a booking waiting on a closure only once that closure is stale', () => {
    assert.equal(canMarkAfterTour(waiting), false);
    assert.equal(canMarkAfterTour(waiting, true), true);
    assert.equal(canMarkAfterTour({ ...waiting, closure: null }), true);
  });

  test('not on a departure Travis closed and left them booked on: it didn’t go out', () => {
    assert.equal(canMarkAfterTour({ ...waiting, closure: null }, false, true), false);
  });
});

describe('emailKindLabel', () => {
  test('names every kind of email the way the functions’ bounce alerts do', () => {
    for (const [kind, label] of Object.entries(EMAIL_KIND_LABEL)) assert.equal(emailKindLabel(kind), label, kind);
  });
});
