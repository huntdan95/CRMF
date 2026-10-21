/**
 * The cancel dialog's refund preview (src/lib/refund-policy.ts) against the
 * refund cancelBooking actually gives (quoteCustomerRefund in
 * functions/src/lib/datetime.ts). Run with `npm test`.
 *
 * The customer's browser can be in any time zone, so each case runs under
 * several: the departure is 8:00 at the marina, not 8:00 wherever they are.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { inRefundGrace, previewRefund } from '../src/lib/refund-policy';
import { slotStartTime } from '../src/lib/schedule';
import { quoteCustomerRefund, zonedTimeToUtc as serverZonedTimeToUtc } from '../functions/src/lib/datetime';

const ZONES = ['America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'UTC', 'Asia/Tokyo'];
const startingTz = process.env.TZ;

/** Node picks up a change to TZ straight away, so `new Date(y, m, d)` moves with it. */
function inEachZone(fn: (zone: string) => void) {
  for (const zone of ZONES) {
    process.env.TZ = zone;
    fn(zone);
  }
}

afterEach(() => {
  if (startingTz === undefined) delete process.env.TZ;
  else process.env.TZ = startingTz;
});

const hoursBefore = (date: string, start: string, h: number) =>
  new Date(serverZonedTimeToUtc(date, start).getTime() - h * 3600_000);

function both(date: string, startTime: string, now: Date, amountRefundedCents = 0) {
  const opts = { amountPaidCents: 60000, amountRefundedCents, date, startTime, now };
  return { preview: previewRefund(opts), server: quoteCustomerRefund(opts) };
}

describe('previewRefund', () => {
  test('70.5 hours before an 8:00 tour is no refund, from California or Hawaii too', () => {
    const now = hoursBefore('2026-07-04', '08:00', 70.5);
    inEachZone((zone) => {
      const { preview, server } = both('2026-07-04', '08:00', now);
      assert.equal(server.refundCents, 0);
      assert.equal(preview.refundCents, 0, zone);
      assert.equal(preview.tier, 'none', zone);
      assert.equal(preview.hoursUntilTour, 70.5, zone);
    });
  });

  test('exactly 72 hours before is a full refund, in every zone', () => {
    // 8:00 EDT on May 22 is 12:00 UTC; 72 hours earlier is 12:00 UTC on May 19.
    const now = new Date('2026-05-19T12:00:00Z');
    inEachZone((zone) => {
      const { preview } = both('2026-05-22', '08:00', now);
      assert.equal(preview.hoursUntilTour, 72, zone);
      assert.equal(preview.refundCents, 60000, zone);
    });
  });

  test('agrees with the server, either side of the line, across daylight-saving changes and sunset times', () => {
    const departures: Array<[string, string]> = [
      ['2026-03-08', '08:00'], // spring forward
      ['2026-03-11', '08:00'], // 72 hours back crosses it
      ['2026-11-01', '07:00'], // fall back
      ['2026-11-03', '15:30'],
      ['2026-12-31', '10:30'],
      ['2026-06-21', slotStartTime('sunset', '2026-06-21')],
      ['2026-09-30', slotStartTime('sunset', '2026-09-30')],
      ['2026-11-14', slotStartTime('sunset', '2026-11-14')],
    ];
    const offsets = [100, 72.01, 72, 71.99, 48, 1, -0.5];
    inEachZone((zone) => {
      for (const [date, start] of departures) {
        for (const h of offsets) {
          for (const refunded of [0, 15000]) {
            const { preview, server } = both(date, start, hoursBefore(date, start, h), refunded);
            const at = `${date} ${start}, ${h}h before, in ${zone}`;
            assert.equal(preview.refundCents, server.refundCents, at);
            assert.equal(preview.refundPercent, server.refundPercent, at);
            assert.equal(preview.tier, server.tier, at);
            assert.equal(preview.hoursUntilTour, server.hoursUntilTour, at);
          }
        }
      }
    });
  });
});

