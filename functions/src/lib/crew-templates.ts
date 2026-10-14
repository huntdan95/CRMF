import type { Booking, TourTimeSlot } from './types';
import { formatPrice, slotLabels } from './tours';
import { wetsuitTally, type WetsuitSizes } from './site-settings';
import {
  departureLabel,
  escapeHtml as esc,
  guestsLabel,
  longDate,
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

/** `(6 on the boat)` when other parties share the departure. */
function boatNote(guestCount: number, boatTotal: number | null): string {
  return boatTotal !== null && boatTotal > guestCount ? ` (${boatTotal} on the boat)` : '';
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
  /** Guests on that departure including this booking; null if unknown. */
  boatTotal: number | null;
}): Email {
  const { booking: b } = ctx;
  const when = `${shortDate(b.date)}, ${departureLabel(b)}`;
  const guests = guestsLabel(b.guestCount);
  return crewEmail({
    subject: `${CREW_TAG} New booking: ${when}, ${guests}`,
    title: 'New booking',
    intro: `${b.tourName}, ${longDate(b.date)}.`,
    sections: [
      {
        rows: [
          ...leadRows(b),
          { label: 'Guests', value: `${b.guestCount}${boatNote(b.guestCount, ctx.boatTotal)}` },
          { label: 'Wetsuits', value: wetsuitTally(b.guests ?? [], ctx.sizes) || 'Not given' },
        ],
      },
    ],
    links: [{ label: 'Open in admin', url: adminBookingUrl(ctx.baseUrl, b.id) }],
    sms: `New booking: ${when}, ${guests}. ${b.customerName} ${b.customerPhone}`.trim(),
  });
}

/* -------------------------------------------------------------------------- */
/* Customer cancellation                                                      */
/* -------------------------------------------------------------------------- */

export function buildCrewCancellationAlert(ctx: {
  booking: Booking;
  baseUrl: string;
  refundCents: number;
  /** Guests still on that departure after this cancellation; null if unknown. */
  stillOnBoat: number | null;
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
            ? [{ label: 'Still going', value: ctx.stillOnBoat === 0 ? 'Nobody on that departure now' : guestsLabel(ctx.stillOnBoat) }]
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
