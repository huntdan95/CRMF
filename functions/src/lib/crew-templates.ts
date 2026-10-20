import type { Booking, TourTimeSlot } from './types';
import { formatPrice, slotLabels } from './tours';
import { wetsuitTally, type WetsuitSizes } from './site-settings';
import {
  departureLabel,
  escapeHtml as esc,
  guestsLabel,
  longDate,
  partyLabel,
  shortDate,
  telHref,
} from './trip-format';

/*
 * Emails to the crew. Subjects start with "[CRMF]" so Travis and the mates
 * can set a phone notification for them. Written to be read at a glance on
 * a phone: the facts first, one link to act on.
 */

const CREW_TAG = '[CRMF]';

interface Row {
  label: string;
  value: string;
  /** Makes the value a link (tel:, mailto:, https:). */
  href?: string;
}

interface Section {
  heading?: string;
  rows: Row[];
  /** Free text under the rows (admin notes, a customer's message). */
  note?: string;
}

interface Link {
  label: string;
  url: string;
}

export interface Email {
  subject: string;
  text: string;
  html: string;
  sms: string;
}

function crewEmail(opts: {
  subject: string;
  title: string;
  intro?: string;
  sections: Section[];
  links: Link[];
  sms: string;
}): Email {
  const text = [
    opts.intro,
    ...opts.sections.flatMap((s) => [
      '',
      ...(s.heading ? [s.heading.toUpperCase()] : []),
      ...s.rows.map((r) => `${r.label}: ${r.value}`),
      ...(s.note ? ['', s.note] : []),
    ]),
    '',
    ...opts.links.map((l) => `${l.label}: ${l.url}`),
  ]
    .filter((l): l is string => l !== undefined)
    .join('\n')
    .trim();

  const cell = (r: Row) =>
    r.href ? `<a href="${esc(r.href)}" style="color:#1B6FA8;">${esc(r.value)}</a>` : esc(r.value);
  const sectionHtml = (s: Section) => `
    ${s.heading ? `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#7A8B7E;margin:20px 0 6px;">${esc(s.heading)}</h3>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.5;">
      ${s.rows
        .map(
          (r) =>
            `<tr><td style="padding:4px 12px 4px 0;color:#4A524C;vertical-align:top;white-space:nowrap;">${esc(r.label)}</td><td style="padding:4px 0;font-weight:500;">${cell(r)}</td></tr>`,
        )
        .join('')}
    </table>
    ${s.note ? `<p style="margin:8px 0 0;font-size:14px;color:#4A524C;white-space:pre-wrap;">${esc(s.note)}</p>` : ''}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>${esc(opts.subject)}</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;padding:16px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:20px;">
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 8px;font-size:22px;">${esc(opts.title)}</h2>
    ${opts.intro ? `<p style="margin:0 0 8px;font-size:15px;">${esc(opts.intro)}</p>` : ''}
    ${opts.sections.map(sectionHtml).join('')}
    <p style="margin:20px 0 0;">
      ${opts.links
        .map(
          (l, i) =>
            `<a href="${esc(l.url)}" style="display:inline-block;margin:0 8px 8px 0;${i === 0 ? 'background:#1B6FA8;color:#fff;' : 'border:1px solid #1B6FA8;color:#1B6FA8;'}text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;font-size:14px;">${esc(l.label)}</a>`,
        )
        .join('')}
    </p>
  </div>
</body></html>`;

  return { subject: opts.subject, text, html, sms: opts.sms };
}

function leadRows(b: Booking): Row[] {
  return [
    { label: 'Lead', value: b.customerName || '—' },
    ...(b.customerPhone ? [{ label: 'Phone', value: b.customerPhone, href: telHref(b.customerPhone) }] : []),
  ];
}

/**
 * `(6 on the boat)` when other parties share the departure, from each
 * party's guestCount; `6+` with an old-site party of unknown size among
 * them (0), as the crew push says it.
 */
function boatNote(guestCount: number, boat: readonly number[] | null): string {
  if (!boat) return '';
  const total = boat.reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
  const more = boat.some((n) => !(n > 0)) ? '+' : '';
  return total > guestCount || more ? ` (${total}${more} on the boat)` : '';
}

/** The wetsuit sizes to set aside. Nobody swims on the sunset cruise, so nobody's asked. */
function wetsuitRows(b: Pick<Booking, 'timeSlot'>, tally: () => string): Row[] {
  return b.timeSlot === 'sunset' ? [] : [{ label: 'Wetsuits', value: tally() || 'Not given' }];
}

export function adminBookingUrl(baseUrl: string, bookingId: string): string {
  return `${baseUrl}/admin/bookings/${bookingId}`;
}

/* -------------------------------------------------------------------------- */
/* New booking                                                                */
/* -------------------------------------------------------------------------- */

export function buildCrewBookingAlert(ctx: {
  booking: Booking;
  baseUrl: string;
  sizes: WetsuitSizes;
  /** Each party's guestCount on that departure, this booking's included; null if unknown. */
  boat: readonly number[] | null;
  /**
   * Paid for after Travis closed the trip (a checkout that was already
   * open): it isn't going out as booked. He's been told; the crew push
   * marks it the same way.
   */
  closedTrip?: boolean;
}): Email {
  const { booking: b } = ctx;
  const when = `${shortDate(b.date)}, ${departureLabel(b)}`;
  const guests = guestsLabel(b.guestCount);
  const what = ctx.closedTrip ? 'New booking on a closed trip' : 'New booking';
  return crewEmail({
    subject: `${CREW_TAG} ${what}: ${when}, ${guests}`,
    title: what,
    intro: ctx.closedTrip
      ? `On a trip Travis closed: they paid after he closed it, so it isn't going out as booked. He's been told. ${b.tourName}, ${longDate(b.date)}.`
      : `${b.tourName}, ${longDate(b.date)}.`,
    sections: [
      {
        rows: [
          ...leadRows(b),
          { label: 'Guests', value: `${b.guestCount}${boatNote(b.guestCount, ctx.boat)}` },
          ...wetsuitRows(b, () => wetsuitTally(b.guests ?? [], ctx.sizes)),
        ],
      },
    ],
    links: [{ label: 'Open in admin', url: adminBookingUrl(ctx.baseUrl, b.id) }],
    sms: `${what}: ${when}, ${guests}. ${b.customerName} ${b.customerPhone}`.trim(),
  });
}

/* -------------------------------------------------------------------------- */
/* Customer cancellation                                                      */
/* -------------------------------------------------------------------------- */

export function buildCrewCancellationAlert(ctx: {
  booking: Booking;
  baseUrl: string;
  refundCents: number;
  /** Each party's guestCount still on that departure after this cancellation; null if unknown. */
  stillOnBoat: readonly number[] | null;
}): Email {
  const { booking: b } = ctx;
  const when = `${shortDate(b.date)}, ${departureLabel(b)}`;
  const guests = guestsLabel(b.guestCount);
  return crewEmail({
    subject: `${CREW_TAG} Cancelled: ${when}, ${guests}`,
    title: 'Booking cancelled',
    intro: `${b.customerName || 'A customer'} cancelled online. ${b.tourName}, ${longDate(b.date)}.`,
    sections: [
      {
        rows: [
          ...leadRows(b),
          { label: 'Guests', value: String(b.guestCount) },
          ...(ctx.stillOnBoat !== null
            ? [{ label: 'Still going', value: ctx.stillOnBoat.length === 0 ? 'Nobody on that departure now' : partyLabel(ctx.stillOnBoat) }]
            : []),
          { label: 'Refunded', value: ctx.refundCents > 0 ? formatPrice(ctx.refundCents) : 'Nothing' },
        ],
        note: b.cancellationReason ? `Reason: ${b.cancellationReason}` : undefined,
      },
    ],
    links: [{ label: 'Open in admin', url: adminBookingUrl(ctx.baseUrl, b.id) }],
    sms: `Cancelled: ${when}, ${guests}. ${b.customerName}`.trim(),
  });
}

/* -------------------------------------------------------------------------- */
/* Reschedule request                                                         */
/* -------------------------------------------------------------------------- */

export function buildCrewRescheduleAlert(ctx: {
  booking: Booking;
  baseUrl: string;
  requestedDate: string;
  requestedSlot: TourTimeSlot | null;
  notes: string | null;
}): Email {
  const { booking: b } = ctx;
  const when = `${shortDate(b.date)}, ${departureLabel(b)}`;
  const target = ctx.requestedSlot
    ? `${shortDate(ctx.requestedDate)}, ${slotLabels[ctx.requestedSlot] ?? ctx.requestedSlot}`
    : shortDate(ctx.requestedDate);
  return crewEmail({
    subject: `${CREW_TAG} Reschedule request: ${when} → ${target}`,
    title: 'Reschedule request',
    intro: `${b.customerName || 'A customer'} asked to move their tour. Nothing has changed until Travis moves it.`,
    sections: [
      {
        rows: [
          ...leadRows(b),
          { label: 'Guests', value: String(b.guestCount) },
          { label: 'Booked', value: `${b.tourName}, ${when}` },
          { label: 'Wants', value: ctx.requestedSlot ? target : `${target}, any time` },
        ],
        note: ctx.notes ? `Their note: ${ctx.notes}` : undefined,
      },
    ],
    links: [
      { label: 'Open in admin', url: adminBookingUrl(ctx.baseUrl, b.id) },
      { label: 'All requests', url: `${ctx.baseUrl}/admin/reschedules` },
    ],
    sms: `Reschedule request: ${when} → ${target}. ${b.customerName}`.trim(),
  });
}

/* -------------------------------------------------------------------------- */
/* Tomorrow's trips (8 PM)                                                    */
/* -------------------------------------------------------------------------- */

/** One departure tomorrow: every booking on the same boat at the same time. */
export interface ScheduleTrip {
  timeSlot: TourTimeSlot;
  /** Bookings going ahead on it, lead guest first-come order. */
  bookings: Booking[];
  /** The crew's photo-upload link for this departure, once there is one. */
  uploadUrl?: string | null;
  /**
   * A blackout covers it: Travis closed it and left the guests booked to
   * contact them himself (or closed the day from MCP), or he's calling it
   * off right now (the undo window is open).
   */
  off?: 'closed' | 'closing' | null;
  /** Travis is running it solo. */
  noCrew?: boolean;
}

/** How a closed departure reads, in the crew app's words (src/components/crew/CrewSchedule.tsx). */
const OFF_LABEL: Record<NonNullable<ScheduleTrip['off']>, { tag: string; note: string }> = {
  closed: { tag: 'Closed', note: 'Closed to new bookings. Travis is contacting the guests, so check with him.' },
  closing: { tag: 'Being called off', note: 'Travis is calling this off. You’ll get a message when it’s final.' },
};

export function buildCrewSchedule(ctx: {
  date: string;
  trips: ScheduleTrip[];
  baseUrl: string;
  sizes: WetsuitSizes;
}): Email {
  const { trips } = ctx;
  // The headline counts the trips going out; closed ones are listed, marked.
  const going = trips.filter((t) => !t.off);
  const closed = trips.length - going.length;
  const counts = (list: ScheduleTrip[]) => list.flatMap((t) => t.bookings.map((b) => b.guestCount));
  const goingLabel = going.length
    ? `${going.length} ${going.length === 1 ? 'trip' : 'trips'}, ${partyLabel(counts(going))}`
    : 'no trips going out';
  const summary = closed ? `${goingLabel}, ${closed} closed` : goingLabel;
  const subject = `${CREW_TAG} Tomorrow: ${summary}`;

  const tripTitle = (t: ScheduleTrip) =>
    `${t.off ? `${OFF_LABEL[t.off].tag}: ` : ''}${departureLabel(t.bookings[0]!)} · ${t.bookings[0]!.tourName} · ${partyLabel(counts([t]))}${t.noCrew ? ' · No crew needed' : ''}`;
  const tally = (t: ScheduleTrip) =>
    wetsuitTally(t.bookings.flatMap((b) => b.guests ?? []), ctx.sizes) || 'Not given';
  // Nobody swims on the sunset cruise, so nobody's asked for a size.
  const showTally = (t: ScheduleTrip) => t.timeSlot !== 'sunset';
  const party = (b: Booking) => (b.guestCount > 0 ? String(b.guestCount) : 'party size unknown');
  const manifestUrl = (b: Booking) => `${ctx.baseUrl}/admin/bookings/${b.id}/manifest`;

  const text = [
    `Tomorrow, ${longDate(ctx.date)}: ${summary}.`,
    ...trips.flatMap((t) => [
      '',
      tripTitle(t).toUpperCase(),
      ...(t.off ? [OFF_LABEL[t.off].note] : []),
      ...(showTally(t) ? [`Wetsuits: ${tally(t)}`] : []),
      ...t.bookings.flatMap((b) => [
        `- ${b.customerName} (${party(b)})${b.customerPhone ? `, ${b.customerPhone}` : ''}`,
        ...(b.adminNotes ? [`  Notes: ${b.adminNotes.replace(/\s*\n\s*/g, ' / ')}`] : []),
        `  Manifest: ${manifestUrl(b)}`,
      ]),
      ...(t.uploadUrl ? [`Photo upload: ${t.uploadUrl}`] : []),
    ]),
  ].join('\n');

  const bookingHtml = (b: Booking) => `
      <li style="margin:0 0 10px;">
        <strong>${esc(b.customerName || '—')}</strong> (${esc(party(b))})${
          b.customerPhone
            ? ` · <a href="${esc(telHref(b.customerPhone))}" style="color:#1B6FA8;">${esc(b.customerPhone)}</a>`
            : ''
        }
        ${b.adminNotes ? `<div style="margin-top:2px;color:#4A524C;font-size:14px;white-space:pre-wrap;">Notes: ${esc(b.adminNotes)}</div>` : ''}
        <div style="margin-top:2px;font-size:13px;"><a href="${esc(manifestUrl(b))}" style="color:#1B6FA8;">Manifest</a></div>
      </li>`;

  const tripHtml = (t: ScheduleTrip) => `
    <div style="border-top:1px solid #E8E1CC;padding-top:14px;margin-top:14px;">
      <h3 style="margin:0 0 4px;font-size:17px;">${esc(tripTitle(t))}</h3>
      ${t.off ? `<p style="margin:0 0 10px;font-size:14px;color:#B3261E;font-weight:600;">${esc(OFF_LABEL[t.off].note)}</p>` : ''}
      ${showTally(t) ? `<p style="margin:0 0 10px;font-size:14px;color:#4A524C;">Wetsuits: <strong style="color:#1A1F1B;">${esc(tally(t))}</strong></p>` : ''}
      <ul style="padding-left:18px;margin:0;font-size:15px;line-height:1.5;">${t.bookings.map(bookingHtml).join('')}</ul>
      ${
        t.uploadUrl
          ? `<p style="margin:10px 0 0;"><a href="${esc(t.uploadUrl)}" style="display:inline-block;border:1px solid #1B6FA8;color:#1B6FA8;text-decoration:none;padding:8px 14px;border-radius:999px;font-weight:600;font-size:14px;">Upload this trip’s photos</a></p>`
          : ''
      }
    </div>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>${esc(subject)}</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;padding:16px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:20px;">
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 4px;font-size:22px;">Tomorrow: ${esc(longDate(ctx.date))}</h2>
    <p style="margin:0;font-size:15px;">${esc(summary)}.</p>
    ${trips.map(tripHtml).join('')}
  </div>
</body></html>`;

  return {
    subject,
    text,
    html,
    sms: `Tomorrow: ${summary}. ${trips
      .map((t) => `${t.off ? `${OFF_LABEL[t.off].tag}: ` : ''}${departureLabel(t.bookings[0]!)} (${partyLabel(counts([t]))})`)
      .join(', ')}`,
  };
}
