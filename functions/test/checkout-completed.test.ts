/**
 * What stripeWebhook does with checkout.session.completed, against in-memory
 * stand-ins for Firestore and Stripe. Run with `npm test` in functions/.
 */
import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';

process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';

import {
  departingSoon,
  leavesIn,
  recordCompletedCheckout,
  sendLastMinuteAlert,
  type LastMinuteBooking,
  type PaidAfterCancellation,
} from '../src/lib/checkout-completed';
import {
  buildBookingConfirmation,
  buildCancellationEmail,
  buildLastMinuteBookingEmail,
  buildPaidAfterCancellationEmail,
  buildRescheduleAckEmail,
  buildRescheduleRequestEmail,
} from '../src/lib/email-templates';
import { zonedTimeToUtc } from '../src/lib/datetime';
import { slotStartTime } from '../src/lib/schedule';
import type { Booking } from '../src/lib/types';
import { TOKEN, fakeDb, fakeResend, type Doc } from './fakes';

const pending: Doc = {
  id: 'b1',
  tourName: 'Morning Manatee Tour',
  date: '2026-12-01',
  timeSlot: 'morning',
  guestCount: 4,
  customerName: 'Sam Rivera',
  customerEmail: 'sam@example.com',
  customerPhone: '555-0100',
  status: 'pending-payment',
  paymentStatus: 'pending',
  amountPaidCents: 0,
  amountRefundedCents: 0,
  accessToken: TOKEN,
  stripeCheckoutSessionId: 'cs_1',
};

const cancelled: Doc = {
  ...pending,
  status: 'cancelled',
  paymentStatus: 'failed',
  cancelledBy: 'admin',
  cancellationReason: 'Day closed by Capt. Travis',
};

function session(overrides: Partial<Stripe.Checkout.Session> = {}) {
  return {
    id: 'cs_1',
    metadata: { bookingId: 'b1' },
    payment_status: 'paid',
    amount_total: 24000,
    payment_intent: 'pi_1',
    livemode: false,
    ...overrides,
  } as Stripe.Checkout.Session;
}

/** Everything recordCompletedCheckout talks to, recording what it was asked. */
function harness(
  docs: Record<string, Doc>,
  opts: {
    refundFails?: boolean;
    alertFails?: boolean;
    confirmationFails?: boolean;
    lastMinuteFails?: boolean;
    paidAt?: Date;
  } = {},
) {
  const { db, store } = fakeDb(docs);
  const refunds: { params: Stripe.RefundCreateParams; options?: Stripe.RequestOptions }[] = [];
  const confirmations: string[] = [];
  const alerts: PaidAfterCancellation[] = [];
  const lastMinute: LastMinuteBooking[] = [];
  /** The emails in the order they were asked for. */
  const calls: string[] = [];
  const stripe = {
    refunds: {
      create: async (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions) => {
        refunds.push({ params, options });
        if (opts.refundFails) throw new Error('Stripe is down');
        return { id: 're_1', amount: 24000 };
      },
    },
  } as unknown as Pick<Stripe, 'refunds'>;
  const deps = {
    db,
    stripe,
    sendConfirmation: async (bookingId: string) => {
      calls.push('confirmation');
      if (opts.confirmationFails) throw new Error('Resend is down');
      confirmations.push(bookingId);
    },
    alertAdmin: async (alert: PaidAfterCancellation) => {
      if (opts.alertFails) throw new Error('Resend is down');
      alerts.push(alert);
    },
    alertLastMinute: async (alert: LastMinuteBooking) => {
      calls.push('last-minute');
      if (opts.lastMinuteFails) throw new Error('Resend is down');
      lastMinute.push(alert);
    },
    paidAt: opts.paidAt,
  };
  return { deps, store, refunds, confirmations, alerts, lastMinute, calls };
}

/** Marina time on Saturday, October 17, 2026 (EDT). */
const oct17 = (hhmm: string) => zonedTimeToUtc('2026-10-17', hhmm);
const leavingOct17: Doc = { ...pending, date: '2026-10-17' };

