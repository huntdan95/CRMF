/**
 * The crew calendar feed's iCalendar output (src/lib/crew-calendar/), which
 * the Next app serves at /api/crew-calendar/[token]. Pure functions, plus
 * one generated feed read back with ical.js. Run with `npm test` in
 * functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';

import { escapeText, foldLine, localDateTime, serializeLines } from '../../src/lib/crew-calendar/ics';
import {
  BOOKING_FIELDS,
  CREW_APP_URL,
  FEED_CANCELLED_BY,
  FEED_STATUSES,
  buildFeed,
  feedWindow,
  nextRecord,
  planDepartures,
  removedRecord,
  renderEvent,
  toFeedBlackout,
  toFeedBooking,
  type DepartureRecord,
  type FeedBlackout,
  type FeedBooking,
} from '../../src/lib/crew-calendar/feed';
import { calledOffDepartures, type ClosedDays, type ClosureRow } from '../../src/lib/departure-off';

// 9:00 AM at the marina (EST) on Sunday, November 8, 2026.
const NOW_MS = Date.UTC(2026, 10, 8, 14);
const WINDOW = feedWindow('2026-11-08');

function booking(over: Partial<FeedBooking> & Pick<FeedBooking, 'id'>): FeedBooking {
  return {
    date: '2026-11-10',
    timeSlot: 'morning',
    type: 'shared',
    guestCount: 2,
    status: 'confirmed',
    legacy: false,
    closure: null,
    cancelledBy: null,
    cancelledAtMs: null,
    checkoutOnly: false,
    ...over,
  };
}

function blackout(over: Partial<FeedBlackout> & Pick<FeedBlackout, 'id'>): FeedBlackout {
  return { date: '2026-11-10', affectedSlots: ['all'], reason: 'weather', createdAtMs: NOW_MS - 3600_000, closing: false, ...over };
}

function plan(bookings: FeedBooking[], blackouts: FeedBlackout[] = [], records = new Map<string, DepartureRecord>()) {
  return planDepartures({ bookings, blackouts, records, ...WINDOW });
}

/** The feed as a fresh server would build it: every event at SEQUENCE 0. */
function feedOf(bookings: FeedBooking[], blackouts: FeedBlackout[] = []) {
  const events = plan(bookings, blackouts).map((p) => renderEvent(p));
  return buildFeed(events.map((event) => ({ event, record: nextRecord(undefined, event, NOW_MS)! })));
}

