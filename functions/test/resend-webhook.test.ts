/**
 * The Resend webhook: signatures, each event type, when Travis is alerted,
 * and that retries and out-of-order events don't double up or go backwards.
 * Against in-memory stand-ins for Firestore and Resend, with real Svix
 * signatures. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Webhook } from 'svix';

process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';

import {
  alertReason,
  handleResendWebhook,
  laterStatus,
  verifyResendWebhook,
  type BounceAlert,
  type ResendEvent,
} from '../src/lib/email-events';
import { buildBounceAlertEmail, sendBounceAlert } from '../src/lib/bounce-alert';
import { TOKEN, fakeDb, fakeResend, type Doc } from './fakes';

const SECRET = `whsec_${Buffer.from('a-test-signing-secret-32-bytes!!').toString('base64')}`;
const signer = new Webhook(SECRET);

// 9:00 AM at the marina (EDT) on Thursday, October 15, 2026.
const NOW = new Date('2026-10-15T13:00:00Z');

/** A booking leaving `hoursAhead` hours after NOW: the date and slot are picked to match. */
function bookingLeaving(id: string, date: string, extra: Doc = {}): Doc {
  return {
    id,
    tourId: 'mid-morning-shared',
    tourName: '2hr Mid-morning Tour — Shared',
    date,
    timeSlot: 'mid-morning', // 10:30 AM
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
    ...extra,
  };
}
// 10:30 AM Oct 15 is 1.5 h away; Oct 16 is 25.5 h; Oct 17 is 49.5 h; Oct 20 is days out.
const TODAY = '2026-10-15';
const TOMORROW = '2026-10-16';
const IN_TWO_DAYS = '2026-10-17';
const NEXT_WEEK = '2026-10-20';

function logEntry(kind: string, bookingId: string | null, extra: Doc = {}): Doc {
  return {
    kind,
    bookingId,
    waiverId: null,
    crewId: null,
    to: ['jane@example.com'],
    subject: 'You’re booked: Sat, Oct 17',
    sentAt: { toMillis: () => NOW.getTime() - 3_600_000 },
    status: 'sent',
    bounceType: null,
    bounceMessage: null,
    lastEventAt: null,
    events: [],
    ...extra,
  };
}

let counter = 0;
function event(type: string, data: Record<string, unknown> = {}, createdAt = '2026-10-15T12:59:00.000Z'): ResendEvent {
  return {
    type,
    created_at: createdAt,
    data: { email_id: 'em_1', to: ['jane@example.com'], subject: 'You’re booked: Sat, Oct 17', ...data },
  };
}
const bounce = (type: string) => ({ bounce: { type, subType: 'General', message: 'Mailbox does not exist' } });

/** A signed request, as Svix sends it. */
function signed(ev: ResendEvent, opts: { id?: string; at?: Date; secret?: string } = {}) {
  const id = opts.id ?? `msg_${++counter}`;
  const at = opts.at ?? new Date();
  const body = JSON.stringify(ev);
  const sig = (opts.secret ? new Webhook(opts.secret) : signer).sign(id, at, body);
  return {
    rawBody: Buffer.from(body),
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(at.getTime() / 1000)),
      'svix-signature': sig,
    } as Record<string, string>,
  };
}

function harness(bookings: Record<string, Doc>, log: Record<string, Doc>, opts: { alertFails?: boolean } = {}) {
  const fake = fakeDb(bookings, { others: { emailLog: log } });
  const alerts: BounceAlert[] = [];
  const deliver = (req: ReturnType<typeof signed>) =>
    handleResendWebhook(req, {
      db: fake.db,
      secret: SECRET,
      now: () => NOW,
      async sendAlert(a) {
        if (opts.alertFails) throw new Error('Resend failed: down');
        alerts.push(a);
      },
    });
  return { ...fake, alerts, deliver, log: (id = 'em_1') => fake.coll('emailLog').get(id)! };
}

