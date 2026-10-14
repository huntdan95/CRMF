import { isLegacyBooking, type Booking } from './types';
import { WHAT_WE_PROVIDE } from './email-templates';
import { SLOT_START_TIMES } from './schedule';
import {
  clockTime,
  departureTime,
  escapeHtml as esc,
  longDate,
} from './trip-format';

/*
 * Emails to guests sent on a schedule (lib/notify.ts → notifyGuest): trip
 * prep, day-of directions, and photos. Facts are the owner's answers
 * (2026-10-14) or wording already on the site; don't add new ones here.
 */

export const MARINA = {
  name: "Pete's Pier Marina",
  street: '1 SW First Place',
  cityLine: 'Crystal River, FL 34429',
};
export const MARINA_ADDRESS = `${MARINA.street}, ${MARINA.cityLine}`;
export const PHONE_DISPLAY = '352-586-7792';
const PHONE_HREF = 'tel:+13525867792';
/** The USFWS manatee manners video the booking form shows. */
export const MANNERS_VIDEO_URL = 'https://www.youtube.com/watch?v=YP3Erf3Kc2Y';

/** How early to arrive, from the owner: 20 to 30 minutes before departure. */
export const ARRIVE_EARLY = '20 to 30 minutes';

/** `between 10:00 and 10:10 AM` for a 10:30 AM departure. */
export function arrivalWindow(timeSlot: Booking['timeSlot']): string {
  const [h = 0, m = 0] = (SLOT_START_TIMES[timeSlot] ?? '00:00').split(':').map(Number);
  const at = (minsBefore: number) => {
    const t = h * 60 + m - minsBefore;
    return clockTime(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
  };
  const [early, late] = [at(30), at(20)];
  // "10:00 AM and 10:10 AM" → "10:00 and 10:10 AM" when both share AM/PM.
  return early.slice(-2) === late.slice(-2)
    ? `between ${early.slice(0, -3)} and ${late}`
    : `between ${early} and ${late}`;
}

export function myBookingUrl(baseUrl: string, b: Booking): string | null {
  return b.accessToken ? `${baseUrl}/my-booking/${b.id}?t=${b.accessToken}` : null;
}

export interface GuestEmail {
  subject: string;
  text: string;
  html: string;
  sms: string;
}

/* -------------------------------------------------------------------------- */
/* Shared layout                                                              */
/* -------------------------------------------------------------------------- */

const H3 = `font-family:'Fraunces',Georgia,serif;margin:24px 0 6px;color:#1A1F1B;font-size:18px;`;
const P = 'font-size:15px;line-height:1.6;margin:0 0 12px;';
const SOFT = 'font-size:14px;line-height:1.6;color:#4A524C;margin:0 0 12px;';

function layout(subject: string, title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"/><title>${esc(subject)}</title></head>
  <body style="margin:0;font-family:'Inter',-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;">
    <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
      <h1 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;font-size:28px;margin:0 0 12px;">${esc(title)}</h1>
      ${inner}
      <p style="font-size:14px;color:#4A524C;line-height:1.6;margin-top:28px;">
        See you on the water,<br/>
        <strong>Capt. Travis Urbin</strong><br/>
        Crystal River Manatee Fun<br/>
        <a href="${PHONE_HREF}" style="color:#1B6FA8;">${PHONE_DISPLAY}</a>
      </p>
    </div>
  </body>
</html>`;
}

function button(label: string, url: string, color = '#E08266'): string {
  return `<a href="${esc(url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:15px;">${esc(label)}</a>`;
}

function card(inner: string): string {
  return `<div style="background:#fff;border-radius:16px;padding:20px;margin:0 0 16px;box-shadow:0 2px 12px -4px rgba(26,31,27,.10);">${inner}</div>`;
}

const firstName = (b: Booking) => b.customerName.split(' ')[0] || b.customerName;

/* -------------------------------------------------------------------------- */
/* Trip prep (72 hours before)                                                */
/* -------------------------------------------------------------------------- */

/**
 * The weather policy as the site states it (FAQ: "Do you cancel for rain
 * or cold weather?" and "What if the weather is bad?").
 */
const WEATHER_POLICY =
  'We tour rain or shine when conditions are safe: rain, fog or a cold morning won’t stop you seeing manatees. ' +
  'Travis cancels for lightning or high winds, and if he does, you get a full refund.';

export function buildTripPrepEmail(ctx: { booking: Booking; baseUrl: string }): GuestEmail {
  const b = ctx.booking;
  const date = longDate(b.date);
  const departs = departureTime(b.timeSlot);
  const arrive = arrivalWindow(b.timeSlot);
  const manage = myBookingUrl(ctx.baseUrl, b);
  const legacy = isLegacyBooking(b);
  const subject = `Getting ready for your manatee tour on ${date}`;

  const text = [
    `Hi ${firstName(b)},`,
    '',
    `Your tour is coming up: ${b.tourName}, ${date}, departing at ${departs}.`,
    '',
    'WHAT TO WEAR',
    'Your swimsuit, under clothes suited to the weather.',
    '',
    'WHAT TO BRING',
    'A towel and reef-safe sunscreen.',
    '',
    'WHAT WE PROVIDE',
    ...WHAT_WE_PROVIDE.map((item) => `- ${item}`),
    '',
    'WHEN AND WHERE',
    `Arrive ${ARRIVE_EARLY} before departure, ${arrive}.`,
    `Park in the Pete's Pier parking lot. That's where we meet.`,
    `${MARINA.name}, ${MARINA_ADDRESS}`,
    '',
    'BEFORE YOU COME',
    `Watch the manatee manners video (about three minutes, from the U.S. Fish & Wildlife Service): ${MANNERS_VIDEO_URL}`,
    '',
    'WEATHER',
    WEATHER_POLICY,
    '',
    ...(manage && !legacy ? [`Your booking: ${manage}`, ''] : []),
    `Questions? Text or call Travis at ${PHONE_DISPLAY}.`,
    '',
    'See you on the water,',
    'Capt. Travis Urbin',
    'Crystal River Manatee Fun',
  ].join('\n');

  const html = layout(
    subject,
    'Getting ready for your tour',
    `
      <p style="${P}">Hi ${esc(firstName(b))}, your tour is coming up:
        <strong>${esc(b.tourName)}</strong>, ${esc(date)}, departing at <strong>${esc(departs)}</strong>.</p>
      ${card(`
        <h3 style="${H3}margin-top:0;">What to wear</h3>
        <p style="${P}">Your swimsuit, under clothes suited to the weather.</p>
        <h3 style="${H3}">What to bring</h3>
        <p style="${P}">A towel and reef-safe sunscreen.</p>
        <h3 style="${H3}">What we provide</h3>
        <ul style="padding-left:20px;margin:0;line-height:1.6;font-size:15px;">
          ${WHAT_WE_PROVIDE.map((item) => `<li>${esc(item)}</li>`).join('')}
        </ul>
      `)}
      ${card(`
        <h3 style="${H3}margin-top:0;">When and where</h3>
        <p style="${P}">Arrive <strong>${ARRIVE_EARLY} before departure</strong>, ${esc(arrive)}.</p>
        <p style="${P}">Park in the <strong>Pete’s Pier parking lot</strong>. That’s where we meet.</p>
        <p style="${SOFT}margin:0;">${esc(MARINA.name)}<br/>${esc(MARINA_ADDRESS)}</p>
      `)}
      ${card(`
        <h3 style="${H3}margin-top:0;">Before you come</h3>
        <p style="${P}">Watch the manatee manners video. It’s about three minutes, from the U.S. Fish &amp; Wildlife Service, and kid-friendly.</p>
        ${button('Watch the video', MANNERS_VIDEO_URL, '#1B6FA8')}
      `)}
      <h3 style="${H3}">Weather</h3>
      <p style="${SOFT}">${esc(WEATHER_POLICY)}</p>
      ${manage && !legacy ? `<p style="margin:20px 0 12px;">${button('View your booking', manage)}</p>` : ''}
      <p style="${SOFT}">Questions? Text or call Travis at <a href="${PHONE_HREF}" style="color:#1B6FA8;">${PHONE_DISPLAY}</a>.</p>
    `,
  );

  return {
    subject,
    text,
    html,
    sms: `Your manatee tour is ${date} at ${departs}. Wear your swimsuit under weather-appropriate clothes, bring a towel and reef-safe sunscreen, arrive ${arrive} and park in the Pete's Pier lot.`,
  };
}