/** Content lines with folding undone. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
}

function prop(ics: string, name: string): string[] {
  return unfold(ics)
    .filter((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`))
    .map((l) => l.slice(l.indexOf(':') + 1));
}

describe('iCalendar text', () => {
  test('escapes backslashes, semicolons, commas and newlines', () => {
    assert.equal(escapeText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
    assert.equal(escapeText('one\r\ntwo\rthree'), 'one\\ntwo\\nthree');
    // Control characters TEXT doesn't allow are dropped; tabs stay.
    assert.equal(escapeText('x\u0000y\u0007z\tw'), 'xyz\tw');
    // A colon needs no escape in a TEXT value.
    assert.equal(escapeText('Note: 8:00'), 'Note: 8:00');
  });

  test('folds at 75 octets with a leading space, never inside a character', () => {
    const ascii = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldLine(ascii);
    const parts = folded.split('\r\n');
    assert.ok(parts.length > 1);
    for (const [i, part] of parts.entries()) {
      assert.ok(Buffer.byteLength(part) <= 75, `line ${i} is ${Buffer.byteLength(part)} octets`);
      if (i > 0) assert.equal(part[0], ' ');
    }
    assert.equal(folded.replace(/\r\n /g, ''), ascii);

    // 2-, 3- and 4-byte characters where a naive 75-byte cut would split them.
    const wide = `SUMMARY:${'é'.repeat(40)}${'·'.repeat(30)}${'🐋'.repeat(20)}`;
    const wideParts = foldLine(wide).split('\r\n');
    for (const part of wideParts) {
      assert.ok(Buffer.byteLength(part) <= 75);
      // Decoding each physical line on its own must not produce U+FFFD.
      assert.ok(!Buffer.from(part, 'utf8').toString('utf8').includes('�'));
      assert.equal(Buffer.from(Buffer.from(part, 'utf8').toString('utf8'), 'utf8').length, Buffer.byteLength(part));
    }
    assert.equal(foldLine(wide).replace(/\r\n /g, ''), wide);

    // Exactly 75 octets stays on one line.
    assert.equal(foldLine('X'.repeat(75)), 'X'.repeat(75));
    assert.equal(foldLine('X'.repeat(76)).split('\r\n').length, 2);
  });

  test('ends every line, the last too, with CRLF and nothing else', () => {
    const out = serializeLines(['BEGIN:VCALENDAR', 'END:VCALENDAR']);
    assert.equal(out, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  });

  test('local times roll past midnight', () => {
    assert.equal(localDateTime('2026-11-10', '08:00'), '20261110T080000');
    assert.equal(localDateTime('2026-11-10', '07:00', 480), '20261110T150000');
    assert.equal(localDateTime('2026-12-31', '23:30', 60), '20270101T003000');
  });
});

describe('planDepartures', () => {
  test('one departure per date and slot, shared bookings added up', () => {
    const plans = plan([
      booking({ id: 'a', guestCount: 2 }),
      booking({ id: 'b', guestCount: 4 }),
      booking({ id: 'c', timeSlot: 'mid-morning', guestCount: 3 }),
      // Not going out: a checkout in progress, a customer cancellation, a no-show.
      booking({ id: 'd', status: 'pending-payment', checkoutOnly: true }),
      booking({ id: 'e', timeSlot: 'late-afternoon', status: 'cancelled', cancelledBy: 'customer', cancelledAtMs: NOW_MS }),
      booking({ id: 'f', timeSlot: 'early-afternoon', status: 'no-show' }),
    ]);
    assert.deepEqual(
      plans.map((p) => [p.id, p.status, p.guests, p.bookings]),
      [
        ['2026-11-10_morning', 'on', 6, 2],
        ['2026-11-10_mid-morning', 'on', 3, 1],
      ],
    );
  });

  test('old-site deposits count, as in the crew app; unknown party sizes are flagged', () => {
    const [p] = plan([
      booking({ id: 'legacy-1', status: 'pending-payment', legacy: true, guestCount: 0 }),
      booking({ id: 'b', guestCount: 3 }),
    ]);
    assert.equal(p!.guests, 3);
    assert.equal(p!.unknownPartyBookings, 1);
    assert.equal(renderEventTitle(p!), '8:00 shared · 3+ guests');
    assert.match(description(p!), /^3\+ guests on 2 bookings\.\nParty size not on file for 1 booking from the old website\./);

    // None on file at all: no "0 guests".
    const [unknown] = plan([booking({ id: 'legacy-1', status: 'pending-payment', legacy: true, guestCount: 0 })]);
    assert.equal(renderEventTitle(unknown!), '8:00 shared · party size unknown');
    assert.match(description(unknown!), /^1 booking\.\nParty size not on file for 1 booking from the old website\./);
  });

  test('only the last 14 days and the next 120', () => {
    assert.deepEqual(WINDOW, { from: '2026-10-25', to: '2027-03-08' });
    const plans = plan([
      booking({ id: 'old', date: '2026-10-24', status: 'completed' }),
      booking({ id: 'first', date: '2026-10-25', status: 'completed' }),
      booking({ id: 'last', date: '2027-03-08' }),
      booking({ id: 'far', date: '2027-03-09' }),
    ]);
    assert.deepEqual(plans.map((p) => p.date), ['2026-10-25', '2027-03-08']);
  });

  test('a departure closed with "pick a new date" shows as cancelled, with the blackout’s reason', () => {
    const [p] = plan(
      [booking({ id: 'a', closure: { blackoutId: 'bo1', reason: 'Closed for weather' } })],
      [blackout({ id: 'bo1', reason: 'weather' })],
    );
    assert.equal(p!.status, 'cancelled');
    assert.equal(p!.reason, 'weather');
    assert.equal(renderEventTitle(p!), 'CANCELLED (weather): 8:00 shared');
  });

  test('stays cancelled after the closed bookings are refunded, or after the blackout is deleted', () => {
    const settled = booking({
      id: 'a',
      status: 'cancelled',
      cancelledBy: 'admin',
      cancelledAtMs: NOW_MS,
      closure: { blackoutId: 'gone', reason: 'Closed for boat maintenance' },
    });
    const [p] = plan([settled]);
    assert.equal(p!.status, 'cancelled');
    assert.equal(renderEventTitle(p!), 'CANCELLED (boat maintenance): 8:00 shared');
  });

  test('bookings Travis cancelled by closing the day show as cancelled; customer cancellations don’t', () => {
    const closed = blackout({ id: 'bo1', affectedSlots: ['morning'], reason: 'weather', createdAtMs: NOW_MS - 1000 });
    const byClose = booking({ id: 'a', status: 'cancelled', cancelledBy: 'admin', cancelledAtMs: NOW_MS });
    assert.equal(plan([byClose], [closed])[0]!.status, 'cancelled');

    // Cancelled by Travis before the day was closed: not a weather cancel.
    const earlier = booking({ id: 'b', status: 'cancelled', cancelledBy: 'admin', cancelledAtMs: NOW_MS - 5000 });
    assert.deepEqual(plan([earlier], [closed]), []);
    // The customer cancelled.
    const own = booking({ id: 'c', status: 'cancelled', cancelledBy: 'customer', cancelledAtMs: NOW_MS });
    assert.deepEqual(plan([own], [closed]), []);
    // An unpaid checkout swept up by the close: nobody was going.
    const unpaid = booking({ id: 'd', status: 'cancelled', cancelledBy: 'admin', cancelledAtMs: NOW_MS, checkoutOnly: true });
    assert.deepEqual(plan([unpaid], [closed]), []);
  });

  test('closing a morning slot cancels the whole-day charter too', () => {
    const [p] = plan(
      [booking({ id: 'a', timeSlot: 'whole-day', type: 'private', guestCount: 5, closure: { blackoutId: 'bo1', reason: 'Closed for weather' } })],
      [blackout({ id: 'bo1', affectedSlots: ['mid-morning'] })],
    );
    assert.equal(renderEventTitle(p!), 'CANCELLED (weather): 7:00 whole-day charter');
  });

  test('a departure already in calendars that is now closed stays as cancelled once everyone has moved', () => {
    const records = new Map<string, DepartureRecord>([
      ['2026-11-10_morning', record({ status: 'on' })],
    ]);
    const [p] = plan([], [blackout({ id: 'bo1' })], records);
    assert.equal(p!.status, 'cancelled');
    // Without the closure it simply drops off.
    assert.deepEqual(plan([], [], records), []);
  });

  test('what the route doesn’t read changes nothing: no-shows, and checkouts the site let go', () => {
    const closed = blackout({ id: 'bo1', affectedSlots: ['morning', 'mid-morning', 'early-afternoon'], createdAtMs: NOW_MS - 1000 });
    // An expired checkout: `cancelledBy: 'system'`, which toFeedBooking reads as null.
    const expired = (over: Partial<FeedBooking> & Pick<FeedBooking, 'id'>) =>
      booking({ status: 'cancelled', cancelledBy: null, cancelledAtMs: NOW_MS, checkoutOnly: true, ...over });
    const all = [
      booking({ id: 'a' }),
      booking({ id: 'b', status: 'no-show' }),
      expired({ id: 'c' }),
      booking({ id: 'd', timeSlot: 'mid-morning', status: 'cancelled', cancelledBy: 'admin', cancelledAtMs: NOW_MS }),
      expired({ id: 'e', timeSlot: 'mid-morning' }),
      booking({ id: 'f', timeSlot: 'early-afternoon', status: 'no-show' }),
      expired({ id: 'g', timeSlot: 'late-afternoon' }),
      booking({
        id: 'h',
        date: '2026-11-11',
        status: 'cancelled',
        cancelledBy: 'customer',
        cancelledAtMs: NOW_MS,
        closure: { blackoutId: 'gone', reason: 'Closed for weather' },
      }),
      expired({ id: 'i', date: '2026-11-11', timeSlot: 'mid-morning' }),
    ];
    // The route's two queries (src/lib/crew-calendar/server.ts).
    const read = all.filter(
      (b) =>
        (FEED_STATUSES as readonly string[]).includes(b.status) ||
        (b.status === 'cancelled' && (FEED_CANCELLED_BY as readonly string[]).includes(b.cancelledBy ?? '')),
    );
    assert.deepEqual(read.map((b) => b.id), ['a', 'd', 'h']);
    const records = new Map([['2026-11-10_early-afternoon', record({ timeSlot: 'early-afternoon' })]]);
    const plans = plan(all, [closed], records);
    assert.deepEqual(plan(read, [closed], records), plans);
    assert.deepEqual(
      plans.map((p) => [p.id, p.status]),
      [
        ['2026-11-10_morning', 'on'],
        ['2026-11-10_mid-morning', 'cancelled'],
        ['2026-11-10_early-afternoon', 'cancelled'],
        ['2026-11-11_morning', 'cancelled'],
      ],
    );
  });

  test('a departure Travis closed and left them booked on says so, as the 8 PM schedule does', () => {
    const [p] = plan([booking({ id: 'a' })], [blackout({ id: 'bo1' })]);
    assert.equal(p!.status, 'on');
    assert.equal(p!.off, 'closed');
    assert.equal(renderEventTitle(p!), 'CLOSED (weather): 8:00 shared · 2 guests');
    assert.match(
      renderEvent(p!).lines.find((l) => l.startsWith('DESCRIPTION:'))!,
      /^DESCRIPTION:Closed to new bookings\. Travis is contacting the guests\\, so check with him\.\\n2 guests on 1 booking\./,
    );
  });

  test('while Travis is closing it (undo window open), it’s being called off', () => {
    const [p] = plan([booking({ id: 'a' })], [blackout({ id: 'bo1', closing: true })]);
    assert.equal(p!.off, 'closing');
    assert.equal(renderEventTitle(p!), 'BEING CALLED OFF (weather): 8:00 shared · 2 guests');
    assert.match(renderEvent(p!).lines.find((l) => l.startsWith('DESCRIPTION:'))!, /Travis is calling this off\./);
  });

  test('not once he’s marked it completed: then it ran', () => {
    const [p] = plan([booking({ id: 'a', status: 'completed' })], [blackout({ id: 'bo1' })]);
    assert.equal(p!.off, null);
    assert.equal(renderEventTitle(p!), '8:00 shared · 2 guests');
  });
});

function renderEventTitle(p: Parameters<typeof renderEvent>[0]): string {
  const summary = renderEvent(p).lines.find((l) => l.startsWith('SUMMARY:'))!;
  return summary.slice('SUMMARY:'.length).replace(/\\,/g, ',');
}

/** The event's DESCRIPTION, unescaped. */
function description(p: Parameters<typeof renderEvent>[0]): string {
  const line = renderEvent(p).lines.find((l) => l.startsWith('DESCRIPTION:'))!;
  return line.slice('DESCRIPTION:'.length).replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
}

