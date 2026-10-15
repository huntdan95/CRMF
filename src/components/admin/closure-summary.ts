// Plain-English lines for what closing a day did, shared by Close a day
// and the countdown banner.

import type { ClosureChoice, ClosureResult } from '@/lib/closure-types';
import { formatFriendlyDate } from '@/lib/date';
import { formatPrice } from '@/lib/tours';

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
    const notEmailed = done.filter((c) => !c.emailed);
    const emailed = done.length - notEmailed.length;
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
    if (offered.length) {
      summary.push(
        `Emailed ${emailed} of ${plural(offered.length, 'customer')} to pick a new date or take a full refund. ` +
          `Anyone who hasn’t chosen by ${formatFriendlyDate(offered[0]!.decideBy)} is refunded automatically.`,
      );
    }
    // Checkouts that were still being paid for: nothing to offer.
    const unpaid = (result.cancelled ?? []).filter((c) => c.unpaidCheckout);
    const other = (result.cancelled ?? []).filter((c) => !c.unpaidCheckout);
    if (unpaid.length) summary.push(`Cancelled ${plural(unpaid.length, 'unfinished checkout')}.`);
    if (other.length) summary.push(`Cancelled ${plural(other.length, 'booking')} that couldn’t be offered a new date.`);
    for (const n of notEmailed) problems.push(`Call or text ${n.customerName}: they weren’t emailed that their tour is off.`);
  } else {
    const kept = result.kept ?? [];
    if (kept.length) {
      problems.push(
        `${plural(kept.length, 'booking is', 'bookings are')} still on for those trips. Contact ${kept.length === 1 ? 'that customer' : 'those customers'} yourself.`,
      );
    }
  }
  for (const f of failed) {
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