describe('signature', () => {
  test('a correctly signed event is accepted, with header names in any case', () => {
    const req = signed(event('email.delivered'), { id: 'msg_ok' });
    const ok = verifyResendWebhook(req.rawBody, req.headers, SECRET);
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.id, 'msg_ok');
    assert.equal(ok.ok && ok.event.type, 'email.delivered');
    // Another delivery id under the same signature doesn't verify.
    const swapped = verifyResendWebhook(req.rawBody, { ...req.headers, 'svix-id': 'msg_other' }, SECRET);
    assert.equal(swapped.ok, false);
  });

  test('missing headers are refused with 400 and nothing is written', async () => {
    const h = harness({ b1: bookingLeaving('b1', IN_TWO_DAYS) }, { em_1: logEntry('confirmation', 'b1') });
    const req = signed(event('email.bounced', bounce('Permanent')));
    const r = await h.deliver({ rawBody: req.rawBody, headers: {} });
    assert.equal(r.status, 400);
    const noSig = await h.deliver({ rawBody: req.rawBody, headers: { 'svix-id': 'msg_1', 'svix-timestamp': req.headers['svix-timestamp']! } });
    assert.equal(noSig.status, 400);
    assert.equal(h.log().status, 'sent');
    assert.equal(h.coll('resendWebhookEvents').size, 0);
    assert.equal(h.alerts.length, 0);
  });

  test('a wrong signature, another secret or a changed body is refused with 401', async () => {
    const h = harness({ b1: bookingLeaving('b1', IN_TWO_DAYS) }, { em_1: logEntry('confirmation', 'b1') });
    const req = signed(event('email.bounced', bounce('Permanent')));

    const tampered = { ...req, rawBody: Buffer.from(req.rawBody.toString().replace('Permanent', 'Transient')) };
    assert.equal((await h.deliver(tampered)).status, 401);

    const other = signed(event('email.bounced', bounce('Permanent')), {
      secret: `whsec_${Buffer.from('some-other-secret-32-bytes-long!').toString('base64')}`,
    });
    assert.equal((await h.deliver(other)).status, 401);

    const garbage = { ...req, headers: { ...req.headers, 'svix-signature': 'v1,bm90IGEgc2lnbmF0dXJl' } };
    assert.equal((await h.deliver(garbage)).status, 401);

    assert.equal(h.log().status, 'sent');
    assert.equal(h.store.get('b1')!.emailBounces, undefined);
    assert.equal(h.alerts.length, 0);
  });

  test('an old (replayed) signature is refused', async () => {
    const h = harness({}, { em_1: logEntry('confirmation', null) });
    const req = signed(event('email.delivered'), { at: new Date(Date.now() - 60 * 60_000) });
    assert.equal((await h.deliver(req)).status, 401);
  });

  test('no secret configured is a 500, not processed', async () => {
    const fake = fakeDb({}, { others: { emailLog: { em_1: logEntry('confirmation', null) } } });
    const r = await handleResendWebhook(signed(event('email.delivered')), {
      db: fake.db,
      secret: '',
      sendAlert: async () => {},
    });
    assert.equal(r.status, 500);
    assert.equal(fake.coll('emailLog').get('em_1')!.status, 'sent');
  });

  test('events it doesn’t handle get a 200 and change nothing', async () => {
    const h = harness({}, { em_1: logEntry('confirmation', null) });
    const r = await h.deliver(signed(event('email.opened')));
    assert.equal(r.status, 200);
    assert.equal(r.body.ignored, 'email.opened');
    assert.equal(h.log().status, 'sent');
    assert.equal(h.coll('resendWebhookEvents').size, 0);
  });
});

