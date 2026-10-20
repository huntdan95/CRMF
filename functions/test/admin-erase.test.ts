/**
 * "Erase personal details" (lib/admin-erase.ts): who the customer is goes
 * from the booking and every copy the site made of it, while the money,
 * the dates and the signed waivers stay, and nobody else's records are
 * touched. Against an in-memory Firestore. Run with `npm test` in
 * functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import { ERASED, adminEraseOne, erasable, scrubber } from '../src/lib/admin-erase';
import { TOKEN, fakeDb, type Doc } from './fakes';

/** 10 AM marina time, Tuesday October 20. */
const NOW = new Date('2026-10-20T14:00:00Z');
const at = Timestamp.fromDate(new Date('2026-10-01T12:00:00Z'));

const booking = (extra: Doc = {}): Doc => ({
  id: 'b1',
  tourId: 'mid-morning-shared',
  tourName: '2hr Mid-morning Tour — Shared',
  date: '2026-10-17',
  timeSlot: 'mid-morning',
  type: 'shared',
  guestCount: 2,
  customerName: 'Jane Smith',
  customerEmail: 'jane@example.com',
  customerPhone: '352-555-0100',
  emergencyContactName: 'Tom Smith',
  emergencyContactPhone: '352-555-0199',
  guests: [
    { name: 'Jane Smith', age: 41, wetsuitSize: 'M' },
    { name: 'Max Smith', age: 9, wetsuitSize: 'Kids 8' },
  ],
  adminNotes: 'Max is allergic to bees. Jane prefers texts.',
  accessToken: TOKEN,
  status: 'cancelled',
  paymentStatus: 'refunded',
  amountPaidCents: 26000,
  amountRefundedCents: 26000,
  stripePaymentIntentId: 'pi_1',
  stripeCheckoutSessionId: 'cs_1',
  cancellationReason: 'Jane Smith had to fly home early',
  cancelledAt: at,
  checkoutIpHash: 'hash-1',
  emailBounces: {
    confirmation: { emailId: 'em_0', to: 'jane@exmaple.com', subject: 'Your tour is confirmed', bounceType: 'Permanent', bounceMessage: null, at },
  },
  ...extra,
});