describe('recordCompletedCheckout', () => {
  test('confirms a pending booking once it’s paid', async () => {
    const h = harness({ b1: pending });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'confirmed');
    const b = h.store.get('b1')!;
    assert.equal(b.status, 'confirmed');
    assert.equal(b.paymentStatus, 'paid');
    assert.equal(b.amountPaidCents, 24000);
    assert.equal(b.stripePaymentIntentId, 'pi_1');
    assert.deepEqual(h.confirmations, ['b1']);
    assert.deepEqual(h.refunds, []);
    assert.deepEqual(h.alerts, []);
  });

  test('keeps holding the seats while the payment clears', async () => {
    const h = harness({ b1: pending });
    const outcome = await recordCompletedCheckout(session({ payment_status: 'unpaid' }), h.deps);
    assert.equal(outcome, 'awaiting-payment');
    assert.equal(h.store.get('b1')!.status, 'pending-payment');
    assert.equal(h.store.get('b1')!.paymentStatus, 'pending');
    assert.equal(h.store.get('b1')!.amountPaidCents, 0, 'nothing paid yet');
    assert.deepEqual(h.confirmations, []);
  });

  test('confirms once a delayed payment clears', async () => {
    // checkout.session.completed (unpaid), then async_payment_succeeded.
    const h = harness({ b1: pending });
    await recordCompletedCheckout(session({ payment_status: 'unpaid' }), h.deps);
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'confirmed');
    const b = h.store.get('b1')!;
    assert.equal(b.status, 'confirmed');
    assert.equal(b.paymentStatus, 'paid');
    assert.equal(b.amountPaidCents, 24000);
    assert.deepEqual(h.confirmations, ['b1']);
  });

  test('retries the confirmation email when Stripe redelivers', async () => {
    // The first delivery confirmed the booking but the email failed, so the
    // webhook returned 500. The sender itself skips if it already went out.
    const h = harness({ b1: { ...pending, status: 'confirmed', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' } });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'unchanged');
    assert.deepEqual(h.confirmations, ['b1']);
    assert.deepEqual(h.refunds, []);
  });

  test('refunds a payment on a cancelled booking instead of bringing it back', async () => {
    const h = harness({ b1: { ...cancelled, adminNotes: 'Regular, ask about the dog.' } });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'refunded');

    assert.equal(h.refunds.length, 1);
    assert.equal(h.refunds[0]!.params.payment_intent, 'pi_1');
    assert.equal(h.refunds[0]!.params.amount, undefined, 'refunds the whole charge');
    assert.equal(h.refunds[0]!.options?.idempotencyKey, 'paid-after-cancel-cs_1');

    const b = h.store.get('b1')!;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.cancellationReason, 'Day closed by Capt. Travis');
    assert.equal(b.paymentStatus, 'refunded');
    assert.equal(b.amountPaidCents, 24000);
    assert.equal(b.amountRefundedCents, 24000);
    assert.equal(b.stripePaymentIntentId, 'pi_1');
    assert.match(String(b.adminNotes), /^Regular, ask about the dog\.\n\n/);
    assert.match(String(b.adminNotes), /Refunded automatically \(re_1\)/);

    assert.deepEqual(h.confirmations, [], 'no confirmation email');
    assert.equal(h.alerts.length, 1);
    assert.equal(h.alerts[0]!.outcome, 'refunded');
    assert.equal(h.alerts[0]!.refundId, 're_1');
    assert.equal(h.alerts[0]!.booking.status, 'cancelled');
  });

  test('dates the note by the marina’s calendar, not UTC’s', async () => {
    // 9:30 PM in Crystal River on November 30 is already December 1 in UTC.
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-01T02:30:00Z') });
    try {
      const h = harness({ b1: cancelled });
      await recordCompletedCheckout(session(), h.deps);
      assert.match(String(h.store.get('b1')!.adminNotes), /^2026-11-30: Paid /);
    } finally {
      mock.timers.reset();
    }
  });

  test('asks the owner to refund by hand when the automatic refund fails', async () => {
    const h = harness({ b1: cancelled }, { refundFails: true });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'refund-failed');
    const b = h.store.get('b1')!;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.paymentStatus, 'paid');
    assert.equal(b.amountPaidCents, 24000);
    assert.equal(b.amountRefundedCents, 0);
    assert.match(String(b.adminNotes), /automatic refund failed/);
    assert.equal(h.alerts[0]!.outcome, 'refund-failed');
    assert.equal(h.alerts[0]!.refundId, null);
  });

  test('alerts the owner about a cancelled booking whose payment hasn’t cleared', async () => {
    const h = harness({ b1: cancelled });
    const outcome = await recordCompletedCheckout(session({ payment_status: 'unpaid' }), h.deps);
    assert.equal(outcome, 'not-captured');
    assert.deepEqual(h.refunds, [], 'nothing to refund yet');
    const b = h.store.get('b1')!;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.paymentStatus, 'pending');
    assert.equal(b.amountPaidCents, 0);
    assert.equal(b.stripePaymentIntentId, 'pi_1');
    assert.equal(h.alerts[0]!.outcome, 'not-captured');
  });

  test('still records the refund when the alert email fails', async () => {
    const h = harness({ b1: cancelled }, { alertFails: true });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'refunded');
    assert.equal(h.store.get('b1')!.paymentStatus, 'refunded');
  });

  test('does not refund a payment the booking already has', async () => {
    // Paid, then cancelled inside 24 hours (no refund). A replayed event
    // mustn't hand the money back.
    const h = harness({
      b1: { ...cancelled, paymentStatus: 'paid', amountPaidCents: 24000, stripePaymentIntentId: 'pi_1' },
    });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'unchanged');
    assert.deepEqual(h.refunds, []);
    assert.deepEqual(h.alerts, []);
    assert.equal(h.store.get('b1')!.paymentStatus, 'paid');
  });

  test('leaves bookings past checkout alone', async () => {
    for (const status of ['completed', 'no-show'] as const) {
      const h = harness({ b1: { ...pending, status, paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' } });
      assert.equal(await recordCompletedCheckout(session(), h.deps), 'unchanged', status);
      assert.equal(h.store.get('b1')!.status, status);
      assert.deepEqual(h.confirmations, []);
      assert.deepEqual(h.refunds, []);
    }
  });

  test('ignores sessions with no booking', async () => {
    const h = harness({});
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'not-found');
    assert.equal(await recordCompletedCheckout(session({ metadata: {} }), h.deps), 'not-found');
    assert.deepEqual(h.refunds, []);
    assert.deepEqual(h.alerts, []);
  });
});

