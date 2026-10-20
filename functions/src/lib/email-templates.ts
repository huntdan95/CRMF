import { isLegacyBooking, type Booking } from './types';
import type { LastMinuteBooking, PaidAfterCancellation, PaidOnClosedDeparture } from './checkout-completed';
import type { DayForecast } from './forecast';
import { formatPrice, slotLabels } from './tours';
import { SLOT_MINUTES, slotStartMinutes, slotStartTime } from './schedule';
import { waiverUrl } from './waiver-link';
import { ONLINE_CUTOFF_MINUTES, departureClock, marinaNow, tripDayLabel } from './datetime';
import { phoneHref, tripLabel } from './bounce-alert';
import { NO_WETSUIT } from './site-settings';
import { guestsLabel } from './trip-format';
import {
  COLORS,
  actions,
  button,
  card,
  details,
  emailPage,
  escape,
  figure,
  heading,
  label,
  link,
  list,
  notice,
  para,
  signoff,
  subheading,
  telHref,
} from './email-layout';

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

/** "Saturday, Nov 9", for subject lines. */
function fmtShortDate(date: string): string {
  const [y, m, d] = date.split('-').map((n) => Number.parseInt(n, 10));
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/** "8:00 AM", from minutes after midnight. */
function fmtClock(mins: number): string {
  const h = Math.floor(mins / 60);
  return `${((h + 11) % 12) + 1}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Departure time and arrival window for a booking, from the schedule
 * (./schedule.ts; the sunset cruise's moves with the sun). "Morning" alone
 * isn't enough to show up for, and guests arrive 20 to 30 minutes before
 * departure. Null for a slot the schedule doesn't know.
 */
function slotTimes(timeSlot: Booking['timeSlot'], date: string): { departs: string; arrive: string } | null {
  if (!(timeSlot in SLOT_MINUTES)) return null;
  const start = slotStartMinutes(timeSlot, date);
  return { departs: fmtClock(start), arrive: arrivalWindow(start) };
}

/** "7:30–7:40 AM": 30 to 20 minutes before a departure `start` minutes after midnight. */
export function arrivalWindow(start: number): string {
  const from = fmtClock(start - 30);
  const to = fmtClock(start - 20);
  const [fromTime, fromMeridiem] = from.split(' ');
  return to.endsWith(` ${fromMeridiem}`) ? `${fromTime}–${to}` : `${from}–${to}`;
}

/** The sunset cruise is a cruise: nobody swims, there's no gear, and it's BYOB. */
function isCruise(booking: Pick<Booking, 'timeSlot'>): boolean {
  return booking.timeSlot === 'sunset';
}

/** "Morning, departs 8:00 AM (please arrive 7:30–7:40 AM)", or just the slot. */
function whenLine(timeSlot: Booking['timeSlot'], date: string): string {
  const t = slotTimes(timeSlot, date);
  const slot = slotLabels[timeSlot] ?? timeSlot;
  return t ? `${slot}, departs ${t.departs} (please arrive ${t.arrive})` : slot;
}

export function buildBookingConfirmation(ctx: ConfirmationContext) {
  const { booking, baseUrl, marina, phoneDisplay } = ctx;
  const dateStr = fmtDate(booking.date);
  const slot = whenLine(booking.timeSlot, booking.date);
  const totalDisplay =
    formatPrice(booking.amountPaidCents) +
    (booking.salesTaxCents ? `, including ${formatPrice(booking.salesTaxCents)} Florida sales tax` : '');
  // After a partial refund (an updated confirmation, say) the amount paid
  // alone overstates what they're out.
  const refunded = booking.amountRefundedCents ?? 0;
  const refundNote = refunded > 0 ? ` (${formatPrice(refunded)} refunded)` : '';
  // An old-site reservation paid a deposit or part of the price there; the
  // rest is between them and Travis (the importer's note has him collect it).
  const reservation = isLegacyBooking(booking) && booking.status === 'pending-payment';
  const balanceLine = 'Any balance is settled with Travis, not on this site.';
  const selfServiceUrl = `${baseUrl}/my-booking/${booking.id}?t=${booking.accessToken}`;
  const waiverLink = waiverUrl(baseUrl, booking.id, booking.accessToken);

  const subject = `Tour confirmed for ${dateStr} — ${booking.tourName}`;

  // A blank name is a guest they haven't named yet ("leave blank if you
  // don't know them yet"): counted, not listed as an empty line.
  const named = booking.guests.filter((g) => g.name.trim());
  const unnamed = Math.max(0, booking.guestCount - named.length);
  const moreGuests = unnamed > 0 ? `Plus ${unnamed} more ${unnamed === 1 ? 'guest' : 'guests'} not named yet.` : null;
  /** "(age 9, wetsuit Kids 10)", or whichever of the two they gave. */
  const guestDetails = (g: Booking['guests'][number]) => {
    const parts = [
      ...(g.age != null ? [`age ${g.age}`] : []),
      ...(g.wetsuitSize === NO_WETSUIT ? ['not swimming'] : g.wetsuitSize ? [`wetsuit ${g.wetsuitSize}`] : []),
    ];
    return parts.length ? ` (${parts.join(', ')})` : '';
  };
  const guestList = named
    .map((g, i) => `   ${i + 1}. ${g.name}${guestDetails(g)}`)
    .join('\n');

  const text = [
    `Hi ${booking.customerName.split(' ')[0]},`,
    '',
    `Your ${isCruise(booking) ? 'sunset cruise' : 'manatee tour'} is locked in. Here's what you need to know:`,
    '',
    `Tour:     ${booking.tourName}`,
    `When:     ${dateStr}, ${slot}`,
    `Where:    ${marina.name}`,
    `          ${marina.address}`,
    // 0: an old-website booking with no party size on file. Left out, as
    // the HTML part does.
    ...(booking.guestCount > 0 ? [`Guests:   ${booking.guestCount}`] : []),
    `Paid:     ${totalDisplay}${refundNote}${reservation ? ' so far' : ''}`,
    ...(reservation ? [`          ${balanceLine}`] : []),
    '',
    `BEFORE THE TRIP: everyone signs the waiver`,
    `Every adult signs their own liability waiver on their phone (about`,
    `3 minutes). A parent or legal guardian signs for anyone under 18.`,
    `No one boards without a signed waiver. Forward this link to`,
    `everyone in your party:`,
    `   ${waiverLink}`,
    '',
    ...(isLegacyBooking(booking)
      ? [`To change or cancel, call or text Travis at ${phoneDisplay}.`]
      : [`Manage or cancel your booking:`, `   ${selfServiceUrl}`]),
    '',
    ...(named.length > 0 ? [`Your party:`, guestList, ...(moreGuests ? [`   ${moreGuests}`] : []), ''] : []),
    ...(isCruise(booking)
      ? [
          `Arrive 20 to 30 minutes before departure and meet in the Pete's Pier`,
          `parking lot. It's BYOB: bring your own drinks and food.`,
        ]
      : [
          `Arrive 20 to 30 minutes before departure and meet in the Pete's Pier`,
          `parking lot. Wear your swimsuit under clothes suited to the weather,`,
          `and bring your own towel and reef-safe sunscreen.`,
          '',
          // The HTML part's list, so a plain-text reader hears about the
          // swim guide and the free photos too.
          `What we provide:`,
          ...WHAT_WE_PROVIDE.map((item) => `   - ${item}`),
        ]),
    '',
    `Questions or weather concerns? Text or call Travis at ${phoneDisplay}.`,
    '',
    `See you on the water,`,
    `Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${dateStr}. ${slot}.`,
    footer: { marina, phoneDisplay },
    body: [
      heading(isCruise(booking) ? 'Your sunset cruise is confirmed' : 'Your tour is confirmed'),
      para(`Hi ${escape(booking.customerName.split(' ')[0])} — see you on <strong>${escape(dateStr)}</strong>.`, { large: true, margin: '0 0 24px' }),
      card(
        details([
          ['Tour', escape(booking.tourName)],
          ['When', `${escape(dateStr)}<br/>${escape(slot)}`],
          ['Where', `${escape(marina.name)}<br/>${escape(marina.address)}<br/>Park and meet in the Pete's Pier parking lot.`],
          booking.guestCount > 0 && ['Guests', String(booking.guestCount)],
          [
            'Paid',
            `<strong>${escape(totalDisplay)}</strong>${escape(refundNote)}${
              reservation ? ` so far<br/><span style="color:${COLORS.inkSoft};">${escape(balanceLine)}</span>` : ''
            }`,
          ],
        ]),
        { table: true },
      ),
      notice(
        subheading('Before the trip: everyone signs the waiver', { margin: '0 0 6px' }) +
          para(
            'Every adult signs their own liability waiver on their phone. It takes about 3 minutes. A parent or legal guardian signs for anyone under 18. No one boards without a signed waiver. Forward this link to everyone in your party.',
            { small: true, margin: '0 0 4px' },
          ) +
          actions(button(waiverLink, 'Sign the waiver')),
      ),
      isLegacyBooking(booking)
        ? para(`To change or cancel, call or text Travis at ${link(telHref(phoneDisplay), phoneDisplay)}.`)
        : actions(button(selfServiceUrl, 'Manage your booking', { secondary: true })),
      named.length > 0 ? subheading('Your party') : '',
      named.length > 0
        ? list(
            named.map(
              (g) =>
                `${escape(g.name)}${guestDetails(g) ? ` <span style="color:${COLORS.inkSoft};">${escape(guestDetails(g).trim())}</span>` : ''}`,
            ),
            { ordered: true, margin: moreGuests ? '0 0 4px' : undefined },
          )
        : '',
      named.length > 0 && moreGuests ? para(escape(moreGuests), { soft: true, small: true }) : '',
      subheading('What to bring'),
      isCruise(booking)
        ? list(['Your own drinks: it’s BYOB', 'Your own food'])
        : list(['Your swimsuit, worn under clothes suited to the weather', 'Your own towel', 'Reef-safe sunscreen']),
      isCruise(booking) ? '' : subheading('What we provide'),
      isCruise(booking)
        ? ''
        : list(WHAT_WE_PROVIDE),
      para(`Questions or weather concerns? Text or call Travis at ${link(telHref(phoneDisplay), phoneDisplay)}.`, { soft: true, small: true }),
      signoff('See you on the water,'),
    ].join('\n'),
  });

  return { subject, text, html };
}

