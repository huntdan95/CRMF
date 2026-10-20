import { isLegacyBooking, type Booking } from './types';
import { WHAT_WE_PROVIDE, arrivalWindow } from './email-templates';
import { slotStartMinutes } from './schedule';
import {
  actions,
  button,
  card,
  details,
  emailPage,
  escape as esc,
  heading,
  link,
  list,
  para,
  signoff,
  subheading,
  telHref,
} from './email-layout';
import { departureTime, longDate } from './trip-format';

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
/** The USFWS manatee manners video the booking form shows. */
export const MANNERS_VIDEO_URL = 'https://www.youtube.com/watch?v=YP3Erf3Kc2Y';

const FOOTER = { marina: { name: MARINA.name, address: MARINA_ADDRESS }, phoneDisplay: PHONE_DISPLAY };
const phoneLink = () => link(telHref(PHONE_DISPLAY), PHONE_DISPLAY);

/** "7:30–7:40 AM": 30 to 20 minutes before this booking's departure. */
function arriveBy(b: Pick<Booking, 'timeSlot' | 'date'>): string {
  return arrivalWindow(slotStartMinutes(b.timeSlot, b.date));
}

/** The sunset cruise is a cruise: nobody swims, there's no gear, and it's BYOB. */
const isCruise = (b: Pick<Booking, 'timeSlot'>) => b.timeSlot === 'sunset';
const outing = (b: Pick<Booking, 'timeSlot'>) => (isCruise(b) ? 'sunset cruise' : 'manatee tour');

export function myBookingUrl(baseUrl: string, b: Booking): string | null {
  return b.accessToken ? `${baseUrl}/my-booking/${b.id}?t=${b.accessToken}` : null;
}

export interface GuestEmail {
  subject: string;
  text: string;
  html: string;
  sms: string;
}

const firstName = (b: Booking) => b.customerName.split(' ')[0] || b.customerName;

/* -------------------------------------------------------------------------- */
/* Trip prep (72 hours before)                                                */
/* -------------------------------------------------------------------------- */

/** The weather policy as the reminder and closing-a-day emails state it. */
const WEATHER_POLICY =
  'If the weather closes the river, Travis will let you know. You won’t lose your money: he’ll move you to another day or refund you in full.';

