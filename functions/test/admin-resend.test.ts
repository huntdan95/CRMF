/**
 * Admin's "Email the confirmation again": only for a confirmed trip still to
 * come, on a departure Travis hasn't closed. Against an in-memory stand-in
 * for Firestore. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { adminResendOne } from '../src/lib/admin-resend';
import { TOKEN, fakeDb, type Doc } from './fakes';

// 9:00 AM at the marina (EDT) on Thursday, October 15, 2026.
const NOW = new Date('2026-10-15T13:00:00Z');

const booking = (id: string, extra: Doc = {}): Doc => ({
  id,
  tourId: 'morning-shared',
  date: '2026-10-20',
  timeSlot: 'morning',
  type: 'shared',
  status: 'confirmed',
  guestCount: 2,
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  accessToken: TOKEN,
  ...extra,
});

describe('adminResendOne', () => {
  test('sends a confirmed booking’s confirmation again, up to the trip day', async () => {
    const { db } = fakeDb({ b1: booking('b1'), today: booking('today', { date: '2026-10-15' }) });
    const sent: string[] = [];
    const resend = async (id: string) => void sent.push(id);

    assert.deepEqual(await adminResendOne('b1', { db, now: NOW, resend }), { kind: 'sent' });
    assert.deepEqual(await adminResendOne('today', { db, now: NOW, resend }), { kind: 'sent' });
    assert.deepEqual(sent, ['b1', 'today']);
  });

  test('not for a departure Travis closed, a trip that’s passed, or a booking that isn’t confirmed', async () => {
    const { db } = fakeDb({
      closed: booking('closed', { closure: { reason: 'Weather', decideBy: '2026-10-23' } as Doc['closure'] }),
      past: booking('past', { date: '2026-10-14' }),
      unpaid: booking('unpaid', { status: 'pending-payment' }),
      done: booking('done', { status: 'completed', date: '2026-10-14' }),
    });
    const sent: string[] = [];
    const resend = async (id: string) => void sent.push(id);

    assert.deepEqual(await adminResendOne('closed', { db, now: NOW, resend }), { kind: 'closed' });
    assert.deepEqual(await adminResendOne('past', { db, now: NOW, resend }), { kind: 'past' });
    assert.deepEqual(await adminResendOne('unpaid', { db, now: NOW, resend }), { kind: 'not-confirmed' });
    assert.deepEqual(await adminResendOne('done', { db, now: NOW, resend }), { kind: 'not-confirmed' });
    assert.deepEqual(await adminResendOne('nope', { db, now: NOW, resend }), { kind: 'not-found' });
    assert.deepEqual(sent, []);
  });

  test('not for a departure Travis closed and left them booked, but for another trip that day', async () => {
    const { db } = fakeDb(
      { kept: booking('kept'), later: booking('later', { timeSlot: 'late-afternoon' }) },
      { blackouts: [{ date: '2026-10-20', affectedSlots: ['morning'], reason: 'weather' }] },
    );
    const sent: string[] = [];
    const resend = async (id: string) => void sent.push(id);

    assert.deepEqual(await adminResendOne('kept', { db, now: NOW, resend }), { kind: 'closed' });
    assert.deepEqual(await adminResendOne('later', { db, now: NOW, resend }), { kind: 'sent' });
    assert.deepEqual(sent, ['later']);
  });
});
