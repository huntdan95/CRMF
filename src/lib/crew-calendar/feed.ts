/**
 * The crew calendar feed (/api/crew-calendar/[token]): one event per
 * departure that has guests on it, in the crew's own phone calendar.
 *
 * Pure: the route (./server.ts) reads Firestore and passes plain values in,
 * so functions/test can check the output. Relative imports only, and
 * nothing that needs Next, for the same reason.
 *
 * Calendar feeds get copied to Apple's and Google's servers, so nothing in
 * here may carry a guest's name, phone or email. The inputs don't even
 * have them: {@link FeedBooking} is all the route reads from a booking.
 */
import { createHash } from 'node:crypto';

import { WHOLE_DAY_OVERLAPS } from '../availability';
import { siteConfig } from '../site-config';
import { tours, type TourTimeSlot, type TourType } from '../tours';
import {
  MARINA_TZID,
  NEW_YORK_VTIMEZONE,
  escapeText,
  localDateTime,
  serializeLines,
  utcDateTime,
} from './ics';

/** Days of past trips the feed keeps, and how far ahead it looks. */
export const FEED_DAYS_BACK = 14;
export const FEED_DAYS_AHEAD = 120;

export const CALENDAR_NAME = 'Manatee Fun trips';

/**
 * Reminder before each departure.
 * TODO(owner): confirm 60 minutes is the lead time the crew want. Some
 * calendar apps ignore reminders on subscribed calendars, and iPhone has a
 * "Remove Alerts" switch per subscription.
 */
export const ALARM_MINUTES_BEFORE = 60;

/** How often calendar apps are asked to check for changes. */
export const REFRESH_INTERVAL = 'PT15M';

const UID_DOMAIN = 'crystalrivermanateefun.com';

/** The crew app on the production domain. See {@link renderEvent} for other hosts. */
export const CREW_APP_URL = `${siteConfig.url}/crew`;

export const MARINA_LOCATION = `${siteConfig.marina.name}, ${siteConfig.marina.streetAddress}, ${siteConfig.marina.city}, ${siteConfig.marina.region} ${siteConfig.marina.postalCode}`;

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

export type FeedBookingStatus = 'pending-payment' | 'confirmed' | 'cancelled' | 'completed' | 'no-show';
export type FeedBlackoutReason = 'weather' | 'maintenance' | 'personal' | 'other';

/** The fields of a booking the feed reads. No names, phones or emails. */
export interface FeedBooking {
  id: string;
  date: string;
  timeSlot: TourTimeSlot;
  type: TourType;
  guestCount: number;
  status: FeedBookingStatus;
  /** Imported from the old website (`legacy-` id). */
  legacy: boolean;
  /** Travis closed the departure and offered a new date or a refund (PR #28's closure model). */
  closure: { blackoutId: string; reason: string } | null;
  cancelledBy: 'customer' | 'admin' | null;
  cancelledAtMs: number | null;
  /** A checkout on this site that was never paid for: nobody was going out on it. */
  checkoutOnly: boolean;
}

export interface FeedBlackout {
  id: string;
  date: string;
  affectedSlots: string[];
  reason: FeedBlackoutReason | null;
  createdAtMs: number | null;
}

type Millis = { toMillis(): number };

function millis(v: unknown): number | null {
  if (v && typeof (v as Millis).toMillis === 'function') return (v as Millis).toMillis();
  return null;
}

/**
 * A Firestore booking doc to the fields the feed uses. Everything else on
 * it (customer and guest names, emails, phones, payments, notes) stays
 * behind; the route also only asks Firestore for {@link BOOKING_FIELDS}.
 */
export function toFeedBooking(id: string, d: Record<string, unknown>): FeedBooking {
  const closure = d.closure as { blackoutId?: unknown; reason?: unknown } | null | undefined;
  const legacy = id.startsWith('legacy-') || !!d.legacy;
  const paymentStatus = d.paymentStatus;
  return {
    id,
    date: String(d.date ?? ''),
    timeSlot: d.timeSlot as TourTimeSlot,
    type: d.type === 'private' ? 'private' : 'shared',
    guestCount: typeof d.guestCount === 'number' && d.guestCount > 0 ? d.guestCount : 0,
    status: d.status as FeedBookingStatus,
    legacy,
    closure:
      closure && typeof closure.blackoutId === 'string'
        ? { blackoutId: closure.blackoutId, reason: typeof closure.reason === 'string' ? closure.reason : '' }
        : null,
    cancelledBy: d.cancelledBy === 'customer' || d.cancelledBy === 'admin' ? d.cancelledBy : null,
    cancelledAtMs: millis(d.cancelledAt),
    checkoutOnly: !legacy && (paymentStatus === 'pending' || paymentStatus === 'failed'),
  };
}