/** What's on the boat for every swim guest. The trip-prep email lists it too. */
export const WHAT_WE_PROVIDE = [
  'Wetsuit, mask, and snorkel',
  'Dedicated in-water swim guide',
  'Free GoPro photos from your tour',
  'Bottled water and hot chocolate on the boat',
];

/* -------------------------------------------------------------------------- */
/* Closed departure: pick a new date or a refund                              */
/* -------------------------------------------------------------------------- */

interface ClosureOfferContext {
  booking: Booking;
  /** What the customer is told, e.g. "Closed for weather". */
  reason: string;
  /** Last day to choose, YYYY-MM-DD. */
  decideBy: string;
  baseUrl: string;
  phoneDisplay: string;
  marina: { name: string; address: string };
  /**
   * The one reminder the day before the deadline, to someone who hasn't
   * chosen yet (closureReminders.ts). Same choices and wording, with a
   * reminder subject, heading and first line.
   */
  reminder?: boolean;
}

/**
 * Sent when Travis closes a departure and offers the people on it another
 * date or their money back (lib/close-day.ts). Both are on the booking
 * page; this email says what happens if they do neither.
 */
export function buildClosureOfferEmail(ctx: ClosureOfferContext) {
  const { booking, reason, decideBy, baseUrl, phoneDisplay, marina, reminder = false } = ctx;
  const firstName = booking.customerName.split(' ')[0];
  const dateStr = fmtDate(booking.date);
  const decideStr = fmtDate(decideBy);
  const departs = slotTimes(booking.timeSlot, booking.date)?.departs;
  const noun = isCruise(booking) ? 'sunset cruise' : 'tour';
  const tourWhen = departs ? `${departs} ${noun}` : noun;
  const pageUrl = `${baseUrl}/my-booking/${booking.id}?t=${booking.accessToken}`;
  const phoneHref = `tel:+1${phoneDisplay.replace(/[^0-9]/g, '')}`;
  const owed = Math.max(0, booking.amountPaidCents - (booking.amountRefundedCents ?? 0));
  const byHand = isLegacyBooking(booking);
  // What moveClosedBooking allows: an old-site shared booking with no party
  // size on file can't be moved online (seats can't be counted), and no
  // booking moves online onto a date priced higher.
  const moveByPhone = booking.type === 'shared' && booking.guestCount < 1;
  const callToMove = (phone: string) =>
    `Move to another date: we don’t have your party size on file, so call or text Travis at ${phone} to pick one.`;

  const subject = reminder
    ? `Reminder: pick a new date or a refund for your ${fmtShortDate(booking.date)} ${noun} by ${fmtShortDate(decideBy)}`
    : `Your ${fmtShortDate(booking.date)} ${noun} can’t go out: pick a new date or a refund`;
  const lead = reminder
    ? `A reminder: Capt. Travis couldn’t run your ${tourWhen} on ${dateStr}, and you haven’t picked a new date or a refund yet.`
    : `Capt. Travis can’t run your ${tourWhen} on ${dateStr}. Sorry about that.`;
  const moveLine = moveByPhone
    ? callToMove(phoneDisplay)
    : `Move to another date: same ${noun}, any open departure at the same price or less, no charge.`;
  const pageLine = moveByPhone
    ? `${owed === 0 ? 'Cancelling' : 'Choosing the refund'} is one tap on your booking page:`
    : 'Both are one tap on your booking page:';
  const refundLine =
    owed === 0
      ? 'Or cancel: you haven’t been charged, so there’s nothing to pay back.'
      : byHand
        ? `Or get your ${formatPrice(owed)} back: Travis refunds it himself, since you booked on our old website.`
        : `Or get a full refund of ${formatPrice(owed)} to your card.`;
  const deadline =
    owed === 0
      ? `If you haven’t picked a date by ${decideStr}, we’ll cancel the booking.`
      : byHand
        ? `If you haven’t picked a date by ${decideStr}, we’ll cancel the booking and Travis will refund your ${formatPrice(owed)} himself.`
        : `If you haven’t picked a date by ${decideStr}, we’ll refund you in full automatically.`;

  const text = [
    `Hi ${firstName},`,
    '',
    lead,
    `Reason: ${reason}`,
    '',
    `Your booking isn't lost. Choose what suits you:`,
    `  • ${moveLine}`,
    `  • ${refundLine}`,
    '',
    pageLine,
    `   ${pageUrl}`,
    '',
    deadline,
    '',
    `Questions, or want to talk it through? Call or text Travis at ${phoneDisplay}.`,
    '',
    `— Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: reminder
      ? `Last day to choose: ${fmtShortDate(decideBy)}.`
      : // As refundLine has it: with nothing paid there's nothing to refund.
        `Your booking isn’t lost: move it to another date or ${owed === 0 ? 'cancel it' : 'take a full refund'}.`,
    footer: { marina, phoneDisplay },
    body: [
      heading(reminder ? 'Still time to pick a new date' : 'Pick a new date'),
      para(`Hi ${escape(firstName)} — ${escape(lead)}`, { large: true }),
      para(`<strong>Reason:</strong> ${escape(reason)}`, { soft: true, small: true, margin: '0 0 24px' }),
      notice(
        para('<strong>Your booking isn’t lost.</strong> Choose what suits you:', { margin: '0 0 10px' }) +
          list([moveByPhone ? callToMove(link(phoneHref, phoneDisplay)) : escape(moveLine), escape(refundLine)]) +
          actions(button(pageUrl, moveByPhone ? 'Open your booking page' : 'Choose a new date or a refund')),
      ),
      card(
        details([
          ['Tour', escape(booking.tourName)],
          ['Was', `${escape(dateStr)}${departs ? `, ${escape(departs)}` : ''}`],
          booking.guestCount > 0 && ['Guests', String(booking.guestCount)],
        ]),
        { table: true },
      ),
      para(escape(deadline), { soft: true, small: true }),
      para(`Questions, or want to talk it through? Call or text Travis at ${link(phoneHref, phoneDisplay)}.`, { soft: true, small: true }),
      signoff(),
    ].join('\n'),
  });

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Day-before reminder                                                        */
/* -------------------------------------------------------------------------- */

interface ReminderContext {
  booking: Booking;
  baseUrl: string;
  marina: { name: string; address: string; mapUrl: string };
  phoneDisplay: string;
  /** Left out when Open-Meteo couldn't be reached. */
  forecast: DayForecast | null;
}

/** Below this high, the reminder says to bring a warm layer. */
const COOL_DAY_F = 70;

export function buildTourReminderEmail(ctx: ReminderContext) {
  const { booking, baseUrl, marina, phoneDisplay, forecast } = ctx;
  const firstName = booking.customerName.split(' ')[0];
  const dateStr = fmtDate(booking.date);
  const times = slotTimes(booking.timeSlot, booking.date);
  const departs = times?.departs ?? slotLabels[booking.timeSlot] ?? booking.timeSlot;
  const legacy = isLegacyBooking(booking);
  const selfServiceUrl = `${baseUrl}/my-booking/${booking.id}?t=${booking.accessToken}`;
  const phoneHref = `tel:+1${phoneDisplay.replace(/[^0-9]/g, '')}`;

  const cruise = isCruise(booking);
  const subject = `Tomorrow at ${departs}: your ${cruise ? 'sunset cruise' : 'manatee tour'}`;

  const forecastLine = forecast
    ? `${forecast.label}, high ${forecast.highF}°F, low ${forecast.lowF}°F, ${forecast.rainPct}% chance of rain.`
    : null;
  const coolDay = !!forecast && forecast.highF < COOL_DAY_F;
  const bring = cruise
    ? 'It’s BYOB: bring your own drinks and food.'
    : 'Wear your swimsuit under clothes suited to the weather, and bring your own towel and reef-safe sunscreen. Wetsuit, mask and snorkel are on the boat, plus bottled water and hot chocolate.';
  const warmLayer = cruise
    ? 'It’ll be cool on the water after sunset: bring a warm layer.'
    : 'It’ll be cool on the boat: bring a warm layer and dry clothes for after your swim.';
  const weatherPolicy =
    'If the weather closes the river, Travis will let you know. You won’t lose your money: he’ll move you to another day or refund you in full.';

  const text = [
    `Hi ${firstName},`,
    '',
    `Quick reminder: you're on the water with Capt. Travis tomorrow.`,
    '',
    `Tour:       ${booking.tourName}`,
    `When:       ${dateStr}, departs ${departs}`,
    times ? `Arrive:     ${times.arrive}` : null,
    `Where:      ${marina.name}`,
    `            ${marina.address}`,
    `            Park and meet in the Pete's Pier parking lot.`,
    `Directions: ${marina.mapUrl}`,
    booking.guestCount > 0 ? `Guests:     ${booking.guestCount}` : null,
    '',
    forecastLine ? `Tomorrow's forecast: ${forecastLine}` : null,
    forecastLine ? '' : null,
    bring,
    coolDay ? warmLayer : null,
    '',
    weatherPolicy,
    '',
    legacy
      ? `Need to change something? Call or text Travis at ${phoneDisplay}.`
      : `Need to change something? ${selfServiceUrl}`,
    `Running late or can't find us? Call or text Travis at ${phoneDisplay}.`,
    '',
    `See you tomorrow,`,
    `Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
  ]
    // Drop only the optional lines left out (null); the blank spacers stay.
    .filter((line) => line !== null)
    .join('\n');

  const html = emailPage({
    title: subject,
    preheader: times ? `Departs ${departs}. Please arrive ${times.arrive}.` : `Departs ${departs}.`,
    footer: { marina, phoneDisplay },
    body: [
      heading('See you tomorrow'),
      para(`Hi ${escape(firstName)} — quick reminder: you’re on the water with Capt. Travis tomorrow.`, { large: true, margin: '0 0 24px' }),
      card(
        details([
          ['Tour', escape(booking.tourName)],
          ['When', `${escape(dateStr)}<br/>Departs ${escape(departs)}`],
          times && ['Arrive', `<strong style="color:${COLORS.spring};">${escape(times.arrive)}</strong>`],
          ['Where', `${escape(marina.name)}<br/>${escape(marina.address)}<br/>Park and meet in the Pete's Pier parking lot.<br/>${link(marina.mapUrl, 'Directions')}`],
          booking.guestCount > 0 && ['Guests', String(booking.guestCount)],
          forecastLine ? ['Forecast', escape(forecastLine)] : null,
        ]),
        { table: true },
      ),
      subheading('What to bring'),
      para(escape(bring)),
      coolDay ? para(`<strong>${escape(warmLayer)}</strong>`) : '',
      para(escape(weatherPolicy), { soft: true, small: true }),
      legacy
        ? para(`Need to change something? Call or text Travis at ${link(phoneHref, phoneDisplay)}.`, { small: true })
        : actions(button(selfServiceUrl, 'Manage your booking')),
      para(`Running late or can’t find us? Call or text Travis at ${link(phoneHref, phoneDisplay)}.`, { soft: true, small: true }),
      signoff('See you tomorrow,'),
    ].join('\n'),
  });

  return { subject, text, html };
}


