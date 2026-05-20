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
    `Show up 15 minutes early — bring a swimsuit, towel (we have spares), and`,
    `sunscreen. We provide all snorkel gear.`,
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
        <li>Swimsuit (we have wetsuits, fins, mask & snorkel)</li>
        <li>Towel (we have spares)</li>
        <li>Reef-safe sunscreen</li>
        <li>Waterproof camera or GoPro, optional</li>
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