/** The booking fields {@link toFeedBooking} reads, for Firestore's `select`. */
export const BOOKING_FIELDS = [
  'date',
  'timeSlot',
  'type',
  'guestCount',
  'status',
  'paymentStatus',
  'cancelledBy',
  'cancelledAt',
  'closure.blackoutId',
  'closure.reason',
  'legacy.bookingId',
] as const;

export function toFeedBlackout(id: string, d: Record<string, unknown>): FeedBlackout {
  const reason = d.reason;
  return {
    id,
    date: String(d.date ?? ''),
    affectedSlots: Array.isArray(d.affectedSlots) ? d.affectedSlots.map(String) : [],
    reason:
      reason === 'weather' || reason === 'maintenance' || reason === 'personal' || reason === 'other' ? reason : null,
    createdAtMs: millis(d.createdAt),
  };
}

/**
 * What the server remembers about each departure it has put in a feed
 * (`crewCalendarDepartures/{date}_{slot}`): a fingerprint of the event's
 * content, and the SEQUENCE that goes up each time the content changes.
 */
export interface DepartureRecord {
  date: string;
  timeSlot: TourTimeSlot;
  type: TourType;
  /** `removed`: it was in the feed and dropped out (every booking cancelled, say). */
  status: DepartureStatus | 'removed';
  fingerprint: string;
  sequence: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export type DepartureStatus = 'on' | 'cancelled';

/* -------------------------------------------------------------------------- */
/* Which departures go in the feed                                            */
/* -------------------------------------------------------------------------- */

export interface DeparturePlan {
  /** `2026-10-17_morning`: the UID's first half and the record's doc id. */
  id: string;
  date: string;
  timeSlot: TourTimeSlot;
  type: TourType;
  status: DepartureStatus;
  /** Guests on the bookings going out (0 for a cancelled departure). */
  guests: number;
  bookings: number;
  /** Old-site bookings with no party size on file. */
  unknownPartyBookings: number;
  /** Why it was closed; for a departure that's on, why it's closed to new bookings. */
  reason: FeedBlackoutReason | null;
  /** A departure that's on, but Travis has closed it to new bookings. */
  closedToNew: boolean;
}

export function departureId(date: string, timeSlot: TourTimeSlot): string {
  return `${date}_${timeSlot}`;
}

/** `YYYY-MM-DD` plus `n` days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** The marina dates the feed covers: the last 14 days and the next 120. */
export function feedWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -FEED_DAYS_BACK), to: addDays(today, FEED_DAYS_AHEAD) };
}

/**
 * A booking with guests going out on that departure: confirmed, or an
 * old-site booking imported as pending-payment, the crew app's rule
 * (fetchCrewSchedule in src/lib/crew-server.ts). Completed bookings keep
 * past trips in the calendar once Travis marks them; no-shows didn't go.
 * A booking waiting on a closure choice isn't going out.
 */
function isGoingOut(b: FeedBooking): boolean {
  if (b.status === 'completed') return true;
  if (b.closure) return false;
  return b.status === 'confirmed' || (b.status === 'pending-payment' && b.legacy);
}

/**
 * Same rule as closing a day (adminBlackouts.ts): 'all', the slot itself,
 * or for the whole-day charter, any departure inside its hours.
 */
function covers(blackout: FeedBlackout, slot: TourTimeSlot): boolean {
  const s = blackout.affectedSlots;
  if (s.includes('all') || s.includes(slot)) return true;
  return slot === 'whole-day' && WHOLE_DAY_OVERLAPS.some((o) => s.includes(o));
}

/** What PR #28 tells customers, back to the blackout reason (for a closure whose blackout was since deleted). */
const CLOSURE_REASON_TEXT: Record<string, FeedBlackoutReason> = {
  'Closed for weather': 'weather',
  'Closed for boat maintenance': 'maintenance',
};