/* -------------------------------------------------------------------------- */
/* Cancellation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Why Travis's cancel happened, for its wording. `trip-closed`: he closed
 * the departure and cancelled everyone on it (lib/close-day.ts), so this
 * is the bad news. On a departure he closed with "pick a new date", the
 * customer took the refund instead (`refund-chosen`), or didn't choose by
 * the deadline (`deadline-passed`): the closure was the bad news, and its
 * email already said so; this one only confirms what happened.
 *
 * With none, he cancelled this one booking, often because the customer
 * asked him to (old-site customers are told to call him), so the email
 * just says it's cancelled and his reason, if he gave one, says why.
 */
export type CancellationCause = 'trip-closed' | 'refund-chosen' | 'deadline-passed';

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
  /** With `cancelledBy: 'admin'`; left out, it reads as Travis cancelling this one booking. */
  cause?: CancellationCause;
}

export function buildCancellationEmail(ctx: CancellationContext) {
  const { booking, refundCents, refundPercent, cancelledBy, reason, cause } = ctx;
  const manualCents = ctx.manualRefundCents ?? 0;
  const earlierCents = ctx.previouslyRefundedCents ?? 0;
  const leftCents = Math.max(0, booking.amountPaidCents - earlierCents);
  const dateStr = fmtDate(booking.date);
  const refundDisplay = formatPrice(refundCents + manualCents);
  const paidDisplay = formatPrice(booking.amountPaidCents);
  const earlierDisplay = formatPrice(earlierCents);
  const fullRefund = refundCents > 0 && refundCents === leftCents;
  const noun = isCruise(booking) ? 'sunset cruise' : 'tour';
  // "Saturday, Nov 7 tour", not the tour's name: that already ends in "Tour — Shared".
  const trip = `${fmtShortDate(booking.date)} ${noun}`;
  const closed = cancelledBy === 'admin' ? cause : undefined;

  const subject =
    closed === 'refund-chosen'
      ? `Your ${trip} is cancelled, as you asked`
      : closed === 'deadline-passed'
        ? `No new date picked, so your ${trip} is cancelled`
        : closed === 'trip-closed'
          ? `Your ${trip} was cancelled by Capt. Travis`
          : cancelledBy === 'admin'
            ? `Your booking for the ${trip} has been cancelled`
            : `Cancellation confirmed — ${booking.tourName}, ${dateStr}`;

  const lead =
    closed === 'refund-chosen'
      ? `As you asked, your ${noun} on ${dateStr} is cancelled rather than moved to another date. Sorry again that Capt. Travis couldn’t take you out. Hope you make it back to the river another time.`
      : closed === 'deadline-passed'
        ? `We didn’t hear back about a new date for your ${noun} on ${dateStr}, the one Capt. Travis couldn’t run, so it’s now cancelled, as our earlier email said. Hope you make it back to the river another time.`
        : closed === 'trip-closed'
          ? `Travis had to cancel your ${noun} on ${dateStr}. Sorry to break the news — usually this is weather or a boat issue, never personal.`
          : cancelledBy === 'admin'
            ? `Your booking for the ${noun} on ${dateStr} has been cancelled.`
            : `Your ${noun} on ${dateStr} has been cancelled. Sorry to see you go — hope you make it back to the river another time.`;

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
        ? `The remaining ${refundDisplay} of your ${paidDisplay} payment has been refunded to your card (${earlierDisplay} was refunded earlier). It usually shows up in 5-10 business days.`
      : fullRefund
        ? `A full refund of ${refundDisplay} has been issued to your card. It usually shows up in 5-10 business days.`
      : earlierCents > 0
        ? `A ${refundPercent}% refund of ${refundDisplay} has been issued to your card: ${refundPercent}% of the ${formatPrice(leftCents)} left after an earlier ${earlierDisplay} refund (you paid ${paidDisplay}). It usually shows up in 5-10 business days.`
        : `A ${refundPercent}% refund of ${refundDisplay} has been issued to your card (you paid ${paidDisplay}). It usually shows up in 5-10 business days.`;

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

  const html = emailPage({
    title: subject,
    footer: { marina: ctx.marina, phoneDisplay: ctx.phoneDisplay },
    body: [
      heading(
        closed === 'refund-chosen'
          ? 'Cancelled, as you asked'
          : closed === 'trip-closed'
            ? `${isCruise(booking) ? 'Sunset cruise' : 'Tour'} cancelled by Capt. Travis`
            : cancelledBy === 'admin'
              ? 'Booking cancelled'
              : 'Cancellation confirmed',
      ),
      para(escape(lead), { large: true }),
      reason ? para(`<strong>Reason:</strong> ${escape(reason)}`, { soft: true, small: true }) : '',
      card(
        label('Refund') +
          figure(refundDisplay, { muted: refundCents + manualCents === 0 }) +
          para(escape(refundLine), { soft: true, small: true, margin: '10px 0 0' }),
      ),
      subheading('Original booking'),
      card(
        details([
          ['Tour', escape(booking.tourName)],
          ['When', escape(dateStr)],
          booking.guestCount > 0 && ['Guests', String(booking.guestCount)],
        ]),
        { table: true },
      ),
      para(`Questions? Call or text Travis at ${link(telHref(ctx.phoneDisplay), ctx.phoneDisplay)}.`, { soft: true, small: true }),
      signoff(),
    ].join('\n'),
  });

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Post-tour follow-up: the review request (same evening, 7:00 PM)            */
/* -------------------------------------------------------------------------- */

interface PostTourContext {
  booking: Booking;
  baseUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  googleReviewUrl: string;
  phoneDisplay: string;
  marina: { name: string; address: string };
  /** Marina date the email goes out, for "this morning" vs "on Saturday". */
  sentOn: string;
  /**
   * The GoPro photos line. Their gallery's link once the photos email has
   * gone (a held or resent request goes after it); `coming` while it still
   * can; `none` once it can't, so nothing is promised. The sunset cruise
   * has no line either way.
   */
  photos: { galleryUrl: string } | 'coming' | 'none';
}

/**
 * When they were out, in words that fit the slot and the day the email is
 * read: "this morning" or "this afternoon" the same day, "yesterday", or
 * "on Saturday" for a request Travis held for a few days.
 */
function whenTheyWereOut(booking: Booking, sentOn: string): string {
  if (booking.date === sentOn) {
    if (booking.timeSlot === 'whole-day') return 'today';
    if (booking.timeSlot === 'sunset') return 'this evening';
    return booking.timeSlot === 'morning' || booking.timeSlot === 'mid-morning'
      ? 'this morning'
      : 'this afternoon';
  }
  const [y, m, d] = sentOn.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  if (booking.date === yesterday) return 'yesterday';
  const [by, bm, bd] = booking.date.split('-').map(Number);
  return `on ${new Date(Date.UTC(by, bm - 1, bd)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}`;
}

/** The private feedback form, or null for a booking without a link token. */
export function feedbackUrl(baseUrl: string, booking: Booking): string | null {
  return booking.accessToken ? `${baseUrl}/feedback/${booking.id}?t=${booking.accessToken}` : null;
}

/**
 * Every guest whose trip ran gets this same request: it never asks only
 * happy guests (review gating, which Google prohibits). The private
 * feedback link sits next to the review link, never in place of it.
 */
export function buildPostTourFollowupEmail(ctx: PostTourContext) {
  const { booking, baseUrl, instagramUrl, facebookUrl, googleReviewUrl, phoneDisplay, marina } = ctx;
  const firstName = booking.customerName.split(' ')[0];
  const when = whenTheyWereOut(booking, ctx.sentOn);
  const feedback = feedbackUrl(baseUrl, booking);
  const cruise = isCruise(booking);
  const outWith = cruise ? 'on the water' : 'with the manatees';
  const subject = `How was your ${cruise ? 'sunset cruise' : 'manatee tour'}, ${firstName}?`;
  // No GoPro on the sunset cruise: nobody's in the water.
  const photos = cruise ? 'none' : ctx.photos;

  const text = [
    `Hi ${firstName},`,
    '',
    `Thanks for coming out ${outWith} ${when}.`,
    '',
    `Would you leave us an honest Google review, good or bad? Reviews are`,
    `how new guests find us and how Travis hears what to fix:`,
    googleReviewUrl
      ? `   ${googleReviewUrl}`
      : `   Search "Crystal River Manatee Fun" on Google; the option's at the top.`,
    ...(feedback
      ? ['', `Something not right? Tell Travis privately:`, `   ${feedback}`]
      : ['', `Something not right? Tell Travis privately: call or text ${phoneDisplay}.`]),
    '',
    `Tag us in your photos on Instagram, too. We love sharing guest shots:`,
    `   ${instagramUrl}`,
    '',
    ...(photos === 'coming'
      ? [`Your GoPro photos will arrive in a separate email.`, '']
      : photos !== 'none'
        ? [`Your GoPro photos are in your gallery:`, `   ${photos.galleryUrl}`, '']
        : []),
    `Want to come back? Book another tour any time:`,
    `   ${baseUrl}/book`,
    '',
    `Thanks for choosing us,`,
    `Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
    `${phoneDisplay}`,
    `${marina.name}, ${marina.address}`,
  ].join('\n');

  const privately = feedback
    ? `Something not right? ${link(feedback, 'Tell Travis privately')}.`
    : `Something not right? Tell Travis privately: ${link(telHref(phoneDisplay), phoneDisplay)}.`;

  const html = emailPage({
    title: subject,
    preheader:
      photos === 'coming'
        ? 'An honest review helps a lot, and your GoPro photos are on the way.'
        : photos !== 'none'
          ? 'An honest review helps a lot. Your GoPro photos are in your gallery.'
          : 'An honest review helps a lot.',
    footer: { marina, phoneDisplay },
    body: [
      heading(cruise ? 'How was your cruise?' : 'How was your tour?'),
      para(`Hi ${escape(firstName)}, thanks for coming out ${outWith} ${escape(when)}.`, { large: true }),
      card(
        subheading('Would you leave us an honest review?', { margin: '0 0 6px' }) +
          para(
            `Good or bad, Google reviews are how new guests find us and how Travis hears what to fix. ${
              googleReviewUrl ? '30 seconds means a lot.' : 'Search “Crystal River Manatee Fun” on Google and the option is right at the top.'
            }`,
            { soft: true, small: true, margin: '0 0 4px' },
          ) +
          (googleReviewUrl ? actions(button(googleReviewUrl, 'Review on Google')) : '') +
          para(privately, { soft: true, small: true, margin: '12px 0 0' }),
      ),
      card(
        subheading('Tag us on Instagram', { margin: '0 0 6px' }) +
          para('We love sharing guest shots.', { soft: true, small: true, margin: '0 0 4px' }) +
          actions(button(instagramUrl, 'Open Instagram', { secondary: true })),
      ),
      photos === 'coming'
        ? para('Your <strong>GoPro photos</strong> will arrive in a separate email.', { small: true })
        : photos !== 'none'
          ? para(`Your <strong>GoPro photos</strong> are in ${link(photos.galleryUrl, 'your gallery')}.`, { small: true })
          : '',
      para(`Want to come back? ${link(`${baseUrl}/book`, 'Book another tour')} any time.`, { small: true }),
      signoff('Thanks for choosing us,'),
      para(
        `Follow along on ${link(instagramUrl, 'Instagram')} and ${link(facebookUrl, 'Facebook')}.`,
        { soft: true, small: true, margin: '16px 0 0' },
      ),
    ].join('\n'),
  });

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
  const tel = booking.customerPhone ? phoneHref(booking.customerPhone) : null;

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

  const html = emailPage({
    title: subject,
    body: [
      heading(outcome === 'refunded' ? 'Payment on a cancelled booking' : 'Refund needed'),
      para(escape(whatHappened)),
      actions(button(paymentUrl, 'Open the payment in Stripe')),
      para(escape(nextSteps), { soft: true, small: true }),
      subheading('Booking'),
      card(
        details([
          ['Tour', escape(booking.tourName)],
          ['Date', escape(dateStr)],
          ['Guests', String(booking.guestCount)],
          ['Status', escape(cancelled)],
          ['Booking ID', escape(booking.id)],
        ]),
        { table: true },
      ),
      subheading('Customer'),
      card(
        details([
          ['Name', escape(booking.customerName)],
          ['Email', link(`mailto:${booking.customerEmail}`, booking.customerEmail)],
          ['Phone', tel ? link(tel, booking.customerPhone) : escape(booking.customerPhone || 'Not given')],
        ]),
        { table: true },
      ),
    ].join('\n'),
  });

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Last-minute booking (sent to Travis, not the customer)                      */
/* -------------------------------------------------------------------------- */

/**
 * To Travis when a booking is paid inside the online cutoff, or after its
 * trip left (lib/checkout-completed.ts), so he can wait for them or call:
 * who, how many, a tap-to-call link and the booking in admin. Times are the
 * marina's, and say when they paid rather than "now", so the email reads
 * right even if it went out late.
 */
export function buildLastMinuteBookingEmail(alert: LastMinuteBooking, baseUrl: string) {
  const { booking, departs, minutesToGo } = alert;
  const name = booking.customerName;
  const guests = `${booking.guestCount} ${booking.guestCount === 1 ? 'guest' : 'guests'}`;
  const tel = booking.customerPhone ? phoneHref(booking.customerPhone) : null;
  const adminUrl = `${baseUrl.replace(/\/$/, '')}/admin/bookings/${encodeURIComponent(booking.id)}`;
  const day = tripDayLabel(booking.date);
  const [h = 0, m = 0] = departs.split(':').map(Number);
  const leaves = fmtClock(h * 60 + m);
  const paid = marinaNow(alert.paidAt);
  // Paid after midnight for the day before's trip: say which day.
  const paidAt = paid.date === booking.date ? fmtClock(paid.minutes) : `${tripDayLabel(paid.date)}, ${fmtClock(paid.minutes)}`;

  const subject = `[CRMF] Last-minute booking: ${day}, ${departureClock(departs)} — paid ${paidAt}`;

  const when =
    minutesToGo > 0
      ? `${minutesToGo} ${minutesToGo === 1 ? 'minute' : 'minutes'} before it leaves`
      : minutesToGo === 0
        ? 'as it was leaving'
        : 'after it had left';
  const lead = `${name} booked ${guests} on the ${leaves} ${booking.tourName} (${day}) and paid at ${paidAt}, ${when}.`;
  const next =
    minutesToGo > 0
      ? `Their checkout started before online booking closed, ${ONLINE_CUTOFF_MINUTES} minutes before the trip. Give them a call if they need to know where to meet, or if you need to wait for them.`
      : 'Their checkout started before online booking closed, but the trip was gone by the time they paid. Give them a call to move them to another trip or refund them.';

  const text = [
    lead,
    '',
    next,
    '',
    `Name:   ${name}`,
    `Phone:  ${booking.customerPhone || 'not given'}${tel ? ` (${tel})` : ''}`,
    `Party:  ${guests}`,
    `Tour:   ${booking.tourName}`,
    `Trip:   ${day}, departs ${leaves}`,
    `Paid:   ${paidAt}`,
    '',
    `Open the booking: ${adminUrl}`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${name}, ${guests}: paid ${when}`,
    body: [
      heading('Last-minute booking'),
      para(escape(lead), { large: true }),
      notice(
        `${para(escape(next), { margin: '0' })}${
          tel
            ? actions(button(tel, `Call ${name}: ${booking.customerPhone}`))
            : para('No phone number on the booking.', { soft: true, margin: '12px 0 0' })
        }`,
      ),
      card(
        details([
          ['Name', escape(name)],
          ['Phone', tel ? link(tel, booking.customerPhone) : 'Not given'],
          ['Party', escape(guests)],
          ['Tour', escape(booking.tourName)],
          ['Trip', `${escape(day)}, departs ${escape(leaves)}`],
          ['Paid', escape(paidAt)],
        ]),
        { table: true },
      ),
      para(link(adminUrl, 'Open the booking in admin'), { margin: '0' }),
    ].join('\n'),
  });

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Paid for a closed departure (sent to Travis, not the customer)              */
/* -------------------------------------------------------------------------- */

/**
 * To Travis when a checkout that started before he closed a departure is
 * paid after (lib/checkout-completed.ts). The customer hasn't been sent the
 * confirmation, so this says what has reached them or will, and what's his
 * to do: with a closure still in its undo window, nothing unless he undoes
 * it; otherwise they've been told he'll be in touch
 * ({@link buildClosedTripEmail}), so call them and move them or cancel
 * them, which emails them.
 */
export function buildPaidOnClosedDepartureEmail(alert: PaidOnClosedDeparture, baseUrl: string) {
  const { booking, closure } = alert;
  const name = booking.customerName;
  const guests = `${booking.guestCount} ${booking.guestCount === 1 ? 'guest' : 'guests'}`;
  const tel = booking.customerPhone ? phoneHref(booking.customerPhone) : null;
  const adminUrl = `${baseUrl.replace(/\/$/, '')}/admin/bookings/${encodeURIComponent(booking.id)}`;
  const day = tripDayLabel(booking.date);
  const departs = booking.timeSlot in SLOT_MINUTES ? slotStartTime(booking.timeSlot, booking.date) : null;
  const leaves = departs ? fmtClock(slotStartMinutes(booking.timeSlot, booking.date)) : (slotLabels[booking.timeSlot] ?? booking.timeSlot);
  const amount = formatPrice(alert.amountCents);
  const paid = marinaNow(alert.paidAt);
  const paidAt = paid.date === booking.date ? fmtClock(paid.minutes) : `${tripDayLabel(paid.date)}, ${fmtClock(paid.minutes)}`;
  const closing = closure.kind === 'closing';

  const subject = `[CRMF] Paid for a trip you ${closing ? 'are closing' : 'closed'}: ${day}, ${departs ? departureClock(departs) : leaves} — ${name}`;

  const lead = `${name} paid ${amount} at ${paidAt} for ${guests} on the ${leaves} ${booking.tourName} (${day}), which you ${closing ? 'are closing' : 'closed'}. Their checkout started before you closed it.`;
  const next =
    closure.kind === 'closing'
      ? `Your closure ${closure.choice === 'cancel' ? `cancels them and refunds the ${amount}` : 'emails them to pick another date or take a full refund'}, as it does everyone else on that trip, so they haven’t been sent a confirmation: the closure’s email is the one they get. Nothing to do: if you undo the closure, the undo sends them their confirmation.`
      : 'They haven’t been sent a confirmation. They’ve been emailed that their payment came through, that you’ve had to close the trip, and that you’ll be in touch shortly to move them or refund them in full. Call them, then move them to another trip or cancel and refund them in full in admin: either one emails them. If the trip is going ahead after all, reopen it: that sends them their confirmation.';

  const text = [
    lead,
    '',
    next,
    '',
    `Name:   ${name}`,
    `Phone:  ${booking.customerPhone || 'not given'}${tel ? ` (${tel})` : ''}`,
    `Party:  ${guests}`,
    `Tour:   ${booking.tourName}`,
    `Trip:   ${day}, departs ${leaves}`,
    `Paid:   ${amount} at ${paidAt}`,
    '',
    `Open the booking: ${adminUrl}`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${name}, ${guests}: ${closing ? 'your closure takes them with the others' : 'call them'}`,
    body: [
      heading(closing ? 'Paid for a trip you’re closing' : 'Paid for a trip you closed'),
      para(escape(lead), { large: true }),
      notice(
        `${para(escape(next), { margin: '0' })}${
          tel
            ? actions(button(tel, `Call ${name}: ${booking.customerPhone}`))
            : para('No phone number on the booking.', { soft: true, margin: '12px 0 0' })
        }`,
      ),
      card(
        details([
          ['Name', escape(name)],
          ['Phone', tel ? link(tel, booking.customerPhone) : 'Not given'],
          ['Party', escape(guests)],
          ['Tour', escape(booking.tourName)],
          ['Trip', `${escape(day)}, departs ${escape(leaves)}`],
          ['Paid', `${escape(amount)} at ${escape(paidAt)}`],
        ]),
        { table: true },
      ),
      para(link(adminUrl, 'Open the booking in admin'), { margin: '0' }),
    ].join('\n'),
  });

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Paid for a closed departure: the customer's note                            */
/* -------------------------------------------------------------------------- */

interface ClosedTripContext {
  booking: Booking;
  /** What they paid. */
  amountCents: number;
  baseUrl: string;
  phoneDisplay: string;
  marina: { name: string; address: string };
}

/**
 * In place of the confirmation, to someone who paid for a trip Travis closed
 * while they were booking, when nothing else is on its way to them: he
 * closed it from MCP, closed it and left its bookings for him to call, or
 * its closure went out before they paid (lib/checkout-completed.ts).
 * Someone who has just paid hears that the money arrived and what happens
 * next, rather than "you're locked in" or nothing at all.
 */
export function buildClosedTripEmail(ctx: ClosedTripContext) {
  const { booking, baseUrl, phoneDisplay, marina } = ctx;
  const firstName = booking.customerName.split(' ')[0];
  const dateStr = fmtDate(booking.date);
  const amount = formatPrice(ctx.amountCents);
  const noun = isCruise(booking) ? 'sunset cruise' : 'tour';
  // The sunset cruise's is that day's.
  const departs = slotTimes(booking.timeSlot, booking.date)?.departs;
  const pageUrl = `${baseUrl}/my-booking/${booking.id}?t=${booking.accessToken}`;

  const subject = `Payment received, but Capt. Travis has had to close your ${fmtShortDate(booking.date)} ${noun}`;
  const lead = `We got your payment of ${amount}, thank you. But Capt. Travis has had to close your ${departs ? `${departs} ${noun}` : noun} on ${dateStr}: he closed it while you were booking. Sorry about that.`;
  const next = 'He’ll be in touch shortly to move you to another trip or refund you in full, whichever you’d like. There’s nothing you need to do until then.';

  const text = [
    `Hi ${firstName},`,
    '',
    lead,
    '',
    next,
    '',
    `Your booking:`,
    `   ${booking.tourName}`,
    `   ${dateStr}${departs ? `, ${departs}` : ''}`,
    ...(booking.guestCount > 0 ? [`   ${booking.guestCount} guest${booking.guestCount === 1 ? '' : 's'}`] : []),
    `   Paid ${amount}`,
    '',
    `Your booking page:`,
    `   ${pageUrl}`,
    '',
    `Rather not wait? Call or text Travis at ${phoneDisplay}.`,
    '',
    `— Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `Your ${amount} came through. Capt. Travis will be in touch to move you or refund you in full.`,
    footer: { marina, phoneDisplay },
    body: [
      heading('Payment received, but your trip is closed'),
      para(`Hi ${escape(firstName)} — ${escape(lead)}`, { large: true, margin: '0 0 24px' }),
      notice(para(escape(next), { margin: '0' }) + actions(button(telHref(phoneDisplay), `Call Travis: ${phoneDisplay}`))),
      card(
        details([
          ['Tour', escape(booking.tourName)],
          ['When', `${escape(dateStr)}${departs ? `, ${escape(departs)}` : ''}`],
          booking.guestCount > 0 && ['Guests', String(booking.guestCount)],
          ['Paid', `<strong>${escape(amount)}</strong>`],
        ]),
        { table: true },
      ),
      actions(button(pageUrl, 'Your booking page', { secondary: true })),
      para(`Rather not wait? Call or text Travis at ${link(telHref(phoneDisplay), phoneDisplay)}.`, { soft: true, small: true }),
      signoff(),
    ].join('\n'),
  });

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
  marina: { name: string; address: string };
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

  const subject = `We got your request to move your ${isCruise(booking) ? 'sunset cruise' : 'tour'}`;

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

  const html = emailPage({
    title: subject,
    footer: { marina: ctx.marina, phoneDisplay },
    body: [
      heading('Request received'),
      para(`Hi ${escape(firstName)} — we’ve passed your request on to Capt. Travis.`, { large: true, margin: '0 0 24px' }),
      card(
        details([
          ['Booked', `${escape(booking.tourName)}<br/>${escape(originalDate)}`],
          ['Asked for', `<strong>${escape(target)}</strong>`],
        ]),
        { table: true },
      ),
      para(
        `Your booking stays as it is until Travis confirms the change. He’ll get back to you, usually within a day. Reply to this email to add anything, or call or text him at ${link(telHref(phoneDisplay), phoneDisplay)}.`,
        { soft: true },
      ),
      signoff(),
    ].join('\n'),
  });

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
  const newSlot = requestedSlot ? slotLabels[requestedSlot as Booking['timeSlot']] ?? requestedSlot : null;
  // 0 is an old-site booking with no party size on file.
  const guests = booking.guestCount > 0 ? String(booking.guestCount) : 'party size not recorded';
  const tel = booking.customerPhone ? phoneHref(booking.customerPhone) : null;

  const subject = `Reschedule request — ${booking.customerName} (${originalDate} → ${newDate})`;

  const text = [
    `${booking.customerName} wants to move their tour.`,
    '',
    `BOOKING`,
    `  ID:       ${booking.id}`,
    `  Tour:     ${booking.tourName}`,
    `  Was:      ${originalDate} (${slotLabels[booking.timeSlot] ?? booking.timeSlot})`,
    `  Guests:   ${guests}`,
    `  Paid:     ${formatPrice(booking.amountPaidCents)}`,
    '',
    `REQUEST`,
    `  Target date: ${newDate}`,
    `  Target slot: ${newSlot ?? 'no preference'}`,
    notes ? `  Notes: ${notes}` : null,
    '',
    `CUSTOMER`,
    `  Name:  ${booking.customerName}`,
    `  Email: ${booking.customerEmail}`,
    booking.customerPhone ? `  Phone: ${booking.customerPhone}` : null,
    '',
    `Move it in Admin → the booking → Reschedule, and mark the request done in`,
    `Admin → Reschedules. Replying to this email goes to the customer.`,
  ]
    // Drop only the optional lines left out (null); the blank spacers stay.
    .filter((line) => line !== null)
    .join('\n');

  const html = emailPage({
    title: subject,
    body: [
      heading('Reschedule request'),
      para(`<strong>${escape(booking.customerName)}</strong> wants to move their tour.`, { large: true, margin: '0 0 24px' }),
      subheading('Current booking', { margin: '0 0 10px' }),
      card(
        details([
          ['Tour', escape(booking.tourName)],
          ['Date', escape(originalDate)],
          ['Guests', escape(guests)],
          ['Paid', escape(formatPrice(booking.amountPaidCents))],
          ['Booking ID', escape(booking.id)],
        ]),
        { table: true },
      ),
      subheading('Requested'),
      card(
        details([
          ['Date', `<strong>${escape(newDate)}</strong>`],
          ['Time', escape(newSlot ?? 'No preference')],
          notes ? ['Notes', escape(notes)] : null,
        ]),
        { table: true },
      ),
      subheading('Customer'),
      card(
        details([
          ['Name', escape(booking.customerName)],
          ['Email', link(`mailto:${booking.customerEmail}`, booking.customerEmail)],
          booking.customerPhone ? ['Phone', tel ? link(tel, booking.customerPhone) : escape(booking.customerPhone)] : null,
        ]),
        { table: true },
      ),
      para('Move it in Admin → the booking → Reschedule, and mark the request done in Admin → Reschedules. Replying to this email goes to the customer.', { soft: true, small: true }),
    ].join('\n'),
  });

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Trips called off (sent to the crew)                                         */
/* -------------------------------------------------------------------------- */

interface CrewClosureAlertContext {
  subject: string;
  date: string;
  /** What customers were told, e.g. "Closed for weather". */
  reason: string;
  /** What happens to the people booked: emailed to pick a new date, cancelled, or Travis calls them. */
  choice: 'offer' | 'cancel' | 'keep';
  /**
   * Ready to show, in all and per departure: "4 guests", or "4+ guests" /
   * "party size unknown" when the old site didn't record a party size.
   */
  guests: string;
  departures: Array<{ departs: string; slot: Booking['timeSlot']; guests: string }>;
  crewUrl: string;
}

/**
 * To each crew member when Travis's closing of a day goes through
 * (lib/close-day.ts): which trips aren't going out. No customer names or
 * contact details, same as the crew app.
 */
export function buildCrewClosureAlertEmail(ctx: CrewClosureAlertContext) {
  const { subject, date, reason, choice, guests, departures, crewUrl } = ctx;
  const dateStr = fmtDate(date);
  const rows = departures.map(
    (d) => `${d.departs} ${d.slot === 'whole-day' ? 'all-day charter' : (slotLabels[d.slot] ?? d.slot).toLowerCase()}: ${d.guests}`,
  );
  const guestsLine =
    choice === 'offer'
      ? 'The guests have been emailed to pick a new date or take a refund.'
      : choice === 'cancel'
        ? 'The guests have been cancelled and told.'
        : 'They’re still booked: Travis is contacting them himself, so check with him before you head out.';
  const lead =
    choice === 'keep'
      ? `${reason}. Travis closed ${departures.length === 1 ? 'this trip' : 'these trips'} on ${dateStr}:`
      : `${reason}. ${departures.length === 1 ? 'This trip isn’t' : 'These trips aren’t'} going out on ${dateStr}:`;

  const text = [
    lead,
    ...rows.map((r) => `  • ${r}`),
    '',
    `In all: ${guests}. ${guestsLine}`,
    '',
    `Crew schedule: ${crewUrl}`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${departures.map((d) => d.departs).join(', ')} off on ${dateStr}`,
    body: [
      heading(choice === 'keep' ? 'Trips closed' : 'Trips called off'),
      para(escape(lead), { large: true }),
      card(list(rows.map(escape)), {}),
      para(`In all: ${escape(guests)}. ${escape(guestsLine)}`, { soft: true }),
      actions(button(crewUrl, 'Open the crew schedule')),
    ].join('\n'),
  });

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Trips back on after a reopen (sent to the crew)                             */
/* -------------------------------------------------------------------------- */

interface CrewReopenAlertContext {
  subject: string;
  date: string;
  /** `guests` is ready to show: "4 guests", or "4+ guests" when the old site didn't record a party size. */
  departures: Array<{ departs: string; slot: Booking['timeSlot']; guests: string }>;
  /** Travis had left them all booked (nobody was asked to pick a new date). */
  leftBooked?: boolean;
  crewUrl: string;
}

/**
 * To each crew member when Travis reopens a day after they were told its
 * trips were off (lib/close-day.ts): which trips are going out after all.
 * No customer names or contact details, same as the crew app.
 */
export function buildCrewReopenAlertEmail(ctx: CrewReopenAlertContext) {
  const { subject, date, departures, leftBooked = false, crewUrl } = ctx;
  const dateStr = fmtDate(date);
  const rows = departures.map(
    (d) => `${d.departs} ${d.slot === 'whole-day' ? 'all-day charter' : (slotLabels[d.slot] ?? d.slot).toLowerCase()}: ${d.guests}`,
  );
  const lead = `Travis reopened ${dateStr}. ${departures.length === 1 ? 'This trip is' : 'These trips are'} going out after all:`;
  const guestsLine = leftBooked
    ? 'The guests are still booked on them.'
    : 'The guests who were asked to pick a new date are back on their trips.';

  const text = [lead, ...rows.map((r) => `  • ${r}`), '', guestsLine, '', `Crew schedule: ${crewUrl}`].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${departures.map((d) => d.departs).join(', ')} back on for ${dateStr}`,
    body: [
      heading('Trips back on'),
      para(escape(lead), { large: true }),
      card(list(rows.map(escape)), {}),
      para(escape(guestsLine), { soft: true }),
      actions(button(crewUrl, 'Open the crew schedule')),
    ].join('\n'),
  });

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Closing a day: what's left for Travis                                      */
/* -------------------------------------------------------------------------- */

export interface ClosureSummaryContext {
  date: string;
  /** "Sat Oct 17" */
  dateLabel: string;
  /** "Closed for weather" */
  reason: string;
  /** What went out (lib/close-day.ts closureReport). */
  summary: string[];
  /** What he still has to do himself. */
  problems: string[];
  adminUrl: string;
}

/**
 * To whoever closed a day, once it's gone through without them watching
 * (the undo window ran out on its own): what went out, and the list of
 * things left for them to do, the same list the admin screen shows.
 */
export function buildClosureSummaryEmail(ctx: ClosureSummaryContext) {
  const { dateLabel, reason, summary, problems, adminUrl } = ctx;
  const todo = problems.length;
  const subject = todo
    ? `[CRMF] Closed ${dateLabel}: ${todo} ${todo === 1 ? 'thing' : 'things'} for you to do`
    : `[CRMF] Closed ${dateLabel}: all done`;
  const lead = `${reason}. Closing ${fmtDate(ctx.date)} has gone through.`;

  const text = [
    lead,
    '',
    ...(summary.length ? summary : ['Nobody needed anything sent.']),
    ...(todo ? ['', 'Still for you to do:', ...problems.map((p) => `  • ${p}`)] : ['', 'Nothing left for you to do.']),
    '',
    `Close a day: ${adminUrl}`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: todo ? `${todo} ${todo === 1 ? 'thing' : 'things'} left for you to do` : 'Nothing left for you to do',
    body: [
      heading(todo ? 'Day closed: a few things for you' : 'Day closed'),
      para(escape(lead), { large: true }),
      summary.length ? card(list(summary.map(escape)), {}) : para('Nobody needed anything sent.', { soft: true }),
      todo
        ? [subheading('Still for you to do'), notice(list(problems.map(escape)))].join('\n')
        : para('Nothing left for you to do.', { soft: true }),
      actions(button(adminUrl, 'Open Close a day')),
    ].join('\n'),
  });

  return { subject, text, html };
}

