import type { Booking } from './types';
import {
  departureLabel,
  departureMinutes,
  escapeHtml as esc,
  guestsLabel,
  longDate,
  shortDate,
  telHref,
} from './trip-format';

/*
 * Emails to Travis alone. Subjects start with "[CRMF]" like the crew's, so
 * one phone notification rule catches all of them.
 */

const TAG = '[CRMF]';

export interface OwnerEmail {
  subject: string;
  text: string;
  html: string;
  sms: string;
}

function shell(subject: string, inner: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${esc(subject)}</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;padding:16px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:20px;">${inner}</div>
</body></html>`;
}

function primaryButton(label: string, url: string): string {
  return `<a href="${esc(url)}" style="display:inline-block;background:#1B6FA8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;font-size:15px;">${esc(label)}</a>`;
}

/* -------------------------------------------------------------------------- */
/* 6:00 PM: tonight's review requests                                         */
/* -------------------------------------------------------------------------- */

export function buildReviewListEmail(ctx: {
  date: string;
  /** Bookings whose request goes out at 7:00 tonight. */
  going: Booking[];
  /** Today's bookings Travis is holding to call first. */
  held: Booking[];
  baseUrl: string;
}): OwnerEmail {
  const n = ctx.going.length;
  const subject = `${TAG} ${n} review ${n === 1 ? 'request goes' : 'requests go'} out at 7:00`;
  const pageUrl = `${ctx.baseUrl}/admin/review-requests`;
  const sorted = [...ctx.going].sort(
    (a, b) => departureMinutes(a.timeSlot) - departureMinutes(b.timeSlot),
  );
  const line = (b: Booking) => `${departureLabel(b)}: ${b.customerName} (${guestsLabel(b.guestCount)})`;

  const text = [
    `Tonight at 7:00 these guests from today's trips (${longDate(ctx.date)}) get the thank-you email with the Google review link:`,
    '',
    ...sorted.map((b) => `- ${line(b)}`),
    ...(ctx.held.length ? ['', `Held for you to call first: ${ctx.held.map((b) => b.customerName).join(', ')}`] : []),
    '',
    `Anyone who didn't go out? Mark them "Didn't sail" before 7:00. Want to call someone first? Tap "Hold".`,
    pageUrl,
  ].join('\n');

  const html = shell(
    subject,
    `
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 8px;font-size:22px;">Review requests at 7:00</h2>
    <p style="margin:0 0 12px;font-size:15px;">Tonight at 7:00 these guests from today’s trips get the thank-you email with the Google review link:</p>
    <ul style="padding-left:18px;margin:0 0 12px;font-size:15px;line-height:1.6;">
      ${sorted.map((b) => `<li>${esc(line(b))}</li>`).join('')}
    </ul>
    ${ctx.held.length ? `<p style="margin:0 0 12px;font-size:14px;color:#4A524C;">Held for you to call first: ${esc(ctx.held.map((b) => b.customerName).join(', '))}</p>` : ''}
    <p style="margin:0 0 16px;font-size:14px;color:#4A524C;">Anyone who didn’t go out? Mark them “Didn’t sail” before 7:00. Want to call someone first? Tap “Hold”.</p>
    ${primaryButton('Check the list', pageUrl)}
    `,
  );

  return { subject, text, html, sms: `${n} review ${n === 1 ? 'request goes' : 'requests go'} out at 7:00. Check: ${pageUrl}` };
}

/* -------------------------------------------------------------------------- */
/* Private feedback from a guest                                              */
/* -------------------------------------------------------------------------- */

export function buildFeedbackEmail(ctx: {
  booking: Booking;
  message: string;
  baseUrl: string;
}): OwnerEmail {
  const b = ctx.booking;
  const when = `${shortDate(b.date)}, ${departureLabel(b)}`;
  const subject = `${TAG} Private feedback from ${b.customerName} (${when})`;
  const adminUrl = `${ctx.baseUrl}/admin/bookings/${b.id}`;

  const text = [
    `${b.customerName} sent this from the "Tell Travis privately" link in their thank-you email:`,
    '',
    ctx.message,
    '',
    `Trip: ${b.tourName}, ${when} (${guestsLabel(b.guestCount)})`,
    `Phone: ${b.customerPhone || '—'}`,
    `Email: ${b.customerEmail}`,
    '',
    `Reply to this email to answer them.`,
    adminUrl,
  ].join('\n');

  const html = shell(
    subject,
    `
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 8px;font-size:22px;">Private feedback</h2>
    <p style="margin:0 0 12px;font-size:15px;"><strong>${esc(b.customerName)}</strong> sent this from the “Tell Travis privately” link in their thank-you email:</p>
    <blockquote style="margin:0 0 16px;padding:12px 14px;background:#F5EDD8;border-radius:10px;font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(ctx.message)}</blockquote>
    <p style="margin:0;font-size:14px;line-height:1.7;">
      ${esc(b.tourName)}, ${esc(when)} (${esc(guestsLabel(b.guestCount))})<br/>
      ${b.customerPhone ? `<a href="${esc(telHref(b.customerPhone))}" style="color:#1B6FA8;">${esc(b.customerPhone)}</a><br/>` : ''}
      <a href="mailto:${esc(b.customerEmail)}" style="color:#1B6FA8;">${esc(b.customerEmail)}</a>
    </p>
    <p style="margin:16px 0;font-size:14px;color:#4A524C;">Reply to this email to answer them.</p>
    ${primaryButton('Open the booking', adminUrl)}
    `,
  );

  return { subject, text, html, sms: `Private feedback from ${b.customerName}: ${ctx.message.slice(0, 120)}` };
}