describe('last-minute bookings', () => {
  test('tells Travis about a booking paid inside the online cutoff, after the confirmation', async () => {
    const h = harness({ b1: leavingOct17 }, { paidAt: oct17('07:29') });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'confirmed');
    assert.deepEqual(h.calls, ['confirmation', 'last-minute']);
    assert.equal(h.lastMinute.length, 1);
    const alert = h.lastMinute[0]!;
    assert.equal(alert.booking.id, 'b1');
    assert.equal(alert.departs, '08:00');
    assert.equal(alert.minutesToGo, 31);
    assert.equal(alert.paidAt.toISOString(), '2026-10-17T11:29:00.000Z');
  });

  test('draws the line where the booking window does: 60 minutes, marina time', async () => {
    const early = harness({ b1: leavingOct17 }, { paidAt: oct17('06:59') });
    await recordCompletedCheckout(session(), early.deps);
    assert.deepEqual(early.calls, ['confirmation'], '61 minutes out is an ordinary booking');

    const onTheLine = harness({ b1: leavingOct17 }, { paidAt: oct17('07:00') });
    await recordCompletedCheckout(session(), onTheLine.deps);
    assert.equal(onTheLine.lastMinute[0]?.minutesToGo, 60);

    // The same clock time a day ahead is an ordinary booking.
    const dayBefore = harness({ b1: leavingOct17 }, { paidAt: zonedTimeToUtc('2026-10-16', '07:59') });
    await recordCompletedCheckout(session(), dayBefore.deps);
    assert.deepEqual(dayBefore.lastMinute, []);
  });

  test('counts a trip that had already left when they paid', async () => {
    const h = harness({ b1: leavingOct17 }, { paidAt: oct17('08:05') });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'confirmed');
    assert.equal(h.lastMinute[0]?.minutesToGo, -5);
  });

  test('uses the sunset cruise’s time on that day', async () => {
    const departs = slotStartTime('sunset', '2026-10-17');
    const paidAt = new Date(zonedTimeToUtc('2026-10-17', departs).getTime() - 25 * 60_000);
    const h = harness({ b1: { ...leavingOct17, timeSlot: 'sunset', type: 'private' } }, { paidAt });
    await recordCompletedCheckout(session(), h.deps);
    assert.equal(h.lastMinute[0]?.departs, departs);
    assert.equal(h.lastMinute[0]?.minutesToGo, 25);
  });

  test('an alert that fails doesn’t fail the confirmation', async () => {
    const h = harness({ b1: leavingOct17 }, { paidAt: oct17('07:29'), lastMinuteFails: true });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'confirmed');
    assert.equal(h.store.get('b1')!.status, 'confirmed');
    assert.deepEqual(h.confirmations, ['b1']);
  });

  test('still alerts when the confirmation email fails, which still goes back to Stripe', async () => {
    const h = harness({ b1: leavingOct17 }, { paidAt: oct17('07:29'), confirmationFails: true });
    await assert.rejects(recordCompletedCheckout(session(), h.deps), /Resend is down/);
    assert.equal(h.store.get('b1')!.status, 'confirmed');
    assert.deepEqual(h.calls, ['confirmation', 'last-minute']);

    // Stripe's retry sends both again; the alert's idempotency key keeps it to one email.
    const retry = harness({ b1: h.store.get('b1')! }, { paidAt: oct17('07:29') });
    assert.equal(await recordCompletedCheckout(session(), retry.deps), 'unchanged');
    assert.deepEqual(retry.calls, ['confirmation', 'last-minute']);
    assert.equal(retry.lastMinute[0]?.minutesToGo, 31, 'judged by when they paid, not the retry');
  });

  test('says nothing until the payment clears, or about a cancelled booking', async () => {
    const unpaid = harness({ b1: leavingOct17 }, { paidAt: oct17('07:29') });
    await recordCompletedCheckout(session({ payment_status: 'unpaid' }), unpaid.deps);
    assert.deepEqual(unpaid.calls, []);

    const gone = harness({ b1: { ...cancelled, date: '2026-10-17' } }, { paidAt: oct17('07:29') });
    assert.equal(await recordCompletedCheckout(session(), gone.deps), 'refunded');
    assert.deepEqual(gone.lastMinute, []);
  });

  test('the crew’s notification says how soon it leaves', () => {
    const morning = { date: '2026-10-17', timeSlot: 'morning' } as const;
    assert.deepEqual(departingSoon(morning, oct17('07:35')), { departs: '08:00', minutesToGo: 25 });
    assert.equal(leavesIn(25), 'Leaves in 25 min');
    assert.equal(departingSoon(morning, oct17('06:59')), null);
    assert.equal(leavesIn(departingSoon(morning, oct17('08:10'))!.minutesToGo), 'Already left');
  });
});