/** Everything the site copied about Jane, and one record each of someone else's. */
const others = (): Record<string, Record<string, Doc>> => ({
  auditLog: {
    edit: {
      action: 'booking.update',
      targetId: 'b1',
      payload: {
        before: { customerName: 'Jane Smit', customerEmail: 'jane@old.example', guestCount: 1 },
        after: { customerName: 'Jane Smith', customerEmail: 'jane@example.com', guestCount: 2 },
      },
    },
    note: { action: 'booking.note', targetId: 'b1', payload: { field: 'adminNotes', before: '', after: 'Max is allergic to bees.' } },
    cancel: { action: 'booking.cancel', targetId: 'b1', payload: { refundCents: 26000, stripeRefundId: 're_1', reason: 'Jane Smith had to fly home early' } },
    reset: {
      action: 'booking.update',
      targetId: 'b1',
      payload: { action: 'reset-links', email: { outcome: 'sent', kind: 'confirmation', to: 'jane@example.com' } },
    },
    // Travis's own address in an entry: never taken for hers.
    staff: { action: 'booking.update', targetId: 'b1', payload: { action: 'note-to-self', to: 'travis@example.com' } },
    message: { action: 'message.update', targetId: 'contactMessage/m1', payload: { status: 'replied', from: 'Jane Smith' } },
    request: { action: 'reschedule.update', targetId: 'rescheduleRequest/r1', payload: { status: 'declined', adminNotes: 'Told Jane no', bookingId: 'b1' } },
    someoneElse: { action: 'booking.update', targetId: 'b2', payload: { before: { customerName: 'Sam Rivera' }, after: { customerName: 'Sam Rivers' } } },
  },
  emailLog: {
    confirmation: { kind: 'confirmation', bookingId: 'b1', waiverId: null, to: ['jane@example.com'], subject: 'Your tour is confirmed', bounceMessage: null, events: [] },
    bounced: {
      kind: 'confirmation',
      bookingId: 'b1',
      waiverId: null,
      to: ['jane@exmaple.com'],
      subject: 'Your tour is confirmed',
      bounceMessage: '550 jane@exmaple.com: no such user',
      events: [{ type: 'email.bounced', at, detail: '550 jane@exmaple.com: no such user' }],
    },
    paidClosed: { kind: 'admin', bookingId: 'b1', waiverId: null, to: ['travis@example.com'], subject: '[CRMF] Paid for a trip you closed: Sat Oct 17 — Jane Smith' },
    feedbackNotice: { kind: 'admin', bookingId: null, waiverId: null, to: ['travis@example.com'], subject: '[CRMF] Private feedback from Jane Smith (Sat Oct 17)' },
    oldAddress: { kind: 'reminder', bookingId: null, waiverId: null, to: ['jane@old.example'], subject: 'See you tomorrow, Jane Smit' },
    waiverCopy: { kind: 'waiverCopy', bookingId: null, waiverId: 'w1', to: ['jane@example.com'], subject: 'Your signed waiver: Jane Smith' },
    someoneElse: { kind: 'admin', bookingId: null, waiverId: null, to: ['travis@example.com'], subject: '[CRMF] Private feedback from Sam Rivera (Sat Oct 17)' },
    // Another customer who shares her son's first name.
    anotherMax: { kind: 'admin', bookingId: null, waiverId: null, to: ['travis@example.com'], subject: '[CRMF] Private feedback from Max Power (Sat Oct 17)' },
  },
  closureActions: {
    bo1: {
      previewBookingIds: ['b1', 'b2'],
      targetIds: ['b1', 'b2'],
      result: {
        cancelled: [
          { id: 'b1', customerName: 'Jane Smith', timeSlot: 'mid-morning', guests: 2, refundCents: 26000 },
          { id: 'b2', customerName: 'Sam Rivera', timeSlot: 'mid-morning', guests: 1, refundCents: 13000 },
        ],
        offered: [],
        failed: [],
      },
      progress: {
        b1: { bucket: 'cancelled', entry: { id: 'b1', customerName: 'Jane Smith', refundCents: 26000 } },
        b2: { bucket: 'cancelled', entry: { id: 'b2', customerName: 'Sam Rivera', refundCents: 13000 } },
      },
    },
  },
  rescheduleRequests: {
    r1: { bookingId: 'b1', bookingCustomerEmail: 'jane@example.com', notes: 'Could we do Sunday?', adminNotes: 'Told Jane no', status: 'declined' },
    r2: { bookingId: 'b2', bookingCustomerEmail: 'sam@example.com', notes: 'Saturday?', status: 'open' },
  },
  guestFeedback: {
    f1: { bookingId: 'b1', customerName: 'Jane Smith', customerEmail: 'jane@example.com', message: 'The captain was great', tripDate: '2026-10-17' },
  },
  contactMessages: {
    m1: { name: 'Jane Smith', email: 'jane@example.com', phone: '352-555-0100', subject: 'Kids?', message: 'Can Max (9) come?', status: 'replied' },
    m2: { name: 'Sam Rivera', email: 'sam@example.com', phone: null, subject: null, message: 'Hi', status: 'new' },
    // As she typed it into the form.
    m3: { name: 'Jane', email: ' Jane@Example.com', phone: null, subject: null, message: 'Thanks!', status: 'archived' },
  },
  waivers: { w1: { bookingId: 'b1', signerName: 'Jane Smith', signerEmail: 'jane@example.com', guests: ['Max Smith'] } },
});

function setup(extra: Doc = {}) {
  const { db, store, coll } = fakeDb({ b1: booking(extra) }, { others: others() });
  const erase = () => adminEraseOne('b1', { db, now: NOW, adminEmail: 'travis@example.com', isStaff: (a) => a === 'travis@example.com' });
  return { store, coll, erase };
}