function record(over: Partial<DepartureRecord> = {}): DepartureRecord {
  return {
    date: '2026-11-10',
    timeSlot: 'morning',
    type: 'shared',
    status: 'on',
    fingerprint: 'old',
    sequence: 0,
    createdAtMs: NOW_MS - 86400_000,
    updatedAtMs: NOW_MS - 86400_000,
    ...over,
  };
}

/**
 * The crew app lists what the calendar does for a departure Travis closed
 * and left booked (calledOffDepartures in src/lib/departure-off.ts, which
 * the crew app and the dashboard use).
 */
describe('a trip left booked, then emptied: the crew app agrees with the calendar', () => {
  const jane = { id: 'jane', customerName: 'Jane', timeSlot: 'morning' as const, guests: 4 };
  const keep = (over: Partial<ClosureRow> = {}): ClosureRow => ({
    id: 'bo1',
    date: '2026-11-10',
    state: 'done',
    choice: 'keep',
    reason: 'weather',
    result: { cancelled: [], offered: [], kept: [jane], failed: [] },
    ...over,
  });
  const closedDays = (actions: ClosureRow[], blackouts: ClosedDays['blackouts'] = [{ id: 'bo1', date: '2026-11-10', affectedSlots: ['morning'], reason: 'weather' }]): ClosedDays => ({
    blackouts,
    actions: new Map(actions.map((a) => [a.id, a])),
  });
  const cancelledJane = booking({ id: 'jane', guestCount: 4, status: 'cancelled', cancelledBy: 'admin', cancelledAtMs: NOW_MS });

  test('he cancels everyone it left on it: both say it’s cancelled', () => {
    const [p] = plan([cancelledJane], [blackout({ id: 'bo1', affectedSlots: ['morning'] })]);
    assert.equal(renderEventTitle(p!), 'CANCELLED (weather): 8:00 shared');
    assert.deepEqual(calledOffDepartures(closedDays([keep()]), '2026-11-08', []), [
      { date: '2026-11-10', timeSlot: 'morning', guests: 4, bookings: 1, unknownParty: 0, reason: 'weather' },
    ]);
  });

  test('closed from MCP, the "Closed" alert on the blackout says whom it left booked', () => {
    const mcp = [{ id: 'mcp1', date: '2026-11-10', affectedSlots: ['all'], reason: 'weather', crewAlert: { kept: [{ id: 'legacy-7', timeSlot: 'morning' as const, guests: 0 }] } }];
    assert.deepEqual(calledOffDepartures(closedDays([], mcp), '2026-11-08', []), [
      { date: '2026-11-10', timeSlot: 'morning', guests: 0, bookings: 1, unknownParty: 1, reason: 'weather' },
    ]);
    // One closed from MCP before it recorded that, or that told the crew nothing: nothing to list.
    assert.deepEqual(calledOffDepartures(closedDays([], [{ ...mcp[0]!, crewAlert: undefined }]), '2026-11-08', []), []);
    // Left booked in admin, then closed again from MCP, each naming Jane: she counts once.
    const twice = closedDays([keep()], [
      { id: 'bo1', date: '2026-11-10', affectedSlots: ['morning'], reason: 'weather' },
      { ...mcp[0]!, crewAlert: { kept: [jane] } },
    ]);
    assert.deepEqual(calledOffDepartures(twice, '2026-11-08', []).map((d) => [d.guests, d.bookings]), [[4, 1]]);
    // Moved to the 1:00 instead, and called off there by another closing: on both.
    const onJane = { ...jane, timeSlot: 'early-afternoon' as const, refundCents: 0, manualRefundCents: 0, emailed: true };
    const moved = closedDays(
      [keep(), keep({ id: 'bo2', choice: 'cancel', result: { cancelled: [onJane], offered: [], failed: [] } })],
      [
        { id: 'bo1', date: '2026-11-10', affectedSlots: ['morning'], reason: 'weather' },
        { id: 'bo2', date: '2026-11-10', affectedSlots: ['early-afternoon'], reason: 'weather' },
      ],
    );
    assert.deepEqual(calledOffDepartures(moved, '2026-11-08', []).map((d) => d.timeSlot), ['morning', 'early-afternoon']);
  });

  test('not once it went out after all (marked), nor once the day is reopened, nor while it may still go', () => {
    const [p] = plan([booking({ id: 'jane', guestCount: 4, status: 'completed' })], [blackout({ id: 'bo1', affectedSlots: ['morning'] })]);
    assert.equal(renderEventTitle(p!), '8:00 shared · 4 guests');
    for (const status of ['completed', 'no-show']) {
      assert.deepEqual(calledOffDepartures(closedDays([keep()]), '2026-11-08', [{ date: '2026-11-10', timeSlot: 'morning', status }]), []);
    }
    assert.deepEqual(calledOffDepartures(closedDays([keep()], []), '2026-11-08', []), []);
    assert.deepEqual(calledOffDepartures(closedDays([keep({ state: 'pending', result: undefined })]), '2026-11-08', []), []);
  });
});