describe('the last-minute email', () => {
  const alert: LastMinuteBooking = {
    booking: { ...leavingOct17, customerName: 'Sam <Rivera>', customerPhone: '(352) 555-0100' } as Booking,
    paidAt: oct17('07:29'),
    departs: '08:00',
    minutesToGo: 31,
  };

  test('names the trip and when they paid, with a tel: link and the admin link', () => {
    const { subject, text, html } = buildLastMinuteBookingEmail(alert, 'https://example.com/');
    assert.equal(subject, '[CRMF] Last-minute booking: Sat Oct 17, 8:00 — paid 7:29 AM');
    assert.match(text, /booked 4 guests on the 8:00 AM Morning Manatee Tour \(Sat Oct 17\) and paid at 7:29 AM, 31 minutes before it leaves\./);
    assert.match(text, /Phone: {2}\(352\) 555-0100 \(tel:\+13525550100\)/);
    assert.match(text, /https:\/\/example\.com\/admin\/bookings\/b1/);
    assert.match(html, /href="tel:\+13525550100"/);
    assert.match(html, /href="https:\/\/example\.com\/admin\/bookings\/b1"/);
    assert.match(html, /Sam &lt;Rivera&gt;/);
    assert.doesNotMatch(html, /Sam <Rivera>/);
  });

  test('a trip that had left asks Travis to sort it out', () => {
    const { text } = buildLastMinuteBookingEmail({ ...alert, paidAt: oct17('08:05'), minutesToGo: -5 }, 'https://example.com');
    assert.match(text, /paid at 8:05 AM, after it had left\./);
    assert.match(text, /move them to another trip or refund them/);
  });

  test('goes to Travis only, logged as admin, keyed on the booking', async () => {
    const { db, coll } = fakeDb({});
    const { resend, sent } = fakeResend();
    await sendLastMinuteAlert(alert, { db, resend, baseUrl: 'https://example.com', adminEmail: 'travis@example.com' });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.payload.to, ['travis@example.com']);
    assert.equal(sent[0]!.payload.bcc, undefined);
    assert.equal(sent[0]!.payload.replyTo, 'sam@example.com');
    assert.equal(sent[0]!.options?.idempotencyKey, 'last-minute-booking/b1');
    assert.equal(coll('emailLog').get('em_1')!.kind, 'admin');
  });

  test('a retry Resend has already answered isn’t an error', async () => {
    const { resend, sent } = fakeResend({ fail: { name: 'invalid_idempotent_request', message: 'Same key, different email' } });
    await sendLastMinuteAlert(alert, { db: fakeDb({}).db, resend, baseUrl: 'https://example.com', adminEmail: 'travis@example.com' });
    assert.equal(sent.length, 1);
  });
});