describe('adminEraseOne', () => {
  test('the booking keeps its money, dates and Stripe ids, and loses who they were', async () => {
    const { store, erase } = setup({ legacy: { bookingId: 101, billing: { city: 'Ocala', zip: '34470' } } });
    const result = await erase();
    assert.equal(result.kind, 'erased');
    const b = store.get('b1')!;
    for (const k of ['customerName', 'customerEmail', 'customerPhone', 'emergencyContactName', 'emergencyContactPhone', 'adminNotes']) {
      assert.equal(b[k], '', k);
    }
    assert.deepEqual(b.guests, [
      { name: '', age: null, wetsuitSize: 'M' },
      { name: '', age: null, wetsuitSize: 'Kids 8' },
    ]);
    assert.equal(b.cancellationReason, `${ERASED} had to fly home early`);
    assert.equal('emailBounces' in b, false);
    assert.equal('checkoutIpHash' in b, false);
    assert.deepEqual(b.legacy, { bookingId: 101 });
    assert.equal(b.erasedBy, 'travis@example.com');
    assert.ok(b.erasedAt);
    // What the books need.
    assert.equal(b.amountPaidCents, 26000);
    assert.equal(b.amountRefundedCents, 26000);
    assert.equal(b.stripePaymentIntentId, 'pi_1');
    assert.equal(b.date, '2026-10-17');
    assert.equal(b.status, 'cancelled');
    assert.equal(b.guestCount, 2);
  });

  test('every copy goes: audit entries, emails, closures, requests, feedback and messages', async () => {
    const { coll, erase } = setup();
    const result = await erase();
    assert.deepEqual(result.kind === 'erased' && result.copies, {
      auditLog: 7,
      emailLog: 5,
      closureActions: 1,
      rescheduleRequests: 1,
      guestFeedback: 1,
      contactMessages: 2,
    });

    const audit = coll('auditLog');
    assert.deepEqual(audit.get('edit')!.payload, {
      before: { customerName: ERASED, customerEmail: ERASED, guestCount: 1 },
      after: { customerName: ERASED, customerEmail: ERASED, guestCount: 2 },
    });
    assert.deepEqual(audit.get('note')!.payload, { field: 'adminNotes', before: '', after: ERASED });
    assert.deepEqual(audit.get('cancel')!.payload, { refundCents: 26000, stripeRefundId: 're_1', reason: `${ERASED} had to fly home early` });
    assert.deepEqual(audit.get('reset')!.payload, { action: 'reset-links', email: { outcome: 'sent', kind: 'confirmation', to: ERASED } });
    assert.deepEqual(audit.get('message')!.payload, { status: 'replied', from: ERASED });
    assert.deepEqual(audit.get('request')!.payload, { status: 'declined', adminNotes: ERASED, bookingId: 'b1' });

    const log = coll('emailLog');
    assert.deepEqual(log.get('confirmation')!.to, [ERASED]);
    assert.deepEqual(log.get('bounced')!.to, [ERASED], 'the address it bounced from too');
    assert.equal(log.get('bounced')!.bounceMessage, `550 ${ERASED}: no such user`);
    assert.equal((log.get('bounced')!.events as Array<Record<string, unknown>>)[0]!.detail, `550 ${ERASED}: no such user`);
    assert.equal((log.get('bounced')!.events as Array<Record<string, unknown>>)[0]!.at, at, 'when it happened stays');
    assert.equal(log.get('paidClosed')!.subject, `[CRMF] Paid for a trip you closed: Sat Oct 17 — ${ERASED}`);
    assert.deepEqual(log.get('paidClosed')!.to, ['travis@example.com']);
    // Travis's notice not filed under the booking, found by her name.
    assert.equal(log.get('feedbackNotice')!.subject, `[CRMF] Private feedback from ${ERASED} (Sat Oct 17)`);
    // Sent to the address she had before Travis corrected it.
    assert.deepEqual(log.get('oldAddress')!.to, [ERASED]);
    assert.equal(log.get('oldAddress')!.subject, `See you tomorrow, ${ERASED}`);

    const closure = coll('closureActions').get('bo1')!;
    const cancelled = (closure.result as { cancelled: Array<{ id: string; customerName: string; refundCents: number }> }).cancelled;
    assert.deepEqual(cancelled.map((c) => [c.id, c.customerName, c.refundCents]), [['b1', ERASED, 26000], ['b2', 'Sam Rivera', 13000]]);
    const progress = closure.progress as Record<string, { entry: { customerName: string } }>;
    assert.equal(progress.b1!.entry.customerName, ERASED);
    assert.equal(progress.b2!.entry.customerName, 'Sam Rivera');

    assert.deepEqual(coll('rescheduleRequests').get('r1'), { bookingId: 'b1', bookingCustomerEmail: '', notes: ERASED, adminNotes: ERASED, status: 'declined' });
    assert.deepEqual(coll('guestFeedback').get('f1'), { bookingId: 'b1', customerName: ERASED, customerEmail: '', message: ERASED, tripDate: '2026-10-17' });
    assert.deepEqual(coll('contactMessages').get('m1'), { name: ERASED, email: '', phone: null, subject: ERASED, message: ERASED, status: 'replied' });
    assert.deepEqual(coll('contactMessages').get('m3'), { name: ERASED, email: '', phone: null, subject: null, message: ERASED, status: 'archived' });
  });

  test('the signed waivers and everyone else’s records are left as they were', async () => {
    const before = others();
    const { coll, erase } = setup();
    await erase();
    assert.deepEqual(coll('waivers').get('w1'), before.waivers!.w1);
    assert.deepEqual(coll('emailLog').get('waiverCopy'), before.emailLog!.waiverCopy, 'the signer’s copy is the waiver’s record');
    assert.deepEqual(coll('emailLog').get('someoneElse'), before.emailLog!.someoneElse);
    assert.deepEqual(coll('emailLog').get('anotherMax'), before.emailLog!.anotherMax, 'her guests’ names are only looked for in her own records');
    assert.deepEqual(coll('auditLog').get('someoneElse'), before.auditLog!.someoneElse);
    // An entry about her named Travis's address: it's erased there, but
    // isn't taken for hers, so his other emails keep it.
    assert.deepEqual(coll('auditLog').get('staff')!.payload, { action: 'note-to-self', to: ERASED });
    assert.deepEqual(coll('emailLog').get('paidClosed')!.to, ['travis@example.com']);
    assert.deepEqual(coll('rescheduleRequests').get('r2'), before.rescheduleRequests!.r2);
    assert.deepEqual(coll('contactMessages').get('m2'), before.contactMessages!.m2);
  });

  test('only a cancelled booking, or one whose trip is over, and not while they can still pick a new date', async () => {
    const upcoming = setup({ status: 'confirmed', date: '2026-10-24' });
    assert.deepEqual(await upcoming.erase(), { kind: 'not-over' });
    assert.equal(upcoming.store.get('b1')!.customerName, 'Jane Smith');
    assert.deepEqual(upcoming.coll('auditLog').get('edit'), others().auditLog!.edit, 'no copy touched either');

    const today = setup({ status: 'confirmed', date: '2026-10-20' });
    assert.deepEqual(await today.erase(), { kind: 'not-over' });

    const choosing = setup({ status: 'confirmed', date: '2026-10-17', closure: { blackoutId: 'bo1', reason: 'Weather', decideBy: '2026-10-20' } });
    assert.deepEqual(await choosing.erase(), { kind: 'still-choosing' });

    const past = setup({ status: 'completed', date: '2026-10-17' });
    assert.equal((await past.erase()).kind, 'erased');
    assert.deepEqual(await past.erase(), { kind: 'already-erased' });
  });

  test('a booking that isn’t there', async () => {
    const { db } = fakeDb({});
    assert.deepEqual(await adminEraseOne('nope', { db, now: NOW }), { kind: 'not-found' });
  });
});

describe('erasable and scrubber', () => {
  test('a no-show or completed trip can go the same day; a confirmed one waits for the date to pass', () => {
    assert.equal(erasable({ status: 'no-show', date: '2026-10-20' }, NOW), 'ok');
    assert.equal(erasable({ status: 'confirmed', date: '2026-10-19' }, NOW), 'ok');
    assert.equal(erasable({ status: 'pending-payment', date: '2026-10-21' }, NOW), 'not-over');
  });

  test('whole words only, ignoring case, longest first', () => {
    const scrub = scrubber(['Jane Smith', 'Jane', 'jane@example.com', 'Al']);
    assert.equal(scrub('JANE SMITH wrote from Jane@Example.com'), `${ERASED} wrote from ${ERASED}`);
    assert.equal(scrub('Already Janet'), 'Already Janet');
    assert.equal(scrub('Al and Jane'), `${ERASED} and ${ERASED}`);
  });
});