describe('event titles', () => {
  const one = (b: Partial<FeedBooking>) => renderEventTitle(plan([booking({ id: 'x', ...b })])[0]!);
  test('shared, private and the whole-day charter', () => {
    assert.equal(one({ guestCount: 6 }), '8:00 shared · 6 guests');
    assert.equal(one({ guestCount: 1, timeSlot: 'early-afternoon' }), '1:00 shared · 1 guest');
    assert.equal(one({ type: 'private', timeSlot: 'late-afternoon', guestCount: 4 }), '3:30 private · 4 guests');
    assert.equal(one({ type: 'private', timeSlot: 'whole-day', guestCount: 5 }), '7:00 whole-day charter · 5 guests');
  });
});

describe('trips Travis runs solo', () => {
  const solo = (bookings: FeedBooking[]) =>
    planDepartures({ bookings, blackouts: [], records: new Map(), soloTrips: new Set(['2026-11-10_morning']), ...WINDOW });

  test('say no crew is needed, with no reminder, and don’t block the crew’s time', () => {
    const plans = solo([booking({ id: 'a', guestCount: 2 }), booking({ id: 'b', timeSlot: 'mid-morning', guestCount: 3 })]);
    assert.deepEqual(
      plans.map((p) => [p.id, p.status, p.noCrew]),
      [
        ['2026-11-10_morning', 'on', true],
        ['2026-11-10_mid-morning', 'on', false],
      ],
    );
    assert.equal(renderEventTitle(plans[0]!), 'No crew needed: 8:00 shared · 2 guests');
    const [alone, crewed] = plans.map((p) => renderEvent(p).lines);
    assert.ok(alone!.includes('STATUS:CONFIRMED'));
    assert.ok(alone!.includes('TRANSP:TRANSPARENT'));
    assert.ok(!alone!.includes('BEGIN:VALARM'));
    assert.match(
      alone!.find((l) => l.startsWith('DESCRIPTION:'))!,
      /^DESCRIPTION:No crew needed: Travis is running it solo\.\\n2 guests on 1 booking\./,
    );
    assert.ok(crewed!.includes('TRANSP:OPAQUE'));
    assert.ok(crewed!.includes('BEGIN:VALARM'));
  });

  test('switching the crew off changes the event, so SEQUENCE goes up', () => {
    const bookings = [booking({ id: 'a' })];
    const crewed = renderEvent(plan(bookings)[0]!);
    const alone = renderEvent(solo(bookings)[0]!);
    assert.notEqual(alone.fingerprint, crewed.fingerprint);
    const first = nextRecord(undefined, crewed, NOW_MS)!;
    assert.equal(nextRecord(first, alone, NOW_MS + 1)!.sequence, 1);
  });
});