export function buildTripPrepEmail(ctx: { booking: Booking; baseUrl: string }): GuestEmail {
  const b = ctx.booking;
  const cruise = isCruise(b);
  const date = longDate(b.date);
  const departs = departureTime(b.timeSlot, b.date);
  const arrive = arriveBy(b);
  // Old-site bookings can't be managed online; they call Travis.
  const manage = isLegacyBooking(b) ? null : myBookingUrl(ctx.baseUrl, b);
  const subject = `Getting ready for your ${outing(b)} on ${date}`;
  const wear = cruise
    ? 'Clothes for an evening on the water, and a warm layer for after sunset.'
    : 'Your swimsuit, under clothes suited to the weather.';
  const bring = cruise
    ? 'It’s BYOB: bring your own drinks and food.'
    : 'A towel and reef-safe sunscreen.';

  const text = [
    `Hi ${firstName(b)},`,
    '',
    `Your ${outing(b)} is coming up: ${b.tourName}, ${date}, departing at ${departs}.`,
    '',
    'WHAT TO WEAR',
    wear,
    '',
    'WHAT TO BRING',
    bring,
    ...(cruise ? [] : ['', 'WHAT WE PROVIDE', ...WHAT_WE_PROVIDE.map((item) => `- ${item}`)]),
    '',
    'WHEN AND WHERE',
    `Arrive 20 to 30 minutes before departure: ${arrive}.`,
    `Park and meet in the Pete's Pier parking lot.`,
    `${MARINA.name}, ${MARINA_ADDRESS}`,
    ...(cruise
      ? []
      : [
          '',
          'BEFORE YOU COME',
          `Watch the manatee manners video (about three minutes, from the U.S. Fish & Wildlife Service): ${MANNERS_VIDEO_URL}`,
        ]),
    '',
    'WEATHER',
    WEATHER_POLICY,
    '',
    ...(manage ? [`Your booking: ${manage}`, ''] : []),
    `Questions? Text or call Travis at ${PHONE_DISPLAY}.`,
    '',
    'See you on the water,',
    'Capt. Travis Urbin',
    'Crystal River Manatee Fun',
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `Departs ${departs}. Arrive ${arrive} and park in the Pete's Pier lot.`,
    footer: FOOTER,
    body: [
      heading(cruise ? 'Getting ready for your cruise' : 'Getting ready for your tour'),
      para(
        `Hi ${esc(firstName(b))}, your ${outing(b)} is coming up: <strong>${esc(b.tourName)}</strong>, ${esc(date)}, departing at <strong>${esc(departs)}</strong>.`,
        { large: true, margin: '0 0 24px' },
      ),
      card(
        details([
          ['Arrive', `<strong>${esc(arrive)}</strong><br/>20 to 30 minutes before departure`],
          ['Where', `${esc(MARINA.name)}<br/>${esc(MARINA_ADDRESS)}<br/>Park and meet in the Pete’s Pier parking lot.`],
          ['Wear', esc(wear)],
          ['Bring', esc(bring)],
        ]),
        { table: true },
      ),
      cruise ? '' : subheading('What we provide'),
      cruise ? '' : list(WHAT_WE_PROVIDE.map(esc)),
      cruise ? '' : subheading('Before you come'),
      cruise
        ? ''
        : para(
            'Watch the manatee manners video. It’s about three minutes, from the U.S. Fish &amp; Wildlife Service, and kid-friendly.',
          ),
      cruise ? '' : actions(button(MANNERS_VIDEO_URL, 'Watch the video', { secondary: true })),
      subheading('Weather'),
      para(esc(WEATHER_POLICY), { soft: true, small: true }),
      manage ? actions(button(manage, 'View your booking')) : '',
      para(`Questions? Text or call Travis at ${phoneLink()}.`, { soft: true, small: true }),
      signoff('See you on the water,'),
    ].join('\n'),
  });

  return {
    subject,
    text,
    html,
    sms: cruise
      ? `Your sunset cruise is ${date} at ${departs}. It's BYOB. Arrive ${arrive} and park in the Pete's Pier lot.`
      : `Your manatee tour is ${date} at ${departs}. Wear your swimsuit under weather-appropriate clothes, bring a towel and reef-safe sunscreen, arrive ${arrive} and park in the Pete's Pier lot.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Day-of directions (2 hours before, never before 6 AM)                       */
/* -------------------------------------------------------------------------- */

const DESTINATION = `${MARINA.name}, ${MARINA_ADDRESS}`;
/** encodeURIComponent leaves the apostrophe in "Pete's", which ends a link early in some mail apps. */
const q = (s: string) => encodeURIComponent(s).replace(/'/g, '%27');
export const GOOGLE_MAPS_URL = `https://www.google.com/maps/dir/?api=1&destination=${q(DESTINATION)}`;
export const APPLE_MAPS_URL = `https://maps.apple.com/?daddr=${q(MARINA_ADDRESS)}&q=${q(MARINA.name)}`;

export function buildDirectionsEmail(ctx: { booking: Booking; baseUrl: string }): GuestEmail {
  const b = ctx.booking;
  const departs = departureTime(b.timeSlot, b.date);
  const arrive = arriveBy(b);
  const manage = isLegacyBooking(b) ? null : myBookingUrl(ctx.baseUrl, b);
  const subject = `Today: directions to your ${departs} ${outing(b)}`;

  const text = [
    `Hi ${firstName(b)},`,
    '',
    `See you today! ${b.tourName}, departing at ${departs}.`,
    '',
    'WHERE',
    MARINA.name,
    MARINA_ADDRESS,
    `Google Maps: ${GOOGLE_MAPS_URL}`,
    `Apple Maps: ${APPLE_MAPS_URL}`,
    '',
    `Park and meet in the Pete's Pier parking lot.`,
    `Arrive 20 to 30 minutes before departure: ${arrive}.`,
    '',
    `Running late or can't find us? Call or text Travis: ${PHONE_DISPLAY}`,
    ...(manage ? ['', `Your booking: ${manage}`] : []),
    '',
    'See you on the water,',
    'Capt. Travis Urbin',
    'Crystal River Manatee Fun',
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `Departs ${departs}. Arrive ${arrive}.`,
    footer: FOOTER,
    body: [
      heading('See you today'),
      para(`Hi ${esc(firstName(b))}, your <strong>${esc(b.tourName)}</strong> departs at <strong>${esc(departs)}</strong>.`, {
        large: true,
        margin: '0 0 24px',
      }),
      card(
        details([
          ['Arrive', `<strong>${esc(arrive)}</strong><br/>20 to 30 minutes before departure`],
          ['Where', `${esc(MARINA.name)}<br/>${esc(MARINA.street)}<br/>${esc(MARINA.cityLine)}<br/>Park and meet in the Pete’s Pier parking lot.`],
        ]),
        { table: true },
      ),
      actions(button(GOOGLE_MAPS_URL, 'Google Maps'), button(APPLE_MAPS_URL, 'Apple Maps', { secondary: true })),
      para(`Running late or can’t find us? Call or text Travis: <strong>${phoneLink()}</strong>`),
      manage ? para(link(manage, 'View your booking'), { soft: true, small: true }) : '',
      signoff('See you on the water,'),
    ].join('\n'),
  });

  return {
    subject,
    text,
    html,
    sms: `See you today at ${departs}! ${DESTINATION}. Park and meet in the Pete's Pier lot, ${arrive}. Travis: ${PHONE_DISPLAY}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Trip photos                                                                */
/* -------------------------------------------------------------------------- */

const INSTAGRAM_HANDLE = '@capt.travisurbin';
const INSTAGRAM_URL = 'https://www.instagram.com/capt.travisurbin/';

export function galleryUrl(baseUrl: string, b: Booking): string | null {
  return b.accessToken ? `${baseUrl}/my-booking/${b.id}/photos?t=${b.accessToken}` : null;
}

/** The photos from their trip are ready. No review request here; that's its own email. */
export function buildTripPhotosEmail(ctx: { booking: Booking; galleryUrl: string; count: number }): GuestEmail {
  const b = ctx.booking;
  const date = longDate(b.date);
  const subject = `Your ${outing(b)} photos are here`;
  const what = `${ctx.count} ${ctx.count === 1 ? 'photo or video' : 'photos and videos'}`;

  const text = [
    `Hi ${firstName(b)},`,
    '',
    `The photos and videos from your ${outing(b)} on ${date} are ready (${what} so far):`,
    `   ${ctx.galleryUrl}`,
    '',
    'Download them one at a time, or all at once.',
    '',
    `Posting any? Tag us on Instagram, ${INSTAGRAM_HANDLE}. We love sharing guest shots:`,
    `   ${INSTAGRAM_URL}`,
    '',
    'See you on the water,',
    'Capt. Travis Urbin',
    'Crystal River Manatee Fun',
    PHONE_DISPLAY,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${what} from ${date}, ready to download.`,
    footer: FOOTER,
    body: [
      heading('Your photos are here'),
      para(`Hi ${esc(firstName(b))}, the photos and videos from your ${outing(b)} on <strong>${esc(date)}</strong> are ready.`, {
        large: true,
      }),
      actions(button(ctx.galleryUrl, 'See your photos')),
      para(`${esc(what)} so far. Download them one at a time, or all at once.`, { soft: true, small: true }),
      card(
        [
          subheading('Posting any?', { margin: '0 0 8px' }),
          para(`Tag us on Instagram, <strong>${INSTAGRAM_HANDLE}</strong>. We love sharing guest shots.`, { margin: '0 0 4px' }),
          para(link(INSTAGRAM_URL, 'Open Instagram'), { margin: '0' }),
        ].join(''),
      ),
      signoff('See you on the water,'),
    ].join('\n'),
  });

  return {
    subject,
    text,
    html,
    sms: `Your ${outing(b)} photos are ready: ${ctx.galleryUrl} Tag us on Instagram ${INSTAGRAM_HANDLE}!`,
  };
}