function latestFirst(a: FeedBlackout, b: FeedBlackout): number {
  return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
}

const KNOWN_SLOTS = new Set<TourTimeSlot>(tours.map((t) => t.timeSlot));

/**
 * Every departure in [from, to] for the feed:
 *
 *  - **On:** it has bookings going out. Their guests are counted.
 *  - **Cancelled:** Travis closed it and it had bookings. Any of: bookings
 *    waiting on (or settled from) a closure offer; bookings Travis
 *    cancelled after a blackout covering it went up (closing a day with
 *    "cancel them"); or it was already in calendars and a blackout now
 *    covers it, so it doesn't vanish once everyone offered a new date has
 *    moved.
 *
 * Anything else (no bookings, or only customer cancellations) is left out,
 * and drops off calendars that had it.
 */
export function planDepartures(input: {
  bookings: readonly FeedBooking[];
  blackouts: readonly FeedBlackout[];
  records: ReadonlyMap<string, DepartureRecord>;
  from: string;
  to: string;
}): DeparturePlan[] {
  const { from, to } = input;
  const groups = new Map<string, { date: string; timeSlot: TourTimeSlot; bookings: FeedBooking[] }>();
  const group = (date: string, timeSlot: TourTimeSlot) => {
    const id = departureId(date, timeSlot);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { date, timeSlot, bookings: [] }));
    return g;
  };
  for (const b of input.bookings) {
    if (b.date < from || b.date > to || !KNOWN_SLOTS.has(b.timeSlot)) continue;
    group(b.date, b.timeSlot).bookings.push(b);
  }
  for (const r of input.records.values()) {
    if (r.status !== 'removed' && r.date >= from && r.date <= to && KNOWN_SLOTS.has(r.timeSlot)) {
      group(r.date, r.timeSlot);
    }
  }

  const plans: DeparturePlan[] = [];
  for (const [id, { date, timeSlot, bookings }] of groups) {
    const covering = input.blackouts
      .filter((bo) => bo.date === date && covers(bo, timeSlot))
      .sort(latestFirst);
    const latestReason = covering.find((bo) => bo.reason)?.reason ?? null;
    const typeOf = (list: FeedBooking[]): TourType | null =>
      list.length === 0 ? null : list.some((b) => b.type === 'private') ? 'private' : 'shared';

    const going = bookings.filter(isGoingOut);
    if (going.length > 0) {
      const known = going.filter((b) => b.guestCount > 0);
      plans.push({
        id,
        date,
        timeSlot,
        type: typeOf(going)!,
        status: 'on',
        guests: known.reduce((sum, b) => sum + b.guestCount, 0),
        bookings: going.length,
        unknownPartyBookings: going.length - known.length,
        reason: covering.length > 0 ? latestReason : null,
        closedToNew: covering.length > 0,
      });
      continue;
    }

    const offered = bookings.filter(
      (b) => b.closure && (b.status === 'confirmed' || b.status === 'pending-payment' || b.status === 'cancelled'),
    );
    const cancelledByClose = bookings.filter(
      (b) =>
        b.status === 'cancelled' &&
        !b.closure &&
        !b.checkoutOnly &&
        b.cancelledBy === 'admin' &&
        b.cancelledAtMs != null &&
        covering.some((bo) => bo.createdAtMs != null && bo.createdAtMs <= b.cancelledAtMs!),
    );
    // Already in calendars, and now closed: show it called off rather than
    // let it vanish (everyone offered a new date has moved, say).
    const record = input.records.get(id);
    const wasShown = record?.status === 'on' || record?.status === 'cancelled';
    if (offered.length === 0 && cancelledByClose.length === 0 && !(wasShown && covering.length > 0)) continue;

    let reason: FeedBlackoutReason | null = latestReason;
    if (offered.length > 0) {
      const { blackoutId, reason: told } = offered[0]!.closure!;
      const blackout = input.blackouts.find((bo) => bo.id === blackoutId);
      reason = blackout ? blackout.reason : (CLOSURE_REASON_TEXT[told] ?? latestReason);
    }
    plans.push({
      id,
      date,
      timeSlot,
      type: typeOf([...offered, ...cancelledByClose]) ?? record?.type ?? 'shared',
      status: 'cancelled',
      guests: 0,
      bookings: 0,
      unknownPartyBookings: 0,
      reason,
      closedToNew: false,
    });
  }

  return plans.sort((a, b) => a.date.localeCompare(b.date) || startTime(a).localeCompare(startTime(b)));
}

