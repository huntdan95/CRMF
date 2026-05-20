import type { Booking } from './types';
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

export function buildBookingConfirmation(ctx: ConfirmationContext) {
  const { booking, baseUrl, marina, phoneDisplay } = ctx;
  const dateStr = fmtDate(booking.date);
  const slot = slotLabels[booking.timeSlot];
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
    `Manage or cancel your booking:`,
    `   ${selfServiceUrl}`,
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
    <title>${subject}</title>
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

      <p style="margin:24px 0 12px;">
        <a href="${escape(selfServiceUrl)}" style="display:inline-block;background:#E08266;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:500;">
          Manage your booking
        </a>
      </p>

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
        <li>Wetsuit, mask, snorkel, and fins</li>
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
}

export function buildCancellationEmail(ctx: CancellationContext) {
  const { booking, refundCents, refundPercent, cancelledBy, reason } = ctx;
  const dateStr = fmtDate(booking.date);
  const refundDisplay = formatPrice(refundCents);
  const paidDisplay = formatPrice(booking.amountPaidCents);
  const fullRefund = refundCents === booking.amountPaidCents;

  const subject = cancelledBy === 'admin'
    ? `Your ${booking.tourName} tour was cancelled by Capt. Travis`
    : `Cancellation confirmed — ${booking.tourName}, ${dateStr}`;

  const lead =
    cancelledBy === 'admin'
      ? `Travis had to cancel your tour on ${dateStr}. Sorry to break the news — usually this is weather or a boat issue, never personal.`
      : `Your tour on ${dateStr} has been cancelled. Sorry to see you go — hope you make it back to the river another time.`;

  const refundLine =
    refundCents === 0
      ? `Per our policy, no refund is being issued for this cancellation.`
      : fullRefund
        ? `A full refund of ${refundDisplay} has been issued to your card. It usually shows up in 3-5 business days.`
        : `A ${refundPercent}% refund of ${refundDisplay} has been issued to your card (you paid ${paidDisplay}). It usually shows up in 3-5 business days.`;

  const text = [
    `Hi ${booking.customerName.split(' ')[0]},`,
    '',
    lead,
    reason ? `\nReason: ${reason}` : '',
    '',
    refundLine,
    '',
    `Original booking:`,
    `   ${booking.tourName}`,
    `   ${dateStr}`,
    `   ${booking.guestCount} guest${booking.guestCount === 1 ? '' : 's'}`,
    '',
    `Questions? Call or text Travis at ${ctx.phoneDisplay}.`,
    '',
    `— Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
  ]
    .filter(Boolean)
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
        <p style="margin:0;font-family:'Fraunces',Georgia,serif;font-size:28px;color:${refundCents > 0 ? '#1B6FA8' : '#7A8B7E'};">
          ${escape(refundDisplay)}
        </p>
        <p style="margin:8px 0 0;font-size:14px;color:#4A524C;line-height:1.5;">${escape(refundLine)}</p>
      </div>

      <h3 style="font-family:'Fraunces',Georgia,serif;margin:24px 0 8px;">Original booking</h3>
      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <tr><td style="padding:6px 0;color:#4A524C;width:120px;">Tour</td><td style="padding:6px 0;font-weight:500;">${escape(booking.tourName)}</td></tr>
        <tr><td style="padding:6px 0;color:#4A524C;">When</td><td style="padding:6px 0;font-weight:500;">${escape(dateStr)}</td></tr>
        <tr><td style="padding:6px 0;color:#4A524C;">Guests</td><td style="padding:6px 0;">${booking.guestCount}</td></tr>
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
    notes ? `  Notes: ${notes}` : '',
    '',
    `CUSTOMER`,
    `  Name:  ${booking.customerName}`,
    `  Email: ${booking.customerEmail}`,
    `  Phone: ${booking.customerPhone}`,
    '',
    `Reply to the customer directly to confirm or propose alternatives. Phase 6`,
    `will add reschedule handling in the admin panel — for v1 this is manual.`,
  ]
    .filter(Boolean)
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
