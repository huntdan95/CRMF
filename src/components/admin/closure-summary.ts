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
    const emailed = done.filter((c) => c.emailed).length;
    if (done.length) {
      summary.push(
        emailed === done.length
          ? `Cancelled ${plural(done.length, 'booking')} and emailed ${done.length === 1 ? 'the customer' : 'each customer'}.`
          : `Cancelled ${plural(done.length, 'booking')}. Emailed ${emailed} of them.`,
      );
    }
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

/**
 * After a reopen or an undo: who's back on their trip (they aren't
 * emailed), and whether the crew heard. No `crewTold` when the crew were
 * never told those trips were off.
 */
export function backOnLines(r: { restored?: RestoredBookingRow[]; crewTold?: boolean }): string[] {
  const lines: string[] = [];
  if (r.restored?.length) {
    const who = r.restored.map((x) => {
      const tour = tours.find((t) => t.timeSlot === x.timeSlot);
      return `${x.customerName} (${tour ? departureTimes(tour, x.date).start : x.timeSlot})`;
    });
    lines.push(`Back on their trip: ${who.join(', ')}. The customers haven’t been told: call or text them.`);
  }
  if (r.crewTold === true) lines.push('The crew have had a message that it’s back on.');
  if (r.crewTold === false) lines.push('The message telling the crew it’s back on didn’t reach them all: let them know too.');
  return lines;
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