/* -------------------------------------------------------------------------- */
/* One event                                                                  */
/* -------------------------------------------------------------------------- */

function tourFor(plan: Pick<DeparturePlan, 'timeSlot' | 'type'>) {
  return (
    tours.find((t) => t.timeSlot === plan.timeSlot && t.type === plan.type) ??
    tours.find((t) => t.timeSlot === plan.timeSlot)!
  );
}

function startTime(plan: Pick<DeparturePlan, 'timeSlot' | 'type'>): string {
  return tourFor(plan).startTime;
}

/** `13:00` → `1:00`. The calendar shows AM/PM next to the title already. */
function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
}

function kindLabel(plan: Pick<DeparturePlan, 'timeSlot' | 'type'>): string {
  if (plan.timeSlot === 'whole-day') return 'whole-day charter';
  return plan.type === 'private' ? 'private' : 'shared';
}

/** In a title: "weather" in `CANCELLED (weather): 8:00 shared`. */
const REASON_LABEL: Record<FeedBlackoutReason, string | null> = {
  weather: 'weather',
  maintenance: 'boat maintenance',
  personal: 'personal',
  other: null,
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function guestsLabel(plan: DeparturePlan): string {
  if (plan.unknownPartyBookings === 0) return plural(plan.guests, 'guest');
  return plan.guests > 0 ? `${plan.guests}+ guests` : 'party size unknown';
}

/** `8:00 shared · 6 guests`, or `CANCELLED (weather): 8:00 shared`. */
export function eventTitle(plan: DeparturePlan): string {
  const what = `${clock(startTime(plan))} ${kindLabel(plan)}`;
  if (plan.status === 'cancelled') {
    const why = plan.reason ? REASON_LABEL[plan.reason] : null;
    return why ? `CANCELLED (${why}): ${what}` : `CANCELLED: ${what}`;
  }
  return `${what} · ${guestsLabel(plan)}`;
}

function description(plan: DeparturePlan, appUrl: string): string {
  const tour = tourFor(plan);
  const why = plan.reason ? REASON_LABEL[plan.reason] : null;
  const lines: string[] = [];
  if (plan.status === 'cancelled') {
    lines.push(`Travis closed this departure${why ? ` (${why})` : ''}. It isn't going out.`);
  } else {
    lines.push(`${plural(plan.guests, 'guest')} on ${plural(plan.bookings, 'booking')}.`);
    if (plan.unknownPartyBookings > 0) {
      lines.push(
        `Party size not on file for ${plural(plan.unknownPartyBookings, 'booking')} from the old website.`,
      );
    }
    // Wetsuit sizes: bookings only record each guest's name and age
    // (BookingGuest in src/lib/firebase/types.ts), not a size, so there's
    // nothing to tally. Add a size tally here if the booking form ever asks.
    //
    // Hook for waivers (being built on another branch): an "Unsigned
    // waivers: N (sign at the dock)" line and the dock check-in link go
    // here. Counts and links only, never names.
    if (plan.closedToNew) {
      lines.push(`Closed to new bookings${why ? ` (${why})` : ''}.`);
    }
  }
  const tourLabel =
    plan.timeSlot === 'whole-day' ? 'Whole-day private charter' : plan.type === 'private' ? 'Private tour' : 'Shared tour';
  lines.push(`${tourLabel}, ${tour.startTimeDisplay} to ${tour.endTimeDisplay}.`);
  lines.push('', `Latest details in the crew app (sign in): ${appUrl}`);
  return lines.join('\n');
}

export interface RenderedEvent {
  id: string;
  plan: DeparturePlan;
  /**
   * The VEVENT's lines between BEGIN and END, except UID, DTSTAMP,
   * CREATED, LAST-MODIFIED and SEQUENCE, which {@link buildFeed} adds from
   * the departure's record.
   */
  lines: string[];
  /** SHA-256 of the event's content: when it changes, SEQUENCE goes up. */
  fingerprint: string;
}

function eventLines(plan: DeparturePlan, appUrl: string): string[] {
  const tour = tourFor(plan);
  const title = eventTitle(plan);
  const minutes = Math.round(tour.durationHours * 60);
  return [
    `DTSTART;TZID=${MARINA_TZID}:${localDateTime(plan.date, tour.startTime)}`,
    `DTEND;TZID=${MARINA_TZID}:${localDateTime(plan.date, tour.startTime, minutes)}`,
    `SUMMARY:${escapeText(title)}`,
    `LOCATION:${escapeText(MARINA_LOCATION)}`,
    `DESCRIPTION:${escapeText(description(plan, appUrl))}`,
    `URL:${appUrl}`,
    `STATUS:${plan.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    // Cancelled trips don't block the crew's time.
    `TRANSP:${plan.status === 'cancelled' ? 'TRANSPARENT' : 'OPAQUE'}`,
    ...(plan.status === 'cancelled'
      ? []
      : [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${escapeText(title)}`,
          `TRIGGER:-PT${ALARM_MINUTES_BEFORE}M`,
          'END:VALARM',
        ]),
  ];
}