describe('buildPaidAfterCancellationEmail', () => {
  const alert = (outcome: PaidAfterCancellation['outcome']): PaidAfterCancellation => ({
    booking: { ...cancelled, customerName: 'Sam <Rivera>' } as Booking,
    outcome,
    amountCents: 24000,
    paymentIntentId: 'pi_1',
    refundId: outcome === 'refunded' ? 're_1' : null,
    stripePaymentStatus: outcome === 'not-captured' ? 'unpaid' : 'paid',
    livemode: false,
  });

  test('tells the owner it was refunded', () => {
    const { subject, text } = buildPaidAfterCancellationEmail(alert('refunded'));
    assert.match(subject, /^Refunded:/);
    assert.match(text, /refunded in full automatically \(re_1\)/);
  });

  test('flags a refund the owner has to make', () => {
    for (const outcome of ['refund-failed', 'not-captured'] as const) {
      const { subject, text, html } = buildPaidAfterCancellationEmail(alert(outcome));
      assert.match(subject, /^Action needed:/, outcome);
      assert.match(text, /dashboard\.stripe\.com\/test\/payments\/pi_1/, outcome);
      assert.match(html, /Sam &lt;Rivera&gt;/, outcome);
    }
  });
});

describe('customer emails', () => {
  const booking = { ...pending, status: 'confirmed', tourId: 'morning-shared', guests: [{ name: 'Sam Rivera', age: null }] } as Booking;
  const marina = { name: "Pete's Pier Marina", address: '1 SW First Place' };

  test('the confirmation says when the boat leaves and when to arrive', () => {
    const { text, html } = buildBookingConfirmation({ booking, baseUrl: 'https://example.com', marina, phoneDisplay: '352-586-7792' });
    assert.match(text, /departs 8:00 AM \(please arrive by 7:45 AM\)/);
    assert.match(html, /departs 8:00 AM \(please arrive by 7:45 AM\)/);
    assert.match(text, /Guests: {3}4\n/);
  });

  test('an old-website booking with no party size on file doesn’t say "Guests: 0"', () => {
    const legacy = { ...booking, id: 'legacy-8', guestCount: 0, guests: [], legacy: { bookingId: 8 } } as Booking;
    const { text } = buildBookingConfirmation({ booking: legacy, baseUrl: 'https://example.com', marina, phoneDisplay: '352-586-7792' });
    assert.doesNotMatch(text, /Guests:/);
    assert.doesNotMatch(text, /Your party:/, 'no empty guest list either');
  });

  test('the party lists only named guests, and counts the rest', () => {
    const party = {
      ...booking,
      guests: [{ name: 'Sam Rivera', age: null }, { name: '', age: null }, { name: 'Kid Rivera', age: 9 }, { name: ' ', age: null }],
    } as Booking;
    const { text, html } = buildBookingConfirmation({ booking: party, baseUrl: 'https://example.com', marina, phoneDisplay: '352-586-7792' });
    assert.match(text, /Your party:\n {3}1\. Sam Rivera\n {3}2\. Kid Rivera \(age 9\)\n {3}Plus 2 more guests not named yet\.\n/);
    const ol = html.match(/<ol[^>]*>(.*?)<\/ol>/)?.[1] ?? '';
    assert.equal(ol.match(/<li /g)?.length, 2, 'no empty entries');
    assert.match(html, /Plus 2 more guests not named yet\./);

    const nobodyNamed = { ...booking, guests: [{ name: '', age: null }] } as Booking;
    const none = buildBookingConfirmation({ booking: nobodyNamed, baseUrl: 'https://example.com', marina, phoneDisplay: '352-586-7792' });
    assert.doesNotMatch(none.text + none.html, /Your party/);
  });

  test('what was paid shows a refund, and an old-site reservation’s balance is with Travis', () => {
    const refunded = { ...booking, amountPaidCents: 39000, amountRefundedCents: 6500 } as Booking;
    const r = buildBookingConfirmation({ booking: refunded, baseUrl: 'https://example.com', marina, phoneDisplay: '352-586-7792' });
    assert.match(r.text, /Paid: {5}\$390 \(\$65 refunded\)\n/);

    const reservation = {
      ...booking,
      id: 'legacy-4',
      status: 'pending-payment',
      amountPaidCents: 5000,
      legacy: { bookingId: 4, oldStatus: 'reserved' },
    } as Booking;
    const d = buildBookingConfirmation({ booking: reservation, baseUrl: 'https://example.com', marina, phoneDisplay: '352-586-7792' });
    assert.match(d.text, /Paid: {5}\$50 so far\n {10}Any balance is settled with Travis, not on this site\.\n/);
    assert.match(d.html, /Any balance is settled with Travis/);
  });

  test('Travis’s copy of a reschedule request reads plainly for an old-site booking', () => {
    const legacy = { ...booking, id: 'legacy-8', guestCount: 0, customerPhone: '', legacy: { bookingId: 8 } } as Booking;
    const { text, html } = buildRescheduleRequestEmail({
      booking: legacy,
      requestedDate: '2026-12-05',
      requestedSlot: 'early-afternoon',
      marina: { name: 'Marina', address: '1 Dock St' },
    });
    assert.match(text, /Was: {6}Tuesday, December 1, 2026 \(Morning\)\n/);
    assert.match(text, /Guests: {3}party size not recorded\n/);
    assert.match(text, /Target slot: Early afternoon\n/);
    assert.doesNotMatch(text + html, /Phone|tel:/);
  });

  test('the cancellation text keeps its blank lines', () => {
    const { text } = buildCancellationEmail({
      booking: { ...booking, amountPaidCents: 24000 } as Booking,
      refundCents: 24000,
      refundPercent: 100,
      cancelledBy: 'customer',
      marina,
      phoneDisplay: '352-586-7792',
    });
    assert.match(text, /\n\nOriginal booking:\n/);
    assert.doesNotMatch(text, /Reason:/, 'no reason line when none was given');
  });

  test('the reschedule acknowledgement goes to the customer in plain words', () => {
    const { subject, text } = buildRescheduleAckEmail({
      booking,
      requestedDate: '2026-12-05',
      requestedSlot: 'mid-morning',
      phoneDisplay: '352-586-7792',
      marina: { name: 'Marina', address: '1 Dock St' },
    });
    assert.match(subject, /move your tour/);
    assert.match(text, /Saturday, December 5, 2026, Mid-morning/);
    assert.match(text, /stays as it is until Travis confirms/);
  });
});