export interface DeadlineRefundRefusedContext {
  booking: Booking & { id: string };
  /** What the deadline was due to refund. */
  refundCents: number;
  /** Stripe's reason. */
  stripeMessage: string;
  baseUrl: string;
}

/**
 * To Travis when Stripe turns down the full refund settleClosedBookings
 * owed a customer who didn't pick a new date after he closed their trip
 * (the payment is disputed, say). Nothing changed on the booking, and the
 * customer hasn't been told. Laid out like the alert for a customer's own
 * cancel that Stripe turns down (cancelBooking.ts), in this case's words.
 */
export function buildDeadlineRefundRefusedEmail(ctx: DeadlineRefundRefusedContext) {
  const b = ctx.booking;
  const name = b.customerName || 'A customer';
  const trip = tripLabel(b);
  const amount = formatPrice(ctx.refundCents);
  const adminUrl = `${ctx.baseUrl.replace(/\/$/, '')}/admin/bookings/${encodeURIComponent(b.id)}`;
  const tel = b.customerPhone ? phoneHref(b.customerPhone) : null;
  const decideBy = b.closure ? ` by ${fmtDate(b.closure.decideBy)}` : '';

  const subject = `[CRMF] Refund refused: call ${b.customerName || 'the customer'} (${trip})`;
  const lead = `${name} didn’t pick a new date for the trip you closed${decideBy}, so their ${amount} was due back automatically, but Stripe turned the refund down: “${ctx.stripeMessage}”`;
  const next =
    'Nothing has been cancelled or refunded, and they haven’t been told. Give them a call; the payment in Stripe’s dashboard shows why it can’t be refunded. ' +
    'The dashboard lists them under Waiting on customers as Refund failed until the booking is moved or cancelled.';

  const text = [
    lead,
    '',
    next,
    '',
    `Phone:   ${b.customerPhone || 'not given'}${tel ? ` (${tel})` : ''}`,
    `Trip:    ${trip} · ${b.tourName}, ${guestsLabel(b.guestCount)}`,
    `Due:     ${amount}`,
    '',
    `Open the booking: ${adminUrl}`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${name}: ${amount} not refunded`,
    body: [
      heading('Refund refused'),
      para(escape(lead), { large: true }),
      notice(
        `${para(escape(next), { margin: '0' })}${
          tel
            ? actions(button(tel, `Call ${name}: ${b.customerPhone}`))
            : para('No phone number on the booking.', { soft: true, margin: '12px 0 0' })
        }`,
      ),
      card(
        details([
          ['Phone', tel ? link(tel, b.customerPhone) : escape(b.customerPhone || 'Not given')],
          ['Trip', `${escape(trip)}<br/>${escape(b.tourName)}, ${escape(guestsLabel(b.guestCount))}`],
          ['Due', escape(amount)],
        ]),
        { table: true },
      ),
      para(link(adminUrl, 'Open the booking in admin'), { margin: '0' }),
    ].join('\n'),
  });

  return { subject, html, text };
}

/* -------------------------------------------------------------------------- */
/* Signed waiver copy                                                         */
/* -------------------------------------------------------------------------- */

interface WaiverCopyContext {
  signerName: string;
  tourName: string;
  tripDate: string;
  minors: string[];
  participating: boolean;
  phoneDisplay: string;
  marina: { name: string; address: string };
}

/**
 * Sent to each signer with their signed waiver PDF attached, so they keep
 * a copy of what they agreed to.
 */
export function buildWaiverCopyEmail(ctx: WaiverCopyContext) {
  const dateStr = fmtDate(ctx.tripDate);
  const first = ctx.signerName.split(' ')[0];
  const subject = `Your signed waiver for ${dateStr}`;
  const coverage = [
    ctx.participating ? 'yourself' : null,
    ...ctx.minors,
  ].filter(Boolean) as string[];
  const covers = coverage.length > 1
    ? `${coverage.slice(0, -1).join(', ')} and ${coverage[coverage.length - 1]}`
    : coverage[0] ?? 'yourself';

  const text = [
    `Hi ${first},`,
    '',
    `Thanks for signing the liability waiver for ${ctx.tourName} on ${dateStr}.`,
    `It covers ${covers}. Your signed copy is attached as a PDF; keep it for your records.`,
    '',
    `Everyone else in your party who's 18 or older signs their own waiver`,
    `with the same link.`,
    '',
    `If you didn't sign this, or anything in it is wrong, tell Travis right`,
    `away.`,
    '',
    `Questions? Text or call Travis at ${ctx.phoneDisplay}.`,
    '',
    `Crystal River Manatee Fun LLC`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: 'Your signed copy is attached. Keep it for your records.',
    footer: { marina: ctx.marina, phoneDisplay: ctx.phoneDisplay },
    body: [
      heading('Your waiver is signed'),
      para(
        `Hi ${escape(first)}, thanks for signing the liability waiver for <strong>${escape(ctx.tourName)}</strong> on <strong>${escape(dateStr)}</strong>. It covers ${escape(covers)}.`,
        { large: true },
      ),
      para('Your signed copy is attached as a PDF. Keep it for your records.'),
      para('Everyone else in your party who’s 18 or older signs their own waiver with the same link.'),
      para('If you didn’t sign this, or anything in it is wrong, tell Travis right away.'),
      para(`Questions? Text or call Travis at ${link(telHref(ctx.phoneDisplay), ctx.phoneDisplay)}.`, { soft: true, small: true }),
    ].join('\n'),
  });

  return { subject, text, html };
}