describe('events', () => {
  test('email.delivered marks the entry delivered and records the event', async () => {
    const h = harness({ b1: bookingLeaving('b1', TODAY) }, { em_1: logEntry('confirmation', 'b1') });
    const r = await h.deliver(signed(event('email.delivered')));
    assert.equal(r.status, 200);
    const entry = h.log();
    assert.equal(entry.status, 'delivered');
    const events = entry.events as Array<{ type: string; at: { toMillis(): number } }>;
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, 'email.delivered');
    assert.equal(events[0]!.at.toMillis(), Date.parse('2026-10-15T12:59:00.000Z'));
    assert.equal((entry.lastEventAt as { toMillis(): number }).toMillis(), Date.parse('2026-10-15T12:59:00.000Z'));
    assert.equal(h.alerts.length, 0);
    assert.equal(h.store.get('b1')!.emailBounces, undefined);
  });

  test('a permanent bounce is flagged on the booking and alerts Travis right away, even days out', async () => {
    const h = harness({ b1: bookingLeaving('b1', NEXT_WEEK) }, { em_1: logEntry('confirmation', 'b1') });
    await h.deliver(signed(event('email.bounced', bounce('Permanent'))));
    const entry = h.log();
    assert.equal(entry.status, 'bounced');
    assert.equal(entry.bounceType, 'Permanent');
    assert.equal(entry.bounceMessage, 'Mailbox does not exist');
    const ev = (entry.events as Array<{ detail?: string }>)[0]!;
    assert.equal(ev.detail, 'Permanent (General): Mailbox does not exist');

    const b = h.store.get('b1')!;
    const flagged = (b.emailBounces as Record<string, Record<string, unknown>>).confirmation!;
    assert.equal(flagged.emailId, 'em_1');
    assert.equal(flagged.to, 'jane@example.com');
    assert.equal(flagged.bounceType, 'Permanent');
    assert.ok((b.bounceAlertSentAt as Record<string, unknown>).confirmation);
    assert.equal((b.bounceAlertClaims as Record<string, unknown> | undefined)?.confirmation, undefined);

    assert.equal(h.alerts.length, 1);
    assert.equal(h.alerts[0]!.reason, 'permanent');
    assert.equal(h.alerts[0]!.kind, 'confirmation');
    assert.equal(h.alerts[0]!.address, 'jane@example.com');
  });

  test('a temporary bounce alerts only within 48 hours of the trip', async () => {
    for (const [date, alerted] of [
      [TOMORROW, true], // 25.5 h
      [IN_TWO_DAYS, false], // 49.5 h
      [NEXT_WEEK, false],
    ] as const) {
      const h = harness({ b1: bookingLeaving('b1', date) }, { em_1: logEntry('reminder', 'b1') });
      await h.deliver(signed(event('email.bounced', bounce('Transient'))));
      assert.equal(h.alerts.length, alerted ? 1 : 0, `trip on ${date}`);
      assert.equal(h.alerts[0]?.reason, alerted ? 'temporary' : undefined);
      // Flagged either way, so admin shows it.
      assert.ok((h.store.get('b1')!.emailBounces as Record<string, unknown>).reminder, `flagged for ${date}`);
    }
  });

  test('a delay alerts only within 24 hours of the trip, and isn’t flagged as a bounce', async () => {
    for (const [date, alerted] of [
      [TODAY, true], // 1.5 h
      [TOMORROW, false], // 25.5 h
    ] as const) {
      const h = harness({ b1: bookingLeaving('b1', date) }, { em_1: logEntry('reminder', 'b1') });
      await h.deliver(signed(event('email.delivery_delayed')));
      assert.equal(h.log().status, 'delayed');
      assert.equal(h.alerts.length, alerted ? 1 : 0, `trip on ${date}`);
      if (alerted) assert.equal(h.alerts[0]!.reason, 'delayed');
      assert.equal(h.store.get('b1')!.emailBounces, undefined);
    }
  });

  test('a spam complaint suppresses marketing on the booking, with no alert', async () => {
    const h = harness({ b1: bookingLeaving('b1', TODAY) }, { em_1: logEntry('followup', 'b1') });
    await h.deliver(signed(event('email.complained')));
    assert.equal(h.log().status, 'complained');
    assert.equal(h.store.get('b1')!.marketingSuppressed, true);
    assert.equal(h.alerts.length, 0);
    assert.equal(h.store.get('b1')!.emailBounces, undefined);
  });

  test('a past trip’s temporary bounce or delay doesn’t alert', async () => {
    const h = harness({ b1: bookingLeaving('b1', '2026-10-10') }, { em_1: logEntry('followup', 'b1') });
    await h.deliver(signed(event('email.bounced', bounce('Transient'))));
    assert.equal(h.alerts.length, 0);
  });

  test('a bounce of an email to Travis is logged but never alerts', async () => {
    const h = harness(
      { b1: bookingLeaving('b1', TODAY) },
      { em_1: logEntry('admin', 'b1', { to: ['travis@example.com'] }) },
    );
    await h.deliver(signed(event('email.bounced', { ...bounce('Permanent'), to: ['travis@example.com'] })));
    assert.equal(h.log().status, 'bounced');
    assert.equal(h.alerts.length, 0);
    assert.equal(h.store.get('b1')!.emailBounces, undefined);
  });

  test('a bounce for an address the booking no longer has is logged, not flagged', async () => {
    const h = harness(
      { b1: bookingLeaving('b1', TODAY, { customerEmail: 'jane.smith@example.com' }) },
      { em_1: logEntry('confirmation', 'b1') },
    );
    await h.deliver(signed(event('email.bounced', bounce('Permanent'))));
    assert.equal(h.log().status, 'bounced');
    assert.equal(h.store.get('b1')!.emailBounces, undefined);
    assert.equal(h.alerts.length, 0);
  });

  test('an event for an email that was never logged builds the entry from its tags', async () => {
    const h = harness({ b1: bookingLeaving('b1', NEXT_WEEK) }, {});
    await h.deliver(
      signed(event('email.bounced', { ...bounce('Permanent'), tags: { kind: 'closureOffer', bookingId: 'b1' }, created_at: '2026-10-15T12:00:00.000Z' })),
    );
    const entry = h.log();
    assert.equal(entry.kind, 'closureOffer');
    assert.equal(entry.bookingId, 'b1');
    assert.equal(entry.status, 'bounced');
    assert.deepEqual(entry.to, ['jane@example.com']);
    assert.equal((entry.sentAt as { toMillis(): number }).toMillis(), Date.parse('2026-10-15T12:00:00.000Z'));
    assert.equal(h.alerts.length, 1);
    assert.equal(h.alerts[0]!.kind, 'closureOffer');
  });
});

