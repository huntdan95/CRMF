import { isLegacyBooking, type Booking } from './types';
import type { PaidAfterCancellation } from './checkout-completed';
import { formatPrice, slotLabels } from './tours';

interface ConfirmationContext {
  booking: Booking;
  baseUrl: string;
  marina: { name: string; address: string };
  phoneDisplay: string;
}

function fmtDate(date: string): string {
  // `date` is YYYY-MM-DD local. Render as "Saturday, May 22, 2026".
  const [y, m, d] = date.split('-').map((n) => Number.parseInt(n, 10));
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Departure time and meet-by time for each slot, as on the website (the
 * schedule is code: src/lib/tours.ts). "Morning" alone isn't enough to
 * show up for, and the email asks people to arrive 15 minutes early.
 */
const SLOT_TIMES: Record<Booking['timeSlot'], { departs: string; arriveBy: string }> = {
  morning: { departs: '8:00 AM', arriveBy: '7:45 AM' },
  'mid-morning': { departs: '10:30 AM', arriveBy: '10:15 AM' },
  'early-afternoon': { departs: '1:00 PM', arriveBy: '12:45 PM' },
  'late-afternoon': { departs: '3:30 PM', arriveBy: '3:15 PM' },
  'whole-day': { departs: '7:00 AM', arriveBy: '6:45 AM' },
};

/** "Morning, departs 8:00 AM (please arrive by 7:45 AM)", or just the slot. */
function whenLine(timeSlot: Booking['timeSlot']): string {
  const t = SLOT_TIMES[timeSlot];
  const slot = slotLabels[timeSlot] ?? timeSlot;
  return t ? `${slot}, departs ${t.departs} (please arrive by ${t.arriveBy})` : slot;
}

export function buildBookingConfirmation(ctx: ConfirmationContext) {
  const { booking, baseUrl, marina, phoneDisplay } = ctx;
  const dateStr = fmtDate(booking.date);
  const slot = whenLine(booking.timeSlot);
  const totalDisplay = formatPrice(booking.amountPaidCents);
  const selfServiceUrl = `${baseUrl}/my-booking/${booking.id}?t=${booking.accessToken}`;

  const subject = `Tour confirmed for ${dateStr} — ${booking.tourName}`;

  const guestList = booking.guests
    .map(
      (g, i) =>
        `   ${i + 1}. ${g.name}${g.age != null ? ` (age ${g.age})` : ''}`,
    )
    .join('\n');

  const text = [
    `Hi ${booking.customerName.split(' ')[0]},`,
    '',
    `Your manatee tour is locked in. Here's what you need to know:`,
    '',
    `Tour:     ${booking.tourName}`,
    `When:     ${dateStr}, ${slot}`,
    `Where:    ${marina.name}`,
    `          ${marina.address}`,
    `Guests:   ${booking.guestCount}`,
    `Paid:     ${totalDisplay}`,
    '',
    ...(isLegacyBooking(booking)
      ? [`To change or cancel, call or text Travis at ${phoneDisplay}.`]
      : [`Manage or cancel your booking:`, `   ${selfServiceUrl}`]),
    '',
    `Your party:`,
    guestList,
    '',
    `Show up 15 minutes early — bring a swimsuit, your own towel, and`,
    `sunscreen. We provide snorkel gear, wetsuit, bottled water, and`,
    `hot chocolate on the boat.`,
    '',
    `Questions or weather concerns? Text or call Travis at ${phoneDisplay}.`,
    '',
    `See you on the water,`,
    `Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escape(subject)}</title>
  </head>
  <body style="margin:0;font-family:'Inter',-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;">
    <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
      <h1 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;font-size:28px;margin:0 0 8px;">
        Your tour is confirmed
      </h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 24px;">
        Hi ${escape(booking.customerName.split(' ')[0])} — see you on
        <strong>${escape(dateStr)}</strong>.
      </p>

      <div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 12px -4px rgba(26,31,27,.10);">
        <table style="width:100%;border-collapse:collapse;font-size:15px;">
          <tr><td style="padding:8px 0;color:#4A524C;width:120px;">Tour</td><td style="padding:8px 0;font-weight:500;">${escape(booking.tourName)}</td></tr>
          <tr><td style="padding:8px 0;color:#4A524C;">When</td><td style="padding:8px 0;font-weight:500;">${escape(dateStr)}, ${escape(slot)}</td></tr>
          <tr><td style="padding:8px 0;color:#4A524C;">Where</td><td style="padding:8px 0;">${escape(marina.name)}<br/>${escape(marina.address)}</td></tr>
          <tr><td style="padding:8px 0;color:#4A524C;">Guests</td><td style="padding:8px 0;">${booking.guestCount}</td></tr>
          <tr><td style="padding:8px 0;color:#4A524C;">Paid</td><td style="padding:8px 0;font-weight:600;color:#1B6FA8;">${escape(totalDisplay)}</td></tr>
        </table>
      </div>

      ${isLegacyBooking(booking)
        ? `<p style="margin:24px 0 12px;font-size:15px;">To change or cancel, call or text Travis at <a href="tel:+1${escape(phoneDisplay.replace(/[^0-9]/g, ''))}" style="color:#1B6FA8;">${escape(phoneDisplay)}</a>.</p>`
        : `<p style="margin:24px 0 12px;">
        <a href="${escape(selfServiceUrl)}" style="display:inline-block;background:#E08266;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:500;">
          Manage your booking
        </a>
      </p>`}

      <h3 style="font-family:'Fraunces',Georgia,serif;margin:32px 0 8px;color:#1A1F1B;">Your party</h3>
      <ol style="padding-left:20px;margin:0 0 24px;line-height:1.6;font-size:15px;">
        ${booking.guests
          .map(
            (g) =>
              `<li>${escape(g.name)}${g.age != null ? ` <span style="color:#7A8B7E;">(age ${g.age})</span>` : ''}</li>`,
          )
          .join('')}
      </ol>

      <h3 style="font-family:'Fraunces',Georgia,serif;margin:24px 0 8px;color:#1A1F1B;">What to bring</h3>
      <ul style="padding-left:20px;margin:0 0 24px;line-height:1.6;font-size:15px;">
        <li>Swimsuit</li>
        <li>Your own towel</li>
        <li>Reef-safe sunscreen</li>
      </ul>
      <h3 style="font-family:'Fraunces',Georgia,serif;margin:16px 0 8px;color:#1A1F1B;">What we provide</h3>
      <ul style="padding-left:20px;margin:0 0 24px;line-height:1.6;font-size:15px;">
        <li>Wetsuit, mask, and snorkel</li>
        <li>Dedicated in-water swim guide</li>
        <li>Free GoPro photos from your tour</li>
        <li>Bottled water and hot chocolate on the boat</li>
      </ul>

      <p style="font-size:14px;color:#4A524C;line-height:1.6;">
        Questions or weather concerns? Text or call Travis at
        <a href="tel:+1${escape(phoneDisplay.replace(/[^0-9]/g, ''))}" style="color:#1B6FA8;">${escape(phoneDisplay)}</a>.
      </p>

      <p style="font-size:14px;color:#4A524C;line-height:1.6;margin-top:32px;">
        See you on the water,<br/>
        <strong>Capt. Travis Urbin</strong><br/>
        Crystal River Manatee Fun
      </p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

function escape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------------- */
/* Cancellation                                                               */
/* -------------------------------------------------------------------------- */

interface CancellationContext {
  booking: Booking;
  refundCents: number;
  refundPercent: number;
  cancelledBy: 'customer' | 'admin';
  reason?: string;
  marina: { name: string; address: string };
  phoneDisplay: string;
  /**
   * Money this site can't refund automatically (paid on the old website),
   * which Travis returns himself. Never claim it "has been issued".
   */
  manualRefundCents?: number;
  /**
   * Refunded before this cancellation, e.g. a partial refund from Travis.
   * `refundCents` and `refundPercent` are out of what was left after it.
   */
  previouslyRefundedCents?: number;
}

export function buildCancellationEmail(ctx: CancellationContext) {
  const { booking, refundCents, refundPercent, cancelledBy, reason } = ctx;
  const manualCents = ctx.manualRefundCents ?? 0;
  const earlierCents = ctx.previouslyRefundedCents ?? 0;
  const leftCents = Math.max(0, booking.amountPaidCents - earlierCents);
  const dateStr = fmtDate(booking.date);
  const refundDisplay = formatPrice(refundCents + manualCents);
  const paidDisplay = formatPrice(booking.amountPaidCents);
  const earlierDisplay = formatPrice(earlierCents);
  const fullRefund = refundCents > 0 && refundCents === leftCents;

  const subject = cancelledBy === 'admin'
    ? `Your ${booking.tourName} tour was cancelled by Capt. Travis`
    : `Cancellation confirmed — ${booking.tourName}, ${dateStr}`;

  const lead =
    cancelledBy === 'admin'
      ? `Travis had to cancel your tour on ${dateStr}. Sorry to break the news — usually this is weather or a boat issue, never personal.`
      : `Your tour on ${dateStr} has been cancelled. Sorry to see you go — hope you make it back to the river another time.`;

  const refundLine =
    manualCents > 0
      ? `Capt. Travis will refund your ${formatPrice(manualCents)} himself and will be in touch about it.`
      : refundCents === 0 && (cancelledBy === 'admin' || leftCents === 0)
      ? booking.amountPaidCents === 0
        ? `You weren't charged for this booking, so there's nothing to refund.`
        : `Your payment has already been refunded.`
      : refundCents === 0
      ? `Per our policy, no refund is being issued for this cancellation.`
      : fullRefund && earlierCents > 0
        ? `The remaining ${refundDisplay} of your ${paidDisplay} payment has been refunded to your card (${earlierDisplay} was refunded earlier). It usually shows up in 3-5 business days.`
      : fullRefund
        ? `A full refund of ${refundDisplay} has been issued to your card. It usually shows up in 3-5 business days.`
      : earlierCents > 0
        ? `A ${refundPercent}% refund of ${refundDisplay} has been issued to your card: ${refundPercent}% of the ${formatPrice(leftCents)} left after an earlier ${earlierDisplay} refund (you paid ${paidDisplay}). It usually shows up in 3-5 business days.`
        : `A ${refundPercent}% refund of ${refundDisplay} has been issued to your card (you paid ${paidDisplay}). It usually shows up in 3-5 business days.`;

  const text = [
    `Hi ${booking.customerName.split(' ')[0]},`,
    '',
    lead,
    reason ? `\nReason: ${reason}` : null,
    '',
    refundLine,
    '',
    `Original booking:`,
    `   ${booking.tourName}`,
    `   ${dateStr}`,
    booking.guestCount > 0 ? `   ${booking.guestCount} guest${booking.guestCount === 1 ? '' : 's'}` : null,
    '',
    `Questions? Call or text Travis at ${ctx.phoneDisplay}.`,
    '',
    `— Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
  ]
    // Drop only the optional lines left out (null); the blank spacers stay.
    .filter((line) => line !== null)
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"/><title>${escape(subject)}</title></head>
  <body style="margin:0;font-family:'Inter',-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;">
    <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
      <h1 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;font-size:26px;margin:0 0 8px;">
        ${cancelledBy === 'admin' ? 'Tour cancelled by Capt. Travis' : 'Cancellation confirmed'}
      </h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">${escape(lead)}</p>
      ${reason ? `<p style="font-size:14px;color:#4A524C;margin:0 0 16px;"><strong>Reason:</strong> ${escape(reason)}</p>` : ''}

      <div style="background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px -4px rgba(26,31,27,.10);margin:16px 0;">
        <p style="margin:0 0 8px;font-size:14px;color:#4A524C;text-transform:uppercase;letter-spacing:1px;">Refund</p>
        <p style="margin:0;font-family:'Fraunces',Georgia,serif;font-size:28px;color:${refundCents + manualCents > 0 ? '#1B6FA8' : '#7A8B7E'};">
          ${escape(refundDisplay)}
        </p>
        <p style="margin:8px 0 0;font-size:14px;color:#4A524C;line-height:1.5;">${escape(refundLine)}</p>
      </div>

      <h3 style="font-family:'Fraunces',Georgia,serif;margin:24px 0 8px;">Original booking</h3>
      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <tr><td style="padding:6px 0;color:#4A524C;width:120px;">Tour</td><td style="padding:6px 0;font-weight:500;">${escape(booking.tourName)}</td></tr>
        <tr><td style="padding:6px 0;color:#4A524C;">When</td><td style="padding:6px 0;font-weight:500;">${escape(dateStr)}</td></tr>
        ${booking.guestCount > 0 ? `<tr><td style="padding:6px 0;color:#4A524C;">Guests</td><td style="padding:6px 0;">${booking.guestCount}</td></tr>` : ''}
      </table>

      <p style="font-size:14px;color:#4A524C;line-height:1.6;margin-top:24px;">
        Questions? Call or text Travis at
        <a href="tel:+1${escape(ctx.phoneDisplay.replace(/[^0-9]/g, ''))}" style="color:#1B6FA8;">${escape(ctx.phoneDisplay)}</a>.
      </p>
      <p style="font-size:14px;color:#4A524C;margin-top:24px;">
        — <strong>Capt. Travis Urbin</strong><br/>Crystal River Manatee Fun
      </p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Post-tour follow-up (sent ~1 day after the tour)                            */
/* -------------------------------------------------------------------------- */

interface PostTourContext {
  booking: Booking;
  baseUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  googleReviewUrl?: string;
  phoneDisplay: string;
  marina: { name: string; address: string };
}

export function buildPostTourFollowupEmail(ctx: PostTourContext) {
  const { booking, baseUrl, instagramUrl, facebookUrl, googleReviewUrl, phoneDisplay, marina } = ctx;
  const firstName = booking.customerName.split(' ')[0];
  const dateStr = fmtDate(booking.date);

  const subject = `How was your manatee tour, ${firstName}?`;

  const reviewLine = googleReviewUrl
    ? `Leave an honest Google review, good or bad: ${googleReviewUrl}`
    : `Leave an honest Google review, good or bad — search "Crystal River Manatee Fun" and the option's at the top.`;

  const text = [
    `Hi ${firstName},`,
    '',
    `Hope you had a great time out with the manatees on ${dateStr}.`,
    `Two quick asks:`,
    '',
    `1. Tag a photo on Instagram — we love sharing guest shots.`,
    `   ${instagramUrl}`,
    '',
    `2. ${reviewLine}`,
    '',
    `Your GoPro photos will arrive in a separate email — usually within a`,
    `day or two, once Travis goes through and picks the highlights.`,
    '',
    `Want to come back? Book another tour any time:`,
    `   ${baseUrl}/book`,
    '',
    `Thanks for choosing us,`,
    `Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
    `${phoneDisplay}`,
    `${marina.name}, ${marina.address}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"/><title>${escape(subject)}</title></head>
  <body style="margin:0;font-family:'Inter',-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;">
    <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
      <h1 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;font-size:28px;margin:0 0 8px;">
        How was your tour?
      </h1>
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">
        Hi ${escape(firstName)} — hope you had a great time out with the
        manatees on <strong>${escape(dateStr)}</strong>.
      </p>

      <p style="font-size:15px;line-height:1.7;margin:0 0 16px;color:#4A524C;">
        Two quick asks:
      </p>

      <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 2px 12px -4px rgba(26,31,27,.10);">
        <p style="margin:0 0 6px;font-family:'Fraunces',Georgia,serif;font-size:18px;color:#1A1F1B;">
          1. Tag a photo on Instagram
        </p>
        <p style="margin:0 0 10px;font-size:14px;color:#4A524C;">
          We love sharing guest shots.
        </p>
        <a href="${escape(instagramUrl)}" style="display:inline-block;background:#E08266;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:500;font-size:14px;">
          Open Instagram
        </a>
      </div>

      <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 2px 12px -4px rgba(26,31,27,.10);">
        <p style="margin:0 0 6px;font-family:'Fraunces',Georgia,serif;font-size:18px;color:#1A1F1B;">
          2. Leave an honest review
        </p>
        <p style="margin:0 0 10px;font-size:14px;color:#4A524C;">
          Good or bad, Google reviews are how new guests find us and how Travis hears what to fix. ${googleReviewUrl ? '30 seconds means a lot.' : 'Search "Crystal River Manatee Fun" on Google and the option is right at the top.'}
        </p>
        ${
          googleReviewUrl
            ? `<a href="${escape(googleReviewUrl)}" style="display:inline-block;background:#1B6FA8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:500;font-size:14px;">Review on Google</a>`
            : ''
        }
      </div>

      <p style="font-size:14px;color:#4A524C;line-height:1.6;margin:20px 0 0;">
        Your <strong>GoPro photos</strong> will arrive in a separate email —
        usually within a day or two, once Travis goes through and picks the
        highlights.
      </p>

      <p style="font-size:14px;color:#4A524C;line-height:1.6;margin:24px 0 0;">
        Want to come back? <a href="${escape(baseUrl)}/book" style="color:#1B6FA8;">Book another tour</a> any time.
      </p>

      <p style="font-size:14px;color:#4A524C;margin-top:28px;">
        Thanks for choosing us,<br/>
        <strong>Capt. Travis Urbin</strong><br/>
        Crystal River Manatee Fun<br/>
        <a href="tel:+1${escape(phoneDisplay.replace(/[^0-9]/g, ''))}" style="color:#1B6FA8;">${escape(phoneDisplay)}</a>
      </p>

      <p style="font-size:11px;color:#7A8B7E;margin-top:24px;">
        Follow on Instagram (<a href="${escape(instagramUrl)}" style="color:#7A8B7E;">@capt.travisurbin</a>) ·
        Facebook (<a href="${escape(facebookUrl)}" style="color:#7A8B7E;">Travis Urbin</a>)<br/>
        Crystal River Manatee Fun · ${escape(marina.name)}, ${escape(marina.address)}
      </p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Paid after cancellation (sent to Travis, not the customer)                 */
/* -------------------------------------------------------------------------- */

export function buildPaidAfterCancellationEmail(ctx: PaidAfterCancellation) {
  const { booking, outcome, amountCents, paymentIntentId, refundId } = ctx;
  const dateStr = fmtDate(booking.date);
  const amount = formatPrice(amountCents);
  const paymentUrl = paymentIntentId
    ? `https://dashboard.stripe.com/${ctx.livemode ? '' : 'test/'}payments/${paymentIntentId}`
    : `https://dashboard.stripe.com/${ctx.livemode ? '' : 'test/'}payments`;

  const subject =
    outcome === 'refunded'
      ? `Refunded: ${booking.customerName} paid for a cancelled booking (${dateStr})`
      : `Action needed: refund ${booking.customerName}, who paid for a cancelled booking (${dateStr})`;

  const whatHappened =
    outcome === 'refunded'
      ? `${booking.customerName} paid ${amount} for a booking that had already been cancelled. It was refunded in full automatically (${refundId}).`
      : outcome === 'refund-failed'
        ? `${booking.customerName} paid ${amount} for a booking that had already been cancelled. The automatic refund failed, so refund it in Stripe.`
        : `${booking.customerName} finished Stripe checkout for a booking that had already been cancelled. Their payment hasn't cleared yet (Stripe status: ${ctx.stripePaymentStatus}). Once it does, refund it in Stripe.`;
  const nextSteps =
    'The booking is still cancelled and no seats are held for it. The customer ' +
    "hasn't been emailed about this. Reach out to them, and offer another date " +
    'if you have room.';
  const cancelled =
    `Cancelled by ${booking.cancelledBy ?? 'unknown'}` +
    (booking.cancellationReason ? `: "${booking.cancellationReason}"` : '');

  const text = [
    whatHappened,
    `Stripe: ${paymentUrl}`,
    '',
    nextSteps,
    '',
    `BOOKING`,
    `  ID:     ${booking.id}`,
    `  Tour:   ${booking.tourName}`,
    `  Date:   ${dateStr} (${booking.timeSlot})`,
    `  Guests: ${booking.guestCount}`,
    `  ${cancelled}`,
    '',
    `CUSTOMER`,
    `  Name:  ${booking.customerName}`,
    `  Email: ${booking.customerEmail}`,
    `  Phone: ${booking.customerPhone}`,
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 16px;">${outcome === 'refunded' ? 'Payment on a cancelled booking' : 'Refund needed'}</h2>
    <p style="margin:0 0 12px;font-size:15px;">${escape(whatHappened)}</p>
    <p style="margin:0 0 12px;font-size:14px;">
      <a href="${escape(paymentUrl)}" style="color:#1B6FA8;">Open the payment in Stripe</a>
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#4A524C;">${escape(nextSteps)}</p>

    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#7A8B7E;margin:16px 0 6px;">Booking</h3>
    <p style="margin:0;font-size:14px;line-height:1.7;">
      ${escape(booking.tourName)}<br/>
      ${escape(dateStr)} · ${booking.guestCount} guest${booking.guestCount === 1 ? '' : 's'}<br/>
      ${escape(cancelled)}<br/>
      <span style="color:#7A8B7E;font-size:12px;">Booking ID: ${escape(booking.id)}</span>
    </p>

    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#7A8B7E;margin:20px 0 6px;">Customer</h3>
    <p style="margin:0;font-size:14px;line-height:1.7;">
      ${escape(booking.customerName)}<br/>
      <a href="mailto:${escape(booking.customerEmail)}" style="color:#1B6FA8;">${escape(booking.customerEmail)}</a><br/>
      <a href="tel:${escape(booking.customerPhone)}" style="color:#1B6FA8;">${escape(booking.customerPhone)}</a>
    </p>
  </div>
</body></html>`;

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Reschedule request: the customer's acknowledgement                          */
/* -------------------------------------------------------------------------- */

interface RescheduleAckContext {
  booking: Booking;
  requestedDate: string;
  requestedSlot?: string;
  phoneDisplay: string;
}

/**
 * What the customer gets after asking to move their tour. Separate from
 * Travis's copy (which is written to him and replies to the customer), so
 * their reply reaches Travis and they don't see admin instructions.
 */
export function buildRescheduleAckEmail(ctx: RescheduleAckContext) {
  const { booking, requestedDate, requestedSlot, phoneDisplay } = ctx;
  const firstName = booking.customerName.split(' ')[0];
  const originalDate = fmtDate(booking.date);
  const newDate = fmtDate(requestedDate);
  const newSlot = requestedSlot ? slotLabels[requestedSlot as Booking['timeSlot']] ?? requestedSlot : null;
  const target = newSlot ? `${newDate}, ${newSlot}` : newDate;

  const subject = `We got your request to move your tour`;

  const text = [
    `Hi ${firstName},`,
    '',
    `We've passed your request on to Capt. Travis:`,
    `   ${booking.tourName} on ${originalDate}`,
    `   → ${target}`,
    '',
    `Your booking stays as it is until Travis confirms the change. He'll`,
    `get back to you, usually within a day. Reply to this email to add`,
    `anything, or call or text him at ${phoneDisplay}.`,
    '',
    `— Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"/><title>${escape(subject)}</title></head>
  <body style="margin:0;font-family:'Inter',-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;">
    <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
      <h1 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;font-size:26px;margin:0 0 8px;">
        Request received
      </h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
        Hi ${escape(firstName)} — we've passed your request on to Capt. Travis.
      </p>
      <div style="background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px -4px rgba(26,31,27,.10);margin:16px 0;font-size:15px;line-height:1.7;">
        ${escape(booking.tourName)} on ${escape(originalDate)}<br/>
        <strong>→ ${escape(target)}</strong>
      </div>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#4A524C;">
        Your booking stays as it is until Travis confirms the change. He'll get back
        to you, usually within a day. Reply to this email to add anything, or call or
        text him at ${escape(phoneDisplay)}.
      </p>
      <p style="font-size:14px;color:#4A524C;margin:24px 0 0;">— Capt. Travis Urbin<br/>Crystal River Manatee Fun</p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Reschedule request (sent to Travis, not the customer)                      */
/* -------------------------------------------------------------------------- */

interface RescheduleRequestContext {
  booking: Booking;
  requestedDate: string;
  requestedSlot?: string;
  notes?: string;
  marina: { name: string; address: string };
}

export function buildRescheduleRequestEmail(ctx: RescheduleRequestContext) {
  const { booking, requestedDate, requestedSlot, notes } = ctx;
  const originalDate = fmtDate(booking.date);
  const newDate = fmtDate(requestedDate);

  const subject = `Reschedule request — ${booking.customerName} (${originalDate} → ${newDate})`;

  const text = [
    `${booking.customerName} wants to move their tour.`,
    '',
    `BOOKING`,
    `  ID:       ${booking.id}`,
    `  Tour:     ${booking.tourName}`,
    `  Was:      ${originalDate} (${booking.timeSlot})`,
    `  Guests:   ${booking.guestCount}`,
    `  Paid:     ${formatPrice(booking.amountPaidCents)}`,
    '',
    `REQUEST`,
    `  Target date: ${newDate}`,
    `  Target slot: ${requestedSlot ?? 'no preference'}`,
    notes ? `  Notes: ${notes}` : null,
    '',
    `CUSTOMER`,
    `  Name:  ${booking.customerName}`,
    `  Email: ${booking.customerEmail}`,
    `  Phone: ${booking.customerPhone}`,
    '',
    `Move it in Admin → the booking → Reschedule, and mark the request done in`,
    `Admin → Reschedules. Replying to this email goes to the customer.`,
  ]
    // Drop only the optional lines left out (null); the blank spacers stay.
    .filter((line) => line !== null)
    .join('\n');

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 16px;">Reschedule request</h2>
    <p style="margin:0 0 16px;font-size:15px;">
      <strong>${escape(booking.customerName)}</strong> wants to move their tour.
    </p>

    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#7A8B7E;margin:16px 0 6px;">Current booking</h3>
    <p style="margin:0;font-size:14px;line-height:1.7;">
      ${escape(booking.tourName)}<br/>
      ${escape(originalDate)} · ${booking.guestCount} guest${booking.guestCount === 1 ? '' : 's'}<br/>
      Paid: ${escape(formatPrice(booking.amountPaidCents))}<br/>
      <span style="color:#7A8B7E;font-size:12px;">Booking ID: ${escape(booking.id)}</span>
    </p>

    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#7A8B7E;margin:20px 0 6px;">Requested</h3>
    <p style="margin:0;font-size:14px;line-height:1.7;">
      <strong>${escape(newDate)}</strong>${requestedSlot ? ` · slot: ${escape(requestedSlot)}` : ''}
      ${notes ? `<br/><span style="color:#4A524C;">Notes: ${escape(notes)}</span>` : ''}
    </p>

    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#7A8B7E;margin:20px 0 6px;">Customer</h3>
    <p style="margin:0;font-size:14px;line-height:1.7;">
      ${escape(booking.customerName)}<br/>
      <a href="mailto:${escape(booking.customerEmail)}" style="color:#1B6FA8;">${escape(booking.customerEmail)}</a><br/>
      <a href="tel:${escape(booking.customerPhone)}" style="color:#1B6FA8;">${escape(booking.customerPhone)}</a>
    </p>
  </div>
</body></html>`;

  return { subject, text, html };
}
