import type { Booking } from './types';
import {
  departureLabel,
  departureMinutes,
  escapeHtml as esc,
  longDate,
  partyLabel,
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
  /** Back after 7:00 (a sunset cruise): theirs goes tomorrow morning. */
  tomorrow?: Booking[];
  /** Today's bookings Travis is holding to call first. */
  held: Booking[];
  baseUrl: string;
}): OwnerEmail {
  const tomorrow = ctx.tomorrow ?? [];
  const n = ctx.going.length;
  const requests = (k: number) => `${k} review ${k === 1 ? 'request goes' : 'requests go'}`;
  // With only a late cruise today, it's tomorrow morning's list.
  const headline = n > 0 ? `${requests(n)} out at 7:00` : `${requests(tomorrow.length)} out tomorrow morning`;
  const subject = `${TAG} ${headline}`;
  const pageUrl = `${ctx.baseUrl}/admin/review-requests`;
  const byDeparture = (list: Booking[]) =>
    [...list].sort((a, b) => departureMinutes(a.timeSlot, a.date) - departureMinutes(b.timeSlot, b.date));
  const line = (b: Booking) => `${departureLabel(b)}: ${b.customerName} (${partyLabel([b.guestCount])})`;
  const tonightIntro = `Tonight at 7:00 these guests from today's trips (${longDate(ctx.date)}) get the thank-you email with the Google review link:`;
  const tomorrowIntro =
    n > 0
      ? 'Back after 7:00, so theirs goes out tomorrow morning:'
      : `These guests from today's trips (${longDate(ctx.date)}) are back after 7:00, so they get the thank-you email with the Google review link tomorrow morning:`;
  const deadline = n > 0 ? 'before 7:00' : 'before tomorrow morning';

  const text = [
    ...(n > 0 ? [tonightIntro, '', ...byDeparture(ctx.going).map((b) => `- ${line(b)}`)] : []),
    ...(tomorrow.length ? [...(n > 0 ? [''] : []), tomorrowIntro, '', ...byDeparture(tomorrow).map((b) => `- ${line(b)}`)] : []),
    ...(ctx.held.length ? ['', `Held for you to call first: ${ctx.held.map((b) => b.customerName).join(', ')}`] : []),
    '',
    `Anyone who didn't go out? Mark them "Didn't sail" ${deadline}. Want to call someone first? Tap "Hold".`,
    pageUrl,
  ].join('\n');

  const listHtml = (intro: string, list: Booking[]) => `
    <p style="margin:0 0 12px;font-size:15px;">${esc(intro)}</p>
    <ul style="padding-left:18px;margin:0 0 12px;font-size:15px;line-height:1.6;">
      ${byDeparture(list).map((b) => `<li>${esc(line(b))}</li>`).join('')}
    </ul>`;
  const html = shell(
    subject,
    `
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 8px;font-size:22px;">Review requests ${n > 0 ? 'at 7:00' : 'tomorrow morning'}</h2>
    ${n > 0 ? listHtml(tonightIntro, ctx.going) : ''}
    ${tomorrow.length ? listHtml(tomorrowIntro, tomorrow) : ''}
    ${ctx.held.length ? `<p style="margin:0 0 12px;font-size:14px;color:#4A524C;">Held for you to call first: ${esc(ctx.held.map((b) => b.customerName).join(', '))}</p>` : ''}
    <p style="margin:0 0 16px;font-size:14px;color:#4A524C;">Anyone who didn’t go out? Mark them “Didn’t sail” ${deadline}. Want to call someone first? Tap “Hold”.</p>
    ${primaryButton('Check the list', pageUrl)}
    `,
  );

  return { subject, text, html, sms: `${headline}. Check: ${pageUrl}` };
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
    `Trip: ${b.tourName}, ${when} (${partyLabel([b.guestCount])})`,
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
      ${esc(b.tourName)}, ${esc(when)} (${esc(partyLabel([b.guestCount]))})<br/>
      ${b.customerPhone ? `<a href="${esc(telHref(b.customerPhone))}" style="color:#1B6FA8;">${esc(b.customerPhone)}</a><br/>` : ''}
      <a href="mailto:${esc(b.customerEmail)}" style="color:#1B6FA8;">${esc(b.customerEmail)}</a>
    </p>
    <p style="margin:16px 0;font-size:14px;color:#4A524C;">Reply to this email to answer them.</p>
    ${primaryButton('Open the booking', adminUrl)}
    `,
  );

  return { subject, text, html, sms: `Private feedback from ${b.customerName}: ${ctx.message.slice(0, 120)}` };
}

/* -------------------------------------------------------------------------- */
/* A cancellation the crew never heard about                                  */
/* -------------------------------------------------------------------------- */

/**
 * To Travis when the crew's "Cancelled" email for a customer's cancellation
 * still hadn't gone when the hourly retries gave up (retryCrewAlerts). It's
 * the crew's only word of it: the 8 PM schedule just leaves the booking out.
 */
export function buildCrewNotToldEmail(ctx: { booking: Booking; baseUrl: string }): OwnerEmail {
  const b = ctx.booking;
  const name = b.customerName || 'A customer';
  const when = `${shortDate(b.date)}, ${departureLabel(b)}`;
  const subject = `${TAG} Crew not told: ${name} cancelled ${when}`;
  const adminUrl = `${ctx.baseUrl}/admin/bookings/${b.id}`;
  const lead = `${name} cancelled online: ${b.tourName}, ${longDate(b.date)}, ${departureLabel(b)} (${partyLabel([b.guestCount])}). The email telling the crew failed, and still hadn’t gone after a few hours of tries, so they don’t know.`;
  const next = 'Let them know yourself, so nobody turns up for it.';

  const text = [lead, '', next, adminUrl].join('\n');
  const html = shell(
    subject,
    `
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 8px;font-size:22px;">The crew weren’t told</h2>
    <p style="margin:0 0 12px;font-size:15px;">${esc(lead)}</p>
    <p style="margin:0 0 16px;font-size:15px;"><strong>${esc(next)}</strong></p>
    ${primaryButton('Open the booking', adminUrl)}
    `,
  );

  return { subject, text, html, sms: `Crew not told: ${name} cancelled ${when}. Tell them yourself.` };
}