describe('status never moves backwards', () => {
  test('a late delivered after a bounce keeps it bounced, and is still recorded', async () => {
    const h = harness({ b1: bookingLeaving('b1', NEXT_WEEK) }, { em_1: logEntry('confirmation', 'b1') });
    await h.deliver(signed(event('email.bounced', bounce('Permanent'), '2026-10-15T12:59:00.000Z')));
    await h.deliver(signed(event('email.delivered', {}, '2026-10-15T12:58:00.000Z')));
    const entry = h.log();
    assert.equal(entry.status, 'bounced');
    assert.deepEqual((entry.events as Array<{ type: string }>).map((e) => e.type), ['email.bounced', 'email.delivered']);
    // The latest time stays, though the delivered event arrived last.
    assert.equal((entry.lastEventAt as { toMillis(): number }).toMillis(), Date.parse('2026-10-15T12:59:00.000Z'));
  });

  test('a delay after delivery stays delivered', async () => {
    const h = harness({ b1: bookingLeaving('b1', NEXT_WEEK) }, { em_1: logEntry('reminder', 'b1') });
    await h.deliver(signed(event('email.delivered')));
    await h.deliver(signed(event('email.delivery_delayed', {}, '2026-10-15T12:50:00.000Z')));
    assert.equal(h.log().status, 'delivered');
  });

  test('the order of statuses', () => {
    assert.equal(laterStatus('sent', 'delayed'), 'delayed');
    assert.equal(laterStatus('delayed', 'delivered'), 'delivered');
    assert.equal(laterStatus('delivered', 'delayed'), 'delivered');
    assert.equal(laterStatus('bounced', 'delivered'), 'bounced');
    assert.equal(laterStatus('delivered', 'complained'), 'complained');
    assert.equal(laterStatus('complained', 'bounced'), 'complained');
  });

  test('a softer bounce after a hard one keeps the hard bounce as the reason', async () => {
    const h = harness({ b1: bookingLeaving('b1', NEXT_WEEK) }, { em_1: logEntry('confirmation', 'b1') });
    await h.deliver(signed(event('email.bounced', bounce('Permanent'), '2026-10-15T12:59:00.000Z')));
    await h.deliver(signed(event('email.bounced', bounce('Transient'), '2026-10-15T12:59:30.000Z')));
    assert.equal(h.log().bounceType, 'Permanent');
  });
});

