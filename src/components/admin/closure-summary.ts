// Plain-English lines for what closing a day did, shared by Close a day
// and the countdown banner.

import type { RestoredBookingRow } from '@/lib/admin-client';
import type { ClosureChoice, ClosureResult } from '@/lib/closure-types';
import { formatFriendlyDate } from '@/lib/date';
import { departureTimes, formatPrice, tours } from '@/lib/tours';

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What went out, and what Travis still has to do himself. */
export function closureSummary(choice: ClosureChoice, result: ClosureResult): { summary: string[]; problems: string[] } {
  const summary: string[] = [];
  const problems: string[] = [];
  const failed = result.failed ?? [];

  if (choice === 'cancel') {
    const done = result.cancelled ?? [];
    const auto = done.reduce((s, c) => s + c.refundCents, 0);
    const manual = done.filter((c) => c.manualRefundCents > 0);
    // No email on file (old-site bookings) or the send failed: Travis has
    // to tell these people himself.
    const notEmailed = done.filter((c) => !c.emailed && !c.recovered);
    // Checkouts that were still being paid for aren't bookings: counted
    // apart, as for "offer".
    const unpaid = done.filter((c) => c.unpaidCheckout);
    const booked = done.filter((c) => !c.unpaidCheckout);
    const emailed = booked.filter((c) => c.emailed).length;
    if (booked.length) {
      summary.push(
        emailed === booked.length
          ? `Cancelled ${plural(booked.length, 'booking')} and emailed ${booked.length === 1 ? 'the customer' : 'each customer'}.`
          : `Cancelled ${plural(booked.length, 'booking')}. Emailed ${emailed} of them.`,
      );
    }
    if (unpaid.length) summary.push(`Cancelled ${plural(unpaid.length, 'unfinished checkout')}.`);
    if (auto > 0) summary.push(`${formatPrice(auto)} is going back to their cards.`);
    for (const n of notEmailed) problems.push(`Call or text ${n.customerName}: they weren’t emailed that their tour is off.`);
    for (const m of manual) problems.push(`Refund ${formatPrice(m.manualRefundCents)} to ${m.customerName} yourself (paid on the old website).`);
  } else if (choice === 'offer') {
    const offered = result.offered ?? [];
    const notEmailed = offered.filter((o) => !o.emailed);
    const emailed = offered.length - notEmailed.length;
    // Paid on the old website: cancelling one refunds nothing through
    // Stripe, so the money is Travis's to send back.
    const oldSite = offered.filter((o) => o.id.startsWith('legacy-'));
    if (offered.length) {
      summary.push(
        `Emailed ${emailed} of ${plural(offered.length, 'customer')} to pick a new date or take a full refund. ` +
          `Anyone who hasn’t chosen by ${formatFriendlyDate(offered[0]!.decideBy)} is ${oldSite.length === offered.length ? 'cancelled' : 'refunded'} automatically.`,
      );
    }
    // Checkouts that were still being paid for: nothing to offer.
    const unpaid = (result.cancelled ?? []).filter((c) => c.unpaidCheckout);
    const other = (result.cancelled ?? []).filter((c) => !c.unpaidCheckout);
    if (unpaid.length) summary.push(`Cancelled ${plural(unpaid.length, 'unfinished checkout')}.`);
    if (other.length) summary.push(`Cancelled ${plural(other.length, 'booking')} that couldn’t be offered a new date.`);
    for (const n of notEmailed) problems.push(`Call or text ${n.customerName}: they weren’t emailed that their tour is off.`);
    if (oldSite.length) {
      problems.push(
        `${plural(oldSite.length, 'booking')} from the old website (${oldSite.map((o) => o.customerName).join(', ')}): ` +
          `if they take the refund or don’t choose by ${formatFriendlyDate(oldSite[0]!.decideBy)}, refund them yourself.`,
      );
    }
  } else {
    const kept = result.kept ?? [];
    if (kept.length) {
      problems.push(
        `${plural(kept.length, 'booking is', 'bookings are')} still on for those trips. Contact ${kept.length === 1 ? 'that customer' : 'those customers'} yourself.`,
      );
    }
  }
  // Found cancelled after a run that died partway (functions/src/lib/close-day.ts).
  for (const r of (result.cancelled ?? []).filter((c) => c.recovered && !c.unpaidCheckout)) {
    problems.push(`Check on ${r.customerName}: their booking was cancelled, but we can’t tell if they were emailed. Call or text them.`);
  }
  for (const f of failed) {
    // Moved or cancelled another way as it was refunded: telling Travis to
    // cancel it could cancel the trip they moved to, so it says what happened.
    if (f.refundedAnyway) {
      problems.push(`${f.customerName}: ${f.error}`);
      continue;
    }
    problems.push(
      f.retryable
        ? `${f.customerName} paid just as you closed it. It’s being tried again in a couple of minutes.`
        : choice === 'cancel'
          ? `${f.customerName}’s booking was NOT cancelled. Open it and cancel it there.`
          : `${f.customerName}’s booking wasn’t changed. Open it and sort it out there.`,
    );
  }
  return { summary, problems };
}