/**
 * Travis reopened the trip after offering a new date or a full refund, and
 * put them back on it (`refundGraceUntil`, the offer's deadline): until the
 * end of that day, marina time, cancelling refunds in full. The dialog
 * sends the refund it shows, and cancelBooking cancels nothing if its own
 * is lower, so the two must agree on the grace too, or the customer is
 * told their refund changed every time they confirm.
 */
describe('previewRefund, on a trip Travis reopened', () => {
  function bothWithGrace(date: string, startTime: string, now: Date, refundGraceUntil: string, amountRefundedCents = 0) {
    const opts = { amountPaidCents: 60000, amountRefundedCents, date, startTime, now, refundGraceUntil };
    return { preview: previewRefund(opts), server: quoteCustomerRefund(opts) };
  }

  test('under 72 hours, a full refund until the deadline, the same as the server’s, and says why', () => {
    // 10:00 AM at the marina on Oct 15, for the 8:00 on Saturday the 17th.
    const now = new Date('2026-10-15T14:00:00Z');
    inEachZone((zone) => {
      const { preview, server } = bothWithGrace('2026-10-17', '08:00', now, '2026-10-20', 15000);
      assert.equal(preview.tier, 'full', zone);
      assert.equal(preview.refundPercent, 100, zone);
      assert.equal(preview.refundCents, 45000, zone);
      assert.equal(preview.refundCents, server.refundCents, zone);
      assert.equal(preview.explanation, 'Travis reopened your trip; you can still cancel for a full refund until it leaves.', zone);
      assert.equal(preview.explanation, server.explanation, zone);
    });
  });

  test('the deadline is the marina’s day, inclusive, wherever the customer is', () => {
    // A deadline before the trip, so the dialog names the date.
    const date = '2026-10-17';
    const start = slotStartTime('sunset', date);
    const lastMinute = new Date('2026-10-16T03:59:00Z'); // 11:59 PM on the 15th, marina time
    const midnight = new Date('2026-10-16T04:00:00Z');
    inEachZone((zone) => {
      const inside = bothWithGrace(date, start, lastMinute, '2026-10-15');
      assert.equal(inRefundGrace('2026-10-15', lastMinute), true, zone);
      assert.equal(inside.preview.refundCents, 60000, zone);
      assert.equal(inside.preview.explanation, 'Travis reopened your trip; you can still cancel for a full refund until Thursday, October 15, 2026.', zone);
      assert.equal(inside.preview.explanation, inside.server.explanation, zone);

      const after = bothWithGrace(date, start, midnight, '2026-10-15');
      assert.equal(inRefundGrace('2026-10-15', midnight), false, zone);
      assert.equal(after.preview.refundCents, 0, zone);
      assert.equal(after.preview.tier, 'none', zone);
    });
  });

  test('agrees with the server either side of the deadline and of departure', () => {
    const departures: Array<[string, string]> = [
      ['2026-10-17', '08:00'],
      ['2026-11-01', '07:00'], // fall back
      ['2026-11-14', slotStartTime('sunset', '2026-11-14')],
    ];
    const offsets = [100, 72, 71.99, 30, 12, 1, 0, -0.5];
    inEachZone((zone) => {
      for (const [date, start] of departures) {
        // From before the trip to well after it.
        for (const grace of [addDays(date, -3), addDays(date, -2), addDays(date, -1), date, addDays(date, 3)]) {
          for (const h of offsets) {
            const { preview, server } = bothWithGrace(date, start, hoursBefore(date, start, h), grace);
            const at = `${date} ${start}, ${h}h before, grace until ${grace}, in ${zone}`;
            assert.equal(preview.refundCents, server.refundCents, at);
            assert.equal(preview.refundPercent, server.refundPercent, at);
            assert.equal(preview.tier, server.tier, at);
            if (preview.refundCents > 0 && h < 72) assert.equal(preview.explanation, server.explanation, at);
          }
        }
      }
    });
  });

  test('no grace on file is the usual policy', () => {
    const now = hoursBefore('2026-10-17', '08:00', 48);
    for (const refundGraceUntil of [null, undefined]) {
      assert.equal(previewRefund({ amountPaidCents: 60000, date: '2026-10-17', startTime: '08:00', now, refundGraceUntil }).refundCents, 0);
    }
  });
});

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}