describe('one alert per booking per kind', () => {
  test('Svix delivering the same message again does nothing the second time', async () => {
    const h = harness({ b1: bookingLeaving('b1', NEXT_WEEK) }, { em_1: logEntry('confirmation', 'b1') });
    const req = signed(event('email.bounced', bounce('Permanent')), { id: 'msg_retry' });
    assert.equal((await h.deliver(req)).status, 200);
    const again = await h.deliver(req);
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(h.alerts.length, 1);
    assert.equal((h.log().events as unknown[]).length, 1);
    assert.equal(h.coll('resendWebhookEvents').get('msg_retry')!.status, 'done');
  });

  test('the same event under a new delivery id adds no second event and no second alert', async () => {
    const h = harness({ b1: bookingLeaving('b1', NEXT_WEEK) }, { em_1: logEntry('confirmation', 'b1') });
    await h.deliver(signed(event('email.bounced', bounce('Permanent'))));
    await h.deliver(signed(event('email.bounced', bounce('Permanent'))));
    assert.equal(h.alerts.length, 1);
    assert.equal((h.log().events as unknown[]).length, 1);
  });

  test('a second bounce of the same kind (another email) doesn’t alert again; another kind does', async () => {
    const h = harness(
      { b1: bookingLeaving('b1', NEXT_WEEK) },
      { em_1: logEntry('confirmation', 'b1'), em_2: logEntry('confirmation', 'b1'), em_3: logEntry('closureOffer', 'b1') },
    );
    await h.deliver(signed(event('email.bounced', bounce('Permanent'))));
    await h.deliver(signed(event('email.bounced', { ...bounce('Permanent'), email_id: 'em_2' })));
    assert.equal(h.alerts.length, 1);
    // The flag follows the latest bounce of that kind.
    assert.equal((h.store.get('b1')!.emailBounces as Record<string, { emailId: string }>).confirmation!.emailId, 'em_2');
    await h.deliver(signed(event('email.bounced', { ...bounce('Permanent'), email_id: 'em_3' })));
    assert.equal(h.alerts.length, 2);
    assert.equal(h.alerts[1]!.kind, 'closureOffer');
  });

  test('two deliveries racing for the same alert send it once', async () => {
    // The second delivery lands while the first is still sending.
    const fake = fakeDb(
      { b1: bookingLeaving('b1', NEXT_WEEK) },
      { others: { emailLog: { em_1: logEntry('confirmation', 'b1'), em_2: logEntry('confirmation', 'b1') } } },
    );
    let sends = 0;
    let second: Promise<{ status: number }> | null = null;
    const deps = {
      db: fake.db,
      secret: SECRET,
      now: () => NOW,
      async sendAlert() {
        sends++;
        if (!second) {
          second = handleResendWebhook(signed(event('email.bounced', { ...bounce('Permanent'), email_id: 'em_2' })), deps);
          await second;
        }
      },
    };
    const first = await handleResendWebhook(signed(event('email.bounced', bounce('Permanent'))), deps);
    assert.equal(first.status, 200);
    // The second saw the claim and failed, so Svix will retry it later.
    assert.equal((await second!).status, 500);
    assert.equal(sends, 1);
  });

  test('a failed alert lets go of its claim and the delivery, so Svix’s retry sends it', async () => {
    const bookings = { b1: bookingLeaving('b1', NEXT_WEEK) };
    const failing = harness(bookings, { em_1: logEntry('confirmation', 'b1') }, { alertFails: true });
    const req = signed(event('email.bounced', bounce('Permanent')), { id: 'msg_fail' });
    assert.equal((await failing.deliver(req)).status, 500);
    assert.equal(failing.coll('resendWebhookEvents').has('msg_fail'), false);
    const b = failing.store.get('b1')!;
    assert.equal((b.bounceAlertSentAt as Record<string, unknown> | undefined)?.confirmation, undefined);
    assert.equal((b.bounceAlertClaims as Record<string, unknown> | undefined)?.confirmation, undefined);

    // Retry with alerts working: Firestore state carries over.
    const alerts: BounceAlert[] = [];
    const retry = await handleResendWebhook(req, {
      db: failing.db,
      secret: SECRET,
      now: () => NOW,
      sendAlert: async (a) => void alerts.push(a),
    });
    assert.equal(retry.status, 200);
    assert.equal(alerts.length, 1);
    // The event was recorded once, though handled twice.
    assert.equal((failing.log().events as unknown[]).length, 1);
  });
});

