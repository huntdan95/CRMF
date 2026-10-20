/**
 * Every email goes through sendEmail and leaves an emailLog entry with the
 * right kind. Against in-memory stand-ins for Firestore and Resend. Run with
 * `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Secrets and params are read from the environment when a send runs.
process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';
process.env.ADMIN_EMAIL = 'travis@example.com';
process.env.APP_BASE_URL = 'https://example.com';

import { EmailSendError, emailTags, sendEmail } from '../src/lib/email-log';
import { customerMailer } from '../src/lib/customer-mailer';
import { sendBookingConfirmation, sendUpdatedConfirmation } from '../src/lib/send-confirmation';
import { adminCancelOne } from '../src/lib/admin-cancel';
import type { Booking } from '../src/lib/types';
import { TOKEN, fakeDb, fakeResend, fakeStripe, type Doc } from './fakes';

const booking: Doc = {
  id: 'b1',
  tourId: 'mid-morning-shared',
  tourName: '2hr Mid-morning Tour — Shared',
  date: '2026-10-17',
  timeSlot: 'mid-morning',
  type: 'shared',
  guestCount: 2,
  guests: [],
  customerName: 'Jane Smith',
  customerEmail: 'jane@example.com',
  customerPhone: '352-555-0100',
  accessToken: TOKEN,
  status: 'confirmed',
  paymentStatus: 'paid',
  amountPaidCents: 16800,
  amountRefundedCents: 0,
};

describe('sendEmail', () => {
  test('sends, tags and logs the email under Resend’s id', async () => {
    const { db, coll } = fakeDb({});
    const { resend, sent } = fakeResend();
    const r = await sendEmail(
      { kind: 'reminder', bookingId: 'b1', to: 'jane@example.com', subject: 'Tomorrow', html: '<p>x</p>', text: 'x', idempotencyKey: 'k1' },
      { db, resend },
    );
    assert.deepEqual(r, { id: 'em_1' });
    assert.equal(sent[0]!.payload.from, 'Manatee Fun <hello@example.com>');
    assert.deepEqual(sent[0]!.payload.to, ['jane@example.com']);
    assert.deepEqual(sent[0]!.payload.tags, [
      { name: 'kind', value: 'reminder' },
      { name: 'bookingId', value: 'b1' },
    ]);
    assert.deepEqual(sent[0]!.options, { idempotencyKey: 'k1' });

    const entry = coll('emailLog').get('em_1')!;
    assert.equal(entry.kind, 'reminder');
    assert.equal(entry.bookingId, 'b1');
    assert.equal(entry.waiverId, null);
    assert.equal(entry.crewId, null);
    assert.deepEqual(entry.to, ['jane@example.com']);
    assert.equal(entry.subject, 'Tomorrow');
    assert.equal(entry.status, 'sent');
    assert.equal(entry.bounceType, null);
    assert.equal(entry.bounceMessage, null);
    assert.equal(entry.lastEventAt, null);
    assert.deepEqual(entry.events, []);
    assert.ok(entry.sentAt, 'sentAt is set');
  });

  test('an error Resend returns is thrown, with its code, and nothing is logged', async () => {
    const { db, coll } = fakeDb({});
    const { resend } = fakeResend({ fail: { name: 'validation_error', message: 'Invalid `to` field' } });
    await assert.rejects(
      sendEmail({ kind: 'confirmation', bookingId: 'b1', to: 'x', subject: 's', html: 'h', text: 't' }, { db, resend }),
      (err: unknown) => err instanceof EmailSendError && err.code === 'validation_error' && err.message === 'Resend failed: Invalid `to` field',
    );
    assert.equal(coll('emailLog').size, 0);
  });

  test('a send Resend turns away for its rate limit is tried again, with the same key', async () => {
    const { db, coll } = fakeDb({});
    const { resend, sent } = fakeResend({
      fail: (n) => (n <= 2 ? { name: 'rate_limit_exceeded', message: 'Too many requests' } : null),
    });
    const waits: number[] = [];
    const r = await sendEmail(
      { kind: 'crew', crewId: 'c3', to: 'deckhand@example.com', subject: 'Trips called off', html: 'h', text: 't', idempotencyKey: 'k1' },
      { db, resend, wait: async (ms) => void waits.push(ms) },
    );
    assert.deepEqual(r, { id: 'em_3' });
    assert.equal(sent.length, 3);
    assert.deepEqual(sent.map((s) => s.options?.idempotencyKey), ['k1', 'k1', 'k1']);
    assert.deepEqual(waits, [1000, 2000]);
    assert.equal(coll('emailLog').size, 1);
    assert.equal(coll('emailLog').get('em_3')!.kind, 'crew');
  });

  test('it gives up after two more tries, and doesn’t retry any other refusal', async () => {
    const { db, coll } = fakeDb({});
    const limited = fakeResend({ fail: { name: 'rate_limit_exceeded', message: 'Too many requests' } });
    await assert.rejects(
      sendEmail(
        { kind: 'crew', to: 'deckhand@example.com', subject: 's', html: 'h', text: 't' },
        { db, resend: limited.resend, wait: async () => undefined },
      ),
      (err: unknown) => err instanceof EmailSendError && err.code === 'rate_limit_exceeded',
    );
    assert.equal(limited.sent.length, 3);

    const refused = fakeResend({ fail: { name: 'validation_error', message: 'Invalid `to` field' } });
    await assert.rejects(
      sendEmail({ kind: 'crew', to: 'x', subject: 's', html: 'h', text: 't' }, { db, resend: refused.resend, wait: async () => undefined }),
      EmailSendError,
    );
    assert.equal(refused.sent.length, 1);
    assert.equal(coll('emailLog').size, 0);
  });

  test('a log entry the webhook already made keeps its status and events', async () => {
    const { db, coll } = fakeDb({}, {
      others: { emailLog: { em_1: { kind: 'unknown', status: 'delivered', events: [{ type: 'email.delivered' }] } } },
    });
    const { resend } = fakeResend();
    await sendEmail({ kind: 'followup', bookingId: 'b1', to: 'jane@example.com', subject: 'Thanks', html: 'h', text: 't' }, { db, resend });
    const entry = coll('emailLog').get('em_1')!;
    assert.equal(entry.kind, 'followup');
    assert.equal(entry.status, 'delivered');
    assert.equal((entry.events as unknown[]).length, 1);
  });

  test('tags leave out values Resend wouldn’t take', () => {
    assert.deepEqual(emailTags('admin', { bookingId: 'legacy-412', crewId: 'has spaces' }), [
      { name: 'kind', value: 'admin' },
      { name: 'bookingId', value: 'legacy-412' },
    ]);
  });
});

describe('each send path logs its kind', () => {
  test('the confirmation is logged as confirmation, and a reused key is sent again without one', async () => {
    const { db, coll, store } = fakeDb({ b1: { ...booking, confirmationEmailMessageId: 'em_old' } });
    const { resend, sent } = fakeResend({
      fail: (n) => (n === 1 ? { name: 'invalid_idempotent_request', message: 'key reused' } : null),
    });
    await sendBookingConfirmation('b1', { db, resend });
    assert.equal(sent.length, 2);
    assert.equal(sent[0]!.options?.idempotencyKey, 'booking-confirmation/b1/em_old');
    assert.equal(sent[1]!.options, undefined);
    assert.equal(coll('emailLog').get('em_2')!.kind, 'confirmation');
    assert.equal(store.get('b1')!.confirmationEmailMessageId, 'em_2');
  });

  test('an updated confirmation after a move is logged as reschedule', async () => {
    const { db, coll } = fakeDb({});
    const { resend, sent } = fakeResend();
    await sendUpdatedConfirmation(booking as Booking, { adminEmail: 'travis@example.com' }, { db, resend });
    assert.match(sent[0]!.payload.subject, /^Updated: /);
    assert.equal(coll('emailLog').get('em_1')!.kind, 'reschedule');
  });

  test('the customer mailer logs cancellations, or the kind it’s given', async () => {
    const { db, coll } = fakeDb({});
    const { resend, sent } = fakeResend();
    const mailer = customerMailer({ adminEmail: 'dan@example.com', deps: { db, resend } });
    await mailer.send({ to: 'jane@example.com', subject: 'Cancelled', html: 'h', text: 't', bookingId: 'b1' });
    await mailer.send({ to: 'jane@example.com', subject: 'Pick a date', html: 'h', text: 't', bookingId: 'b1', kind: 'closureOffer' });
    assert.equal(coll('emailLog').get('em_1')!.kind, 'cancellation');
    assert.equal(coll('emailLog').get('em_2')!.kind, 'closureOffer');
    assert.deepEqual(sent[0]!.payload.bcc, 'dan@example.com');
    assert.deepEqual(sent[0]!.payload.replyTo, 'dan@example.com');
  });

  test('an admin cancel whose email Resend refuses is reported as not emailed', async () => {
    const { db } = fakeDb({ b1: { ...booking, stripePaymentIntentId: undefined, amountPaidCents: 0 } });
    const { resend } = fakeResend({ fail: { name: 'validation_error', message: 'bad address' } });
    const { stripe } = fakeStripe('complete');
    const r = await adminCancelOne(
      'b1',
      { reason: 'Weather', cause: 'admin' },
      { db, stripe: stripe as never, mailer: customerMailer({ deps: { db, resend } }) },
    );
    assert.equal(r.kind, 'cancelled');
    assert.equal(r.kind === 'cancelled' && r.emailed, false);
    assert.equal(r.kind === 'cancelled' && r.emailFailed, true);
  });
});