/* -------------------------------------------------------------------------- */
/* Waiver reminder                                                            */
/* -------------------------------------------------------------------------- */

interface WaiverReminderContext {
  booking: Booking;
  baseUrl: string;
  /** Roster guests with no signed waiver, in booking order. */
  unsigned: Array<{ name: string; minor: boolean }>;
  /** Guests beyond the named roster who still need to sign. */
  unnamedCount: number;
  signedCount: number;
  /** 0 when the party size isn't on file. */
  needed: number;
  /**
   * Someone signed under a name that isn't on the booking, so one of the
   * `unsigned` names may already be covered.
   */
  hasUnmatched: boolean;
  /** The trip is tomorrow (marina time). */
  tomorrow: boolean;
  phoneDisplay: string;
  marina: { name: string; address: string };
}

/**
 * Sent to the booker when their party hasn't finished signing waivers:
 * automatically the afternoon before the trip, or when Travis sends one
 * from admin. Lists who still needs to sign (or, with no party size on
 * file, asks them to make sure everyone has), with the signing link.
 */
export function buildWaiverReminderEmail(ctx: WaiverReminderContext) {
  const { booking, phoneDisplay } = ctx;
  const dateStr = fmtDate(booking.date);
  const slot = whenLine(booking.timeSlot, booking.date);
  const trip = isCruise(booking) ? 'sunset cruise' : 'manatee tour';
  const first = booking.customerName.split(' ')[0];
  const signLink = waiverUrl(ctx.baseUrl, booking.id, booking.accessToken);
  const missing = ctx.needed - ctx.signedCount;
  const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);
  const when = ctx.tomorrow ? 'tomorrow' : `on ${dateStr}`;
  // No party size on file (an old-site booking with no guest count or
  // names): there's no telling who's left, so they're asked to check.
  const sizeUnknown = ctx.needed === 0;

  const subject = sizeUnknown
    ? `${ctx.tomorrow ? 'Tomorrow' : dateStr}: make sure everyone in your party has signed the waiver`
    : `${ctx.tomorrow ? 'Tomorrow' : dateStr}: ${people(missing)} still ${missing === 1 ? 'needs' : 'need'} to sign the waiver`;

  const has = ctx.signedCount === 1 ? 'has' : 'have';
  const status = ctx.signedCount === 0
    ? 'No one in your party has signed the liability waiver yet.'
    : sizeUnknown
      ? `${people(ctx.signedCount)} in your party ${has} signed the liability waiver so far.`
      : `${ctx.signedCount} of ${ctx.needed} people in your party ${has} signed the liability waiver.`;
  const onThe = isCruise(booking) ? 'on the cruise' : 'on the tour';
  const checkEveryone = ctx.signedCount === 0
    ? `Make sure everyone coming ${onThe} signs before you arrive.`
    : `Make sure everyone else coming ${onThe} has signed too.`;
  const rows = [
    ...ctx.unsigned.map((g) =>
      g.minor ? `${g.name}: a parent or legal guardian signs for them` : g.name,
    ),
    ...(ctx.unnamedCount > 0
      ? [
          `${ctx.unnamedCount} ${ctx.unsigned.length > 0 ? 'more ' : ''}${ctx.unnamedCount === 1 ? 'person' : 'people'} in your party`,
        ]
      : []),
  ];
  const unmatchedNote =
    'Someone signed under a name that isn’t on your booking. If that’s one of the people above, they’re all set.';

  const text = [
    `Hi ${first},`,
    '',
    `A quick reminder before your ${trip} ${when}:`,
    `${booking.tourName}, ${dateStr}, ${slot}.`,
    '',
    ...(sizeUnknown
      ? [`${status} ${checkEveryone}`]
      : [`${status} Still to sign:`, ...rows.map((r) => `   - ${r}`)]),
    '',
    `Every adult signs their own waiver on their phone (about 3 minutes).`,
    `A parent or legal guardian signs for anyone under 18. No one boards`,
    `without a signed waiver. Forward this link to whoever still needs to`,
    `sign:`,
    `   ${signLink}`,
    '',
    ...(ctx.hasUnmatched ? [unmatchedNote, ''] : []),
    `Questions? Text or call Travis at ${phoneDisplay}.`,
    '',
    `See you on the water,`,
    `Capt. Travis Urbin`,
    `Crystal River Manatee Fun`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${status} No one boards without a signed waiver.`,
    footer: { marina: ctx.marina, phoneDisplay },
    body: [
      heading('Waivers still to sign'),
      para(
        `Hi ${escape(first)}, a quick reminder before your ${trip} ${escape(when)}: <strong>${escape(booking.tourName)}</strong>, ${escape(dateStr)}, ${escape(slot)}.`,
        { large: true, margin: '0 0 24px' },
      ),
      card(
        sizeUnknown
          ? para(`${escape(status)} ${escape(checkEveryone)}`, { margin: '0' })
          : para(`${escape(status)} Still to sign:`, { margin: '0 0 8px' }) + list(rows.map(escape), { margin: '0' }),
      ),
      notice(
        para(
          'Every adult signs their own waiver on their phone. It takes about 3 minutes. A parent or legal guardian signs for anyone under 18. No one boards without a signed waiver. Forward this link to whoever still needs to sign.',
          { small: true, margin: '0 0 4px' },
        ) + actions(button(signLink, 'Sign the waiver')),
      ),
      ctx.hasUnmatched ? para(escape(unmatchedNote), { soft: true, small: true }) : '',
      para(`Questions? Text or call Travis at ${link(telHref(phoneDisplay), phoneDisplay)}.`, { soft: true, small: true }),
      signoff('See you on the water,'),
    ].join('\n'),
  });

  return { subject, text, html };
}