describe('alert rules', () => {
  test('permanent always, temporary within 48 h, delayed within 24 h, others never', () => {
    assert.equal(alertReason('email.bounced', 'Permanent', 500), 'permanent');
    assert.equal(alertReason('email.bounced', 'Permanent', null), 'permanent');
    assert.equal(alertReason('email.bounced', 'Transient', 48), 'temporary');
    assert.equal(alertReason('email.bounced', 'Transient', 48.01), null);
    assert.equal(alertReason('email.bounced', 'Undetermined', 3), 'temporary');
    assert.equal(alertReason('email.bounced', 'Temporary', -1), null);
    assert.equal(alertReason('email.delivery_delayed', null, 24), 'delayed');
    assert.equal(alertReason('email.delivery_delayed', null, 24.5), null);
    assert.equal(alertReason('email.complained', null, 1), null);
    assert.equal(alertReason('email.delivered', null, 1), null);
  });
});

describe('the alert email', () => {
  const alert: BounceAlert = {
    reason: 'permanent',
    booking: bookingLeaving('b1', IN_TWO_DAYS) as never,
    kind: 'confirmation',
    emailId: 'em_1',
    address: 'jane@example.com',
    subject: 'You’re booked',
    bounceType: 'Permanent',
    bounceMessage: 'Mailbox does not exist',
  };

  test('names who to call and the trip, with the address, a tel: link and the admin link', () => {
    const { subject, html, text } = buildBounceAlertEmail(alert, 'https://example.com/');
    assert.equal(subject, '[CRMF] Email bounced: call Jane Smith (Sat Oct 17, 10:30 shared)');
    assert.match(text, /booking confirmation/);
    assert.match(text, /Address:\s+jane@example\.com/);
    assert.match(html, /href="tel:\+13525550100"/);
    assert.match(html, /href="https:\/\/example\.com\/admin\/bookings\/b1"/);
    assert.match(text, /https:\/\/example\.com\/admin\/bookings\/b1/);
    assert.match(text, /Permanent: Mailbox does not exist/);
  });

  test('a delay says delayed', () => {
    const { subject } = buildBounceAlertEmail({ ...alert, reason: 'delayed' }, 'https://example.com');
    assert.equal(subject, '[CRMF] Email delayed: call Jane Smith (Sat Oct 17, 10:30 shared)');
  });

  test('goes to Travis only, logged as admin, keyed on the bounced email', async () => {
    const { db, coll } = fakeDb({});
    const { resend, sent } = fakeResend();
    await sendBounceAlert(alert, { db, resend, baseUrl: 'https://example.com', adminEmail: 'travis@example.com' });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.payload.to, ['travis@example.com']);
    assert.equal(sent[0]!.payload.bcc, undefined);
    assert.equal(sent[0]!.options?.idempotencyKey, 'bounce-alert/b1/confirmation/em_1');
    assert.equal(coll('emailLog').get('em_1')!.kind, 'admin');
  });

  test('the alert bouncing too sets off nothing more', async () => {
    const h = harness({ b1: bookingLeaving('b1', TODAY) }, {});
    // The alert's own log entry, as sendBounceAlert writes it.
    const { resend } = fakeResend();
    await sendBounceAlert(alert, { db: h.db, resend, baseUrl: 'https://example.com', adminEmail: 'travis@example.com' });
    await h.deliver(signed(event('email.bounced', { ...bounce('Permanent'), to: ['travis@example.com'] })));
    assert.equal(h.log().status, 'bounced');
    assert.equal(h.alerts.length, 0);
  });
});