describe('buildFeed', () => {
  const bookings = [
    booking({ id: 'a', guestCount: 2 }),
    booking({ id: 'b', guestCount: 4 }),
    booking({ id: 'c', date: '2026-11-12', timeSlot: 'whole-day', type: 'private', guestCount: 5 }),
    booking({ id: 'd', date: '2026-11-14', closure: { blackoutId: 'bo1', reason: 'Closed for weather' } }),
  ];
  const blackouts = [blackout({ id: 'bo1', date: '2026-11-14' })];
  const ics = feedOf(bookings, blackouts);

  test('CRLF line endings, folded at 75 octets', () => {
    assert.ok(ics.endsWith('\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'a bare LF');
    assert.ok(!/\r(?!\n)/.test(ics), 'a bare CR');
    for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  });

  test('calendar name, refresh hints and a New York VTIMEZONE', () => {
    const lines = unfold(ics);
    assert.ok(lines.includes('X-WR-CALNAME:Manatee Fun trips'));
    assert.ok(lines.includes('REFRESH-INTERVAL;VALUE=DURATION:PT1H'));
    assert.ok(lines.includes('X-PUBLISHED-TTL:PT1H'));
    const tz = ics.slice(ics.indexOf('BEGIN:VTIMEZONE'), ics.indexOf('END:VTIMEZONE'));
    assert.match(tz, /TZID:America\/New_York/);
    assert.match(tz, /BEGIN:DAYLIGHT[\s\S]*TZOFFSETTO:-0400[\s\S]*BYMONTH=3;BYDAY=2SU/);
    assert.match(tz, /BEGIN:STANDARD[\s\S]*TZOFFSETTO:-0500[\s\S]*BYMONTH=11;BYDAY=1SU/);
    // The VTIMEZONE comes before any event that uses it.
    assert.ok(ics.indexOf('END:VTIMEZONE') < ics.indexOf('BEGIN:VEVENT'));
  });

  test('stable UIDs, start and end in marina time from the tour’s duration', () => {
    assert.deepEqual(prop(ics, 'UID'), [
      '2026-11-10_morning@crystalrivermanateefun.com',
      '2026-11-12_whole-day@crystalrivermanateefun.com',
      '2026-11-14_morning@crystalrivermanateefun.com',
    ]);
    assert.deepEqual(unfold(ics).filter((l) => l.startsWith('DTSTART;')), [
      'DTSTART;TZID=America/New_York:20261110T080000',
      'DTSTART;TZID=America/New_York:20261112T070000',
      'DTSTART;TZID=America/New_York:20261114T080000',
    ]);
    assert.deepEqual(unfold(ics).filter((l) => l.startsWith('DTEND;')), [
      'DTEND;TZID=America/New_York:20261110T100000',
      'DTEND;TZID=America/New_York:20261112T150000',
      'DTEND;TZID=America/New_York:20261114T100000',
    ]);
  });

  test('marina location, crew-app link and a 60-minute reminder; none for a cancelled trip', () => {
    for (const loc of prop(ics, 'LOCATION')) {
      assert.equal(loc, "Pete's Pier Marina\\, 1 SW First Place\\, Crystal River\\, FL 34429");
    }
    // Event descriptions; the alarms' DESCRIPTION is the title.
    const descriptions = prop(ics, 'DESCRIPTION').filter((d) => d.includes('crew app'));
    assert.equal(descriptions.length, 3);
    assert.ok(descriptions.every((d) => d.includes(CREW_APP_URL)));
    assert.match(descriptions[0]!, /^6 guests on 2 bookings\./);
    assert.equal(prop(ics, 'TRIGGER').length, 2);
    assert.ok(prop(ics, 'TRIGGER').every((t) => t === '-PT60M'));
  });

  test('a cancelled departure has STATUS:CANCELLED and the reason in the title', () => {
    const events = ics.split('BEGIN:VEVENT').slice(1);
    const cancelled = events.find((e) => e.includes('2026-11-14_morning'))!;
    assert.match(cancelled, /STATUS:CANCELLED\r\n/);
    assert.match(cancelled, /SUMMARY:CANCELLED \(weather\): 8:00 shared\r\n/);
    assert.match(cancelled, /TRANSP:TRANSPARENT/);
    assert.doesNotMatch(cancelled, /BEGIN:VALARM/);
    assert.equal(events.filter((e) => /STATUS:CONFIRMED/.test(e)).length, 2);
  });

  test('no guest names, phones or emails, even from a full booking doc', () => {
    // A booking as Firestore has it, with every kind of personal detail.
    const doc = {
      tourId: 'morning-shared',
      tourName: '2hr Morning Tour — Shared',
      date: '2026-11-10',
      timeSlot: 'morning',
      type: 'shared',
      guestCount: 3,
      customerName: 'Zelda Quixote',
      customerEmail: 'zelda@example.com',
      customerPhone: '352-555-0199',
      emergencyContactName: 'Yorick Quixote',
      emergencyContactPhone: '352-555-0142',
      guests: [{ name: 'Zelda Quixote', age: 41 }, { name: 'Xander Quixote', age: 9 }],
      status: 'confirmed',
      paymentStatus: 'paid',
      accessToken: '6f1c7a52-0000-4000-8000-000000000000',
      adminNotes: 'Call Zelda at 352-555-0199 about the wetsuit for Xander',
      legacy: { bookingId: 42, billing: { city: 'Ocala' } },
    };
    const out = feedOf([toFeedBooking('legacy-42', doc)]);
    for (const secret of ['Zelda', 'Xander', 'Yorick', 'Quixote', 'example.com', '555', '6f1c7a52', 'Ocala', '@example', 'wetsuit for']) {
      assert.ok(!out.includes(secret), `feed contains ${secret}`);
    }
    // And the route only asks Firestore for these fields.
    for (const field of BOOKING_FIELDS) {
      assert.doesNotMatch(field, /name|email|phone|guests|notes|token|billing/i);
    }
    assert.ok(!/@(?!crystalrivermanateefun\.com)/.test(out), 'an email address');
  });

  test('blackout docs map across, junk reasons dropped', () => {
    const b = toFeedBlackout('bo', { date: '2026-11-10', affectedSlots: ['morning'], reason: 'hurricane', createdAt: { toMillis: () => 5 } });
    assert.deepEqual(b, { id: 'bo', date: '2026-11-10', affectedSlots: ['morning'], reason: null, createdAtMs: 5, closing: false });
    assert.equal(toFeedBlackout('bo', { date: '2026-11-10' }, true).closing, true);
  });

  test('a real parser reads it: ical.js, with the right UTC instants across the DST change', () => {
    const feed = feedOf([
      booking({ id: 'edt', date: '2026-10-30', status: 'completed', guestCount: 3 }),
      ...bookings,
    ], blackouts);
    const cal = new ICAL.Component(ICAL.parse(feed));
    assert.equal(cal.getFirstPropertyValue('x-wr-calname'), 'Manatee Fun trips');
    assert.equal(String(cal.getFirstPropertyValue('refresh-interval')), 'PT1H');
    for (const tz of cal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
    const events = cal.getAllSubcomponents('vevent').map((c) => new ICAL.Event(c));
    assert.equal(events.length, 4);
    const [edt, morning, charter, cancelled] = events;
    // Oct 30 is EDT (UTC-4); Nov 10 is EST (UTC-5).
    assert.equal(edt!.startDate.toJSDate().toISOString(), '2026-10-30T12:00:00.000Z');
    assert.equal(morning!.startDate.toJSDate().toISOString(), '2026-11-10T13:00:00.000Z');
    assert.equal(morning!.endDate.toJSDate().toISOString(), '2026-11-10T15:00:00.000Z');
    assert.equal(morning!.summary, '8:00 shared · 6 guests');
    assert.equal(morning!.location, "Pete's Pier Marina, 1 SW First Place, Crystal River, FL 34429");
    assert.match(morning!.description, /^6 guests on 2 bookings\.\n/);
    assert.equal(charter!.duration.toSeconds(), 8 * 3600);
    assert.equal(cancelled!.summary, 'CANCELLED (weather): 8:00 shared');
    assert.equal(cancelled!.component.getFirstPropertyValue('status'), 'CANCELLED');
    assert.equal(morning!.sequence, 0);
    const alarm = morning!.component.getFirstSubcomponent('valarm')!;
    const trigger = alarm.getFirstPropertyValue('trigger') as ICAL.Duration;
    assert.equal(trigger.toSeconds(), -3600);
  });
});

describe('SEQUENCE', () => {
  const [base] = plan([booking({ id: 'a', guestCount: 2 })]);
  const event = renderEvent(base!);

  test('starts at 0 and stays put while nothing changes', () => {
    const first = nextRecord(undefined, event, NOW_MS)!;
    assert.equal(first.sequence, 0);
    assert.equal(first.createdAtMs, NOW_MS);
    // Fetched again later: same content, no write, same DTSTAMP.
    assert.equal(nextRecord(first, renderEvent(base!), NOW_MS + 60_000), null);
  });

  test('goes up when the event changes, and stamps LAST-MODIFIED', () => {
    const first = nextRecord(undefined, event, NOW_MS)!;
    const [more] = plan([booking({ id: 'a', guestCount: 2 }), booking({ id: 'b', guestCount: 3 })]);
    const changed = renderEvent(more!);
    assert.notEqual(changed.fingerprint, event.fingerprint);
    const later = NOW_MS + 3600_000;
    const second = nextRecord(first, changed, later)!;
    assert.equal(second.sequence, 1);
    assert.equal(second.createdAtMs, NOW_MS);
    assert.equal(second.updatedAtMs, later);

    const out = buildFeed([{ event: changed, record: second }]);
    assert.deepEqual(prop(out, 'SEQUENCE'), ['1']);
    assert.deepEqual(prop(out, 'LAST-MODIFIED'), ['20261108T150000Z']);
    assert.deepEqual(prop(out, 'DTSTAMP'), ['20261108T150000Z']);
    assert.deepEqual(prop(out, 'CREATED'), ['20261108T140000Z']);

    // Then cancelled: up again.
    const [closed] = plan(
      [booking({ id: 'a', closure: { blackoutId: 'bo1', reason: 'Closed for weather' } })],
      [blackout({ id: 'bo1' })],
    );
    const third = nextRecord(second, renderEvent(closed!), later + 1)!;
    assert.equal(third.sequence, 2);
    assert.equal(third.status, 'cancelled');
  });

  test('a departure that drops out is marked removed, and comes back with a higher SEQUENCE', () => {
    const first = nextRecord(undefined, event, NOW_MS)!;
    const gone = removedRecord(first, NOW_MS + 1)!;
    assert.equal(gone.status, 'removed');
    assert.equal(gone.sequence, 1);
    assert.equal(removedRecord(gone, NOW_MS + 2), null);
    const back = nextRecord(gone, event, NOW_MS + 3)!;
    assert.equal(back.sequence, 2);
  });

  test('the link host doesn’t change the fingerprint', () => {
    const staging = renderEvent(base!, { appUrl: 'https://crmf--crmf-99aad.us-central1.hosted.app/crew' });
    assert.equal(staging.fingerprint, event.fingerprint);
    assert.ok(staging.lines.some((l) => l.includes('hosted.app/crew')));
    assert.ok(!event.lines.some((l) => l.includes('hosted.app')));
  });
});

