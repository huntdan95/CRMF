/**
 * Travis editing a booking's party size or contact details, against an
 * in-memory stand-in for Firestore. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Webhook } from 'svix';

process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';

import { NOTE_MAX, adminEditOne, saveAdminNote } from '../src/lib/admin-edit';
import { handleResendWebhook, type BounceAlert } from '../src/lib/email-events';
import type { Tour } from '../src/lib/types';
import { TOKEN, fakeDb, type Doc } from './fakes';

const tour = { slug: 'morning-shared', type: 'shared', timeSlot: 'morning', maxGuests: 6 } as Tour;
const getTour = async (slug: string) => (slug === tour.slug ? tour : null);

const booking = (id: string, guestCount: number, more: Doc = {}): Doc => ({
  id,
  tourId: 'morning-shared',
  date: '2099-07-04',
  timeSlot: 'morning',
  type: 'shared',
  status: 'confirmed',
  guestCount,
  customerName: 'Pat Example',
  customerPhone: '352-555-0100',
  accessToken: TOKEN,
  ...more,
});

describe('adminEditOne', () => {
  test('raises the party size when the boat has room, checking seats in the same transaction as the write', async () => {
    const { db, store, commits } = fakeDb({ b1: booking('b1', 2), b2: booking('b2', 3) });

    const r = await adminEditOne('b1', { guestCount: 3 }, { db, getTour });

    assert.equal(r.kind, 'updated');
    if (r.kind !== 'updated') return;
    assert.deepEqual(r.before, { guestCount: 2 });
    assert.equal(r.after.guestCount, 3);
    assert.equal(store.get('b1')!.guestCount, 3);
    assert.deepEqual(commits, [
      { reads: ['bookings/b1', 'bookings where date == 2099-07-04'], writes: ['bookings/b1'] },
    ]);
  });

  test('refuses when the boat doesn’t have the seats', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2), b2: booking('b2', 3) });

    const r = await adminEditOne('b1', { guestCount: 4 }, { db, getTour });

    assert.deepEqual(r, {
      kind: 'slot-full',
      message: 'Cannot raise to 4. Only 3 of 6 spots remain for the morning tour on 2099-07-04.',
    });
    assert.equal(store.get('b1')!.guestCount, 2);
  });

  test('a booking imported with no party size fills the boat, as it does for online booking', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2), b2: booking('b2', 0, { legacy: { bookingId: 4102 } }) });

    const r = await adminEditOne('b1', { guestCount: 3 }, { db, getTour });

    assert.deepEqual(r, {
      kind: 'slot-full',
      message: 'Cannot raise to 3. Only 0 of 6 spots remain for the morning tour on 2099-07-04.',
    });
    assert.equal(store.get('b1')!.guestCount, 2);
  });

  test('a private charter on the same departure leaves no seats to add', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2), b2: booking('b2', 2, { type: 'private', tourId: 'morning-private' }) });

    const r = await adminEditOne('b1', { guestCount: 3 }, { db, getTour });

    assert.equal(r.kind, 'slot-full');
    assert.equal(store.get('b1')!.guestCount, 2);
  });

  test('a blackout on its departure doesn’t stop Travis recording a bigger party', async () => {
    const { db, store } = fakeDb(
      { b1: booking('b1', 2) },
      { blackouts: [{ date: '2099-07-04', affectedSlots: ['all'] }] },
    );

    const r = await adminEditOne('b1', { guestCount: 4 }, { db, getTour });

    assert.equal(r.kind, 'updated');
    assert.equal(store.get('b1')!.guestCount, 4);
  });

  test('a booking made while the edit is saving can’t take the same seats', async () => {
    const { db, store } = fakeDb(
      { b1: booking('b1', 2), b2: booking('b2', 2) },
      {
        beforeCommit: (s, attempt) => {
          // A customer books the last two seats just before the edit lands.
          if (attempt === 1) s.set('b3', booking('b3', 2, { status: 'pending-payment' }));
        },
      },
    );

    const r = await adminEditOne('b1', { guestCount: 4 }, { db, getTour });

    assert.deepEqual(r, {
      kind: 'slot-full',
      message: 'Cannot raise to 4. Only 2 of 6 spots remain for the morning tour on 2099-07-04.',
    });
    assert.equal(store.get('b1')!.guestCount, 2, 'the boat is not oversold');
  });

  test('cancelled bookings and other departures don’t take seats', async () => {
    const { db, store } = fakeDb({
      b1: booking('b1', 2),
      b2: booking('b2', 4, { status: 'cancelled' }),
      b3: booking('b3', 4, { timeSlot: 'mid-morning' }),
      b4: booking('b4', 4, { status: 'no-show' }),
    });

    const r = await adminEditOne('b1', { guestCount: 6 }, { db, getTour });

    assert.equal(r.kind, 'updated');
    assert.equal(store.get('b1')!.guestCount, 6);
  });

  test('lowering the party size never needs free seats', async () => {
    // Overfull already, e.g. Travis squeezed someone on by phone.
    const { db, store, commits } = fakeDb({ b1: booking('b1', 4), b2: booking('b2', 4) });

    const r = await adminEditOne('b1', { guestCount: 3 }, { db, getTour });

    assert.equal(r.kind, 'updated');
    assert.equal(store.get('b1')!.guestCount, 3);
    assert.deepEqual(commits[0]!.reads, ['bookings/b1']);
  });

  test('a private charter has the boat to itself, so no seat check', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2, { type: 'private', tourId: 'morning-private' }) });

    const r = await adminEditOne('b1', { guestCount: 6 }, { db, getTour });

    assert.equal(r.kind, 'updated');
    assert.equal(store.get('b1')!.guestCount, 6);
  });

  test('contact details save with what they were before, for the audit log', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2) });

    const r = await adminEditOne('b1', { customerName: 'Pat Q. Example', customerPhone: '352-555-0199' }, { db, getTour });

    assert.equal(r.kind, 'updated');
    if (r.kind !== 'updated') return;
    assert.deepEqual(r.before, { customerName: 'Pat Example', customerPhone: '352-555-0100' });
    assert.equal(store.get('b1')!.customerName, 'Pat Q. Example');
    assert.equal(store.get('b1')!.customerPhone, '352-555-0199');
  });

  test('nothing to change, or no such booking', async () => {
    const { db, commits } = fakeDb({ b1: booking('b1', 2) });
    assert.deepEqual(await adminEditOne('b1', {}, { db, getTour }), { kind: 'nothing-to-update' });
    assert.deepEqual(await adminEditOne('nope', { guestCount: 3 }, { db, getTour }), { kind: 'not-found' });
    assert.deepEqual(commits.flatMap((c) => c.writes), []);
  });

  test('a shared booking whose tour is gone can’t be raised', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2, { tourId: 'retired-tour' }) });
    assert.deepEqual(await adminEditOne('b1', { guestCount: 3 }, { db, getTour }), { kind: 'tour-missing' });
    assert.equal(store.get('b1')!.guestCount, 2);
  });
});

describe('changing the customer’s email in Edit booking', () => {
  const SECRET = `whsec_${Buffer.from('a-test-signing-secret-32-bytes!!').toString('base64')}`;
  const signer = new Webhook(SECRET);
  // 9:00 AM at the marina on Thursday, October 15, 2026.
  const NOW = new Date('2026-10-15T13:00:00Z');
  let n = 0;
  function bounced(emailId: string, to: string, createdAt: string) {
    const id = `msg_${++n}`;
    const sentAt = new Date();
    const body = JSON.stringify({
      type: 'email.bounced',
      created_at: createdAt,
      data: { email_id: emailId, to: [to], bounce: { type: 'Permanent', message: 'Mailbox does not exist' } },
    });
    return {
      rawBody: Buffer.from(body),
      headers: {
        'svix-id': id,
        'svix-timestamp': String(Math.floor(sentAt.getTime() / 1000)),
        'svix-signature': signer.sign(id, sentAt, body),
      },
    };
  }
  const sent = (to: string): Doc => ({ kind: 'confirmation', bookingId: 'b1', to: [to], subject: 'Booked', status: 'sent', events: [] }) as unknown as Doc;

  test('the new address bouncing too still alerts Travis, and the old bounce is gone', async () => {
    const { db, store } = fakeDb(
      { b1: booking('b1', 2, { date: '2026-10-20', customerEmail: 'jane@exmaple.com' }) },
      { others: { emailLog: { em_1: sent('jane@exmaple.com'), em_2: sent('jane@exampel.com') } } },
    );
    const alerts: BounceAlert[] = [];
    const deps = { db, secret: SECRET, now: () => NOW, sendAlert: async (a: BounceAlert) => void alerts.push(a) };

    await handleResendWebhook(bounced('em_1', 'jane@exmaple.com', '2026-10-15T12:00:00Z'), deps);
    assert.equal(alerts.length, 1);
    assert.equal((store.get('b1')!.emailBounces as Record<string, { to: string }>).confirmation!.to, 'jane@exmaple.com');

    const r = await adminEditOne('b1', { customerEmail: 'jane@exampel.com' }, { db, getTour });
    assert.equal(r.kind, 'updated');
    const after = store.get('b1')!;
    assert.equal(after.emailBounces, undefined, 'the bounce was from an address the booking no longer uses');
    assert.deepEqual(after.bounceAlertSentAt, {});
    assert.equal(after.customerEmail, 'jane@exampel.com');

    // Travis resends; that bounces as well.
    await handleResendWebhook(bounced('em_2', 'jane@exampel.com', '2026-10-15T12:30:00Z'), deps);
    assert.equal(alerts.length, 2, 'Travis hears about the second bounce');
    assert.equal(alerts[1]!.address, 'jane@exampel.com');
    assert.equal((store.get('b1')!.emailBounces as Record<string, { to: string }>).confirmation!.to, 'jane@exampel.com');
  });

  test('other edits, or the same address in other capitals, leave the bounce flagged', async () => {
    const bounce = { emailId: 'em_1', to: 'jane@exmaple.com', subject: 'Booked', bounceType: 'Permanent', bounceMessage: null, at: null };
    const { db, store } = fakeDb({
      b1: booking('b1', 2, {
        customerEmail: 'jane@exmaple.com',
        emailBounces: { confirmation: bounce },
        bounceAlertSentAt: { confirmation: 'sent' },
      } as unknown as Doc),
    });

    await adminEditOne('b1', { customerPhone: '352-555-0199' }, { db, getTour });
    await adminEditOne('b1', { customerEmail: 'Jane@Exmaple.com' }, { db, getTour });

    assert.deepEqual(store.get('b1')!.emailBounces, { confirmation: bounce });
    assert.deepEqual(store.get('b1')!.bounceAlertSentAt, { confirmation: 'sent' });
  });
});

describe('saveAdminNote', () => {
  test('appending adds the line to the notes as they are when it saves', async () => {
    const { db, store } = fakeDb(
      { b1: booking('b1', 2, { adminNotes: 'Kid is nervous.' }) },
      {
        beforeCommit: (s, attempt) => {
          // Cancelling it adds a refund-by-hand line just before the note lands.
          if (attempt === 1) s.set('b1', { ...s.get('b1')!, adminNotes: 'Kid is nervous.\n2026-10-15: Refund it by hand.' });
        },
      },
    );

    const r = await saveAdminNote('b1', { append: 'Called back, all good.' }, { db });

    assert.equal(r.kind, 'saved');
    assert.equal(store.get('b1')!.adminNotes, 'Kid is nervous.\n2026-10-15: Refund it by hand.\nCalled back, all good.');
  });

  test('appending to no notes, and past the limit', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2), b2: booking('b2', 2, { adminNotes: 'x'.repeat(NOTE_MAX - 5) }) });

    assert.deepEqual(await saveAdminNote('b1', { append: 'First note.' }, { db }), {
      kind: 'saved',
      before: undefined,
      after: 'First note.',
    });
    assert.deepEqual(await saveAdminNote('b2', { append: 'Too long.' }, { db }), { kind: 'too-long', length: NOTE_MAX + 5 });
    assert.equal(store.get('b2')!.adminNotes, 'x'.repeat(NOTE_MAX - 5));
  });

  test('the note window’s save is refused if the notes changed after it opened', async () => {
    const { db, store } = fakeDb({
      b1: booking('b1', 2, { adminNotes: 'Kid is nervous.\n2026-10-15: Moved by the customer from 2026-10-16.' }),
    });

    const r = await saveAdminNote('b1', { note: 'Kid is nervous. Bring the small vest.', previousNotes: 'Kid is nervous.' }, { db });

    assert.deepEqual(r, { kind: 'changed' });
    assert.equal(store.get('b1')!.adminNotes, 'Kid is nervous.\n2026-10-15: Moved by the customer from 2026-10-16.');
  });

  test('the note window’s save goes through when nothing changed, as does one with no starting text', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2, { adminNotes: 'Kid is nervous.' }), b2: booking('b2', 2) });

    const r = await saveAdminNote('b1', { note: 'Kid is nervous. Bring the small vest.', previousNotes: 'Kid is nervous.' }, { db });
    assert.deepEqual(r, { kind: 'saved', before: 'Kid is nervous.', after: 'Kid is nervous. Bring the small vest.' });
    assert.equal((await saveAdminNote('b2', { note: 'Repeat guests.', previousNotes: '' }, { db })).kind, 'saved');
    // A caller that sends neither replaces the notes, as before.
    assert.equal((await saveAdminNote('b1', { note: 'Replaced.' }, { db })).kind, 'saved');

    assert.equal(store.get('b1')!.adminNotes, 'Replaced.');
    assert.equal(store.get('b2')!.adminNotes, 'Repeat guests.');
    assert.deepEqual(await saveAdminNote('nope', { append: 'Hi.' }, { db }), { kind: 'not-found' });
  });
});