/** "Jane Smith (8:00 AM), Bob Lee (10:30 AM)" */
function whoOn(rows: RestoredBookingRow[]): string {
  return rows
    .map((x) => {
      const tour = tours.find((t) => t.timeSlot === x.timeSlot);
      return `${x.customerName} (${tour ? departureTimes(tour, x.date).start : x.timeSlot})`;
    })
    .join(', ');
}

/**
 * After a reopen or an undo: who's back on their trip (they aren't
 * emailed), whether the crew heard, and anyone who paid while it was
 * closed, who is sent the confirmation held back from them. No `crewTold`
 * when the crew were never told those trips were off.
 *
 * Someone can be both: paid during an offer's undo window, offered a new
 * date when it went out, then put back by the reopen. The confirmation
 * line says how they heard (or that they didn't), so they're left out of
 * "haven't been told".
 *
 * `alreadyLeft`: still booked on a trip that had left by then (an undo
 * after it went, or a reopen tried again after it put them back). With
 * the day open again that trip counts as having run, so Travis checks.
 */
export function backOnLines(r: {
  restored?: RestoredBookingRow[];
  crewTold?: boolean;
  confirmationsSent?: RestoredBookingRow[];
  confirmationsFailed?: RestoredBookingRow[];
  alreadyLeft?: RestoredBookingRow[];
}): string[] {
  const lines: string[] = [];
  const confirmed = new Set([...(r.confirmationsSent ?? []), ...(r.confirmationsFailed ?? [])].map((x) => x.id));
  const untold = (r.restored ?? []).filter((x) => !confirmed.has(x.id));
  if (untold.length) {
    lines.push(`Back on their trip: ${whoOn(untold)}. The customers haven’t been told: call or text them.`);
  }
  if (r.confirmationsSent?.length) {
    lines.push(`Paid while it was closed, and now sent their booking confirmation: ${whoOn(r.confirmationsSent)}.`);
  }
  if (r.confirmationsFailed?.length) {
    lines.push(
      `Paid while it was closed, but their booking confirmation didn’t go: ${whoOn(r.confirmationsFailed)}. ` +
        'Open the booking and email the confirmation again, or call them.',
    );
  }
  if (r.alreadyLeft?.length) {
    lines.push(
      `On a trip that had already left: ${whoOn(r.alreadyLeft)}. It now counts as a trip that ran: check whether they went, ` +
        'and if they didn’t, move or cancel them from their booking page.',
    );
  }
  if (r.crewTold === true) lines.push('The crew have had a message that it’s back on.');
  if (r.crewTold === false) lines.push('The message telling the crew it’s back on didn’t reach them all: let them know too.');
  return lines;
}

/**
 * The first line after an undo or a reopen. `stillClosed` (from the
 * server): another closing of that day still covers `all` of the trips this
 * one closed, or `some`, so those can't be booked yet. Without it the day
 * is open for booking again.
 */
export function reopenedLead(day: string, how: 'undo' | 'reopen', stillClosed?: 'all' | 'some' | null): string {
  if (how === 'undo') {
    const open =
      stillClosed === 'all'
        ? `${day} is still closed: another closing of that day covers these trips.`
        : stillClosed === 'some'
          ? `${day} is open for booking again, except the trips another closing of that day still covers.`
          : `${day} is open for booking again.`;
    return `Undone. ${open} Nothing went out for this closing.`;
  }
  if (stillClosed === 'all') return `This closing is gone, but ${day} is still closed: another closing of that day covers these trips.`;
  if (stillClosed === 'some') return `${day} is reopened, except the trips another closing of that day still covers.`;
  return `${day} is reopened.`;
}

/** "8:00 AM and 10:30 AM" */
export function joinTimes(times: string[]): string {
  if (times.length <= 1) return times[0] ?? '';
  return `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
}

/** "Sat, Oct 17" */
export function dayShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Saturday, Oct 17" */
export function dayMedium(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