/**
 * One departure's event. `appUrl` is the crew app on the host the feed was
 * fetched from (the link Travis emailed may be on the staging host). The
 * fingerprint always uses {@link CREW_APP_URL}, so feeds fetched on
 * different hosts agree on when an event changed.
 */
export function renderEvent(plan: DeparturePlan, opts: { appUrl?: string } = {}): RenderedEvent {
  const canonical = eventLines(plan, CREW_APP_URL);
  return {
    id: plan.id,
    plan,
    lines: opts.appUrl && opts.appUrl !== CREW_APP_URL ? eventLines(plan, opts.appUrl) : canonical,
    fingerprint: createHash('sha256').update(canonical.join('\n')).digest('hex'),
  };
}

/**
 * The departure's record after this render: null (no write) if the
 * fingerprint matches, else the next SEQUENCE (0 the first time) stamped
 * `nowMs`.
 */
export function nextRecord(
  prev: DepartureRecord | undefined,
  event: RenderedEvent,
  nowMs: number,
): DepartureRecord | null {
  if (prev && prev.fingerprint === event.fingerprint) return null;
  const { date, timeSlot, type, status } = event.plan;
  return {
    date,
    timeSlot,
    type,
    status,
    fingerprint: event.fingerprint,
    sequence: prev ? prev.sequence + 1 : 0,
    createdAtMs: prev?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
  };
}

const REMOVED = 'removed';

/**
 * A departure that was in the feed and isn't any more: its record is
 * marked removed with the next SEQUENCE, so if it comes back (a new
 * booking on it) its SEQUENCE is higher than anything a calendar has seen.
 * Null if it was already marked.
 */
export function removedRecord(prev: DepartureRecord, nowMs: number): DepartureRecord | null {
  if (prev.status === REMOVED) return null;
  return { ...prev, status: REMOVED, fingerprint: REMOVED, sequence: prev.sequence + 1, updatedAtMs: nowMs };
}

/* -------------------------------------------------------------------------- */
/* The feed                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The whole VCALENDAR. Each event needs its departure's current record
 * (after {@link nextRecord}).
 *
 * No METHOD: this is a subscription, not an iTIP message, so DTSTAMP is
 * when the event last changed (RFC 5545 §3.8.7.2) and stays put between
 * fetches, like LAST-MODIFIED.
 */
export function buildFeed(events: ReadonlyArray<{ event: RenderedEvent; record: DepartureRecord }>): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Crystal River Manatee Fun//Crew calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(CALENDAR_NAME)}`,
    `NAME:${escapeText(CALENDAR_NAME)}`,
    `X-WR-CALDESC:${escapeText('Booked departures for the crew, Crystal River time. No guest details.')}`,
    `X-WR-TIMEZONE:${MARINA_TZID}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
    ...NEW_YORK_VTIMEZONE,
  ];
  for (const { event, record } of events) {
    const changed = utcDateTime(new Date(record.updatedAtMs));
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@${UID_DOMAIN}`,
      `DTSTAMP:${changed}`,
      `CREATED:${utcDateTime(new Date(record.createdAtMs))}`,
      `LAST-MODIFIED:${changed}`,
      `SEQUENCE:${record.sequence}`,
      ...event.lines,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return serializeLines(lines);
}
